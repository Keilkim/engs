import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkScrollDelta, BOOKMARK_VIEW_OFFSET } from './readingBookmark.js';

test('restoring a bookmark leaves room above it instead of pinning it to the top edge', () => {
  // Page image starts 40px below the scroller top and is 2000px tall; the bookmark is halfway down.
  const delta = bookmarkScrollDelta({ imageTop: 140, imageHeight: 2000, scrollerTop: 100, scrollerHeight: 800, y: 50 });
  const markOnScreen = 140 + 1000 - delta - 100; // distance from the scroller top after scrolling
  assert.equal(markOnScreen, 800 * BOOKMARK_VIEW_OFFSET);
});

test('a bookmark near the top of the page simply scrolls to the start', () => {
  const delta = bookmarkScrollDelta({ imageTop: 100, imageHeight: 2000, scrollerTop: 100, scrollerHeight: 800, y: 2 });
  assert.ok(delta < 0); // the browser clamps scrollTop at 0, so the page start stays visible
});
