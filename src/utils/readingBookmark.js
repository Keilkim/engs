export const READING_BOOKMARK_TYPE = 'reading_bookmark';

export function normalizeReadingPosition(value) {
  if (value?.kind === 'video' && Number.isFinite(value.time) && value.time >= 0) {
    return { kind: 'video', time: value.time };
  }
  if (value?.kind === 'document' && Number.isInteger(value.page) && value.page >= 0
    && Number.isFinite(value.y) && value.y >= 0 && value.y <= 100) {
    return { kind: 'document', page: value.page, y: value.y };
  }
  return null;
}

export function parseReadingBookmark(row) {
  if (!row) return null;
  try {
    const data = JSON.parse(row.ai_analysis_json);
    const position = data.type === READING_BOOKMARK_TYPE && normalizeReadingPosition(data);
    return position ? { id: row.id, ...position } : null;
  } catch { return null; }
}

// Deliberately reject diagonal scrolling, small drags, and zoomed/pinch gestures.
export function isBookmarkSwipe({ dx, dy, elapsed, zoomScale, multiTouch = false }) {
  return !multiTouch && zoomScale <= 1 && elapsed > 0 && elapsed < 1800
    && Math.abs(dx) >= 80 && Math.abs(dy) <= 30 && Math.abs(dx) > Math.abs(dy) * 2;
}

// Restore with the bookmark a fifth of the way down the screen, so the lines
// just above it show again instead of the mark sitting on the top edge.
export const BOOKMARK_VIEW_OFFSET = 0.2;

export function bookmarkScrollDelta({ imageTop, imageHeight, scrollerTop, scrollerHeight, y }) {
  return imageTop - scrollerTop + imageHeight * y / 100 - scrollerHeight * BOOKMARK_VIEW_OFFSET;
}
