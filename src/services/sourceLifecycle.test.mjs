import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createSessionScopeTracker } from '../utils/sessionScope.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const STORAGE_ROOT = 'https://project.example/storage/v1/object/public/sources/';
const tracker = createSessionScopeTracker();
let active;

function source(id, patch = {}) {
  return { id, user_id: OWNER, type: 'image', file_path: `${STORAGE_ROOT}${OWNER}/${id}.png`, captions_data: { segments: [{ text: `caption ${id}` }] }, ...patch };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function query(table) {
  const descriptor = { kind: 'query', table, operation: 'select', columns: '*', filters: [] };
  let execution;
  const matches = row => descriptor.filters.every(([kind, column, value]) => kind === 'in'
    ? value.some(item => String(row[column]) === String(item))
    : String(row[column]) === String(value));
  async function execute() {
    const fixture = active;
    fixture.calls.push(structuredClone(descriptor));
    const failure = fixture.failQuery?.(descriptor);
    if (failure) return { data: null, error: new Error(failure) };
    let rows = fixture.tables[table].filter(matches);
    if (descriptor.order) rows.sort((a, b) => a[descriptor.order] - b[descriptor.order]);
    if (descriptor.limit) rows = rows.slice(0, descriptor.limit);
    const snapshot = structuredClone(rows);
    if (descriptor.operation === 'delete') {
      if (!fixture.ignoreDeletes) fixture.tables[table] = fixture.tables[table].filter(row => !rows.includes(row));
    } else if (descriptor.operation === 'update') {
      for (const row of rows) Object.assign(row, descriptor.updates);
    }
    if (descriptor.columns === 'captions_data' && fixture.holdCaptions) {
      fixture.captionStarted.resolve();
      await fixture.holdCaptions.promise;
    }
    if (fixture.afterQuery) await fixture.afterQuery(descriptor);
    const data = descriptor.operation === 'update' ? structuredClone(rows) : snapshot;
    return { data: descriptor.single ? data[0] || null : data, error: null };
  }
  const run = () => execution ||= execute();
  const builder = {
    select(columns = '*') { descriptor.columns = columns; return this; },
    delete() { descriptor.operation = 'delete'; return this; },
    update(updates) { descriptor.operation = 'update'; descriptor.updates = updates; return this; },
    eq(column, value) { descriptor.filters.push(['eq', column, value]); return this; },
    in(column, value) { descriptor.filters.push(['in', column, value]); return this; },
    order(column) { descriptor.order = column; return this; },
    limit(value) { descriptor.limit = value; return this; },
    abortSignal() { return this; }, // emulate a late transport result even after cancellation
    single() { descriptor.single = true; return run(); },
    maybeSingle() { descriptor.single = true; return run(); },
    then(resolve, reject) { return run().then(resolve, reject); },
  };
  return builder;
}

const storage = {
  getPublicUrl(path) { return { data: { publicUrl: `${STORAGE_ROOT}${path}` } }; },
  async list(prefix, options) {
    const fixture = active;
    fixture.calls.push({ kind: 'storage-list', prefix, options });
    if (fixture.storageListError) return { error: new Error('storage list unavailable') };
    const entries = new Map();
    for (const path of [...fixture.files].sort()) {
      if (!path.startsWith(`${prefix}/`)) continue;
      const rest = path.slice(prefix.length + 1);
      entries.set(rest.split('/')[0], { name: rest.split('/')[0], id: rest.includes('/') ? null : path });
    }
    return { data: [...entries.values()].slice(options.offset, options.offset + options.limit) };
  },
  async remove(paths) {
    const fixture = active;
    fixture.calls.push({ kind: 'storage-remove', paths });
    if (fixture.storageRemoveError) return { error: new Error('storage remove unavailable') };
    for (const path of paths) fixture.files.delete(path);
    return { data: [], error: null };
  },
};
const supabase = {
  from: query,
  storage: { from(bucket) { assert.equal(bucket, 'sources'); return storage; } },
  auth: { async getSession() { return { data: { session: { user: { id: tracker.getSnapshot().userId } } } }; } },
};
globalThis.__sourceLifecycleMocks = {
  supabase,
  uploadStorageObject: () => assert.fail('unexpected upload'),
  captureSessionScope: async () => tracker.getSnapshot(),
  assertSessionScope: tracker.assertCurrent,
  subscribeSessionScope: tracker.subscribe,
};
const bundle = await build({
  stdin: {
    contents: "export * from './source'; export { resetAllSources } from './settings';",
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'mock-source-boundaries', setup(builder) {
    builder.onResolve({ filter: /^\.\/(supabase|sessionScope)$/ }, args => ({ path: args.path, namespace: 'source-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'source-test' }, () => ({
      contents: 'export const { supabase, uploadStorageObject, captureSessionScope, assertSessionScope, subscribeSessionScope } = globalThis.__sourceLifecycleMocks;',
      loader: 'js',
    }));
  } }],
});
const { deleteSource, getSourceCaptions, updateSource, clearSourceCaptionsCache, storagePathFromPublicUrl, resetAllSources } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
delete globalThis.__sourceLifecycleMocks;

