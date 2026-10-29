import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeDeleteAccountHandler } from '../../api/_lib/accountDeletion.js';
import { removeUserStorageFiles } from '../lib/storageCleanup.js';
import productionHandler from '../../api/delete-account.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function fixture(paths = []) {
  const files = new Set(paths);
  const calls = [];
  const state = {};
  const storage = {
    async list(prefix, options) {
      calls.push(['list', prefix, options]);
      if (state.listError) return { error: state.listError };
      if (state.listOverride) return { data: state.listOverride };
      const entries = new Map();
      for (const path of [...files].sort()) {
        if (!path.startsWith(`${prefix}/`)) continue;
        const rest = path.slice(prefix.length + 1);
        const name = rest.split('/')[0];
        entries.set(name, { name, id: rest.includes('/') ? null : `object:${path}` });
      }
      return { data: [...entries.values()].slice(options.offset, options.offset + options.limit) };
    },
    async remove(pathsToRemove) {
      calls.push(['remove', pathsToRemove]);
      if (state.removeError) return { error: state.removeError };
      if (!state.keepFiles) for (const path of pathsToRemove) files.delete(path);
      return { data: [] };
    },
  };
  const client = {
    storage: { from(bucket) { assert.equal(bucket, 'sources'); return storage; } },
    from(table) {
      return { delete: () => ({ eq: async (column, uid) => {
        calls.push(['legacy-data', table, column, uid]);
        return { error: state.settingsError || null };
      } }) };
    },
    auth: {
      async getUser(token) {
        calls.push(['verify', token]);
        return { data: { user: state.user || { id: OWNER } }, error: state.authError || null };
      },
      admin: { async deleteUser(uid) {
        calls.push(['delete-user', uid]);
        return { error: state.deleteError || null };
      } },
    },
  };
  const handler = makeDeleteAccountHandler({
    createClient(url, key, options) {
      calls.push(['create-client']);
      assert.equal(url, 'https://project.example');
      assert.equal(key, 'server-key');
      assert.equal(options.auth.persistSession, false);
      return client;
    },
    env: { SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 'server-key' },
  });
  return { files, calls, state, client, handler };
}

