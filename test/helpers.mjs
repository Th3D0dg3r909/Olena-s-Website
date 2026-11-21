// Starts the real server on a free port with its own temporary database, so tests never touch real data.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

export function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'olena-test-'));
  return { path: join(directory, 'bookings.sqlite'), remove: () => rmSync(directory, { recursive: true, force: true }) };
}

const freePort = () => new Promise(resolve => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

export async function startServer(env, databasePath) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--no-warnings', 'server.js'], {
    cwd: root,
    env: { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: databasePath, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const url = 'http://127.0.0.1:' + port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Server stopped during startup:\n' + log);
    try {
      await fetch(url + '/robots.txt');
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  return {
    url,
    get log() { return log; },
    get running() { return child.exitCode === null; },
    stop: () => new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill();
    }),
  };
}

export const json = { 'Content-Type': 'application/json', 'X-Olena-Request': '1' };

// The next Tuesday, Thursday or Saturday at least `daysAhead` days from now.
export function nextWorkingDay(daysAhead = 7) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  while (![2, 4, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
