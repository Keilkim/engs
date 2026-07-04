import type { CaptionsData, CaptionSegment } from '../types';

export interface WordTimeline {
  /** Flat, ascending list of every word's timing across the whole video. */
  words: Array<{ word: string; start: number; end: number }>;
  /** The Whisper segments (carry punctuation/casing in `text`) used for pretty
   *  chunk-row text and confidence-based hallucination filtering. */
  whisperSegments: CaptionSegment[];
}

/**
 * Single source of truth for "does this source have word-level timing, and where
 * is it?". Word timings come from Whisper only:
 *  - sources UPGRADED post-hoc carry an additive `captions_data.whisper` block,
 *  - sources transcribed by Whisper at add-time have `words[]` on their base
 *    `segments` (source === 'whisper').
 * Returns null for YouTube-caption / manual sources with no word timing.
 */
export function getWordTimeline(captionsData: CaptionsData | null | undefined): WordTimeline | null {
  if (!captionsData) return null;

  const whisperSegments: CaptionSegment[] | null =
    captionsData.whisper?.segments ??
    (captionsData.source === 'whisper' ? captionsData.segments : null);

  if (!whisperSegments || whisperSegments.length === 0) return null;

  const words = whisperSegments.flatMap((s) => s.words || []);
  if (words.length === 0) return null;

  return { words, whisperSegments };
}

/** Convenience predicate for gating UI (chunk toggle, virtual-slow buttons). */
export function hasWordTimeline(captionsData: CaptionsData | null | undefined): boolean {
  return getWordTimeline(captionsData) !== null;
}
