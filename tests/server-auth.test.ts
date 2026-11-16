import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

// The SDK's Node transport can attach Origin; Node's built-in WebSocket cannot.
Reflect.deleteProperty(globalThis, 'WebSocket');
const { Client } = await import('@colyseus/sdk');
const PAGES_ORIGIN = 'https://printrune.github.io';

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function rejectedUpgrade(baseUrl: string, origin: string, token: string, expectedStatus: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(new URL(`/verification/socket?_authToken=${encodeURIComponent(token)}`, baseUrl), {
      headers: { Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.alloc(16, 7).toString('base64') },
    });
    request.setTimeout(5_000, () => request.destroy(new Error('WebSocket rejection timed out.')));
    request.once('response', (response) => {
      response.resume();
      try { assert.equal(response.statusCode, expectedStatus); resolve(); } catch (error) { reject(error); }
    });
    request.once('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Unauthorized socket was upgraded.')); });
    request.once('error', reject);
    request.end();
  });
}

test('Pages bearer authentication crosses the real HTTP and WebSocket boundaries without cookies', { timeout: 45_000 }, async (context) => {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DEMO_PASSWORD: 'boundary-test-password',
      SESSION_SECRET: 'test-only-signing-secret-'.repeat(3), ALLOWED_ORIGINS: PAGES_ORIGIN, MAX_ROOMS: '2' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  server.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  server.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  context.after(async () => {
    if (server.exitCode !== null) return;
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  });
  const deadline = Date.now() + 20_000;
  while (!output.includes('"event":"server_ready"')) {
    assert.equal(server.exitCode, null, `Server startup failed: ${output}`);
    assert.ok(Date.now() < deadline, `Server startup timed out: ${output}`);
    await delay(50);
  }
  async function api(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(8_000) });
  }
  for (const path of ['/api/login', '/api/session', '/matchmake/create/arena']) {
    const response = await api(path, { method: 'OPTIONS', headers: { Origin: PAGES_ORIGIN,
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(response.status, 204, path);
    assert.equal(response.headers.get('access-control-allow-origin'), PAGES_ORIGIN);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
  }
  for (const origin of ['https://attacker.example', 'null', `${PAGES_ORIGIN}/bb/`]) {
    const response = await api('/api/session', { headers: { Origin: origin } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const forbiddenPreflight = await api('/matchmake/create/arena', { method: 'OPTIONS', headers: {
    Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(forbiddenPreflight.status, 403);
  assert.equal(forbiddenPreflight.headers.get('access-control-allow-origin'), null);
  const login = await api('/api/login', { method: 'POST', headers: { Origin: PAGES_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'boundary-test-password' }) });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('access-control-allow-origin'), PAGES_ORIGIN);
  const { token } = z.object({ authenticated: z.literal(true), passwordRequired: z.literal(true), token: z.string().min(1) }).parse(await login.json());
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const session = await api('/api/session', { headers: { Origin: PAGES_ORIGIN, Authorization: `Bearer ${token}` } });
  assert.deepEqual(await session.json(), { authenticated: true, passwordRequired: true });
  const sameOrigin = await api('/api/session', { headers: { Origin: baseUrl, Cookie: cookie } });
  assert.deepEqual(await sameOrigin.json(), { authenticated: true, passwordRequired: true });
  const invalid = await api('/api/session', { headers: { Origin: PAGES_ORIGIN, Authorization: 'Bearer invalid', Cookie: cookie } });
  assert.deepEqual(await invalid.json(), { authenticated: false, passwordRequired: true });
  const unauthenticated = await api('/matchmake/create/arena', { method: 'POST', headers: {
    Origin: PAGES_ORIGIN, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get('access-control-allow-origin'), PAGES_ORIGIN);
  await rejectedUpgrade(baseUrl, PAGES_ORIGIN, 'invalid', 401);
  await rejectedUpgrade(baseUrl, 'null', token, 403);
  await rejectedUpgrade(baseUrl, 'https://attacker.example', token, 403);

  const client = new Client(baseUrl, { headers: { Origin: PAGES_ORIGIN } });
  client.http.authToken = token;
  const room = await client.create('arena', { name: 'Pages driver', botId: 'witchdoctor', paint: 'signature', practice: false });
  room.onMessage('snapshot', () => undefined);
  assert.ok(room.roomId);
  assert.ok(room.sessionId);
  await room.leave();
  const health = await api('/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), null, 'Colyseus must not restore its wildcard CORS default.');
});
