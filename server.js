import { getReviews } from './reviews.js';
import { createAuth } from './auth.js';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const translations = JSON.parse(readFileSync(new URL('./translations.json', import.meta.url)));
const ukrainianTranslations = JSON.parse(readFileSync(new URL('./translations.uk.json', import.meta.url)));
const plannerHelp = JSON.parse(readFileSync(new URL('./planner-help.json', import.meta.url)));
const plannerTranslations = JSON.parse(readFileSync(new URL('./planner-translations.json', import.meta.url)));
const services = JSON.parse(readFileSync(new URL('./services.json', import.meta.url)));
const path = process.env.DATABASE_PATH || './data/bookings.sqlite';
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path);
db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA secure_delete = ON;
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, day TEXT NOT NULL, time TEXT NOT NULL, service TEXT NOT NULL,
    name TEXT NOT NULL, email TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','confirmed','declined'))
  );
  CREATE TABLE IF NOT EXISTS blocked_slots (day TEXT NOT NULL, time TEXT NOT NULL, PRIMARY KEY(day,time));
  CREATE TABLE IF NOT EXISTS service_buffers (service_id TEXT PRIMARY KEY, minutes INTEGER NOT NULL CHECK(minutes >= 0 AND minutes <= 120));
  CREATE UNIQUE INDEX IF NOT EXISTS occupied_slot ON bookings(day,time) WHERE status != 'declined';
