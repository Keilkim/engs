import { useMemo, useCallback } from 'react';

export function useCaptionSync(segments, currentTime) {
  const currentSegmentIndex = useMemo(() => {
    if (!segments || segments.length === 0) return -1;

    const n = segments.length;

    // Before the first caption starts → nothing active.
    if (currentTime < segments[0].start) return -1;

    // Binary search for the right-most segment with start <= currentTime.
    // For overlapping captions this deliberately prefers the LATER segment so
    // the highlight follows the newest spoken line instead of lagging one line
    // behind. Gaps between segments keep the previous line active (as before).
    // O(log n) keeps this cheap even for very long (800+ line) transcripts.
    let lo = 0;
    let hi = n - 1;
    let cand = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].start <= currentTime) {
        cand = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return cand;
  }, [segments, currentTime]);

  const isActiveIndex = useCallback((index) => {
    return index === currentSegmentIndex;
  }, [currentSegmentIndex]);

  return { currentSegmentIndex, isActiveIndex };
}

export default useCaptionSync;
