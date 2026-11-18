import { createServer } from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const translations = JSON.parse(readFileSync(new URL('./translations.json', import.meta.url)));
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
  CREATE UNIQUE INDEX IF NOT EXISTS occupied_slot ON bookings(day,time) WHERE status != 'declined';
`);
const local = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'duration')) {
  db.exec('ALTER TABLE bookings ADD COLUMN duration INTEGER NOT NULL DEFAULT 60');
}
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
function slots({ includeBlocked = false, duration = 60 } = {}) {
  const [today, now] = local.format(new Date()).split(' ');
  const date = new Date(today + 'T00:00:00Z');
  const occupied = db.prepare("SELECT day,time,duration FROM bookings WHERE day >= ? AND status != 'declined'").all(today);
  if (!includeBlocked) {
    occupied.push(...db.prepare('SELECT day,time,60 AS duration FROM blocked_slots WHERE day >= ?').all(today));
  }
  const result = [];
  for (let offset = 0; offset < 28; offset++, date.setUTCDate(date.getUTCDate() + 1)) {
    if ([0, 6].includes(date.getUTCDay())) continue;
    const day = date.toISOString().slice(0, 10);
    for (let start = 600; start + duration <= 1020; start += 15) {
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
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminPassword && adminPassword.length < 16) throw new Error('ADMIN_PASSWORD must be at least 16 characters.');
const hash = (value) => createHash('sha256').update(value).digest();
const adminHash = adminPassword && hash('Basic ' + Buffer.from('olena:' + adminPassword).toString('base64'));
const assets = new Map(Object.entries({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.en.html': ['index.en.html', 'text/html; charset=utf-8'],
  '/translations.json': ['../translations.json', 'application/json; charset=utf-8'],
  '/studio.webp': ['studio.webp', 'image/webp'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
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
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const english = new URL(req.url, 'http://localhost').searchParams.get('lang') === 'en';
  const reply = (status, data) => {
    if (english && data?.error) data = { ...data, error: translations[data.error] || data.error };
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
      const [body, type] = assets.get(route === '/' && english ? '/index.en.html' : route);
      res.writeHead(200, { 'Content-Type': type });
      return res.end(body);
    }
    if (req.method === 'GET' && route === '/api/options') {
      const whatsapp = process.env.WHATSAPP_NUMBER || '';
      const serviceId = new URL(req.url, 'http://localhost').searchParams.get('service');
      const selected = services.find(item => item.id === serviceId) || services[0];
      return reply(200, { services: services.map(item => english ? { ...item, ...item.en } : item), slots: slots({ duration: selected.duration }), whatsapp: /^\d{8,15}$/.test(whatsapp) ? whatsapp : '' });
    }
    if (req.method === 'POST' && route === '/api/bookings') {
      if (!adminHash) return reply(503, { error: 'Online aanvragen zijn nog niet geopend.' });
      const body = await readBody(req).catch(() => null);
      if (!body) return reply(400, { error: 'Ongeldig verzoek.' });
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!name || name.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          !services.some(service => service.id === body.service)) return reply(400, { error: 'Controleer je naam, e-mailadres en behandeling.' });
      const selected = services.find(item => item.id === body.service);
      const id = randomUUID();
      const saved = transaction(() => {
        if (!slots({ duration: selected.duration }).some(slot => slot.day === body.day && slot.time === body.time)) return false;
        db.prepare("INSERT INTO bookings (id,day,time,service,name,email,status,duration) VALUES (?,?,?,?,?,?,'pending',?)")
          .run(id, body.day, body.time, body.service, name, email, selected.duration);
        return true;
      });
      if (!saved) return reply(409, { error: 'Dit tijdslot is niet meer beschikbaar.' });
      return reply(201, { id });
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
          return { ...booking, service: (english ? service?.en.name : service?.name) || booking.service };
        }));
    }
    if (req.method === 'PATCH' && route === '/api/admin/bookings') {
      const body = await readBody(req).catch(() => null);
      if (!body || typeof body.id !== 'string' || !['confirmed','declined'].includes(body.status)) return reply(400, { error: 'Ongeldig verzoek.' });
      const result = db.prepare("UPDATE bookings SET status = ? WHERE id = ? AND status = 'pending'").run(body.status, body.id);
      return result.changes ? reply(200, { status: body.status }) : reply(409, { error: 'Deze aanvraag is al verwerkt of bestaat niet.' });
    }
    return reply(404, { error: 'Pagina niet gevonden.' });
  } catch (error) {
    console.error(error.code || error.name);
    if (!res.headersSent) reply(500, { error: 'Er ging iets mis. Probeer het opnieuw.' });
  }
}).listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0');
