// Admin login for Olena's planner: one administrator account configured through environment variables,
// scrypt password verification, random session tokens of which only hashes are stored, server-side idle and
// maximum lifetimes, and limits on repeated failed logins.
import { randomBytes, scrypt, scryptSync, createHash, timingSafeEqual } from 'node:crypto';

const MIN_PASSWORD_LENGTH = 16;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const sha256 = value => createHash('sha256').update(value).digest();
const between = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) && value !== undefined && value !== '' ? Math.min(Math.max(number, min), max) : fallback;
};
const deriveAsync = (password, salt) => new Promise((resolve, reject) =>
  scrypt(password.normalize('NFC'), salt, 32, SCRYPT, (error, key) => error ? reject(error) : resolve(key)));

export function createAuth({ db, env = process.env, now = () => Date.now(), log = console, secureCookies = true }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, credential TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
  `);
  const username = String(env.ADMIN_USERNAME || 'olena').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD || '';
  let problem = null;
  if (!password) problem = 'ADMIN_PASSWORD is not set';
  else if ([...password].length < MIN_PASSWORD_LENGTH) problem = 'ADMIN_PASSWORD is shorter than the required ' + MIN_PASSWORD_LENGTH + ' characters';
  if (problem) log.error('Admin login disabled: ' + problem + '. The public website keeps running; set a valid password in the hosting environment and restart.');

  // A random salt per database; the password itself is never stored, only kept as an scrypt key in memory.
  let salt = db.prepare("SELECT value FROM settings WHERE key = 'password_salt'").get()?.value;
  if (!salt) {
    salt = randomBytes(16).toString('base64');
    db.prepare("INSERT INTO settings (key, value) VALUES ('password_salt', ?)").run(salt);
  }
  const verifier = problem ? null : scryptSync(password.normalize('NFC'), salt, 32, SCRYPT);
  // Sessions belong to the current password: changing ADMIN_PASSWORD signs out every existing session.
  const credential = verifier ? sha256(verifier).toString('hex') : null;
  db.prepare('DELETE FROM admin_sessions WHERE credential != ?').run(credential || '');

  const idleMs = between(env.ADMIN_SESSION_IDLE_MINUTES, 30, 5, 240) * 60 * 1000;
  const maxMs = between(env.ADMIN_SESSION_MAX_HOURS, 12, 1, 72) * 60 * 60 * 1000;
  const cookieName = secureCookies ? '__Host-olena_admin' : 'olena_admin';
  const windowMs = 15 * 60 * 1000;
  const limits = { perAddress: 5, overall: 20 };
  const failures = { addresses: new Map(), overall: [] };

  const recent = list => list.filter(time => now() - time < windowMs);
  function blockedFor(address) {
    failures.overall = recent(failures.overall);
    const own = address === null ? [] : recent(failures.addresses.get(address) || []);
    if (address !== null) failures.addresses.set(address, own);
    const limited = [own.length >= limits.perAddress && own, failures.overall.length >= limits.overall && failures.overall].filter(Boolean);
    if (!limited.length) return 0;
    return Math.max(...limited.map(list => list[list.length - limits[list === own ? 'perAddress' : 'overall']] + windowMs - now()));
  }
  function recordFailure(address) {
    failures.overall.push(now());
    if (address !== null) failures.addresses.set(address, [...(failures.addresses.get(address) || []), now()]);
  }

  function readToken(req) {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === cookieName) return value.join('=');
    }
    return null;
  }
  const cookie = (value, maxAge) => cookieName + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secureCookies ? '; Secure' : '');

  return {
    configured: !problem,
    cookieName,
    idleMinutes: idleMs / 60000,
    // Returns { ok, status, error, retryAfter?, cookie? }. Errors are Dutch keys translated by the server.
    async login(input, address) {
      if (!verifier) return { ok: false, status: 503, error: 'Inloggen voor beheer is niet ingesteld.' };
      const wait = blockedFor(address);
      if (wait > 0) return { ok: false, status: 429, error: 'Te veel inlogpogingen. Probeer het over 15 minuten opnieuw.', retryAfter: Math.ceil(wait / 1000) };
      const givenName = typeof input?.username === 'string' ? input.username.trim().toLowerCase() : '';
      const givenPassword = typeof input?.password === 'string' ? input.password : '';
      if (!givenName || !givenPassword || givenName.length > 100 || givenPassword.length > 1024) {
        recordFailure(address);
        return { ok: false, status: 401, error: 'Gebruikersnaam of wachtwoord is onjuist.' };
      }
      // The password is always derived, so a wrong username takes as long as a wrong password.
      const key = await deriveAsync(givenPassword, salt);
      const valid = timingSafeEqual(sha256(givenName), sha256(username)) & timingSafeEqual(key, verifier);
      if (!valid) {
        recordFailure(address);
        return { ok: false, status: 401, error: 'Gebruikersnaam of wachtwoord is onjuist.' };
      }
      if (address !== null) failures.addresses.delete(address);
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO admin_sessions (token_hash, credential, created, last_seen) VALUES (?,?,?,?)')
        .run(sha256(token).toString('hex'), credential, now(), now());
      return { ok: true, status: 200, cookie: cookie(token, Math.floor(maxMs / 1000)) };
    },
    // Returns 'valid', 'expired' or 'none'. A valid session's idle timer restarts with each request.
    session(req) {
      if (!verifier) return 'none';
      const token = readToken(req);
      if (!token || token.length > 100) return 'none';
      const tokenHash = sha256(token).toString('hex');
      const row = db.prepare('SELECT credential, created, last_seen FROM admin_sessions WHERE token_hash = ?').get(tokenHash);
      if (!row || row.credential !== credential) return token ? 'expired' : 'none';
      if (now() - row.last_seen > idleMs || now() - row.created > maxMs) {
        db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
        return 'expired';
      }
      db.prepare('UPDATE admin_sessions SET last_seen = ? WHERE token_hash = ?').run(now(), tokenHash);
      return 'valid';
    },
    logout(req) {
      const token = readToken(req);
      if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token).toString('hex'));
      return cookie('', 0);
    },
    clearCookie: () => cookie('', 0),
    removeExpired() {
      db.prepare('DELETE FROM admin_sessions WHERE last_seen < ? OR created < ?').run(now() - idleMs, now() - maxMs);
      for (const [address, times] of failures.addresses) if (!recent(times).length) failures.addresses.delete(address);
    },
  };
}
