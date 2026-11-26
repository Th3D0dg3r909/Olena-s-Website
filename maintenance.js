// "Opening soon" mode: while MAINTENANCE_MODE=true, visitors see a holding page. Olena sees the full site when
// logged in to the planner; others get in with MAINTENANCE_ACCESS_CODE, which sets a preview cookie for 30 days.
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const MIN_CODE_LENGTH = 12;
const COOKIE_DAYS = 30;

export function createMaintenance({ db, env = process.env, now = () => Date.now(), log = console, secureCookies = true }) {
  // Accept the usual ways of writing "on" (true, TRUE, "true", 1, yes, on, ja, aan). An unrecognised value keeps the
  // site open but is logged, so a typo in the hosting panel is easy to find.
  const setting = String(env.MAINTENANCE_MODE ?? '').trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  const enabled = ['true', '1', 'yes', 'on', 'ja', 'aan'].includes(setting);
  if (setting && !enabled && !['false', '0', 'no', 'off', 'nee', 'uit'].includes(setting)) {
    log.error('MAINTENANCE_MODE has an unrecognised value, so the website is open. Use true to show the "Opening soon" page.');
  }
  let code = env.MAINTENANCE_ACCESS_CODE || '';
  if (enabled && code && [...code].length < MIN_CODE_LENGTH) {
    log.error('MAINTENANCE_ACCESS_CODE is ignored: it must be at least ' + MIN_CODE_LENGTH + ' characters. Only a planner login gives access.');
    code = '';
  }
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  let key = db.prepare("SELECT value FROM settings WHERE key = 'preview_key'").get()?.value;
  if (!key) {
    key = randomBytes(32).toString('base64');
    db.prepare("INSERT INTO settings (key, value) VALUES ('preview_key', ?)").run(key);
  }
  // The cookie proves knowledge of the current code without containing it; a new code invalidates old cookies.
  const proof = code ? createHmac('sha256', key).update('preview:' + code).digest('base64url') : null;
  const cookieName = secureCookies ? '__Host-olena_preview' : 'olena_preview';
  const cookie = (value, maxAge) => cookieName + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secureCookies ? '; Secure' : '');
  const windowMs = 15 * 60 * 1000;
  const failures = { addresses: new Map(), overall: [] };
  const recent = list => list.filter(time => now() - time < windowMs);

  function readCookie(req) {
    for (const part of String(req.headers.cookie || '').split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === cookieName) return value.join('=');
    }
    return null;
  }
  return {
    enabled,
    codeConfigured: Boolean(code),
    hasPreviewCookie(req) {
      const value = readCookie(req);
      return Boolean(proof && value && value.length === proof.length && timingSafeEqual(Buffer.from(value), Buffer.from(proof)));
    },
    // Returns { ok, status, error, cookie? }. Errors are Dutch keys translated by the server.
    tryCode(input, address) {
      if (!code) return { ok: false, status: 404, error: 'Er is geen toegangscode ingesteld.' };
      failures.overall = recent(failures.overall);
      const own = address === null ? [] : recent(failures.addresses.get(address) || []);
      if (own.length >= 10 || failures.overall.length >= 50) {
        return { ok: false, status: 429, error: 'Te veel pogingen. Probeer het over 15 minuten opnieuw.' };
      }
      const given = typeof input === 'string' ? input.trim() : '';
      const expected = createHmac('sha256', key).update('preview:' + code).digest();
      const actual = createHmac('sha256', key).update('preview:' + given).digest();
      if (!given || given.length > 200 || !timingSafeEqual(expected, actual)) {
        failures.overall.push(now());
        if (address !== null) failures.addresses.set(address, [...own, now()]);
        return { ok: false, status: 401, error: 'Onjuiste toegangscode.' };
      }
      return { ok: true, status: 200, cookie: cookie(proof, COOKIE_DAYS * 24 * 60 * 60) };
    },
    clearCookie: () => cookie('', 0),
  };
}