function fixture(rows = [source(1)]) {
  active = {
    calls: [],
    tables: { sources: rows, chat_logs: rows.map(row => ({ id: row.id, source_id: row.id, user_id: row.user_id })), annotations: [], review_items: [] },
    files: new Set(rows.filter(row => row.file_path.startsWith(STORAGE_ROOT)).map(row => row.file_path.slice(STORAGE_ROOT.length))),
    captionStarted: deferred(),
  };
  tracker.updateUser(null);
  tracker.updateUser(OWNER);
  clearSourceCaptionsCache();
  return active;
}
const captionReads = f => f.calls.filter(call => call.kind === 'query' && call.columns === 'captions_data');
const mutations = f => f.calls.filter(call => call.kind === 'query' && call.operation === 'delete');

test('source lookup failure leaves its file, row, and chat available for a retry', async () => {
  const f = fixture();
  f.failQuery = q => q.operation === 'select' && q.columns === 'type, file_path' ? 'lookup unavailable' : null;
  await assert.rejects(deleteSource('1'), /lookup unavailable/);
  assert.equal(f.files.size, 1);
  assert.equal(f.tables.sources.length, 1);
  assert.equal(f.tables.chat_logs.length, 1);
  assert.equal(mutations(f).length, 0);
});

test('storage removal failure preserves source and chat; retry completes deletion', async () => {
  const f = fixture();
  f.storageRemoveError = true;
  await assert.rejects(deleteSource('1'), /storage remove unavailable/);
  assert.equal(f.tables.sources.length, 1);
  assert.equal(f.tables.chat_logs.length, 1);
  assert.equal(mutations(f).length, 0);
  f.storageRemoveError = false;
  await deleteSource('1');
  assert.equal(f.tables.sources.length, 0);
  assert.equal(f.tables.chat_logs.length, 0);
  assert.equal(f.files.size, 0);
});

test('chat cleanup failure is surfaced before deleting the retryable source row', async () => {
  const f = fixture();
  f.failQuery = q => q.table === 'chat_logs' && q.operation === 'delete' ? 'chat unavailable' : null;
  await assert.rejects(deleteSource('1'), /chat unavailable/);
  assert.equal(f.tables.sources.length, 1);
  assert.equal(f.tables.chat_logs.length, 1);
  f.failQuery = null;
  await deleteSource('1');
  assert.equal(f.tables.sources.length, 0);
});

test('database deletion failure retains the source path and the next attempt can finish', async () => {
  const f = fixture();
  f.failQuery = q => q.table === 'sources' && q.operation === 'delete' ? 'source unavailable' : null;
  await assert.rejects(deleteSource('1'), /source unavailable/);
  assert.equal(f.tables.sources.length, 1);
  f.failQuery = null;
  await deleteSource('1');
  assert.equal(f.tables.sources.length, 0);
});

test('successful deletion invalidates a cached caption and does not serve deleted data', async () => {
  const f = fixture();
  assert.deepEqual(await getSourceCaptions(1), f.tables.sources[0].captions_data);
  await deleteSource('1');
  assert.equal(await getSourceCaptions(1), null);
  assert.equal(captionReads(f).length, 2);
});

test('a lookalike external storage URL is never sent to the local Storage remove API', async () => {
  for (const url of [
    `${STORAGE_ROOT.replace('project.example', 'external.example')}${OWNER}/1.png`,
    `https://external.example/?url=${STORAGE_ROOT}${OWNER}/1.png`,
    `https://project.example/storage/v1/object/public/sources-foreign/${OWNER}/1.png`,
  ]) {
    const f = fixture([source(1, { file_path: url })]);
    assert.equal(storagePathFromPublicUrl(url), null);
    await deleteSource('1');
    assert.equal(f.calls.some(call => call.kind === 'storage-remove'), false);
  }
});

test('concurrent caption reads share one query and use the cached result afterward', async () => {
  const f = fixture();
  f.holdCaptions = deferred();
  const first = getSourceCaptions(1);
  const second = getSourceCaptions('1');
  await f.captionStarted.promise;
  assert.equal(captionReads(f).length, 1);
  f.holdCaptions.resolve();
  assert.deepEqual(await first, await second);
  assert.deepEqual(await getSourceCaptions(1), f.tables.sources[0].captions_data);
  assert.equal(captionReads(f).length, 1);
});

