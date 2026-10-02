import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRequireUser } = require('../../../youtube-audio-server/auth.js');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const config = { supabaseUrl: 'https://audio-auth.test', anonKey: 'test-anon-key' };

test('multiple real app users can use the shared audio service with their own tokens', async (t) => {
  const verified = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://audio-auth.test/auth/v1/user');
    assert.equal(init.headers.apikey, 'test-anon-key');
    const token = init.headers.Authorization;
    verified.push(token);
    return new Response(JSON.stringify({ id: token === 'Bearer user-a' ? 'id-a' : 'id-b', is_anonymous: false }));
  });
  const auth = createRequireUser(config);
  for (const [token, id] of [['user-a', 'id-a'], ['user-b', 'id-b']]) {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = response();
    let passed = false;
    await auth(req, res, () => { passed = true; });
    assert.equal(passed, true);
    assert.equal(req.userId, id);
    assert.equal(res.body, undefined);
  }
  assert.deepEqual(verified, ['Bearer user-a', 'Bearer user-b']);
});

test('unauthenticated calls are rejected before contacting Supabase or starting audio work', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not be called'); });
  const res = response();
  let passed = false;
  await createRequireUser(config)({ headers: {} }, res, () => { passed = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(passed, false);
  assert.equal(fetch.mock.callCount(), 0);
});

test('forged tokens and anonymous sessions cannot use the server YouTube credentials', async (t) => {
  const replies = [new Response('{}', { status: 401 }), new Response(JSON.stringify({ id: 'anonymous', is_anonymous: true }))];
  t.mock.method(globalThis, 'fetch', async () => replies.shift());
  const auth = createRequireUser(config);
  for (const token of ['forged', 'anonymous']) {
    const res = response();
    let passed = false;
    await auth({ headers: { authorization: `Bearer ${token}` } }, res, () => { passed = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(passed, false);
  }
});

test('missing auth configuration fails closed even with a bearer token', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('must not be called'); });
  const res = response();
  await createRequireUser({ supabaseUrl: '' })({ headers: { authorization: 'Bearer user' } }, res, () => assert.fail('must not authorize'));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'AUDIO_ACCESS_NOT_CONFIGURED');
  assert.equal(fetch.mock.callCount(), 0);
});

test('Supabase downtime rejects requests without exposing token or provider diagnostics', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private upstream diagnostics and token'); });
  const res = response();
  await createRequireUser(config)({ headers: { authorization: 'Bearer sensitive-token' } }, res, () => assert.fail('must not authorize'));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'Auth service unavailable');
  assert.ok(!JSON.stringify(res.body).includes('sensitive-token'));
  assert.ok(!JSON.stringify(res.body).includes('private upstream'));
});

test('cached sessions are isolated per token and revalidated after expiration', async (t) => {
  const cache = new Map();
  let time = 1000;
  t.mock.method(Date, 'now', () => time);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 'id-a' })));
  const auth = createRequireUser({ ...config, cache });
  const req = () => ({ headers: { authorization: 'Bearer user-a' } });
  await auth(req(), response(), () => {});
  await auth(req(), response(), () => {});
  assert.equal(fetch.mock.callCount(), 1);
  time += 60001;
  await auth(req(), response(), () => {});
  assert.equal(fetch.mock.callCount(), 2);
});
