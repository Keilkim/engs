import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadingBookmarkStore } from './readingBookmarkStore.js';
import { isBookmarkSwipe, normalizeReadingPosition } from '../utils/readingBookmark.js';

function fixture() {
  const rows = [];
  let userId = 'a';
  let nextId = 1;
  let failure = false;
  let afterQuery;
  const store = createReadingBookmarkStore({
    captureScope: async () => ({ userId }),
    assertScope: scope => { if (scope.userId !== userId) throw new Error('Account changed'); },
    client: { from(table) {
      assert.equal(table, 'annotations'); // No review_items writes for bookmarks.
      const filters = [];
      let operation = 'read', input, single = false;
      const query = {
        select() { return this; },
        insert(value) { operation = 'insert'; input = value; return this; },
        update(value) { operation = 'update'; input = value; return this; },
        delete() { operation = 'delete'; return this; },
        eq(key, value) { filters.push(row => String(row[key]) === String(value)); return this; },
        ilike(key, value) { filters.push(row => row[key]?.includes(value.replaceAll('%', ''))); return this; },
        order() { return this; }, limit() { return this; }, abortSignal() { return this; },
        single() { single = true; return this; },
        async then(resolve, reject) {
          try {
            if (failure) throw new Error('offline');
            let matched = rows.filter(row => filters.every(filter => filter(row)));
            if (operation === 'insert') {
              const row = { ...input, id: nextId++ };
              rows.push(row);
              matched = [row];
            } else if (operation === 'update') matched.forEach(row => Object.assign(row, input));
            else if (operation === 'delete') matched.forEach(row => rows.splice(rows.indexOf(row), 1));
            afterQuery?.();
            resolve({ data: single ? structuredClone(matched[0]) : structuredClone(matched.slice(-1).reverse()),
              error: single && !matched.length ? new Error('No matching row') : null });
          } catch (error) { reject(error); }
        },
      };
      return query;
    } },
  });
  return { store, rows, switchUser: value => { userId = value; }, fail: () => { failure = true; },
    afterQuery: callback => { afterQuery = callback; } };
}

test('video and document bookmarks survive a reload and replace the saved position', async () => {
  const { store, rows } = fixture();
  assert.equal(await store.load(1), null);
  const first = await store.save(1, { kind: 'video', time: 72.5 });
  assert.deepEqual(await store.load(1), first);
  const next = await store.save(1, { kind: 'video', time: 110 }, first.id);
  assert.equal(first.id, next.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].selection_rect, null);
  assert.equal(rows[0].selected_text, null);
  const document = await store.save(2, { kind: 'document', page: 4, y: 37.5 });
  assert.deepEqual(await store.load(2), document);
  await store.remove(1);
  assert.equal(await store.load(1), null);
  assert.deepEqual(await store.load(2), document);
});

test('load, update, and delete stay scoped to the current account and source', async () => {
  const f = fixture();
  const a = await f.store.save(1, { kind: 'video', time: 20 });
  f.switchUser('b');
  assert.equal(await f.store.load(1), null);
  await f.store.remove(1);
  assert.equal(f.rows.length, 1);
  await assert.rejects(f.store.save(1, { kind: 'video', time: 99 }, a.id), /No matching row/);
  assert.equal(f.rows[0].user_id, 'a');
  assert.equal(JSON.parse(f.rows[0].ai_analysis_json).time, 20);
});

test('network failure and an account change reject instead of reporting a saved bookmark', async () => {
  const f = fixture();
  f.fail();
  await assert.rejects(f.store.save(1, { kind: 'video', time: 5 }), /offline/);
  const g = fixture();
  g.afterQuery(() => g.switchUser('b'));
  await assert.rejects(g.store.load(1), /Account changed/);
});

test('invalid bookmark positions are rejected before any write', async () => {
  const f = fixture();
  for (const position of [{ kind: 'video', time: -1 }, { kind: 'video', time: Infinity },
    { kind: 'document', page: -1, y: 10 }, { kind: 'document', page: 1, y: 101 },
    { kind: 'document', page: 1.5, y: 10 }]) {
    assert.equal(normalizeReadingPosition(position), null);
    await assert.rejects(f.store.save(1, position), /Invalid/);
  }
  assert.equal(f.rows.length, 0);
});

test('only a deliberate single-finger horizontal swipe at minimum zoom bookmarks', () => {
  const swipe = { dx: 120, dy: 8, elapsed: 400, zoomScale: 1 };
  assert.equal(isBookmarkSwipe(swipe), true);
  assert.equal(isBookmarkSwipe({ ...swipe, dx: -120 }), true);
  for (const change of [{ dx: 30 }, { dy: 60 }, { zoomScale: 1.5 }, { multiTouch: true },
    { dx: 5, dy: 120 }, { elapsed: 2500 }]) {
    assert.equal(isBookmarkSwipe({ ...swipe, ...change }), false);
  }
});
