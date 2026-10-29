import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const owner = { userId: 'a', signal: new AbortController().signal };
let currentScope = owner;
let record;
let calls;
let switchOnRead;
let compete;
const mocks = {
  captureSessionScope: async () => currentScope,
  assertSessionScope: scope => { if (scope !== currentScope) throw new DOMException('Changed', 'AbortError'); },
  localDateString: () => '2026-10-30',
  supabase: { from(table) {
    const call = { table, filters: [], updates: null };
    calls.push(call);
    const query = {
      select() { return query; }, order() { return query; }, range() { return query; }, single() { return query; }, maybeSingle() { return query; },
      update(updates) { call.updates = updates; return query; },
      eq(key, value) { call.filters.push([key, value]); return query; },
      is(key, value) { call.filters.push([key, value]); return query; },
      abortSignal() { return query; },
      then(resolve) {
        if (!call.updates) {
          if (switchOnRead) currentScope = { userId: 'b' };
          return Promise.resolve({ data: { ...record }, error: null }).then(resolve);
        }
        if (compete) {
          record = { ...record, next_review_date: '2099-01-01', repetitions: 2 };
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        record = { ...record, ...call.updates };
        return Promise.resolve({ data: record, error: null }).then(resolve);
      },
    };
    return query;
  } },
};
globalThis.__reviewMocks = mocks;
const bundle = await build({ entryPoints: [fileURLToPath(new URL('./review.js', import.meta.url))], bundle: true,
  write: false, format: 'esm', platform: 'node', plugins: [{ name: 'review-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(\.\/supabase|\.\/sessionScope\.js|\.\.\/utils\/dateUtils)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const { supabase, captureSessionScope, assertSessionScope, localDateString } = globalThis.__reviewMocks;' }));
  } }] });
const { updateReviewResult, setReviewStatus } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
delete globalThis.__reviewMocks;
function reset() {
  currentScope = owner; calls = []; switchOnRead = false; compete = false;
  record = { id: 1, user_id: 'a', status: 'active', next_review_date: '2026-10-30', last_reviewed: null, repetitions: 0 };
}

test('review writes pin owner and compare previous state; repeated submission does not reschedule', async () => {
  reset();
  const result = await updateReviewResult(1, true);
  assert.equal(result.alreadyRecorded, false);
  const mutation = calls.find(call => call.updates);
  assert.ok(mutation.filters.some(([key, value]) => key === 'user_id' && value === 'a'));
  assert.ok(mutation.filters.some(([key, value]) => key === 'last_reviewed' && value === null));
  record.next_review_date = '2099-01-01';
  assert.equal((await updateReviewResult(1, true)).alreadyRecorded, true);
  assert.equal(calls.filter(call => call.updates).length, 1);
});

test('account switch after read prevents a write to the next account', async () => {
  reset(); switchOnRead = true;
  await assert.rejects(updateReviewResult(1, true), { name: 'AbortError' });
  assert.equal(calls.some(call => call.updates), false);
});

test('a competing tab that wins the compare-and-set is recognized, not overwritten', async () => {
  reset(); compete = true;
  const result = await updateReviewResult(1, false);
  assert.equal(result.alreadyRecorded, true);
  assert.equal(result.item.repetitions, 2);
});

test('suspended cards cannot be graded and invalid statuses cannot be written', async () => {
  reset(); record.status = 'suspended';
  await assert.rejects(updateReviewResult(1, true), /복습에서 빠졌/);
  assert.equal(calls.some(call => call.updates), false);
  await assert.rejects(setReviewStatus(1, 'deleted'), /잘못된/);
});
