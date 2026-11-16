import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Room } from '@colyseus/sdk';
import { BOTS, NEUTRAL_INPUT, TICK_RATE, matchSnapshotSchema } from '../src/shared/protocol';
import type { MatchState, PlayerInput } from '../src/shared/protocol';

try { process.loadEnvFile(); } catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

// The Node ws transport lets this check send the Origin that a browser supplies.
// No client supplies cookies or Authorization headers on its WebSocket handshake.
Reflect.deleteProperty(globalThis, 'WebSocket');
const { Client } = await import('@colyseus/sdk');
const baseUrl = new URL(process.env.VERIFY_BASE_URL ?? 'http://127.0.0.1:3002').origin;
const pagesOrigin = new URL(process.env.VERIFY_PAGES_ORIGIN ?? 'http://127.0.0.1:3000').origin;
const hostileOrigin = 'https://untrusted.example';
const loginSchema = z.object({ authenticated: z.literal(true), passwordRequired: z.literal(true), token: z.string().min(1) });
const sessionSchema = z.object({ authenticated: z.boolean(), passwordRequired: z.literal(true) });
type Hit = MatchState['events'][number];
interface Driver {
  room: Room<unknown>;
  snapshot: MatchState | null;
  hits: Map<number, Hit>;
  connected: boolean;
  drops: number;
  reconnects: number;
  sequence: number;
  errors: number[];
}

function report(check: string, detail: unknown): void {
  process.stdout.write(`${JSON.stringify({ check, detail })}\n`);
}

function currentPhase(driver: Driver): MatchState['phase'] | undefined { return driver.snapshot?.phase; }

async function waitFor(description: string, predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await delay(50);
  }
}

function request(path: string, init: RequestInit = {}, origin = pagesOrigin): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Origin', origin);
  return fetch(`${baseUrl}${path}`, { ...init, headers, credentials: 'omit', signal: AbortSignal.timeout(70_000) });
}

function checkCors(response: Response): void {
  assert.equal(response.headers.get('access-control-allow-origin'), pagesOrigin);
  assert.match(response.headers.get('vary') ?? '', /(?:^|,\s*)Origin(?:,|$)/i);
}

async function login(): Promise<string> {
  const response = await request('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.DEMO_PASSWORD ?? 'let-the-bots-battle' }),
  });
  assert.equal(response.status, 200, 'Pages login must succeed without a cookie.');
  checkCors(response);
  return loginSchema.parse(await response.json()).token;
}

function client(token: string) {
  const sdk = new Client(baseUrl, {
    headers: { Origin: pagesOrigin },
    fetchFn: async (url, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.has('cookie'), false, 'A Pages client must not need a cookie.');
      assert.ok(headers.get('authorization') === `Bearer ${token}`, 'SDK requests must use the signed bearer token.');
      assert.equal(init?.credentials, 'omit');
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
      checkCors(response);
      return response;
    },
  });
  sdk.http.authToken = token;
  sdk.http.options.credentials = 'omit';
  return sdk;
}

function track(room: Room<unknown>): Driver {
  const driver: Driver = { room, snapshot: null, hits: new Map(), connected: true, drops: 0, reconnects: 0, sequence: 0, errors: [] };
  room.reconnection.minUptime = 0;
  room.reconnection.minDelay = 100;
  room.reconnection.maxDelay = 1_000;
  room.reconnection.maxRetries = 8;
  room.reconnection.maxEnqueuedMessages = 0;
  room.onMessage('snapshot', (raw: unknown) => {
    const parsed = matchSnapshotSchema.safeParse(raw);
    if (!parsed.success) { driver.errors.push(-1); return; }
    driver.snapshot = parsed.data;
    for (const event of parsed.data.events) if (event.kind === 'hit') driver.hits.set(event.id, event);
  });
  room.onMessage('notice', () => undefined);
  room.onDrop(() => { driver.connected = false; driver.drops += 1; });
  room.onReconnect(() => { driver.connected = true; driver.reconnects += 1; room.send('sync'); });
  room.onError((code) => driver.errors.push(code));
  room.onLeave(() => { driver.connected = false; });
  room.send('sync');
  return driver;
}

function drive(driver: Driver): void {
  if (!driver.connected || driver.snapshot?.phase.kind !== 'fighting') return;
  const self = driver.snapshot.players.find((player) => player.id === driver.room.sessionId);
  const opponent = driver.snapshot.players.find((player) => player.id !== driver.room.sessionId);
  if (!self || !opponent) return;
  const dx = opponent.position.x - self.position.x;
  const dz = opponent.position.z - self.position.z;
  const desired = Math.atan2(dx, dz);
  const angle = Math.atan2(Math.sin(desired - self.yaw), Math.cos(desired - self.yaw));
  driver.sequence = Math.max(driver.sequence, self.lastInputSeq) + 1;
  const input: PlayerInput = {
    seq: driver.sequence, throttle: Math.abs(angle) > 1.2 ? 0 : Math.hypot(dx, dz) > 2.7 ? 0.85 : 0.25,
    steer: Math.max(-1, Math.min(1, angle * 3 / BOTS[self.botId].turnSpeed)),
    weapon: true, recover: false,
  };
  driver.room.send('input', input);
}

async function rejectSocket(origin: string, token: string, status: number): Promise<void> {
  const endpoint = new URL('/verification/unauthenticated', baseUrl);
  endpoint.searchParams.set('_authToken', token);
  await new Promise<void>((resolve, reject) => {
    const socketRequest = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(endpoint, {
      headers: { Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.alloc(16, 8).toString('base64') },
    });
    socketRequest.setTimeout(5_000, () => socketRequest.destroy(new Error('Socket rejection timed out.')));
    socketRequest.once('response', (response) => {
      response.resume();
      try { assert.equal(response.statusCode, status); resolve(); } catch (error) { reject(error); }
    });
    socketRequest.once('upgrade', (_response, socket) => {
      socket.destroy(); reject(new Error('An unauthorized socket was accepted.'));
    });
    socketRequest.once('error', () => reject(new Error('Socket rejection check failed.')));
    socketRequest.end();
  });
}