test('account changes clear cached captions even for an identical source ID', async () => {
  const f = fixture([source(1), source(1, { user_id: OTHER, captions_data: { segments: [{ text: 'other account' }] } })]);
  assert.equal((await getSourceCaptions(1)).segments[0].text, 'caption 1');
  tracker.updateUser(OTHER);
  assert.equal((await getSourceCaptions(1)).segments[0].text, 'other account');
  assert.equal(captionReads(f).length, 2);
});

test('late captions from a previous account are rejected and cannot replace the next account cache', async () => {
  const f = fixture([source(1), source(1, { user_id: OTHER, captions_data: { segments: [{ text: 'new account' }] } })]);
  const hold = f.holdCaptions = deferred();
  const pending = getSourceCaptions(1);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await f.captionStarted.promise;
  tracker.updateUser(OTHER);
  f.holdCaptions = null;
  assert.equal((await getSourceCaptions(1)).segments[0].text, 'new account');
  hold.resolve();
  await rejected;
  assert.equal((await getSourceCaptions(1)).segments[0].text, 'new account');
  assert.equal(captionReads(f).length, 2);
});

test('a source update invalidates an in-flight old caption response', async () => {
  const f = fixture();
  const hold = f.holdCaptions = deferred();
  const pending = getSourceCaptions(1);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await f.captionStarted.promise;
  const updated = { segments: [{ text: 'updated captions' }] };
  await updateSource('1', { captions_data: updated });
  f.holdCaptions = null;
  assert.deepEqual(await getSourceCaptions(1), updated);
  hold.resolve();
  await rejected;
  assert.deepEqual(await getSourceCaptions(1), updated);
  assert.equal(captionReads(f).length, 2);
});

test('reset processes more than 200 source rows and orphan uploads without touching another user', async () => {
  const rows = Array.from({ length: 425 }, (_, i) => source(i + 1));
  rows.push(source(999, { user_id: OTHER, file_path: `${STORAGE_ROOT}${OTHER}/999.png` }));
  const f = fixture(rows);
  f.files.add(`${OWNER}/old/nested/orphan.pdf`);
  f.tables.annotations = [{ id: 500, user_id: OWNER }, { id: 600, user_id: OTHER }];
  f.tables.review_items = [{ id: 500, user_id: OWNER }, { id: 600, user_id: OTHER }];
  f.tables.chat_logs.push({ id: 500, source_id: null, user_id: OWNER });
  assert.equal(await resetAllSources(), true);
  assert.deepEqual(f.tables.sources.map(row => row.id), [999]);
  assert.deepEqual([...f.files], [`${OTHER}/999.png`]);
  for (const table of ['annotations', 'review_items', 'chat_logs']) {
    assert.ok(f.tables[table].length > 0);
    assert.ok(f.tables[table].every(row => row.user_id === OTHER));
  }
  const sourceDeletes = mutations(f).filter(call => call.table === 'sources');
  assert.deepEqual(sourceDeletes.map(call => call.filters.find(filter => filter[0] === 'in')[2].length), [200, 200, 25]);
});

test('reset Storage failures preserve database rows and surface the failure', async () => {
  for (const failure of ['storageListError', 'storageRemoveError']) {
    const f = fixture();
    f[failure] = true;
    await assert.rejects(resetAllSources(), /storage .* unavailable/);
    assert.equal(f.tables.sources.length, 1);
    assert.equal(mutations(f).length, 0);
    f[failure] = false;
    assert.equal(await resetAllSources(), true);
  }
});

test('reset source lookup and chat-delete failures never pretend reset succeeded', async () => {
  for (const failure of ['lookup', 'chat']) {
    const f = fixture();
    f.failQuery = q => failure === 'lookup'
      ? q.table === 'sources' && q.operation === 'select' ? 'lookup unavailable' : null
      : q.table === 'chat_logs' && q.operation === 'delete' ? 'chat unavailable' : null;
    await assert.rejects(resetAllSources(), /unavailable/);
    assert.equal(f.tables.sources.length, 1);
    f.failQuery = null;
    await resetAllSources();
    assert.equal(f.tables.sources.length, 0);
  }
});

test('reset detects a non-progressing database delete instead of looping indefinitely', async () => {
  const f = fixture();
  f.ignoreDeletes = true;
  await assert.rejects(resetAllSources(), /자료 삭제가 완료되지 않았어요/);
  assert.equal(mutations(f).filter(call => call.table === 'sources').length, 1);
});

test('reset reports failures in the final manual-data cleanup', async () => {
  const f = fixture([]);
  f.tables.annotations.push({ id: 1, user_id: OWNER });
  f.failQuery = q => q.table === 'annotations' ? 'annotation cleanup unavailable' : null;
  await assert.rejects(resetAllSources(), /annotation cleanup unavailable/);
  assert.equal(f.tables.annotations.length, 1);
});
