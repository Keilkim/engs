import { useState, useEffect } from 'react';
import { getSourceCaptions } from '../services/source';

/**
 * Resolve the precise scene window [start, end] for a word saved from a YouTube
 * source.
 *
 * Preferred path: annotations saved after the pause-chunk feature landed persist
 * authoritative `sceneStart`/`sceneEnd` (the exact bounds of the row the user
 * studied). When present we use them directly — no captions fetch, and no risk of
 * a stale/derived index resolving to the wrong stored segment.
 *
 * Legacy path (older annotations, no scene bounds): look up the containing STORED
 * segment by `segmentIndex` to recover the sentence end. The stored `segments`
 * array is never mutated by the upgrade flow, so these indices stay valid forever.
 *
 * Either way, until a value resolves it falls back to `fallbackStart` (the word
 * timestamp) with no end, so playback still works — it just won't auto-stop.
 */
export default function useSceneBounds({ sourceId, segmentIndex, fallbackStart, sceneStart, sceneEnd }) {
  const hasExplicitBounds = typeof sceneStart === 'number';

  // Seed with explicit bounds when available so there is no fetch and no flash.
  const [resolved, setResolved] = useState(
    hasExplicitBounds
      ? { start: sceneStart, end: typeof sceneEnd === 'number' ? sceneEnd : null }
      : null
  );

  useEffect(() => {
    if (hasExplicitBounds) return; // authoritative bounds — skip the captions fetch
    if (sourceId == null || segmentIndex == null) return;

    let cancelled = false;
    (async () => {
      try {
        const captions = await getSourceCaptions(sourceId);
        if (cancelled) return;
        const seg = captions?.segments?.[segmentIndex];
        if (seg && typeof seg.start === 'number') {
          setResolved({
            start: seg.start,
            end: typeof seg.end === 'number' ? seg.end : null,
          });
        }
      } catch {
        // Captions fetch failed — the word-timestamp fallback below still plays.
      }
    })();

    return () => { cancelled = true; };
  }, [sourceId, segmentIndex, hasExplicitBounds]);

  return resolved ?? { start: fallbackStart, end: null };
}
