import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, temporaryDatabase, json, nextWorkingDay } from './helpers.mjs';

const PASSWORD = 'synthetic test password 42';
const ADMIN_ENDPOINTS = [
  ['GET', '/api/admin/bookings'], ['POST', '/api/admin/bookings'], ['PATCH', '/api/admin/bookings'], ['DELETE', '/api/admin/bookings'],
  ['GET', '/api/admin/planning'], ['PATCH', '/api/admin/planning'], ['GET', '/api/admin/buffers'], ['PATCH', '/api/admin/buffers'],
  ['GET', '/api/admin/availability?service=treatment-1&day=2030-01-01'],
];

describe('admin configuration', () => {
  for (const [label, env] of [['missing', {}], ['too short', { ADMIN_PASSWORD: 'fifteen-chars-x' }]]) {
    test(label + ' ADMIN_PASSWORD keeps the public site running and disables admin login only', async () => {
      const database = temporaryDatabase();
      const server = await startServer(env, database.path);
      try {
        const home = await fetch(server.url + '/');
        assert.equal(home.status, 200);
        assert.match(await home.text(), /Olena Skin Care Studio/);
        assert.equal((await fetch(server.url + '/api/options')).status, 200);
        const admin = await (await fetch(server.url + '/admin')).text();
        assert.match(admin, /data-state="not-configured"/);
        assert.match(admin, /Admin login is not configured/);
        const api = await fetch(server.url + '/api/admin/bookings?lang=en');
        assert.equal(api.status, 503);
        assert.equal((await api.json()).error, 'Admin login is not configured.');
        const login = await fetch(server.url + '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ username: 'olena', password: env.ADMIN_PASSWORD || 'x' }) });
        assert.equal(login.status, 503);
        assert.ok(server.running);
        assert.match(server.log, /Admin login disabled/);
        if (env.ADMIN_PASSWORD) assert.ok(!server.log.includes(env.ADMIN_PASSWORD), 'the password never appears in the log');
      } finally {
        await server.stop();
        database.remove();
      }
    });
  }
});

describe('with a valid admin password', () => {
  const database = temporaryDatabase();
  let server;
  let cookie;
  const day = nextWorkingDay(7);
  const admin = (path, options = {}) => fetch(server.url + path, { ...options, headers: { ...json, cookie, ...options.headers } });

  before(async () => {
    // An existing appointment from before this change must survive startup and stay visible to Olena.
    const first = await startServer({ ADMIN_PASSWORD: PASSWORD }, database.path);
    await first.stop();
    const db = new DatabaseSync(database.path);
    db.prepare("INSERT INTO bookings (id,day,time,service,name,email,status,duration,phone,buffer) VALUES ('existing-1',?,'10:00','treatment-1','Synthetic Existing Client','','confirmed',90,'0600000001',15)").run(day);
    db.close();
    server = await startServer({ ADMIN_PASSWORD: PASSWORD }, database.path);
  });
  after(async () => {
    await server.stop();
    database.remove();
  });

  test('every admin endpoint refuses requests without login', async () => {
    for (const [method, path] of ADMIN_ENDPOINTS) {
      const response = await fetch(server.url + path, { method, headers: json, body: method === 'GET' ? undefined : '{}' });
      assert.equal(response.status, 401, method + ' ' + path);
      assert.equal((await response.json()).code, 'login_required');
    }
  });

  test('the planner page shows only the login form before login', async () => {
    const html = await (await fetch(server.url + '/admin')).text();
    assert.match(html, /id="login-form"/);
    assert.doesNotMatch(html, /Synthetic Existing Client|id="bookings"/);
  });

  test('wrong credentials are refused', async () => {
    const response = await fetch(server.url + '/api/auth/login?lang=en', { method: 'POST', headers: json, body: JSON.stringify({ username: 'olena', password: 'not the password!' }) });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'Incorrect username or password.');
    assert.equal(response.headers.get('set-cookie'), null);
  });

  test('cross-site requests are refused, including login', async () => {
    const body = JSON.stringify({ username: 'olena', password: PASSWORD });
    for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-Olena-Request': '' }]) {
      const response = await fetch(server.url + '/api/auth/login', { method: 'POST', headers: { ...json, ...headers }, body });
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.equal(response.headers.get('set-cookie'), null);
    }
  });

  test('correct credentials start a session with a protected cookie', async () => {
    const response = await fetch(server.url + '/api/auth/login', { method: 'POST', headers: { ...json, Origin: server.url }, body: JSON.stringify({ username: 'olena', password: PASSWORD }) });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    for (const part of ['__Host-olena_admin=', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(setCookie.includes(part), part);
    cookie = setCookie.split(';')[0];
    assert.match(await (await admin('/admin')).text(), /id="bookings"/);
  });

  test('existing appointments are preserved', async () => {
    const bookings = await (await admin('/api/admin/bookings?lang=en')).json();
    const existing = bookings.find(booking => booking.id === 'existing-1');
    assert.equal(existing.name, 'Synthetic Existing Client');
    assert.equal(existing.status, 'confirmed');
  });

  test('changes from another site are refused even with a valid session', async () => {
    const response = await admin('/api/admin/planning', { method: 'PATCH', headers: { Origin: 'https://evil.example' }, body: JSON.stringify({ day, time: '17:00', blocked: true }) });
    assert.equal(response.status, 403);
  });

  test('Olena adds confirmed appointments with duration, cleanup time and no overlap', async () => {
    // treatment-1 lasts 90 minutes plus 15 minutes cleanup; the existing appointment occupies 10:00–11:45.
    const add = (time, name, service = 'treatment-1') => admin('/api/admin/bookings?lang=en', { method: 'POST', body: JSON.stringify({ service, day, time, name, phone: '0600000002' }) });
    assert.equal((await add('11:30', 'Synthetic Overlap')).status, 409, 'overlaps the existing appointment');
    assert.equal((await add('11:45', 'Synthetic Second')).status, 201, 'starts right after treatment and cleanup');
    assert.equal((await add('13:15', 'Synthetic Third')).status, 409, '11:45 + 90 + 15 ends at 13:30');
    assert.equal((await add('13:30', 'Synthetic Third')).status, 201);
    assert.equal((await add('19:30', 'Synthetic Late')).status, 409, 'must start by 19:00 and end by 21:00');
    const times = await (await admin('/api/admin/availability?service=treatment-1&day=' + day)).json();
    assert.ok(!times.includes('12:00') && times.includes('15:15'));
  });

  test('availability can be blocked and released', async () => {
    const block = blocked => admin('/api/admin/planning', { method: 'PATCH', body: JSON.stringify({ day, time: '17:00', blocked }) });
    assert.equal((await block(true)).status, 200);
    let planning = await (await admin('/api/admin/planning')).json();
    assert.ok(planning.blocked.some(slot => slot.day === day && slot.time === '17:00'));
    assert.equal((await block(false)).status, 200);
    planning = await (await admin('/api/admin/planning')).json();
    assert.ok(!planning.blocked.some(slot => slot.day === day && slot.time === '17:00'));
  });

  test('cleanup time can be changed per treatment', async () => {
    assert.equal((await admin('/api/admin/buffers', { method: 'PATCH', body: JSON.stringify({ id: 'treatment-2', buffer: 20 }) })).status, 200);
    const buffers = await (await admin('/api/admin/buffers')).json();
    assert.equal(buffers.find(item => item.id === 'treatment-2').buffer, 20);
  });

  test('the old public booking endpoint cannot create appointments', async () => {
    const count = () => admin('/api/admin/bookings').then(response => response.json()).then(list => list.length);
    const before = await count();
    for (const method of ['POST', 'PUT', 'PATCH']) {
      const response = await fetch(server.url + '/api/bookings?lang=en', { method, headers: json, body: JSON.stringify({ service: 'treatment-1', day, time: '15:15', name: 'Synthetic Bypass', phone: '0600000003' }) });
      assert.equal(response.status, 410);
      assert.match((await response.json()).error, /WhatsApp/);
    }
    assert.equal(await count(), before);
  });

  test('the public options show treatments and the WhatsApp number but no booking slots', async () => {
    const options = await (await fetch(server.url + '/api/options?lang=en')).json();
    assert.equal(options.whatsapp, '31647238444');
    assert.equal(options.slots, undefined);
    // PRX-T33 Face keeps its id (existing appointments stay linked); Face + Neck follows directly below it.
    const index = options.services.findIndex(item => item.id === 'treatment-18');
    const [face, neck] = options.services.slice(index, index + 2);
    for (const [item, id, name, price, label] of [[face, 'treatment-18', 'PRX-T33 Face', 110, '30 min'], [neck, 'treatment-28', 'PRX-T33 Face + Neck', 140, '40 min']]) {
      assert.deepEqual([item.id, item.name, item.price, item.durationLabel], [id, name, price, label]);
      assert.equal(item.description, 'No-needle biorevitalizing peel for instant glow, smoother fine lines, and long-lasting lift.');
    }
  });

  test('photos are served as WebP and nothing else is reachable through the photo folder', async () => {
    const photo = await fetch(server.url + '/photos/olena-portret-600.webp?v=1');
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/webp');
    assert.match(photo.headers.get('cache-control'), /immutable/);
    for (const path of ['/photos/../server.js', '/photos/%2e%2e/server.js', '/photos/missing.webp']) {
      assert.equal((await fetch(server.url + path)).status, 404, path);
    }
    const home = await (await fetch(server.url + '/')).text();
    assert.match(home, /\/photos\/olena-portret-600\.webp\?v=[0-9a-f]{12}/, 'photo links get a content version');
  });

  test('logout ends the session on the server', async () => {
    const response = await admin('/api/auth/logout', { method: 'POST' });
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    const after = await admin('/api/admin/bookings');
    assert.equal(after.status, 401, 'the previous cookie no longer works');
  });

  test('repeated wrong logins are limited', async () => {
    const attempt = password => fetch(server.url + '/api/auth/login', { method: 'POST', headers: { ...json, 'X-Forwarded-For': '203.0.113.50' }, body: JSON.stringify({ username: 'olena', password }) });
    for (let i = 0; i < 5; i++) assert.equal((await attempt('wrong password ' + i)).status, 401);
    const locked = await attempt(PASSWORD);
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
  });

  test('the concept site is kept out of search engines', async () => {
    const home = await fetch(server.url + '/');
    assert.equal(home.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.doesNotMatch(await home.text(), /rel="canonical"/);
    assert.equal(await (await fetch(server.url + '/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
    assert.equal((await fetch(server.url + '/sitemap.xml')).status, 404);
  });
});

describe('production settings', () => {
  test('PUBLIC_URL sets canonical links and the sitemap; indexing only with ALLOW_INDEXING', async () => {
    const database = temporaryDatabase();
    const server = await startServer({ ADMIN_PASSWORD: PASSWORD, PUBLIC_URL: 'https://www.example-studio.nl', ALLOW_INDEXING: 'true' }, database.path);
    try {
      const home = await fetch(server.url + '/?lang=en');
      assert.equal(home.headers.get('x-robots-tag'), null);
      const html = await home.text();
      assert.match(html, /<link rel="canonical" href="https:\/\/www\.example-studio\.nl\/\?lang=en">/);
      assert.match(html, /hreflang="uk" href="https:\/\/www\.example-studio\.nl\/\?lang=uk"/);
      assert.equal((await fetch(server.url + '/admin')).headers.get('x-robots-tag'), 'noindex, nofollow', 'the planner is never indexed');
      const robots = await (await fetch(server.url + '/robots.txt')).text();
      assert.match(robots, /Disallow: \/admin/);
      assert.match(robots, /Sitemap: https:\/\/www\.example-studio\.nl\/sitemap\.xml/);
      const sitemap = await (await fetch(server.url + '/sitemap.xml')).text();
      assert.equal(sitemap.match(/<loc>/g).length, 6);
      assert.match(sitemap, /<loc>https:\/\/www\.example-studio\.nl\/privacy\?lang=uk<\/loc>/);
    } finally {
      await server.stop();
      database.remove();
    }
  });

  test('REDIRECT_TO_PUBLIC_URL sends other host names to the public address', async () => {
    const database = temporaryDatabase();
    const server = await startServer({ PUBLIC_URL: 'https://www.example-studio.nl', REDIRECT_TO_PUBLIC_URL: 'true' }, database.path);
    try {
      const response = await fetch(server.url + '/privacy?lang=en', { redirect: 'manual' });
      assert.equal(response.status, 301);
      assert.equal(response.headers.get('location'), 'https://www.example-studio.nl/privacy?lang=en');
    } finally {
      await server.stop();
      database.remove();
    }
  });
});

describe('requests from this website behind a proxy', () => {
  test('a same-origin browser request is accepted even if the proxy changes the Host header', async () => {
    const database = temporaryDatabase();
    const server = await startServer({ ADMIN_PASSWORD: PASSWORD }, database.path);
    try {
      const headers = { ...json, 'Sec-Fetch-Site': 'same-origin', Origin: 'https://olena.example', Host: 'internal-backend:3000' };
      const response = await fetch(server.url + '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ username: 'olena', password: PASSWORD }) });
      assert.equal(response.status, 200);
    } finally {
      await server.stop();
      database.remove();
    }
  });
});
