import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAuth } from '../auth.js';

const PASSWORD = 'synthetic test password 42';
function setup(env = { ADMIN_PASSWORD: PASSWORD }, db = new DatabaseSync(':memory:')) {
  let time = Date.UTC(2026, 10, 21, 12);
  const errors = [];
  const auth = createAuth({ db, env, now: () => time, log: { error: message => errors.push(message) } });
  return { auth, db, errors, advance: minutes => { time += minutes * 60 * 1000; } };
}
const request = cookie => ({ headers: { cookie } });
const tokenOf = cookie => cookie.split(';')[0];

test('missing or too-short password disables login without exposing it', async () => {
  for (const env of [{}, { ADMIN_PASSWORD: 'fifteen-chars-x' }]) {
    const { auth, errors } = setup(env);
    assert.equal(auth.configured, false);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Admin login disabled/);
    if (env.ADMIN_PASSWORD) assert.ok(!errors[0].includes(env.ADMIN_PASSWORD));
    const result = await auth.login({ username: 'olena', password: env.ADMIN_PASSWORD || '' }, '203.0.113.1');
    assert.equal(result.status, 503);
  }
});

test('a password of 16 characters or more enables login', () => {
  const { auth, errors } = setup({ ADMIN_PASSWORD: 'x'.repeat(16) });
  assert.equal(auth.configured, true);
  assert.equal(errors.length, 0);
});

test('correct and incorrect credentials', async () => {
  const { auth } = setup();
  assert.equal((await auth.login({ username: 'olena', password: 'wrong password here' }, 'a')).status, 401);
  assert.equal((await auth.login({ username: 'someone', password: PASSWORD }, 'a')).status, 401);
  assert.equal((await auth.login({ username: 'olena' }, 'a')).status, 401);
  const ok = await auth.login({ username: ' Olena ', password: PASSWORD }, 'a');
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /^__Host-olena_admin=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
  assert.equal(auth.session(request(tokenOf(ok.cookie))), 'valid');
});

test('only a hash of the session token is stored', async () => {
  const { auth, db } = setup();
  const { cookie } = await auth.login({ username: 'olena', password: PASSWORD }, 'a');
  const token = tokenOf(cookie).split('=')[1];
  const rows = db.prepare('SELECT * FROM admin_sessions').all();
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes(token));
  assert.equal(rows[0].token_hash.length, 64);
});

test('sessions expire after 30 idle minutes and after 12 hours at most', async () => {
  const { auth, advance } = setup();
  let { cookie } = await auth.login({ username: 'olena', password: PASSWORD }, 'a');
  advance(29);
  assert.equal(auth.session(request(tokenOf(cookie))), 'valid');
  advance(31);
  assert.equal(auth.session(request(tokenOf(cookie))), 'expired');
  assert.equal(auth.session(request(tokenOf(cookie))), 'expired', 'an expired token stays unusable');

  ({ cookie } = await auth.login({ username: 'olena', password: PASSWORD }, 'a'));
  for (let elapsed = 20; elapsed <= 700; elapsed += 20) {
    advance(20);
    assert.equal(auth.session(request(tokenOf(cookie))), 'valid');
  }
  advance(25);
  assert.equal(auth.session(request(tokenOf(cookie))), 'expired', 'activity cannot extend a session beyond 12 hours');
});

test('logout invalidates the session on the server', async () => {
  const { auth } = setup();
  const { cookie } = await auth.login({ username: 'olena', password: PASSWORD }, 'a');
  const cleared = auth.logout(request(tokenOf(cookie)));
  assert.match(cleared, /Max-Age=0/);
  assert.notEqual(auth.session(request(tokenOf(cookie))), 'valid');
});

test('changing the password signs out existing sessions', async () => {
  const db = new DatabaseSync(':memory:');
  const first = setup({ ADMIN_PASSWORD: PASSWORD }, db);
  const { cookie } = await first.auth.login({ username: 'olena', password: PASSWORD }, 'a');
  const second = setup({ ADMIN_PASSWORD: 'a completely new password' }, db);
  assert.notEqual(second.auth.session(request(tokenOf(cookie))), 'valid');
  assert.equal(db.prepare('SELECT count(*) AS n FROM admin_sessions').get().n, 0);
});

test('repeated failures are limited per address and overall', async () => {
  const { auth, advance } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await auth.login({ username: 'olena', password: 'wrong ' + i }, '198.51.100.1')).status, 401);
  const blocked = await auth.login({ username: 'olena', password: PASSWORD }, '198.51.100.1');
  assert.equal(blocked.status, 429, 'even the right password is refused while locked');
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 900);
  assert.equal((await auth.login({ username: 'olena', password: PASSWORD }, '198.51.100.2')).status, 200, 'other addresses still work');
  advance(16);
  assert.equal((await auth.login({ username: 'olena', password: PASSWORD }, '198.51.100.1')).status, 200, 'the lock ends after 15 minutes');

  // Without a known visitor address (as behind some web servers) the overall limit still applies.
  for (let i = 0; i < 20; i++) await auth.login({ username: 'olena', password: 'wrong ' + i }, null);
  assert.equal((await auth.login({ username: 'olena', password: PASSWORD }, null)).status, 429);
  assert.equal((await auth.login({ username: 'olena', password: PASSWORD }, '198.51.100.3')).status, 429);
});