`);
const local = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'duration')) {
  db.exec('ALTER TABLE bookings ADD COLUMN duration INTEGER NOT NULL DEFAULT 60');
}
if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'phone')) {
  db.exec("ALTER TABLE bookings ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
}
if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'buffer')) {
  db.exec('ALTER TABLE bookings ADD COLUMN buffer INTEGER NOT NULL DEFAULT 0');
}
function configuredServices() {
  const overrides = new Map(db.prepare('SELECT service_id,minutes FROM service_buffers').all().map(row => [row.service_id, row.minutes]));
  return services.map(service => ({ ...service, buffer: overrides.get(service.id) ?? (service.en.category === 'BROWS & LASHES' ? 5 : 15) }));
}
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
function slots({ includeBlocked = false, duration = 60, days = 28 } = {}) {
  const [today, now] = local.format(new Date()).split(' ');
  const date = new Date(today + 'T00:00:00Z');
  const occupied = db.prepare("SELECT day,time,duration + buffer AS duration FROM bookings WHERE day >= ? AND status != 'declined'").all(today);
  if (!includeBlocked) {
    occupied.push(...db.prepare('SELECT day,time,60 AS duration FROM blocked_slots WHERE day >= ?').all(today));
  }
  const result = [];
  for (let offset = 0; offset < days; offset++, date.setUTCDate(date.getUTCDate() + 1)) {
    if (![2, 4, 6].includes(date.getUTCDay())) continue;
    const day = date.toISOString().slice(0, 10);
    for (let start = 600; start <= 1140 && start + duration <= 1260; start += 15) {
      const time = String(Math.floor(start / 60)).padStart(2, '0') + ':' + String(start % 60).padStart(2, '0');
      const overlap = occupied.some(item => item.day === day && start < minutes(item.time) + item.duration && start + duration > minutes(item.time));
      if ((day !== today || time > now) && !overlap) result.push({ day, time });
    }
  }
  return result;
}
// Personal data is kept for a limited time: bookings are deleted this many months after the appointment date.
const retentionMonths = Math.min(Math.max(Math.round(Number(process.env.BOOKING_RETENTION_MONTHS)) || 12, 1), 120);
function removeOldData() {
  const [today] = local.format(new Date()).split(' ');
  const cutoff = new Date(today + 'T00:00:00Z');
  cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);
  const removed = db.prepare('DELETE FROM bookings WHERE day < ?').run(cutoff.toISOString().slice(0, 10)).changes;
  db.prepare('DELETE FROM blocked_slots WHERE day < ?').run(today);
  if (removed) console.log('Removed ' + removed + ' bookings older than ' + retentionMonths + ' months.');
}
removeOldData();
setInterval(removeOldData, 24 * 60 * 60 * 1000).unref();
function transaction(action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
// Olena adds confirmed appointments herself, up to a year ahead and also in time she blocked.
const adminSlots = duration => slots({ includeBlocked: true, duration, days: 366 });
function clientAddress(req) {
  const socket = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  // Behind the host's own web server (LiteSpeed/Passenger connect through a local socket without an address),
  // the last forwarded address is the visitor as seen by that server. Unknown addresses return null.
  const local = !socket || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd])/.test(socket);
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!local) return socket;
  return forwarded.length ? forwarded.at(-1) : null;
}

// Public address of the website. The concept site and the final domain each set their own PUBLIC_URL.
function configuredUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url;
  } catch {
    console.error('PUBLIC_URL is ignored: use a full address such as https://www.example.nl without a path.');
    return null;
  }
}
const publicUrl = configuredUrl(process.env.PUBLIC_URL);
// Search engines are kept out unless ALLOW_INDEXING=true is set on the approved production site.
const allowIndexing = process.env.ALLOW_INDEXING === 'true';
const redirectToPublicUrl = process.env.REDIRECT_TO_PUBLIC_URL === 'true' && publicUrl !== null;
const secureCookies = publicUrl ? publicUrl.protocol === 'https:' : process.env.COOKIE_SECURE !== 'false';
const whatsappNumber = /^\d{8,15}$/.test(process.env.WHATSAPP_NUMBER || '') ? process.env.WHATSAPP_NUMBER : '31647238444';
const auth = createAuth({ db, secureCookies });
setInterval(() => auth.removeExpired(), 60 * 60 * 1000).unref();

const assets = new Map(Object.entries({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/privacy': ['privacy.html', 'text/html; charset=utf-8'],
  '/privacy.en.html': ['privacy.en.html', 'text/html; charset=utf-8'],
  '/privacy.uk.html': ['privacy.uk.html', 'text/html; charset=utf-8'],
  '/index.uk.html': ['index.uk.html', 'text/html; charset=utf-8'],
  '/translations.uk.json': ['../translations.uk.json', 'application/json; charset=utf-8'],
  '/index.en.html': ['index.en.html', 'text/html; charset=utf-8'],
  '/translations.json': ['../translations.json', 'application/json; charset=utf-8'],
  '/whatsapp-chat.js': ['whatsapp-chat.js', 'text/javascript; charset=utf-8'],
  '/whatsapp-chat.css': ['whatsapp-chat.css', 'text/css; charset=utf-8'],
  '/navigation.js': ['navigation.js', 'text/javascript; charset=utf-8'],
  '/logo.webp': ['logo.webp', 'image/webp'],
  '/studio-mobile.webp': ['studio-mobile.webp', 'image/webp'],
  '/logo.png': ['logo.png', 'image/png'],
  '/logo-transparent.svg': ['logo-transparent.svg', 'image/svg+xml'],
  '/studio.webp': ['studio.webp', 'image/webp'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/reviews.js': ['reviews.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
  // Not reachable by its own address: shown at /admin until Olena is logged in.
  'login.html': ['login.html', 'text/html; charset=utf-8'],
  '/login.js': ['login.js', 'text/javascript; charset=utf-8'],
  '/planner-translations.json': ['../planner-translations.json', 'application/json; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
}).map(([route, [file,type]]) => [route, [readFileSync(new URL('./public/' + file, import.meta.url)), type]]));
// Photos of Olena and her work: every WebP file in public/photos is served at /photos/<name>.
for (const name of readdirSync(new URL('./public/photos/', import.meta.url)).filter(name => /^[\w-]+\.webp$/.test(name))) {
  assets.set('/photos/' + name, [readFileSync(new URL('./public/photos/' + name, import.meta.url)), 'image/webp']);
}
// Each ?v= in a page is set to the linked file's content hash at startup, so an edited file always gets a new
// address and browsers never keep an outdated copy, even though linked files are cached for a year.
const versions = new Map([...assets].map(([route, [body]]) => [route, createHash('sha256').update(body).digest('hex').slice(0, 12)]));
// Public pages in each language, with their address on the public site for canonical links and the sitemap.
const publicPages = [['/', '/'], ['/index.en.html', '/?lang=en'], ['/index.uk.html', '/?lang=uk'],
  ['/privacy', '/privacy'], ['/privacy.en.html', '/privacy?lang=en'], ['/privacy.uk.html', '/privacy?lang=uk']];
const languageOf = address => address.match(/lang=(\w+)/)?.[1] || 'nl';
function alternates(address) {
  const base = address.split('?')[0];
  const links = publicPages.filter(([, other]) => other.split('?')[0] === base)
    .map(([, other]) => '<link rel="alternate" hreflang="' + languageOf(other) + '" href="' + new URL(other, publicUrl).href + '">');
  return '<link rel="canonical" href="' + new URL(address, publicUrl).href + '">' + links.join('') +
    '<link rel="alternate" hreflang="x-default" href="' + new URL(base, publicUrl).href + '">';
}
for (const [route, entry] of assets) {
  if (entry[1].startsWith('text/html')) {
    let html = entry[0].toString().replace(/(\/[\w./-]+)\?v=[\w-]+/g, (link, path) => versions.has(path) ? path + '?v=' + versions.get(path) : link);
    const page = publicPages.find(([file]) => file === route);
    if (page && publicUrl) html = html.replace('</head>', alternates(page[1]) + '\n</head>');
    entry[0] = Buffer.from(html);
  }
  entry.push('"' + createHash('sha256').update(entry[0]).digest('base64url').slice(0, 22) + '"');
}
// Pages that exist in Dutch, English and Ukrainian; ?lang= picks the file.
const localizedPages = { '/': '/index', '/privacy': '/privacy' };
async function readBody(req) {
  if (req.headers['content-type'] !== 'application/json' || req.headers['x-olena-request'] !== '1') throw new Error('Ongeldig verzoek.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error('Verzoek te groot.');
  }
  const value = JSON.parse(body);
  if (!value || typeof value !== 'object') throw new Error('Ongeldig verzoek.');
  return value;
}
// Planner and login pages are written in English and translated by replacing known texts.
function plannerPage(file, language, replacements = {}) {
  let html = assets.get(file)[0].toString().replace('<html lang="en">', '<html lang="' + language + '">');
  for (const [from, to] of Object.entries(replacements)) html = html.replace(from, to);
  if (language !== 'en') {
    const translations = plannerTranslations[language];
    const pattern = Object.keys(translations).sort((a,b) => b.length - a.length)
      .map(text => text.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')).join('|');
    html = html.replace(new RegExp(pattern, 'g'), text => translations[text]);
  }
  html = html.replaceAll('href="/?lang=en"', 'href="/?lang=' + language + '"');
  html = html.replaceAll(' aria-current="page"', '');
  html = html.replace('href="/admin?lang=' + language + '"', 'aria-current="page" href="/admin?lang=' + language + '"');
  return html.replace('<!--PLANNER_HELP-->', plannerHelp[language]);
}
// Requests that change data must come from this website itself, never from another site.
function sameSite(req) {
  // Browsers set Sec-Fetch-Site themselves and pages cannot change it; older browsers are checked by Origin.
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return origin === publicUrl?.origin || new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
function sitemap() {
  const entries = publicPages.map(([, address]) => '  <url><loc>' + new URL(address, publicUrl).href.replaceAll('&', '&amp;') + '</loc>' +
    publicPages.filter(([, other]) => other.split('?')[0] === address.split('?')[0])
      .map(([, other]) => '<xhtml:link rel="alternate" hreflang="' + languageOf(other) + '" href="' + new URL(other, publicUrl).href + '"/>').join('') + '</url>');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + entries.join('\n') + '\n</urlset>\n';
}
createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://*.googleusercontent.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store');
  const route = req.url.split('?')[0];
  const privateRoute = route === '/admin' || route.startsWith('/api/');
  // The concept site is never indexed; the approved production site sets ALLOW_INDEXING=true.
  if (!allowIndexing || privateRoute) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (redirectToPublicUrl && req.headers.host !== publicUrl.host) {
    res.writeHead(301, { Location: publicUrl.origin + req.url });
    return res.end();
  }
  const requestedLanguage = new URL(req.url, 'http://localhost').searchParams.get('lang');
  const language = ['nl', 'en', 'uk'].includes(requestedLanguage) ? requestedLanguage : (route === '/admin' ? 'en' : 'nl');
  const reply = (status, data) => {
    if (language !== 'nl' && data?.error) data = { ...data, error: (language === 'uk' ? ukrainianTranslations : translations)[data.error] || data.error };
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
  };
  try {
    const adminApi = route.startsWith('/api/admin/');
    if ((adminApi || route.startsWith('/api/auth/')) && (!sameSite(req) ||
        (!['GET', 'HEAD'].includes(req.method) && req.headers['x-olena-request'] !== '1'))) {
      return reply(403, { error: 'Dit verzoek is geweigerd omdat het niet van deze website komt.' });
    }
    if (adminApi) {
      if (!auth.configured) return reply(503, { error: 'Inloggen voor beheer is niet ingesteld.', code: 'not_configured' });
      const state = auth.session(req);
      if (state === 'expired') res.setHeader('Set-Cookie', auth.clearCookie());
      if (state !== 'valid') {
        return reply(401, state === 'expired'
          ? { error: 'Je sessie is verlopen. Log opnieuw in.', code: 'session_expired' }
          : { error: 'Log in om afspraken te beheren.', code: 'login_required' });
      }
    }
    if (req.method === 'GET' && route === '/admin') {
      const state = auth.configured ? auth.session(req) : 'not-configured';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (state === 'valid') return res.end(plannerPage('/admin', language));
      if (state === 'expired') res.setHeader('Set-Cookie', auth.clearCookie());
      // Nothing about appointments or clients is sent before login.
      return res.end(plannerPage('login.html', language, { 'data-state=""': 'data-state="' + state + '"' }));
    }
    if (req.method === 'POST' && route === '/api/auth/login') {
      const body = await readBody(req).catch(() => null);
      if (!body) return reply(400, { error: 'Ongeldig verzoek.' });
      const result = await auth.login(body, clientAddress(req));
      if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter));
      if (result.ok) res.setHeader('Set-Cookie', result.cookie);
      return reply(result.status, result.ok ? { ok: true } : { error: result.error });
    }
    if (req.method === 'POST' && route === '/api/auth/logout') {
      res.setHeader('Set-Cookie', auth.logout(req));
      return reply(200, { ok: true });
    }
    if (req.method === 'GET' && route === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(allowIndexing
        ? 'User-agent: *\nDisallow: /admin\nDisallow: /api/\n' + (publicUrl ? 'Sitemap: ' + new URL('/sitemap.xml', publicUrl).href + '\n' : '')
        : 'User-agent: *\nDisallow: /\n');
    }
    if (req.method === 'GET' && route === '/sitemap.xml' && publicUrl) {
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      return res.end(sitemap());
    }
    if (req.method === 'GET' && assets.has(route) && route !== '/admin') {
      const [body, type, etag] = assets.get(localizedPages[route] && language !== 'nl' ? localizedPages[route] + '.' + language + '.html' : route);
      // Files linked with ?v=<content hash> never change, so browsers may keep them for a year.
      // Pages and other files are checked with the server on each visit and only downloaded again when changed.
      const versioned = new URL(req.url, 'http://localhost').searchParams.has('v') && !type.startsWith('text/html');
      res.setHeader('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.setHeader('ETag', etag);
      if (String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(etag)) {
        res.writeHead(304);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': type });
      return res.end(body);
    }
    if (req.method === 'GET' && route === '/api/reviews') {
      try {
        const result = await getReviews(language);
        return reply(result.status, result.data);
      } catch {
        return reply(502, { error: 'Google reviews are temporarily unavailable.' });
      }
    }
    if (req.method === 'GET' && route === '/api/options') {
      // Treatments and the business WhatsApp number; customers request appointments, they do not book them.
      return reply(200, {
        services: services.map(({ id, category, name, description, price, durationLabel, ...item }) => ({
          id, price, ...(language === 'nl' ? { category, name, description } : item[language]), durationLabel,
        })),
        whatsapp: whatsappNumber,
      });
    }
    if (req.method === 'GET' && route === '/api/admin/availability') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const selected = configuredServices().find(item => item.id === params.get('service'));
      if (!selected) return reply(400, { error: 'Ongeldig verzoek.' });
      return reply(200, adminSlots(selected.duration + selected.buffer).filter(slot => slot.day === params.get('day')).map(slot => slot.time));
    }
    if (route === '/api/bookings') {
      // Online booking was replaced by requests via WhatsApp: only Olena confirms and enters appointments.
      return reply(410, { error: 'Online boeken is vervangen door een afspraakaanvraag via WhatsApp. Olena bevestigt elke afspraak persoonlijk.' });
    }
    if (req.method === 'POST' && route === '/api/admin/bookings') {
      const body = await readBody(req).catch(() => null);
      if (!body) return reply(400, { error: 'Ongeldig verzoek.' });
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      const phoneDigits = phone.replace(/\D/g, '');
      if (!name || name.length > 100 || phone.length > 30 || !/^\+?[0-9 ()\.\-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15 ||
          !services.some(service => service.id === body.service)) return reply(400, { error: 'Controleer je naam, telefoonnummer en behandeling.' });
      const id = randomUUID();
      const saved = transaction(() => {
        const selected = configuredServices().find(item => item.id === body.service);
        if (!adminSlots(selected.duration + selected.buffer).some(slot => slot.day === body.day && slot.time === body.time)) return false;
        db.prepare("INSERT INTO bookings (id,day,time,service,name,email,status,duration,phone,buffer) VALUES (?,?,?,?,?,?,'confirmed',?,?,?)")
          .run(id, body.day, body.time, body.service, name, '', selected.duration, phone, selected.buffer);
        return true;
      });
      if (!saved) return reply(409, { error: 'Dit tijdslot is niet meer beschikbaar.' });
      return reply(201, { id, status: 'confirmed', day: body.day, time: body.time, duration: services.find(item => item.id === body.service).duration });
    }
    if (route === '/api/admin/buffers' && req.method === 'GET') {
      return reply(200, configuredServices().map(service => ({
        id: service.id, name: language === 'nl' ? service.name : service[language].name,
        duration: service.duration, buffer: service.buffer
      })));
    }
    if (route === '/api/admin/buffers' && req.method === 'PATCH') {
      const body = await readBody(req).catch(() => null);
      if (!body || !services.some(service => service.id === body.id) ||
          !Number.isInteger(body.buffer) || body.buffer < 0 || body.buffer > 120) {
        return reply(400, { error: 'Ongeldig verzoek.' });
      }
      db.prepare('INSERT INTO service_buffers VALUES (?,?) ON CONFLICT(service_id) DO UPDATE SET minutes = excluded.minutes')
        .run(body.id, body.buffer);
      return reply(200, { buffer: body.buffer });
    }
    if (route === '/api/admin/planning' && req.method === 'GET') {
      const [today] = local.format(new Date()).split(' ');
      return reply(200, { today, free: slots().filter(slot => slot.time.endsWith(':00')), blocked: db.prepare('SELECT day,time FROM blocked_slots WHERE day >= ? ORDER BY day,time').all(today) });
    }
    if (route === '/api/admin/planning' && req.method === 'PATCH') {
      const body = await readBody(req).catch(() => null);
      if (!body || typeof body.day !== 'string' || typeof body.time !== 'string' || typeof body.blocked !== 'boolean') {
        return reply(400, { error: 'Kies een datum en tijdslot.' });
      }
      if (!body.blocked) {
        db.prepare('DELETE FROM blocked_slots WHERE day = ? AND time = ?').run(body.day, body.time);
        return reply(200, { blocked: false });
      }
      const saved = transaction(() => {
        if (!slots({ includeBlocked: true }).some(slot => slot.day === body.day && slot.time === body.time)) return false;
        return db.prepare('INSERT INTO blocked_slots VALUES (?,?) ON CONFLICT DO NOTHING').run(body.day, body.time).changes;
      });
      return saved ? reply(200, { blocked: true }) : reply(409, { error: 'Dit tijdslot is al bezet of geblokkeerd.' });
    }

    if (req.method === 'GET' && route === '/api/admin/bookings') {
      return reply(200, db.prepare('SELECT * FROM bookings ORDER BY day DESC,time DESC').all()
        .map(booking => {
          const service = services.find(service => service.id === booking.service);
          return { ...booking, service: (language === 'nl' ? service?.name : service?.[language]?.name) || booking.service };
        }));
    }
    if (req.method === 'PATCH' && route === '/api/admin/bookings') {
      const body = await readBody(req).catch(() => null);
      if (!body || typeof body.id !== 'string' || !['confirmed','declined'].includes(body.status)) return reply(400, { error: 'Ongeldig verzoek.' });
      const result = db.prepare("UPDATE bookings SET status = ? WHERE id = ? AND (status = 'pending' OR (status = 'confirmed' AND ? = 'declined'))").run(body.status, body.id, body.status);
      return result.changes ? reply(200, { status: body.status }) : reply(409, { error: 'Deze aanvraag is al verwerkt of bestaat niet.' });
    }
    if (req.method === 'DELETE' && route === '/api/admin/bookings') {
      // Removes a booking and the client's details completely, for example when a client asks for erasure.
      const body = await readBody(req).catch(() => null);
      if (!body || typeof body.id !== 'string') return reply(400, { error: 'Ongeldig verzoek.' });
      const result = db.prepare('DELETE FROM bookings WHERE id = ?').run(body.id);
      return result.changes ? reply(200, { deleted: true }) : reply(404, { error: 'Deze aanvraag is al verwerkt of bestaat niet.' });
    }
    return reply(404, { error: 'Pagina niet gevonden.' });
  } catch (error) {
    console.error(error.code || error.name);
    if (!res.headersSent) reply(500, { error: 'Er ging iets mis. Probeer het opnieuw.' });
  }
}).listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0');
