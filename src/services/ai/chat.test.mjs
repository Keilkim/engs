import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
let modules = 0;
const bundled = await build({
  stdin: {
    contents: "export * from './src/services/ai/chat.js'; export * from './src/services/sessionScope.js'; export {apiFetch} from './src/services/apiFetch.ts';",
    resolveDir: repo,
  },
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'authenticated-test-boundaries', setup(builder) {
    builder.onResolve({ filter: /\/(supabase|annotation|settings)$/ }, args => {
      const name = args.path.split('/').at(-1);
      return { path: name, namespace: 'fixture' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: {
      supabase: `export const supabase = { auth: {
        onAuthStateChange(callback) { globalThis.chatFixture.listeners.push(callback); return {data:{subscription:{unsubscribe(){}}}}; },
        getSession() { return globalThis.chatFixture.getSession(); }
      }};`,
      annotation: `export const getVocabulary = () => globalThis.chatFixture.getVocabulary(); export const getGrammarPatterns = async () => [];`,
      settings: `export const SETTINGS_KEYS = {}; export const getSetting = (_key, fallback) => fallback;`,
    }[path], loader: 'js' }));
  } }],
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t, overrides = {}) {
  const state = {
    userId: 'A', listeners: [], prompts: [], vocabCalls: 0,
    getSession: async () => ({ data: { session: { user: { id: state.userId }, access_token: `token-${state.userId}` } } }),
    getVocabulary: async () => {
      state.vocabCalls += 1;
      return [{ selected_text: `PRIVATE_${state.userId}`, ai_analysis_json: '{"definition":"private note"}' }];
    },
    switchUser(userId) {
      state.userId = userId;
      state.listeners.forEach(listener => listener(userId ? 'SIGNED_IN' : 'SIGNED_OUT', userId ? { user: { id: userId } } : null));
    },
    ...overrides,
  };
  globalThis.chatFixture = state;
  t.after(() => { delete globalThis.chatFixture; });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    state.prompts.push({ body: JSON.parse(init.body), authorization: init.headers.get('Authorization'), signal: init.signal });
    return Response.json({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] });
  });
  const code = `${bundled.outputFiles[0].text}\n// fresh fixture ${++modules}`;
  const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return { state, api };
}

test('dictionary context is cached only within one authenticated session', async t => {
  const { state, api } = await fixture(t);
  await api.chat('hello A');
  await api.chat('again A');
  assert.equal(state.vocabCalls, 1);
  state.switchUser('B');
  await api.chat('hello B');
  const prompt = state.prompts.at(-1);
  assert.match(prompt.body.systemInstruction.parts[0].text, /PRIVATE_B/);
  assert.doesNotMatch(prompt.body.systemInstruction.parts[0].text, /PRIVATE_A/);
  assert.equal(prompt.authorization, 'Bearer token-B');
  assert.equal(state.vocabCalls, 2);
});

test('a delayed old-account dictionary cannot overwrite the new-account cache or reach the API', async t => {
  const late = deferred();
  let first = true;
  const { state, api } = await fixture(t, { getVocabulary: () => {
    if (first) { first = false; return late.promise; }
    return Promise.resolve([{ selected_text: 'PRIVATE_B' }]);
  } });
  const old = api.chat('A question');
  const rejected = assert.rejects(old, { name: 'AbortError' });
  // Let the first request enter the dictionary read.
  await new Promise(resolve => setImmediate(resolve));
  state.switchUser('B');
  await api.chat('B question');
  late.resolve([{ selected_text: 'PRIVATE_A' }]);
  await rejected;
  await api.chat('B again');
  assert.equal(state.prompts.length, 2);
  for (const prompt of state.prompts) {
    assert.match(prompt.body.systemInstruction.parts[0].text, /PRIVATE_B/);
    assert.doesNotMatch(prompt.body.systemInstruction.parts[0].text, /PRIVATE_A/);
  }
});

test('logging out and back in as the same account discards its prior dictionary cache', async t => {
  const { state, api } = await fixture(t);
  await api.chat('before');
  state.switchUser(null);
  state.switchUser('A');
  await api.chat('after');
  assert.equal(state.vocabCalls, 2);
});

test('a newer auth event wins over a slow initial session read', async t => {
  const initial = deferred();
  const { state, api } = await fixture(t, { getSession: () => initial.promise });
  state.switchUser('B');
  initial.resolve({ data: { session: { user: { id: 'A' }, access_token: 'token-A' } } });
  assert.equal((await api.captureSessionScope()).userId, 'B');
});

test('an account change during token lookup prevents sending the old prompt with the new token', async t => {
  const { state, api } = await fixture(t);
  const scope = await api.captureSessionScope();
  const token = deferred();
  state.getSession = () => token.promise;
  const request = api.apiFetch('/api/gemini', { method: 'POST', body: '{}', sessionScope: scope });
  const rejected = assert.rejects(request, { name: 'AbortError' });
  state.switchUser('B');
  token.resolve({ data: { session: { user: { id: 'B' }, access_token: 'token-B' } } });
  await rejected;
  assert.equal(state.prompts.length, 0);
});

test('capturing an initialized session pins the initiating account before yielding', async t => {
  const { state, api } = await fixture(t);
  await api.captureSessionScope();
  const pendingScope = api.captureSessionScope();
  state.switchUser('B');
  const original = await pendingScope;
  assert.equal(original.userId, 'A');
  assert.throws(() => api.assertSessionScope(original), { name: 'AbortError' });
});

test('cancelling a stream releases its pending reader and stops updates', async t => {
  const { state, api } = await fixture(t);
  const ready = deferred();
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => {
    ready.resolve();
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  const updates = [];
  const response = api.chatStream('question', '', [], chunk => updates.push(chunk));
  const rejected = assert.rejects(response, { name: 'AbortError' });
  await ready.promise;
  await new Promise(resolve => setImmediate(resolve));
  state.switchUser('B');
  await rejected;
  assert.equal(cancelled, true);
  assert.deepEqual(updates, []);
});

test('cancelling during a rate-limit delay prevents another paid request', async t => {
  const { api } = await fixture(t);
  const ready = deferred();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    ready.resolve();
    return Response.json({ error: 'rate limited' }, { status: 429 });
  });
  const controller = new AbortController();
  const response = api.chat('question', '', [], { signal: controller.signal });
  const rejected = assert.rejects(response, { name: 'AbortError' });
  await ready.promise;
  controller.abort();
  await rejected;
  assert.equal(calls, 1);
});
