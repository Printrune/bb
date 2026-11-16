import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  corsHeaders, issueSession, originAllowed, passwordsEqual, preflightAllowed,
  readAuthConfig, requestToken, sessionValid,
} from '../src/server/auth.ts';

const config = { password: 'test-password', secret: 'a'.repeat(64), production: false,
  allowedOrigins: ['https://printrune.github.io'] };

test('signed sessions reject tampering, expiry, and another signing key', () => {
  const now = 10_000;
  const token = issueSession(config, now);
  assert.equal(sessionValid(token, config, now + 1), true);
  assert.equal(sessionValid(`${token}x`, config, now + 1), false);
  assert.equal(sessionValid(token, { ...config, secret: 'b'.repeat(64) }, now + 1), false);
  assert.equal(sessionValid(token, config, now + 13 * 60 * 60 * 1_000), false);
  assert.equal(sessionValid('not-a-session', config, now), false);
  assert.equal(sessionValid(`${token}=`, config, now + 1), false);
});

test('origin configuration accepts exact origins and rejects paths, wildcards and malformed entries', () => {
  assert.deepEqual(readAuthConfig({ ALLOWED_ORIGINS: 'https://printrune.github.io, http://localhost:3001,https://printrune.github.io' }).allowedOrigins,
    ['https://printrune.github.io', 'http://localhost:3001']);
  assert.deepEqual(readAuthConfig({}).allowedOrigins, []);
  for (const origin of ['*', 'null', 'https://printrune.github.io/bb/', 'https://printrune.github.io/',
    'https://user:pass@example.com', 'https://example.com?foo=1', 'https://example.com#foo', 'file://example.com', 'https://example.com,']) {
    assert.throws(() => readAuthConfig({ ALLOWED_ORIGINS: origin }), /ALLOWED_ORIGINS/);
  }
});

test('only same-host and explicitly allowed browser origins receive CORS headers', () => {
  assert.equal(originAllowed('https://arena.example', 'arena.example', config), true);
  assert.equal(originAllowed('https://printrune.github.io', 'arena.example', config), true);
  assert.equal(originAllowed(undefined, 'arena.example', config), true);
  for (const origin of ['', 'null', 'https://printrune.github.io.attacker.example', 'https://printrune.github.io:8443',
    'https://arena.example:8443', 'https://arena.example/path', 'https://name@arena.example', 'file://arena.example']) {
    assert.equal(originAllowed(origin, 'arena.example', config), false, origin);
    assert.equal(corsHeaders(origin, 'arena.example', config)['Access-Control-Allow-Origin'], undefined);
  }
  const allowed = corsHeaders('https://printrune.github.io', 'arena.example', config);
  assert.equal(allowed['Access-Control-Allow-Origin'], 'https://printrune.github.io');
  assert.equal(allowed['Access-Control-Allow-Credentials'], undefined);
  assert.equal(allowed.Vary, 'Origin');
  assert.equal(corsHeaders(undefined, 'arena.example', config)['Access-Control-Allow-Origin'], undefined);
});

test('bearer and WebSocket tokens are explicit credentials and never fall back to a valid cookie', () => {
  const cookie = 'another=value; battlebots_session=cookie-token';
  assert.equal(requestToken({ cookie }), 'cookie-token');
  assert.equal(requestToken({ cookie, authorization: 'Bearer bearer-token' }), 'bearer-token');
  assert.equal(requestToken({ cookie, authorization: 'bearer bearer-token' }), 'bearer-token');
  assert.equal(requestToken({ cookie, authorization: 'Basic invalid' }), '');
  assert.equal(requestToken({ cookie, authorization: 'Bearer a b' }), '');
  assert.equal(requestToken({ cookie }, 'socket-token'), 'socket-token');
  assert.equal(requestToken({ cookie }, ''), '');
  assert.equal(requestToken({}), '');
});

test('preflight permits only the game HTTP methods and required request headers', () => {
  assert.equal(preflightAllowed('POST', 'authorization, content-type'), true);
  assert.equal(preflightAllowed('GET', undefined), true);
  assert.equal(preflightAllowed('POST', 'Authorization, Content-Type'), true);
  assert.equal(preflightAllowed('DELETE', 'Authorization'), false);
  assert.equal(preflightAllowed('POST', 'Authorization, X-Forwarded-Host'), false);
  assert.equal(preflightAllowed(undefined, undefined), false);
});

test('password comparison and production config fail closed', () => {
  assert.equal(passwordsEqual('test-password', config.password), true);
  assert.equal(passwordsEqual('other', config.password), false);
  assert.throws(() => readAuthConfig({ NODE_ENV: 'production' }), /Set DEMO_PASSWORD/);
  assert.throws(() => readAuthConfig({ NODE_ENV: 'production', DEMO_PASSWORD: 'secret', SESSION_SECRET: 'short' }));
});
