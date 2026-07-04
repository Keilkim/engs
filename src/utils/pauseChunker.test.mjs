import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPauseChunks, DEFAULT_CHUNK_PARAMS } from './pauseChunker.js';

// Helpers ------------------------------------------------------------------
const seg = (text, words, extra = {}) => ({ text, words: words.map(([word, start, end]) => ({ word, start, end })), ...extra });
const totalWords = (chunks) => chunks.reduce((n, c) => n + c.words.length, 0);

// A run of glued words starting at `t0`, each `dur` long with `gap` between.
function run(prefix, count, t0, dur, gap) {
  const out = [];
  let t = t0;
  for (let i = 0; i < count; i++) {
    out.push([`${prefix}${i}`, t, t + dur]);
    t += dur + gap;
  }
  return out;
}

// Tests --------------------------------------------------------------------

test('HARD gap splits into two chunks', () => {
  const chunks = buildPauseChunks(
    [seg('the cat sat down', [['the', 0, 0.3], ['cat', 0.3, 0.6], ['sat', 1.1, 1.4], ['down', 1.4, 1.7]])],
    [{ start: 0 }]
  );
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].words.map((w) => w.word), ['the', 'cat']);
  assert.deepEqual(chunks[1].words.map((w) => w.word), ['sat', 'down']);
});

test('all-glued run is never split even past maxChunk', () => {
  // 13 words, all glued (gap 0) → exceeds 12-word cap but has no SOFT gap.
  const chunks = buildPauseChunks([seg('x', run('w', 13, 0, 0.2, 0))], [{ start: 0 }]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].words.length, 13);
});

test('tiny chunks merge into neighbours', () => {
  // three HARD-separated single words → all merge to one chunk
  const chunks = buildPauseChunks(
    [seg('a b c', [['a', 0, 0.2], ['b', 0.7, 0.9], ['c', 1.4, 1.7]])],
    [{ start: 0 }]
  );
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].words.length, 3);
});

test('oversized chunk splits at the largest SOFT gap', () => {
  // 14 glued words (gap 0.05) with one 0.25s SOFT gap after index 6.
  const words = run('w', 14, 0, 0.2, 0.05);
  // widen the gap between word6 and word7: shift word7.. later by 0.2
  for (let i = 7; i < words.length; i++) {
    words[i][1] += 0.2;
    words[i][2] += 0.2;
  }
  const chunks = buildPauseChunks([seg('x', words)], [{ start: 0 }]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].words.length, 7);
  assert.equal(chunks[1].words.length, 7);
});

test('deterministic — identical input yields identical output', () => {
  const input = [seg('the cat sat down on a warm mat today', run('w', 9, 0, 0.25, 0.4))];
  const a = buildPauseChunks(input, [{ start: 0 }]);
  const b = buildPauseChunks(input, [{ start: 0 }]);
  assert.deepEqual(a, b);
});

test('hallucinated segments are dropped', () => {
  const chunks = buildPauseChunks(
    [
      seg('real words here', [['real', 0, 0.3], ['words', 0.3, 0.6]]),
      seg('[music]', [['music', 5, 5.3], ['noise', 5.3, 5.6]], { no_speech_prob: 0.9, avg_logprob: -2.0 }),
    ],
    [{ start: 0 }]
  );
  assert.equal(totalWords(chunks), 2);
});

test('sourceSegmentIndex maps to the stored segment by time', () => {
  const chunks = buildPauseChunks(
    [seg('a b', [['a', 1, 1.3], ['b', 6, 6.3]])],
    [{ start: 0 }, { start: 5 }]
  );
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].sourceSegmentIndex, 0);
  assert.equal(chunks[1].sourceSegmentIndex, 1);
});

test('glueSpans coalesce glued words and break at SOFT gaps', () => {
  // one chunk: w0,w1 glued; SOFT 0.2s gap; w2
  const chunks = buildPauseChunks(
    [seg('x', [['w0', 0, 0.2], ['w1', 0.2, 0.4], ['w2', 0.6, 0.8]])],
    [{ start: 0 }]
  );
  assert.equal(chunks.length, 1);
  assert.deepEqual(
    chunks[0].glueSpans.map((s) => [s.wordStart, s.wordEnd]),
    [[0, 1], [2, 2]]
  );
});

test('chunk text preserves punctuation from the whisper segment text', () => {
  const chunks = buildPauseChunks(
    [seg('The cat, sat down.', [['The', 0, 0.3], ['cat', 0.3, 0.6], ['sat', 0.6, 0.9], ['down', 0.9, 1.2]])],
    [{ start: 0 }]
  );
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, 'The cat, sat down.');
});

test('empty / no-word input returns []', () => {
  assert.deepEqual(buildPauseChunks([], []), []);
  assert.deepEqual(buildPauseChunks([seg('x', [])], []), []);
  assert.deepEqual(buildPauseChunks(null, null), []);
});

test('DEFAULT_CHUNK_PARAMS is not mutated by an override', () => {
  const before = JSON.stringify(DEFAULT_CHUNK_PARAMS);
  buildPauseChunks([seg('x', run('w', 3, 0, 0.2, 0))], [{ start: 0 }], { boundaryThreshold: 1.0, minChunk: { words: 1 } });
  assert.equal(JSON.stringify(DEFAULT_CHUNK_PARAMS), before);
});
