import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const state = { calls: [] };
const ownerScope = { userId: 'account-a' };
const mocks = {
  supabase: { auth: { async signOut(options) {
    state.calls.push(['signOut', options]);
    return { error: state.signOutError || null };
  } } },
  async apiFetch(url, options) {
    state.calls.push(['request', url, options]);
    if (state.switchAccount) state.currentScope = { userId: 'account-b' };
    return state.response;
  },
  async captureSessionScope() { return state.currentScope; },
  assertSessionScope(scope) {
    if (scope !== state.currentScope) throw new DOMException('Account changed', 'AbortError');
  },
};
globalThis.__accountDeletionTestMocks = mocks;
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./auth.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'mock-auth-boundaries', setup(builder) {
    builder.onResolve({ filter: /^\.\/(supabase|apiFetch|sessionScope)$/ }, args => ({ path: args.path, namespace: 'account-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'account-test' }, () => ({
      contents: 'export const { supabase, apiFetch, captureSessionScope, assertSessionScope } = globalThis.__accountDeletionTestMocks;',
      loader: 'js',
    }));
  } }],
});
const { deleteAccount } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
delete globalThis.__accountDeletionTestMocks;

function reset(response) {
  state.calls = [];
  state.response = response;
  state.currentScope = ownerScope;
  state.switchAccount = false;
  state.signOutError = null;
}

test('account API failures retain the login and surface the retryable server message', async () => {
  reset(Response.json({ error: 'File cleanup needs a retry' }, { status: 503 }));
  await assert.rejects(deleteAccount('account-a'), /File cleanup needs a retry/);
  assert.equal(state.calls.some(call => call[0] === 'signOut'), false);
});

test('a missing API route returning HTML never signs out or pretends deletion succeeded', async () => {
  reset(new Response('<!DOCTYPE html><html></html>', { status: 200 }));
  await assert.rejects(deleteAccount('account-a'), /계정 삭제를 완료하지 못했어요/);
  assert.equal(state.calls.some(call => call[0] === 'signOut'), false);
});

test('only confirmed server deletion signs out, after making the request with the captured account', async () => {
  reset(Response.json({ deleted: true }));
  await deleteAccount('account-a');
  assert.deepEqual(state.calls, [
    ['request', '/api/delete-account', { method: 'POST', sessionScope: ownerScope }],
    ['signOut', { scope: 'local' }],
  ]);
});

test('a changed account before confirmation never sends the destructive request', async () => {
  reset(Response.json({ deleted: true }));
  await assert.rejects(deleteAccount('account-b'), /로그인 계정이 변경/);
  assert.deepEqual(state.calls, []);
});

test('a late response for a deleted account never signs out the next account', async () => {
  reset(Response.json({ deleted: true }));
  state.switchAccount = true;
  await assert.rejects(deleteAccount('account-a'), { name: 'AbortError' });
  assert.equal(state.calls.some(call => call[0] === 'signOut'), false);
});

test('logout failure after deletion reports that the account was already removed', async () => {
  reset(Response.json({ deleted: true }));
  state.signOutError = new Error('offline');
  await assert.rejects(deleteAccount('account-a'), /계정은 삭제됐지만/);
});
