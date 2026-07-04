// Pure, deterministic pause-based chunker. Shared by the caption-row display and
// (later) the virtual-slow audio engine, so the SAME memoized output drives both
// — display rows and playback spans can never disagree.
//
// Input is Whisper word timings (the only source of per-word timing). Boundaries
// are decided by inter-word SILENCE, not punctuation:
//   gap < glueThreshold        → GLUED  (never cut — preserves liaison "used to")
//   glueThreshold ≤ gap < HARD  → SOFT   (chunk-internal; a legal force-split point)
//   gap ≥ boundaryThreshold     → HARD   (chunk boundary)
//
// NOTE: thresholds here operate on RAW Whisper gaps (no audio available at display
// time), so they are deliberately looser than the audio engine's RMS-refined ones
// (see whisper-accuracy findings). The engine re-refines cut/glue points on the
// decoded buffer; rows stay shared, only intra-row audio cuts are refined.

export const DEFAULT_CHUNK_PARAMS = {
  boundaryThreshold: 0.35, // s — gap ≥ this ends a chunk
  glueThreshold: 0.12,     // s — gap < this is glued (never split)
  minChunk: { sec: 0.6, words: 2 },
  maxChunk: { sec: 6.0, words: 12 },
  // A too-small chunk is only merged into a neighbour when the intervening
  // silence is below this. A lone word bracketed by long pauses (e.g. "Yes.")
  // stays its own chunk rather than being fused into a silence-heavy row.
  maxMergeGap: 1.0, // s
  // Segment-level Whisper hallucination guard: drop words from segments Whisper
  // itself flagged as probably-not-speech (music/applause/noise).
  hallucination: { noSpeechProb: 0.6, avgLogprob: -1.0 },
};

const TIE_EPS = 0.02; // s — gaps within this are considered equal for tie-breaking

