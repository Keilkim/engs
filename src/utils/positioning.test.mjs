import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./positioning.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const { placeAnchoredMenu } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

// 800px screen, 50px bottom bar → usable band is [12, 738].
const base = { viewportHeight: 800, bottomInset: 50, margin: 12, gap: 12 };

test('keeps the preferred side when the menu fits there', () => {
  const r = placeAnchoredMenu({ ...base, anchor: { top: 100, bottom: 120 }, menuHeight: 300, preferred: 'below' });
  assert.equal(r.placement, 'below');
  assert.equal(r.top, 132);
  assert.equal(r.detached, false);
});

test('flips above when a tall menu would run off the bottom', () => {
  // 250px below the word passed the old fixed "200px" check, but a 450px idiom
  // list does not fit there; it does fit above.
  const r = placeAnchoredMenu({ ...base, anchor: { top: 480, bottom: 500 }, menuHeight: 450, preferred: 'below' });
  assert.equal(r.placement, 'above');
  assert.equal(r.top, 480 - 12 - 450);
  assert.ok(r.top >= 12);
  assert.equal(r.detached, false);
});

test('caps height to the roomier side when neither side fits', () => {
  const r = placeAnchoredMenu({ ...base, anchor: { top: 380, bottom: 400 }, menuHeight: 900, preferred: 'below' });
  // below: 738 - 412 = 326, above: 368 - 12 = 356 → above wins, body scrolls.
  assert.equal(r.placement, 'above');
  assert.equal(r.maxHeight, 356);
  assert.equal(r.top, 12);
  assert.equal(r.detached, false);
});

test('never leaves the screen even when squeezed below minHeight', () => {
  // Huge anchor (zoomed in): almost no room either side → overlap the anchor
  // but stay on screen, and report that the arrow no longer points at it.
  const r = placeAnchoredMenu({ ...base, anchor: { top: 40, bottom: 720 }, menuHeight: 400, preferred: 'below' });
  assert.equal(r.maxHeight, 160);
  assert.ok(r.top >= 12);
  assert.ok(r.top + Math.min(400, r.maxHeight) <= 738);
  assert.equal(r.detached, true);
});
