// Pure timeline planner for gap-expanded ("또박또박 느리게") playback.
//
// Idea: play every glued word-span at NATIVE speed (1.0x articulation, so the
// sound is never time-stretched/muddied), and insert SILENCE between spans so the
// wall-clock duration of any content region equals contentDuration / rate. The
// muted YouTube video plays continuously at `rate`, so the two stay aligned — and
// because silence is budgeted PER CHUNK, they re-align exactly at every chunk
// boundary (drift is bounded to within a single chunk).
//
// Input `chunks` come from pauseChunker (buildPauseChunks): each has
// {start,end,words,glueSpans:[{start,end,...}]}. glueSpans are the continuous
// audio slices; the gaps between them (and between chunks) carry the budget.
//
// Output is a flat, ascending list of timeline entries on a wall clock that
// starts at 0 (the engine adds an absolute AudioContext anchor at play time):
//   { type:'speech',  contentStart, contentEnd, wallStart, wallEnd }
//   { type:'ambient', contentStart, contentEnd, wallStart, wallEnd }  // long non-speech region: play once at 1x then pad
//   { type:'gap',     contentAt,                wallStart, wallEnd }   // pure silence; content time holds at contentAt

export const DEFAULT_PLAN_OPTS = {
  ambientThresholdSec: 1.5, // inter-chunk content gap ≥ this → play original audio once (music/applause), else pure silence
  maxSpanSec: 3.0,          // a glued span longer than this is force-cut so the muted video can't visibly lag
};

const spanDur = (s) => Math.max(0, s.end - s.start);

// Split an over-long span at its largest internal word gap so no single native
// slice runs longer than maxSpanSec (keeps video drift small). Returns sub-spans
// [{start,end}]. `words` are the chunk's words (chunk-local), glueSpan indices
// wordStart..wordEnd point into them.
function capSpan(span, words, maxSpanSec) {
  if (spanDur(span) <= maxSpanSec || span.wordEnd <= span.wordStart) return [{ start: span.start, end: span.end }];
  // find largest gap between consecutive words in [wordStart, wordEnd]
  let cut = -1;
  let best = -1;
  for (let i = span.wordStart; i < span.wordEnd; i++) {
    const g = words[i + 1].start - words[i].end;
    if (g > best) { best = g; cut = i; }
  }
  if (cut < 0) return [{ start: span.start, end: span.end }];
  const left = { start: span.start, end: words[cut].end, wordStart: span.wordStart, wordEnd: cut };
  const right = { start: words[cut + 1].start, end: span.end, wordStart: cut + 1, wordEnd: span.wordEnd };
  return [...capSpan(left, words, maxSpanSec), ...capSpan(right, words, maxSpanSec)];
}

/**
 * Build the wall-clock timeline for a set of chunks at a sub-1.0 rate.
 * @returns {{ entries: Array, totalWall: number, contentStart: number, contentEnd: number, rate: number }}
 */
