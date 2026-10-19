import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotationWriter } from './annotationWriter.js';
import { createSessionScopeTracker } from '../utils/sessionScope.js';

function fixture() {
  const tracker = createSessionScopeTracker();
  tracker.updateUser('user-a');
  const annotations = new Map();
  const reviews = new Map();
  const events = [];
  const stored = new Map();
  let nextId = 1;
  const failures = { insert: false, review: false, cleanup: false, afterInsert: null };
  const dependencies = {
    captureScope: async () => {
      const scope = tracker.getSnapshot();
      tracker.assertCurrent(scope);
      return scope;
    },
    assertScope: tracker.assertCurrent,
    getStorage: () => ({
      getItem: key => stored.get(key),
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key),
    }),
    async insertAnnotation(input, userId) {
      events.push(['insert', userId]);
      if (failures.insert) throw new Error('annotation insert failed');
      const row = { ...input, id: nextId++, user_id: userId };
      annotations.set(row.id, row);
      await failures.afterInsert?.();
      return row;
    },
    async insertReview(id, userId) {
      events.push(['review', id, userId]);
      // Simulate a response failure AFTER the review insert commits too.
      reviews.set(id, { annotation_id: id, user_id: userId });
      if (failures.review) throw new Error('review response failed');
    },
    async removeAnnotation(id, userId) {
      events.push(['cleanup', id, userId]);
      if (failures.cleanup) throw new Error('cleanup offline');
      if (annotations.get(id)?.user_id === userId) {
        annotations.delete(id);
        reviews.delete(id); // schema's ON DELETE CASCADE
      }
    },
  };
  return {
    write: createAnnotationWriter(dependencies),
    reload: () => createAnnotationWriter(dependencies),
    tracker, annotations, reviews, events, stored, failures,
  };
}

const word = { type: 'highlight', selected_text: 'word', ai_analysis_json: '{"isVocabulary":true}' };

test('a completed vocabulary save retains its annotation and review under one owner', async () => {
  const f = fixture();
  const saved = await f.write(word, true);
  assert.equal(f.annotations.size, 1);
  assert.equal(f.reviews.get(saved.id).user_id, saved.user_id);
  assert.equal(f.stored.size, 0);
});

test('review failure removes the annotation and any committed review before rejecting', async () => {
  const f = fixture();
  f.failures.review = true;
  await assert.rejects(f.write(word, true), /review response failed/);
  assert.equal(f.annotations.size, 0);
  assert.equal(f.reviews.size, 0);
  assert.equal(f.stored.size, 0);
  f.failures.review = false;
  await f.write(word, true);
  assert.equal(f.annotations.size, 1);
  assert.equal(f.reviews.size, 1);
});

test('cleanup failure remains visible and blocks a duplicate insert on retry', async () => {
  const f = fixture();
  f.failures.review = true;
  f.failures.cleanup = true;
  await assert.rejects(f.write(word, true), error => {
    assert.equal(error.code, 'ANNOTATION_CLEANUP_PENDING');
    assert.equal(error.annotationId, 1);
    assert.match(error.cause.message, /review/);
    assert.match(error.cleanupError.message, /offline/);
    return true;
  });
  await assert.rejects(f.write(word, true), { code: 'ANNOTATION_CLEANUP_PENDING' });
  assert.equal(f.events.filter(event => event[0] === 'insert').length, 1);
  assert.equal(f.annotations.size, 1);
});

test('after reload a recovered connection cleans up the old row before saving one replacement', async () => {
  const f = fixture();
  f.failures.review = f.failures.cleanup = true;
  await assert.rejects(f.write(word, true));
  assert.deepEqual(JSON.parse([...f.stored.values()][0]), [{ userId: 'user-a', id: 1 }]);
  f.failures.review = f.failures.cleanup = false;
  const replacement = await f.reload()(word, true);
  assert.equal(replacement.id, 2);
  assert.deepEqual([...f.annotations.keys()], [2]);
  assert.deepEqual([...f.reviews.keys()], [2]);
  assert.equal(f.stored.size, 0);
});

test('changing accounts between writes never creates a review owned by the new account', async () => {
  const f = fixture();
  f.failures.afterInsert = () => f.tracker.updateUser('user-b');
  await assert.rejects(f.write(word, true), { code: 'ANNOTATION_CLEANUP_PENDING' });
  assert.equal(f.reviews.size, 0);
  assert.equal(f.events.filter(event => event[0] === 'cleanup').length, 0);

  f.failures.afterInsert = null;
  const b = await f.write(word, true);
  assert.equal(b.user_id, 'user-b');
  assert.equal(f.annotations.get(1).user_id, 'user-a');

  f.tracker.updateUser('user-a');
  await f.write(word, true);
  assert.equal(f.annotations.has(1), false);
  assert.deepEqual(f.events.filter(event => event[0] === 'cleanup'), [['cleanup', 1, 'user-a']]);
});

test('concurrent identical saves share one operation and produce one review', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([f.write(word, true), f.write({ ...word }, true)]);
  assert.equal(first.id, second.id);
  assert.equal(f.annotations.size, 1);
  assert.equal(f.reviews.size, 1);
});

test('ordinary notes skip review insertion while unauthenticated saves do not write anything', async () => {
  const f = fixture();
  await f.write({ type: 'memo', memo_content: 'memo' }, false);
  assert.equal(f.reviews.size, 0);
  f.tracker.updateUser(null);
  await assert.rejects(f.write(word, true), { name: 'AbortError' });
  assert.equal(f.annotations.size, 1);
});

test('an annotation insert failure does not attempt to delete an unknown record', async () => {
  const f = fixture();
  f.failures.insert = true;
  await assert.rejects(f.write(word, true), /annotation insert failed/);
  assert.deepEqual(f.events, [['insert', 'user-a']]);
  assert.equal(f.annotations.size, 0);
});
