import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportTask } from './importTask.js';

function fixture() {
  const removed = [];
  const task = createImportTask({
    removeSource: async id => { removed.push(['source', id]); },
    removeUpload: async path => { removed.push(['file', path]); },
  });
  return { task, removed };
}

test('cancel before saving never inserts a source', async () => {
  const { task, removed } = fixture();
  task.cancel();
  await assert.rejects(task.save(() => assert.fail('must not insert')), { name: 'AbortError' });
  await task.rollback();
  assert.deepEqual(removed, []);
});

test('cancel during the final insert removes the committed row and upload', async () => {
  const { task, removed } = fixture();
  task.trackUpload('user/file.pdf');
  let finish;
  const saving = task.save(() => new Promise(resolve => { finish = resolve; }));
  const rejected = assert.rejects(saving, { name: 'AbortError' });
  task.cancel();
  finish({ id: 42 });
  await rejected;
  await task.rollback();
  await task.rollback(); // repeated cancellation never deletes twice
  assert.deepEqual(removed, [['source', 42], ['file', 'user/file.pdf']]);
});

test('failed insert cleans up the already uploaded file', async () => {
  const { task, removed } = fixture();
  task.trackUpload('user/image.png');
  await assert.rejects(task.save(async () => { throw new Error('database unavailable'); }));
  await task.rollback();
  assert.deepEqual(removed, [['file', 'user/image.png']]);
});

test('normal completion retains both the source and its file', async () => {
  const { task, removed } = fixture();
  task.trackUpload('user/file.pdf');
  assert.deepEqual(await task.save(async () => ({ id: 43 })), { id: 43 });
  assert.deepEqual(removed, []);
});

test('cancelling an old task does not affect a newly started task', async () => {
  const old = fixture();
  const next = fixture();
  old.task.cancel();
  assert.equal(next.task.signal.aborted, false);
  assert.deepEqual(await next.task.save(async () => ({ id: 44 })), { id: 44 });
});

test('cleanup failure is reported and preserves the file until its row is removed', async () => {
  let fail = true;
  const removed = [];
  const task = createImportTask({
    removeSource: async id => {
      if (fail) throw new Error('offline');
      removed.push(id);
    },
    removeUpload: async path => { removed.push(path); },
  });
  task.trackUpload('user/file.pdf');
  await task.save(async () => ({ id: 45 }));
  task.cancel();
  await assert.rejects(task.rollback(), /offline/);
  assert.deepEqual(removed, []);
  fail = false;
  await task.rollback();
  assert.deepEqual(removed, [45, 'user/file.pdf']);
});