const normalizeToken = (s) => (s || '').toLowerCase().replace(/[^a-z0-9']/g, '');

function isHallucinated(seg, h) {
  return (
    h &&
    typeof seg.no_speech_prob === 'number' &&
    typeof seg.avg_logprob === 'number' &&
    seg.no_speech_prob > h.noSpeechProb &&
    seg.avg_logprob < h.avgLogprob
  );
}

// Flatten Whisper segments → ascending word list, each tagged with its owning
// segment index (for pretty text slicing). Sanitizes bad timings; drops
// hallucinated segments' words.
function flattenWords(whisperSegments, hallucination) {
  const out = [];
  (whisperSegments || []).forEach((seg, si) => {
    if (isHallucinated(seg, hallucination)) return;
    (seg.words || []).forEach((w) => {
      const start = Number(w.start);
      const end = Number(w.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      out.push({ word: w.word ?? '', start, end: Math.max(end, start + 0.01), segIndex: si });
    });
  });
  out.sort((a, b) => a.start - b.start);
  return out;
}

const gapBetween = (a, b) => Math.max(0, b.start - a.end);
const rangeDur = (r, words) => words[r[1]].end - words[r[0]].start;
const rangeLen = (r) => r[1] - r[0] + 1;

function isSmall(r, words, p) {
  return rangeDur(r, words) < p.minChunk.sec || rangeLen(r) < p.minChunk.words;
}
function isBig(r, words, p) {
  return rangeDur(r, words) > p.maxChunk.sec || rangeLen(r) > p.maxChunk.words;
}

// Merge chunks that are too small into a neighbour across the SMALLER original
// gap (tie → merge left). Loops to a fixpoint; bounded against pathological input.
function minMerge(ranges, words, gapAfter, p) {
  const out = ranges.slice();
  let guard = 0;
  let changed = true;
  while (changed && guard++ < 100000) {
    changed = false;
    if (out.length <= 1) break;
    for (let i = 0; i < out.length; i++) {
      if (!isSmall(out[i], words, p)) continue;
      const leftGap = i > 0 ? gapAfter(out[i - 1][1]) : Infinity;
      const rightGap = i < out.length - 1 ? gapAfter(out[i][1]) : Infinity;
      if (leftGap === Infinity && rightGap === Infinity) break; // only one chunk left
      // Don't fuse across a long silence — an isolated word stays isolated.
      if (Math.min(leftGap, rightGap) > p.maxMergeGap) continue;
      const mergeLeft = rightGap === Infinity ? true : leftGap === Infinity ? false : leftGap <= rightGap;
      if (mergeLeft) {
        out[i - 1] = [out[i - 1][0], out[i][1]];
        out.splice(i, 1);
      } else {
        out[i] = [out[i][0], out[i + 1][1]];
        out.splice(i + 1, 1);
      }
      changed = true;
      break;
    }
  }
  return out;
}

// Recursively split chunks that are too big at the largest SOFT gap. Ties (within
// TIE_EPS) break toward the chunk midpoint, then toward a punctuation boundary.
// An all-glued run (no SOFT gap) is never split — cutting a liaison is forbidden.
function maxSplit(r, words, gapAfter, p, whisperSegments) {
  if (!isBig(r, words, p)) return [r];
  const mid = (words[r[0]].start + words[r[1]].end) / 2;
  let bestI = -1;
  let bestGap = -1;
  for (let i = r[0]; i < r[1]; i++) {
    const g = gapAfter(i);
    if (g < p.glueThreshold) continue; // glued — never cut
    if (g > bestGap + TIE_EPS) {
      bestI = i;
      bestGap = g;
    } else if (Math.abs(g - bestGap) <= TIE_EPS && bestI >= 0) {
      const better =
        Math.abs(words[i].end - mid) < Math.abs(words[bestI].end - mid) ||
        (endsSentence(words[i], whisperSegments) && !endsSentence(words[bestI], whisperSegments));
      if (better) bestI = i;
    }
  }
  if (bestI === -1) return [r]; // all glued — keep whole
  return [
    ...maxSplit([r[0], bestI], words, gapAfter, p, whisperSegments),
    ...maxSplit([bestI + 1, r[1]], words, gapAfter, p, whisperSegments),
  ];
}

// Punctuation tiebreaker only: does this word carry sentence/clause-ending
// punctuation in its Whisper segment text? (Never the primary split criterion.)
function endsSentence(w, whisperSegments) {
  const seg = whisperSegments?.[w.segIndex];
  if (!seg?.text) return false;
  const wn = normalizeToken(w.word);
  const tokens = seg.text.split(/\s+/);
  for (const t of tokens) {
    if (normalizeToken(t) === wn) return /[.!?,;:]$/.test(t);
  }
  return false;
}

function findStoredSegmentIndex(storedSegments, t) {
  if (!storedSegments || storedSegments.length === 0) return 0;
  let lo = 0;
  let hi = storedSegments.length - 1;
  let cand = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (storedSegments[m].start <= t) {
      cand = m;
      lo = m + 1;
    } else {
      hi = m - 1;
    }
  }
  return cand;
}

// Reconstruct nicely-punctuated chunk text by slicing the owning Whisper
// segment's `text` (words[] strip punctuation/casing). Falls back to a raw word
// join for any stretch that can't be aligned.
function sliceSegmentText(seg, gWords) {
  if (!seg?.text) return null;
  const text = seg.text;
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) tokens.push({ start: m.index, end: m.index + m[0].length, norm: normalizeToken(m[0]) });
  if (tokens.length === 0) return null;

  let ti = 0;
  let firstPos = -1;
  let lastPos = -1;
  for (const w of gWords) {
    const wn = normalizeToken(w.word);
    let matched = -1;
    for (let scan = ti; scan < tokens.length && scan <= ti + 2; scan++) {
      if (tokens[scan].norm === wn) {
        matched = scan;
        break;
      }
    }
    if (matched === -1 && ti < tokens.length) matched = ti; // positional fallback
    if (matched >= 0) {
      if (firstPos === -1) firstPos = tokens[matched].start;
      lastPos = tokens[matched].end;
      ti = matched + 1;
    }
  }
  if (firstPos === -1) return null;
  return text.slice(firstPos, lastPos).trim();
}

function buildChunkText(words, r, whisperSegments) {
  const groups = [];
  for (let i = r[0]; i <= r[1]; i++) {
    const w = words[i];
    const last = groups[groups.length - 1];
    if (last && last.segIndex === w.segIndex) last.words.push(w);
    else groups.push({ segIndex: w.segIndex, words: [w] });
  }
  const parts = groups.map((g) => {
    const seg = whisperSegments?.[g.segIndex];
    return sliceSegmentText(seg, g.words) || g.words.map((w) => (w.word || '').trim()).join(' ');
  });
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function buildChunk(r, index, words, gapAfter, p, whisperSegments, storedSegments) {
  const chunkWords = [];
  for (let i = r[0]; i <= r[1]; i++) {
    chunkWords.push({ word: words[i].word, start: words[i].start, end: words[i].end });
  }
  const start = words[r[0]].start;
  const end = words[r[1]].end;

  // Maximal runs of glued words → continuous playback spans (indices are
  // chunk-local, into chunkWords).
  const glueSpans = [];
  let spanStart = 0;
  for (let k = 0; k < chunkWords.length; k++) {
    const globalIdx = r[0] + k;
    const isLast = k === chunkWords.length - 1;
    const g = isLast ? Infinity : gapAfter(globalIdx);
    if (isLast || g >= p.glueThreshold) {
      glueSpans.push({
        wordStart: spanStart,
        wordEnd: k,
        start: chunkWords[spanStart].start,
        end: chunkWords[k].end,
      });
      spanStart = k + 1;
    }
  }

  return {
    id: `chunk-${index}`,
    index,
    start,
    end,
    text: buildChunkText(words, r, whisperSegments),
    words: chunkWords,
    glueSpans,
    sourceSegmentIndex: findStoredSegmentIndex(storedSegments, start),
  };
}

/**
 * Build pause-based chunk rows from Whisper word timings.
 * @param {Array} whisperSegments  Whisper segments ({text, words:[{word,start,end}], no_speech_prob?, avg_logprob?}).
 * @param {Array} storedSegments   ORIGINAL captions_data.segments (for annotation index translation).
 * @param {object} [params]        Override DEFAULT_CHUNK_PARAMS.
 * @returns {Array} chunks: {id,index,start,end,text,words,glueSpans,sourceSegmentIndex}
 */
export function buildPauseChunks(whisperSegments, storedSegments, params = DEFAULT_CHUNK_PARAMS) {
  const p = {
    ...DEFAULT_CHUNK_PARAMS,
    ...params,
    minChunk: { ...DEFAULT_CHUNK_PARAMS.minChunk, ...(params.minChunk || {}) },
    maxChunk: { ...DEFAULT_CHUNK_PARAMS.maxChunk, ...(params.maxChunk || {}) },
    hallucination: params.hallucination === null ? null : { ...DEFAULT_CHUNK_PARAMS.hallucination, ...(params.hallucination || {}) },
  };

  const words = flattenWords(whisperSegments, p.hallucination);
  if (words.length === 0) return [];

  const gapAfter = (i) => (i < words.length - 1 ? gapBetween(words[i], words[i + 1]) : Infinity);

  // 1. HARD split.
  let ranges = [];
  let s = 0;
  for (let i = 0; i < words.length; i++) {
    if (i === words.length - 1 || gapAfter(i) >= p.boundaryThreshold) {
      ranges.push([s, i]);
      s = i + 1;
    }
  }

  // 2. Min-merge to fixpoint.
  ranges = minMerge(ranges, words, gapAfter, p);

  // 3. Max-split recursively.
  ranges = ranges.flatMap((r) => maxSplit(r, words, gapAfter, p, whisperSegments));

  // 4. Materialize.
  return ranges.map((r, index) => buildChunk(r, index, words, gapAfter, p, whisperSegments, storedSegments));
}