async function request(handler, patch = {}) {
  const res = {
    headers: {}, statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
  await handler({ method: 'POST', headers: { authorization: 'Bearer own-token' }, ...patch }, res);
  return res;
}

test('production entry denies unauthenticated requests before loading the administrative SDK', async () => {
  const result = await request(productionHandler, { headers: {} });
  assert.equal(result.statusCode, 401);
});

test('asynchronous administrative SDK initialization failure keeps the account and returns a recoverable error', async () => {
  const handler = makeDeleteAccountHandler({
    createClient: async () => { throw new Error('SDK initialization unavailable'); },
    env: { SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 'server-key' },
  });
  const result = await request(handler);
  assert.equal(result.statusCode, 503);
  assert.match(result.body.error, /로그인을 확인하지 못했어요/);
});

test('storage cleanup traverses multiple pages and nested orphan files without touching another account', async () => {
  const owned = Array.from({ length: 225 }, (_, i) => `${OWNER}/upload-${i}.pdf`);
  owned.push(`${OWNER}/old/nested/orphan.png`);
  const f = fixture([...owned, `${OTHER}/keep.pdf`]);
  await removeUserStorageFiles(f.client, OWNER);
  assert.deepEqual([...f.files], [`${OTHER}/keep.pdf`]);
  assert.ok(f.calls.filter(call => call[0] === 'list').length >= 6);
  for (const call of f.calls.filter(call => call[0] === 'list')) {
    assert.equal(call[2].offset, 0);
    assert.equal(call[2].limit, 100);
  }
});

test('cleanup budget preserves the account and a later request resumes after files already removed', async () => {
  const f = fixture(Array.from({ length: 150 }, (_, i) => `${OWNER}/file-${i}`));
  await assert.rejects(removeUserStorageFiles(f.client, OWNER, { maxRequests: 2 }), /another attempt/);
  assert.equal(f.files.size, 50);
  assert.equal(f.calls.some(call => call[0] === 'delete-user'), false);
  await removeUserStorageFiles(f.client, OWNER);
  assert.equal(f.files.size, 0);
});

test('storage cleanup fails within its budget if Storage reports success without removing files', async () => {
  const f = fixture([`${OWNER}/file.pdf`]);
  f.state.keepFiles = true;
  await assert.rejects(removeUserStorageFiles(f.client, OWNER, { maxRequests: 4 }), /another attempt/);
  assert.equal(f.calls.filter(call => call[0] === 'list').length, 2);
});

test('untrusted paths and invalid account IDs never reach storage deletion', async () => {
  const f = fixture();
  f.state.listOverride = [{ name: '../other/file', id: 'file' }];
  await assert.rejects(removeUserStorageFiles(f.client, OWNER), /Invalid storage entry/);
  await assert.rejects(removeUserStorageFiles(f.client, '../other'), /Invalid account ID/);
  assert.equal(f.calls.some(call => call[0] === 'remove'), false);
});

test('expired cleanup deadline stops work before the first storage call', async () => {
  const f = fixture();
  await assert.rejects(removeUserStorageFiles(f.client, OWNER, { deadline: 10, now: () => 10 }), /another attempt/);
  assert.equal(f.calls.length, 0);
});

test('account deletion targets only the freshly verified bearer identity and runs storage first', async () => {
  const f = fixture([`${OWNER}/orphan.pdf`, `${OTHER}/keep.pdf`]);
  const res = await request(f.handler, { body: { userId: OTHER, id: OTHER } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { deleted: true });
  assert.deepEqual([...f.files], [`${OTHER}/keep.pdf`]);
  assert.deepEqual(f.calls.find(call => call[0] === 'verify'), ['verify', 'own-token']);
  assert.deepEqual(f.calls.find(call => call[0] === 'legacy-data'), ['legacy-data', 'user_settings', 'user_id', OWNER]);
  assert.deepEqual(f.calls.at(-1), ['delete-user', OWNER]);
  assert.ok(f.calls.findIndex(call => call[0] === 'remove') < f.calls.findIndex(call => call[0] === 'legacy-data'));
});

test('unauthenticated and unsupported requests do not instantiate an admin client', async () => {
  const f = fixture();
  assert.equal((await request(f.handler, { headers: {} })).statusCode, 401);
  assert.equal((await request(f.handler, { method: 'GET' })).statusCode, 405);
  assert.equal((await request(f.handler, { method: 'OPTIONS' })).statusCode, 204);
  assert.equal(f.calls.length, 0);
});

test('missing server configuration fails before any account or data changes', async () => {
  const handler = makeDeleteAccountHandler({ createClient: () => assert.fail('no admin client'), env: {} });
  const res = await request(handler);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /서버 설정/);
});

test('invalid or anonymous sessions cannot delete files or an account', async () => {
  for (const state of [{ authError: { message: 'expired' } }, { user: { id: OWNER, is_anonymous: true } }]) {
    const f = fixture([`${OWNER}/keep.pdf`]);
    Object.assign(f.state, state);
    assert.equal((await request(f.handler)).statusCode, 401);
    assert.equal(f.calls.some(call => ['list', 'legacy-data', 'delete-user'].includes(call[0])), false);
  }
});

test('Storage listing and removal failures preserve database rows and identity for a retry', async () => {
  for (const failure of ['listError', 'removeError']) {
    const f = fixture([`${OWNER}/keep.pdf`]);
    f.state[failure] = new Error('storage unavailable');
    const res = await request(f.handler);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /계정은 유지/);
    assert.equal(f.calls.some(call => ['legacy-data', 'delete-user'].includes(call[0])), false);
    delete f.state[failure];
    assert.equal((await request(f.handler)).statusCode, 200);
  }
});

test('an absent legacy table is allowed, but its permission or network failure is surfaced', async () => {
  for (const code of ['42P01', 'PGRST205', '42501', 'NETWORK']) {
    const f = fixture();
    f.state.settingsError = { code };
    const res = await request(f.handler);
    const optionalMissing = ['42P01', 'PGRST205'].includes(code);
    assert.equal(res.statusCode, optionalMissing ? 200 : 503);
    assert.equal(f.calls.some(call => call[0] === 'delete-user'), optionalMissing);
  }
});

test('identity deletion failure never returns a success response', async () => {
  const f = fixture();
  f.state.deleteError = new Error('auth unavailable');
  const res = await request(f.handler);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /다시 삭제/);
});

test('all schema-owned account tables support the transactional Auth deletion cascade', async () => {
  const schema = await readFile(new URL('../../supabase-schema.sql', import.meta.url), 'utf8');
  for (const table of ['sources', 'annotations', 'review_items', 'chat_logs', 'user_stats', 'notification_settings', 'push_tokens', 'api_usage']) {
    const declaration = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(declaration, `${table} is defined`);
    assert.match(declaration[1], /user_id UUID REFERENCES auth\.users\(id\) ON DELETE CASCADE NOT NULL/);
  }
});
