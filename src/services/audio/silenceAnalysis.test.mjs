import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeWindow,
  longestSilenceRun,
  silentFraction,
  measuredGap,
  noiseFloor,
} from './silenceAnalysis.js';

const SR = 16000;

// Build a mono buffer: `segments` = [{from,to,amp}] seconds (amp 0 = silence).
function buildBuffer(durationSec, segments) {
  const buf = new Float32Array(Math.round(durationSec * SR));
  for (const { from, to, amp } of segments) {
    const i0 = Math.round(from * SR);
    const i1 = Math.round(to * SR);
    for (let i = i0; i < i1; i++) {
      // deterministic pseudo-tone (no Math.random): alternating sign scaled by amp
      buf[i] = amp * ((i % 2 === 0) ? 1 : -1);
    }
  }
  return buf;
}

test('longestSilenceRun finds the silent gap between two loud regions', () => {
  // loud [0,1], silence [1,1.5], loud [1.5,2.5]
  const buf = buildBuffer(2.5, [
    { from: 0, to: 1, amp: 0.5 },
    { from: 1.5, to: 2.5, amp: 0.5 },
  ]);
  const analysis = analyzeWindow(buf, SR);
  const run = longestSilenceRun(analysis, 0, 2.5);
  assert.ok(run, 'a silence run exists');
  assert.ok(Math.abs(run.start - 1.0) < 0.05, `start ~1.0 (got ${run.start})`);
  assert.ok(Math.abs(run.end - 1.5) < 0.05, `end ~1.5 (got ${run.end})`);
});

test('silentFraction ~1 for a silent region, ~0 for a loud region', () => {
  const buf = buildBuffer(2, [{ from: 0, to: 1, amp: 0.5 }]); // loud [0,1], silent [1,2]
  const analysis = analyzeWindow(buf, SR);
  assert.ok(silentFraction(analysis, 1.2, 1.8) > 0.9, 'silent region reads silent');
  assert.ok(silentFraction(analysis, 0.2, 0.8) < 0.1, 'loud region reads non-silent');
});

test('measuredGap recovers the true gap length regardless of rough word ends', () => {
  // word A loud [0,0.8], silence [0.8,1.3], word B loud [1.3,2]
  const buf = buildBuffer(2, [
    { from: 0, to: 0.8, amp: 0.4 },
    { from: 1.3, to: 2, amp: 0.4 },
  ]);
  const analysis = analyzeWindow(buf, SR);
  // Whisper's rough estimate says A ends 0.9, B starts 1.2 (both wrong); measured
  // gap should still recover ~0.5s.
  const g = measuredGap(analysis, 0.9, 1.2, 200);
  assert.ok(g, 'gap measured');
  assert.ok(Math.abs(g.gapSec - 0.5) < 0.08, `gap ~0.5 (got ${g.gapSec})`);
});

test('measuredGap returns null when there is no silence (glued)', () => {
  const buf = buildBuffer(1, [{ from: 0, to: 1, amp: 0.4 }]); // all loud
  const analysis = analyzeWindow(buf, SR);
  assert.equal(measuredGap(analysis, 0.4, 0.5, 100), null);
});

test('noiseFloor is low for a mostly-silent buffer', () => {
  const buf = buildBuffer(2, [{ from: 0, to: 0.2, amp: 0.5 }]); // mostly silent
  const analysis = analyzeWindow(buf, SR);
  assert.ok(noiseFloor(analysis.hops, 0.2) < 0.01);
});
