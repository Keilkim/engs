import { useState, useEffect } from 'react';
import { getSourceCaptions } from '../services/source';

/**
 * Resolve the precise sentence window [start, end] for a word that was saved from
 * a YouTube source. We only store the word's start `timestamp` on the annotation,
 * so to play the *sentence* (a real "scene", not a clipped word) we look up the
 * containing segment in the source's captions.
 *
 * Until (or unless) that lookup resolves, it falls back to the stored word
 * timestamp with no end, so playback still works — it just won't auto-stop at the
 * sentence boundary.
 */
export default function useSceneBounds({ sourceId, segmentIndex, fallbackStart }) {
  // Captions-derived bounds; null until resolved (or if it can't resolve).
  const [resolved, setResolved] = useState(null);

  useEffect(() => {
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
  }, [sourceId, segmentIndex]);

  return resolved ?? { start: fallbackStart, end: null };
}
