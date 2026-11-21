import { getReviews } from './reviews.js';
import { createServer } from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
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
// Olena may add appointments further ahead and in blocked time; customers book up to four weeks ahead.
const adminSlots = duration => slots({ includeBlocked: true, duration, days: 366 });
// Limits per visitor stop one person from filling the calendar with fake online bookings.
const bookingLimits = [{ window: 60 * 60 * 1000, max: 3 }, { window: 24 * 60 * 60 * 1000, max: 6 }];
const maxUpcomingPerPhone = 2;
const bookingAttempts = new Map();
function clientAddress(req) {
  const socket = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  // Behind the host's own proxy, the last forwarded address is the visitor as seen by that proxy.
  const local = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd])/.test(socket);
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
  return local && forwarded.length ? forwarded.at(-1) : socket;
}
function bookingAllowed(address) {
  const now = Date.now();
  const longest = Math.max(...bookingLimits.map(limit => limit.window));
  const recent = (bookingAttempts.get(address) || []).filter(time => now - time < longest);
  bookingAttempts.set(address, recent);
  return bookingLimits.every(limit => recent.filter(time => now - time < limit.window).length < limit.max);
}
function recordBooking(address) {
  bookingAttempts.get(address).push(Date.now());
}
setInterval(() => {
  const longest = Math.max(...bookingLimits.map(limit => limit.window));
  for (const [address, times] of bookingAttempts) {
    if (!times.some(time => Date.now() - time < longest)) bookingAttempts.delete(address);
  }
}, 60 * 60 * 1000).unref();
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminPassword && adminPassword.length < 16) throw new Error('ADMIN_PASSWORD must be at least 16 characters.');
const hash = (value) => createHash('sha256').update(value).digest();
const adminHash = adminPassword && hash('Basic ' + Buffer.from('olena:' + adminPassword).toString('base64'));
const assets = new Map(Object.entries({
  '/': ['index.html', 'text/html; charset=utf-8'],
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
  '/planner-translations.json': ['../planner-translations.json', 'application/json; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
}).map(([route, [file,type]]) => [route,[readFileSync(new URL('./public/' + file, import.meta.url)),type]]));
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
createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://*.googleusercontent.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const requestedLanguage = new URL(req.url, 'http://localhost').searchParams.get('lang');
  const language = ['nl', 'en', 'uk'].includes(requestedLanguage) ? requestedLanguage : (req.url.split('?')[0] === '/admin' ? 'en' : 'nl');
  const english = language === 'en';
  const reply = (status, data) => {
    if (language !== 'nl' && data?.error) data = { ...data, error: (language === 'uk' ? ukrainianTranslations : translations)[data.error] || data.error };
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
  };
  const route = req.url.split('?')[0];
  try {
    if (route === '/admin' || route.startsWith('/api/admin/')) {
      if (!adminHash) return reply(503, { error: 'Beheer is nog niet ingesteld.' });
      if (!timingSafeEqual(adminHash, hash(req.headers.authorization || ''))) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Olena Studio", charset="UTF-8"');
        return reply(401, { error: 'Log in om afspraken te beheren.' });
      }
    }
    if (req.method === 'GET' && assets.has(route)) {
      const [body, type] = assets.get(route === '/' && language !== 'nl' ? '/index.' + language + '.html' : route);
      res.writeHead(200, { 'Content-Type': type });
      if (route === '/admin') {
        let html = body.toString().replace('<html lang="en">', '<html lang="' + language + '">');
        if (language !== 'en') {
          const translations = plannerTranslations[language];
          const pattern = Object.keys(translations).sort((a,b) => b.length - a.length)
            .map(text => text.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')).join('|');
          html = html.replace(new RegExp(pattern, 'g'), text => translations[text]);
        }
        html = html.replaceAll('href="/?lang=en"', 'href="/?lang=' + language + '"');
        html = html.replaceAll(' aria-current="page"', '');
        html = html.replace('href="/admin?lang=' + language + '"', 'aria-current="page" href="/admin?lang=' + language + '"');
        html = html.replace('<!--PLANNER_HELP-->', plannerHelp[language]);
        return res.end(html);
      }
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
      const whatsapp = process.env.WHATSAPP_NUMBER || '';
      const serviceId = new URL(req.url, 'http://localhost').searchParams.get('service');
      const configured = configuredServices();
      const selected = configured.find(item => item.id === serviceId) || configured[0];
      return reply(200, { services: configured.map(item => language !== 'nl' ? { ...item, ...item[language] } : item), slots: slots({ duration: selected.duration + selected.buffer }), whatsapp: /^\d{8,15}$/.test(whatsapp) ? whatsapp : '' });
    }
    if (req.method === 'GET' && route === '/api/admin/availability') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const selected = configuredServices().find(item => item.id === params.get('service'));
      if (!selected) return reply(400, { error: 'Ongeldig verzoek.' });
      return reply(200, adminSlots(selected.duration + selected.buffer).filter(slot => slot.day === params.get('day')).map(slot => slot.time));
    }
    if (req.method === 'POST' && ['/api/bookings', '/api/admin/bookings'].includes(route)) {
      const admin = route === '/api/admin/bookings';
      const body = await readBody(req).catch(() => null);
      if (!body) return reply(400, { error: 'Ongeldig verzoek.' });
      // Hidden field that people never see; automated form fillers often complete it.
      if (!admin && body.website) return reply(400, { error: 'Ongeldig verzoek.' });
      const address = clientAddress(req);
      if (!admin && !bookingAllowed(address)) return reply(429, { error: 'Je hebt al meerdere afspraken geboekt. Bel of stuur Olena een WhatsApp voor een extra afspraak.' });
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      const phoneDigits = phone.replace(/\D/g, '');
      if (!name || name.length > 100 || phone.length > 30 || !/^\+?[0-9 ()\.\-]+$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15 ||
          !services.some(service => service.id === body.service)) return reply(400, { error: 'Controleer je naam, telefoonnummer en behandeling.' });
      const id = randomUUID();
      const saved = transaction(() => {
        const selected = configuredServices().find(item => item.id === body.service);
        if (!admin) {
          const [today] = local.format(new Date()).split(' ');
          const upcoming = db.prepare("SELECT phone FROM bookings WHERE day >= ? AND status != 'declined'").all(today)
            .filter(booking => booking.phone.replace(/\D/g, '') === phoneDigits).length;
          if (upcoming >= maxUpcomingPerPhone) return 'phone';
        }
        const available = admin ? adminSlots(selected.duration + selected.buffer) : slots({ duration: selected.duration + selected.buffer });
        if (!available.some(slot => slot.day === body.day && slot.time === body.time)) return false;
        db.prepare("INSERT INTO bookings (id,day,time,service,name,email,status,duration,phone,buffer) VALUES (?,?,?,?,?,?,'confirmed',?,?,?)")
          .run(id, body.day, body.time, body.service, name, '', selected.duration, phone, selected.buffer);
        return true;
      });
      if (saved === 'phone') return reply(429, { error: 'Met dit telefoonnummer staan al twee afspraken gepland. Bel of stuur Olena een WhatsApp voor een extra afspraak.' });
      if (!saved) return reply(409, { error: 'Dit tijdslot is niet meer beschikbaar.' });
      if (!admin) recordBooking(address);
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
    return reply(404, { error: 'Pagina niet gevonden.' });
  } catch (error) {
    console.error(error.code || error.name);
    if (!res.headersSent) reply(500, { error: 'Er ging iets mis. Probeer het opnieuw.' });
  }
}).listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0');