export function planTimeline(chunks, rate, opts = DEFAULT_PLAN_OPTS) {
  const o = { ...DEFAULT_PLAN_OPTS, ...opts };
  const entries = [];
  if (!chunks || chunks.length === 0 || !(rate > 0) || rate >= 1) {
    return { entries, totalWall: 0, contentStart: 0, contentEnd: 0, rate };
  }

  let wall = 0;
  const push = (e) => { entries.push(e); wall = e.wallEnd; };

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const words = chunk.words || [];
    // Native (1.0x) spans, capped so none is too long for the video to track.
    const rawSpans = (chunk.glueSpans && chunk.glueSpans.length)
      ? chunk.glueSpans
      : [{ start: chunk.start, end: chunk.end, wordStart: 0, wordEnd: Math.max(0, words.length - 1) }];
    const spans = rawSpans.flatMap((s) => capSpan(s, words, o.maxSpanSec));

    const chunkContent = chunk.end - chunk.start;
    const speechTime = spans.reduce((n, s) => n + spanDur(s), 0);
    const wallBudget = chunkContent / rate;
    const silenceBudget = Math.max(0, wallBudget - speechTime);

    // Internal gaps (content) between spans → distribute the budget proportionally.
    const softGaps = [];
    let totalSoft = 0;
    for (let k = 1; k < spans.length; k++) {
      const g = Math.max(0, spans[k].start - spans[k - 1].end);
      softGaps.push(g);
      totalSoft += g;
    }

    for (let k = 0; k < spans.length; k++) {
      const s = spans[k];
      push({ type: 'speech', contentStart: s.start, contentEnd: s.end, wallStart: wall, wallEnd: wall + spanDur(s) });
      if (k < spans.length - 1) {
        const share = totalSoft > 0
          ? silenceBudget * (softGaps[k] / totalSoft)
          : silenceBudget / (spans.length - 1);
        push({ type: 'gap', contentAt: s.end, wallStart: wall, wallEnd: wall + share });
      }
    }
    // Single-span chunk: no internal gap to hold the budget, so it trails the
    // span. (When spans.length > 1 the per-span loop already distributed the
    // full budget — including the totalSoft===0 force-split case via its equal
    // fallback share — so we must NOT emit it again here.)
    if (spans.length === 1 && silenceBudget > 0) {
      const last = spans[spans.length - 1];
      push({ type: 'gap', contentAt: last.end, wallStart: wall, wallEnd: wall + silenceBudget });
    }

    // Inter-chunk HARD gap.
    const next = chunks[ci + 1];
    if (next) {
      const hard = Math.max(0, next.start - chunk.end);
      const wallHard = hard / rate;
      if (hard >= o.ambientThresholdSec) {
        // Long non-speech region (music/applause): play it once at 1.0x, then pad.
        push({ type: 'ambient', contentStart: chunk.end, contentEnd: next.start, wallStart: wall, wallEnd: wall + hard });
        const pad = wallHard - hard;
        if (pad > 0) push({ type: 'gap', contentAt: next.start, wallStart: wall, wallEnd: wall + pad });
      } else if (wallHard > 0) {
        push({ type: 'gap', contentAt: chunk.end, wallStart: wall, wallEnd: wall + wallHard });
      }
    }
  }

  return {
    entries,
    totalWall: wall,
    contentStart: chunks[0].start,
    contentEnd: chunks[chunks.length - 1].end,
    rate,
  };
}

// Map engine wall time → content (video) time. Within speech/ambient, content
// advances at 1.0x; within a gap it HOLDS at the gap's content time (karaoke
// freezes on the just-finished word — the intended UX).
export function contentTimeAtWall(plan, wall) {
  const { entries } = plan;
  if (!entries.length) return plan.contentStart;
  if (wall <= entries[0].wallStart) return entries[0].contentStart ?? entries[0].contentAt ?? plan.contentStart;
  // binary search for the entry containing `wall`
  let lo = 0;
  let hi = entries.length - 1;
  let idx = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].wallStart <= wall) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const e = entries[idx];
  if (e.type === 'gap') return e.contentAt;
  const frac = Math.min(e.wallEnd - e.wallStart, Math.max(0, wall - e.wallStart));
  return e.contentStart + frac; // 1.0x within speech/ambient
}

// Map engine wall time → the muted VIDEO's ideal content time. Unlike the caption
// clock, this advances SMOOTHLY (the video plays continuously at `rate` and must
// keep moving through gaps), so drift control compares against this, not the
// gap-holding caption clock. By construction totalWall * rate == contentEnd -
// contentStart, so the two clocks coincide exactly at every chunk boundary.
export function videoContentAtWall(plan, wall) {
  return plan.contentStart + Math.max(0, wall) * plan.rate;
}

// Map a content time → the wall time where that content first plays. Used by
// seek: find the first speech/ambient entry covering the target (or the next one
// after a gap).
export function wallAtContent(plan, content) {
  const { entries } = plan;
  for (const e of entries) {
    if (e.type === 'gap') continue;
    if (content <= e.contentStart) return e.wallStart;
    if (content < e.contentEnd) return e.wallStart + (content - e.contentStart);
  }
  return plan.totalWall;
}

// Snap a seek target to the start of the span that should play. If the target is
// inside a span, restart that span (re-articulate the whole word/phrase); if it
// falls in a gap/before content, jump to the next span start.
export function snapSeekContent(plan, content) {
  const { entries } = plan;
  let lastEnd = plan.contentStart;
  for (const e of entries) {
    if (e.type === 'gap') continue;
    if (content < e.contentStart) return e.contentStart; // in a gap → next span
    if (content < e.contentEnd) return e.contentStart;   // inside → restart span
    lastEnd = e.contentEnd;
  }
  return lastEnd;
}
