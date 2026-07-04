// RMS-based silence analysis over a decoded mono buffer. Whisper's raw word gaps
// are too noisy to decide 60–80ms "glue" reliably (verified), so the engine
// refines cut/glue points against the ACTUAL signal: measure per-hop RMS, derive
// a local noise floor, and snap boundaries to real silence runs. Also used to
// reject hallucinated "words" that are actually silence/music.
//
// All functions are pure and operate on a Float32Array of PCM samples; times are
// in seconds relative to the analyzed buffer's start.

// Per-hop RMS envelope (default 10 ms hops).
export function computeRmsHops(samples, sampleRate, hopMs = 10) {
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const n = Math.max(1, Math.ceil(samples.length / hop));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * hop;
    const e = Math.min(samples.length, s + hop);
    let sum = 0;
    for (let j = s; j < e; j++) sum += samples[j] * samples[j];
    out[i] = Math.sqrt(sum / Math.max(1, e - s));
  }
  return out;
}

function percentileOf(hops, p) {
  if (!hops.length) return 0;
  const sorted = Float32Array.from(hops).sort();
  const idx = Math.min(hops.length - 1, Math.max(0, Math.floor(p * hops.length)));
  return sorted[idx];
}

// Low-percentile hop RMS — the quiet baseline. (Kept for diagnostics.)
export function noiseFloor(hops, percentile = 0.2) {
  return percentileOf(hops, percentile);
}

// "Silent" threshold, RELATIVE to the typical speech level (a high percentile),
// not the floor: a hop is silent when it sits well below speech (≈ -18 dB of the
// 75th-percentile RMS), but never below an absolute dBFS gate. Keying off speech
// level (rather than floor×factor) is what makes an all-loud buffer read as
// non-silent instead of collapsing to "all silent".
export function silenceThreshold(speechLevel, { relativeFactor = 0.12, absoluteDbfs = -40 } = {}) {
  const absLinear = Math.pow(10, absoluteDbfs / 20);
  return Math.max(absLinear, speechLevel * relativeFactor);
}

/**
 * Precompute a reusable analysis for a whole decoded window (called once per
 * window, not per boundary). Returns hop envelope + silence mask + metadata.
 */
export function analyzeWindow(samples, sampleRate, opts = {}) {
  const hopMs = opts.hopMs ?? 10;
  const hops = computeRmsHops(samples, sampleRate, hopMs);
  const speechLevel = percentileOf(hops, opts.speechPercentile ?? 0.75);
  const threshold = silenceThreshold(speechLevel, opts);
  const mask = new Uint8Array(hops.length);
  for (let i = 0; i < hops.length; i++) mask[i] = hops[i] < threshold ? 1 : 0;
  return {
    hops,
    mask,
    hopSec: hopMs / 1000,
    speechLevel,
    threshold,
    sampleRate,
    durationSec: samples.length / sampleRate,
  };
}

const clampIdx = (i, len) => Math.min(len, Math.max(0, i));

// Longest contiguous silent run within [t0,t1] (seconds). Returns {start,end} or
// null. Used to find the TRUE gap length and snap cut points to its edges.
export function longestSilenceRun(analysis, t0, t1) {
  const { mask, hopSec } = analysis;
  const i0 = clampIdx(Math.floor(t0 / hopSec), mask.length);
  const i1 = clampIdx(Math.ceil(t1 / hopSec), mask.length);
  let bestS = -1;
  let bestLen = 0;
  let curS = -1;
  for (let i = i0; i < i1; i++) {
    if (mask[i]) {
      if (curS < 0) curS = i;
    } else if (curS >= 0) {
      if (i - curS > bestLen) { bestLen = i - curS; bestS = curS; }
      curS = -1;
    }
  }
  if (curS >= 0 && i1 - curS > bestLen) { bestLen = i1 - curS; bestS = curS; }
  if (bestS < 0) return null;
  return { start: bestS * hopSec, end: (bestS + bestLen) * hopSec };
}

// Fraction of [t0,t1] that is silent (0..1). ~1 → the region is silence/music
// (a hallucinated word), ~0 → real speech.
export function silentFraction(analysis, t0, t1) {
  const { mask, hopSec } = analysis;
  const i0 = clampIdx(Math.floor(t0 / hopSec), mask.length);
  const i1 = clampIdx(Math.ceil(t1 / hopSec), mask.length);
  if (i1 <= i0) return 1;
  let silent = 0;
  for (let i = i0; i < i1; i++) silent += mask[i];
  return silent / (i1 - i0);
}

/**
 * Measured gap between two words: the longest silence run in the search window
 * around [prevEnd, nextStart]. Returns { gapSec, cutStart, cutEnd } where
 * cutStart/cutEnd are silence-run edges to snap the span boundary to, or null if
 * no silence found (treat as glued).
 */
export function measuredGap(analysis, prevEnd, nextStart, searchMs = 150) {
  const pad = searchMs / 1000;
  const run = longestSilenceRun(analysis, prevEnd - pad, nextStart + pad);
  if (!run) return null;
  return { gapSec: run.end - run.start, cutStart: run.start, cutEnd: run.end };
}
