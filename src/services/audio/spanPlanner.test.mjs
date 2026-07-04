import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planTimeline,
  contentTimeAtWall,
  videoContentAtWall,
  wallAtContent,
  snapSeekContent,
} from './spanPlanner.js';

// Build a chunk mimicking pauseChunker output. `spans` = [[start,end],...].
function chunk(start, end, spans) {
  const words = [];
  const glueSpans = spans.map(([s, e]) => {
    const wordStart = words.length;
    words.push({ word: 'w', start: s, end: e });
    return { wordStart, wordEnd: words.length - 1, start: s, end: e };
  });
  return { start, end, words, glueSpans };
}

const APPROX = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('totalWall equals content span / rate', () => {
  const chunks = [chunk(0, 2, [[0, 2]]), chunk(3, 4, [[3, 4]])];
  const plan = planTimeline(chunks, 0.5);
  APPROX(plan.totalWall, (4 - 0) / 0.5); // = 8
});

test('speech entries play at native 1.0x (wallDur == contentDur)', () => {
  const chunks = [chunk(0, 2, [[0, 1], [1.2, 2]])];
  const plan = planTimeline(chunks, 0.5);
  for (const e of plan.entries) {
    if (e.type !== 'speech') continue;
    APPROX(e.wallEnd - e.wallStart, e.contentEnd - e.contentStart);
  }
});

test('caption + video clocks coincide at every chunk boundary', () => {
  const chunks = [chunk(0, 2, [[0, 2]]), chunk(3, 4, [[3, 4]]), chunk(4.5, 6, [[4.5, 6]])];
  const rate = 0.5;
  const plan = planTimeline(chunks, rate);
  // At each chunk.end, cumulative wall must map both clocks to chunk.end.
  let cumWall = 0;
  for (let i = 0; i < chunks.length; i++) {
    // wall consumed up to and including chunk i's budget + inter gaps before it
    // is exactly (chunk[i].end - contentStart)/rate.
    cumWall = (chunks[i].end - chunks[0].start) / rate;
    APPROX(videoContentAtWall(plan, cumWall), chunks[i].end);
    APPROX(contentTimeAtWall(plan, cumWall), chunks[i].end, 1e-6);
  }
});

test('caption clock is frozen during a gap while the video clock keeps moving', () => {
  const chunks = [chunk(0, 1, [[0, 1]]), chunk(2, 3, [[2, 3]])]; // 1s gap < ambient threshold → pure silence
  const rate = 0.5;
  const plan = planTimeline(chunks, rate);
  // Speech A: wall [0,1] content [0,1]; trailing gap wall [1,2] holds caption at 1.
  assert.equal(contentTimeAtWall(plan, 1.2), contentTimeAtWall(plan, 1.8)); // caption frozen
  assert.equal(contentTimeAtWall(plan, 1.5), 1);
  assert.notEqual(videoContentAtWall(plan, 1.2), videoContentAtWall(plan, 1.8)); // video moving
});

test('contentTimeAtWall is monotonic non-decreasing', () => {
  const chunks = [chunk(0, 2, [[0, 0.8], [1.0, 2]]), chunk(3, 5, [[3, 5]])];
  const plan = planTimeline(chunks, 0.25);
  let prev = -Infinity;
  for (let w = 0; w <= plan.totalWall + 0.01; w += plan.totalWall / 200) {
    const c = contentTimeAtWall(plan, w);
    assert.ok(c >= prev - 1e-9, `non-monotonic at wall ${w}: ${c} < ${prev}`);
    prev = c;
  }
});

test('over-long glued span is force-split by maxSpanSec', () => {
  // one chunk, one 5s glued span made of 5 words @1s each, no gaps → cap at 3s.
  const words = Array.from({ length: 5 }, (_, i) => ({ word: 'w', start: i, end: i + 1 }));
  const chunkObj = { start: 0, end: 5, words, glueSpans: [{ wordStart: 0, wordEnd: 4, start: 0, end: 5 }] };
  const plan = planTimeline([chunkObj], 0.5, { maxSpanSec: 3.0 });
  const speechDurs = plan.entries.filter((e) => e.type === 'speech').map((e) => e.contentEnd - e.contentStart);
  assert.ok(speechDurs.length >= 2, 'should split into ≥2 spans');
  assert.ok(speechDurs.every((d) => d <= 3.0 + 1e-9), 'no span exceeds maxSpanSec');
  // Regression: the silence budget for a force-split (totalSoft===0) chunk must
  // not be double-counted — totalWall must still equal content span / rate.
  APPROX(plan.totalWall, (5 - 0) / 0.5); // = 10
});

test('snapSeek: inside a span restarts it; inside a gap jumps to next span', () => {
  const chunks = [chunk(0, 1, [[0, 1]]), chunk(2, 3, [[2, 3]])]; // 1s pure-silence gap
  const plan = planTimeline(chunks, 0.5);
  assert.equal(snapSeekContent(plan, 0.5), 0);  // inside span A → restart A
  assert.equal(snapSeekContent(plan, 1.5), 2);  // in the gap between → next span (B)
});

test('wallAtContent round-trips content that is inside a span', () => {
  const chunks = [chunk(0, 2, [[0, 2]])];
  const plan = planTimeline(chunks, 0.5);
  const w = wallAtContent(plan, 1.0); // middle of the only span
  APPROX(contentTimeAtWall(plan, w), 1.0);
});

test('degenerate input: rate>=1 or no chunks yields empty plan', () => {
  assert.equal(planTimeline([], 0.5).entries.length, 0);
  assert.equal(planTimeline([chunk(0, 1, [[0, 1]])], 1.0).entries.length, 0);
});