async function main(): Promise<void> {
  assert.notEqual(baseUrl, pagesOrigin, 'Use separate origins to verify Pages connections.');
  for (const path of ['/api/login', '/matchmake/create/arena']) {
    const response = await request(path, { method: 'OPTIONS', headers: {
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type',
    } });
    assert.equal(response.status, 204);
    checkCors(response);
    assert.match(response.headers.get('access-control-allow-headers') ?? '', /authorization/i);
  }
  const denied = await request('/matchmake/create/arena', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type',
  } }, hostileOrigin);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const unauthorized = await request('/matchmake/create/arena', {
    method: 'POST', headers: { Authorization: 'Bearer invalid', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(unauthorized.status, 401);
  checkCors(unauthorized);
  const firstToken = await login();
  const secondToken = await login();
  assert.ok(firstToken !== secondToken, 'Independent devices must receive independent session tokens.');
  for (const token of [firstToken, secondToken]) {
    const session = await request('/api/session', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(session.status, 200);
    checkCors(session);
    assert.equal(sessionSchema.parse(await session.json()).authenticated, true);
  }
  const invalidSession = await request('/api/session', { headers: { Authorization: 'Bearer invalid' } });
  assert.equal(sessionSchema.parse(await invalidSession.json()).authenticated, false);
  await rejectSocket(pagesOrigin, 'invalid', 401);
  await rejectSocket(hostileOrigin, firstToken, 403);
  report('pages-access', { allowedPreflights: true, untrustedOriginRejected: true, bearerOnlyLogin: true, unauthorizedSocketsRejected: true });

  const rooms: Driver[] = [];
  let driving: ReturnType<typeof setInterval> | undefined;
  try {
    const first = track(await client(firstToken).create<unknown>('arena', { name: 'Pages Host', botId: 'witchdoctor', paint: 'signature', practice: false }));
    rooms.push(first);
    const second = track(await client(secondToken).joinById<unknown>(first.room.roomId, { name: 'Pages Guest', botId: 'tombstone', paint: 'signature', practice: false }));
    rooms.push(second);
    assert.notEqual(first.room.sessionId, second.room.sessionId);
    await waitFor('two players on both clients', () => first.snapshot?.players.length === 2 && second.snapshot?.players.length === 2);
    await assert.rejects(() => client(secondToken).joinById<unknown>(first.room.roomId, { name: 'Third Seat', botId: 'witchdoctor', paint: 'signature', practice: false }));
    const guestSeat = second.room.sessionId;
    second.room.connection.close(1001, 'Pages verification interruption');
    await waitFor('guest reconnect', () => second.drops > 0 && second.reconnects > 0 && second.connected);
    assert.equal(second.room.sessionId, guestSeat);
    await waitFor('same guest seat restored', () => first.snapshot?.players.find((player) => player.id === guestSeat)?.connected === true);
    report('pages-room', { distinctSeats: true, thirdSeatRejected: true, sameSeatReconnect: true });

    first.room.send('ready');
    second.room.send('ready');
    await waitFor('shared countdown', () => first.snapshot?.phase.kind === 'countdown' && second.snapshot?.phase.kind === 'countdown');
    await waitFor('shared fight', () => first.snapshot?.phase.kind === 'fighting' && second.snapshot?.phase.kind === 'fighting');
    driving = setInterval(() => { drive(first); drive(second); }, 1_000 / TICK_RATE);
    await waitFor('the same authoritative hit on both clients', () => [...first.hits.keys()].some((id) => second.hits.has(id)), 15_000);
    clearInterval(driving); driving = undefined;
    for (const driver of rooms) driver.room.send('input', { ...NEUTRAL_INPUT, seq: ++driver.sequence });
    const sharedHit = [...first.hits.values()].find((hit) => second.hits.has(hit.id));
    assert.ok(sharedHit);
    assert.deepEqual(sharedHit, second.hits.get(sharedHit.id));
    await waitFor('damage on both clients', () => !!first.snapshot?.players.some((player) => player.health < 100) && !!second.snapshot?.players.some((player) => player.health < 100));
    assert.equal(currentPhase(first)?.kind, 'fighting', 'Combat must still be active for the forfeit check.');
    await second.room.leave();
    await waitFor('host receives forfeit', () => first.snapshot?.phase.kind === 'finished');
    const phase = currentPhase(first);
    assert.ok(phase?.kind === 'finished');
    assert.deepEqual(phase.result, { winnerId: first.room.sessionId, reason: 'forfeit' });
    assert.deepEqual(first.errors, []);
    assert.deepEqual(second.errors, []);
    report('PASS', { cookieFreeClients: 2, sharedCombatHit: sharedHit.id, forfeitWinnerCorrect: true });
  } finally {
    if (driving) clearInterval(driving);
    await Promise.allSettled(rooms.filter((driver) => driver.connected).map(async (driver) => {
      await Promise.race([driver.room.leave(), delay(2_000)]);
    }));
  }
}

await main().catch((error: unknown) => {
  // Do not print request objects or SDK errors, which may contain session tokens.
  const message = error instanceof assert.AssertionError ? error.message
    : error instanceof Error && error.message.startsWith('Timed out waiting for ') ? error.message
      : 'Pages multiplayer verification failed. Check the server log.';
  report('FAIL', message);
  process.exitCode = 1;
});
