import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const owner = { userId: 'a', signal: new AbortController().signal };
let scope = owner;
let row;
let calls;
let switchOnRead;
let conflict;
const mocks = {
  captureSessionScope: async () => scope,
  assertSessionScope: captured => { if (captured !== scope) throw new DOMException('Changed', 'AbortError'); },
  localDateString: () => '2026-10-30',
  supabase: { from(table) {
    const call = { table, filters: [], mutation: null };
    calls.push(call);
    const query = {
      select() { return query; }, abortSignal() { return query; }, maybeSingle() { return query; },
      eq(key, value) { call.filters.push([key, value]); return query; },
      update(data) { call.mutation = 'update'; call.data = data; return query; },
      insert(data) { call.mutation = 'insert'; call.data = data; return query; },
      then(resolve) {
        if (!call.mutation) {
          if (switchOnRead) scope = { userId: 'b' };
          return Promise.resolve({ data: row ? { ...row } : null, error: null }).then(resolve);
        }
        if (conflict) {
          conflict = false;
          row = { id: 1, cards_reviewed: (row?.cards_reviewed || 0) + 1, cards_correct: (row?.cards_correct || 0) + 1 };
          return Promise.resolve({ data: null, error: call.mutation === 'insert' ? { code: '23505' } : null }).then(resolve);
        }
        row = { id: 1, ...row, ...call.data };
        return Promise.resolve({ data: { id: 1 }, error: null }).then(resolve);
      },
    };
    return query;
  } },
};
globalThis.__statsMocks = mocks;
const bundle = await build({ entryPoints: [fileURLToPath(new URL('./stats.js', import.meta.url))], bundle: true,
  write: false, format: 'esm', platform: 'node', plugins: [{ name: 'stats-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(\.\/supabase|\.\/sessionScope\.js|\.\.\/utils\/dateUtils)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const { supabase, captureSessionScope, assertSessionScope, localDateString } = globalThis.__statsMocks;' }));
  } }] });
const { recordReviewStats } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
delete globalThis.__statsMocks;
function reset() { scope = owner; row = null; calls = []; switchOnRead = false; conflict = false; }

test('stats refuse a stale expected user before reading or writing', async () => {
  reset();
  await assert.rejects(recordReviewStats('b', true), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('an account change after the stats read prevents mutation', async () => {
  reset(); switchOnRead = true;
  await assert.rejects(recordReviewStats('a', true), { name: 'AbortError' });
  assert.equal(calls.some(call => call.mutation), false);
});

test('a simultaneous first review retries the unique insert and preserves both counts', async () => {
  reset(); conflict = true;
  await recordReviewStats('a', false);
  assert.equal(row.cards_reviewed, 2);
  assert.equal(row.cards_correct, 1);
  const update = calls.find(call => call.mutation === 'update');
  assert.ok(update.filters.some(([key, value]) => key === 'user_id' && value === 'a'));
});

test('a simultaneous existing-row update rereads instead of losing another review', async () => {
  reset(); row = { id: 1, cards_reviewed: 4, cards_correct: 3 }; conflict = true;
  await recordReviewStats('a', true);
  assert.equal(row.cards_reviewed, 6);
  assert.equal(row.cards_correct, 5);
  assert.ok(calls.filter(call => call.mutation).every(call => call.filters.some(([key]) => key === 'cards_reviewed')));
});
