import { useMemo, useCallback } from 'react';

export function useCaptionSync(segments, currentTime) {
  const currentSegmentIndex = useMemo(() => {
    if (!segments || segments.length === 0) return -1;

    // Exact match
    for (let i = 0; i < segments.length; i++) {
      if (currentTime >= segments[i].start && currentTime < segments[i].end) {
        return i;
      }
    }

    // Gap handling: if between two segments, keep the previous one active
    for (let i = 0; i < segments.length; i++) {
      if (currentTime < segments[i].start) {
        if (i > 0 && currentTime >= segments[i - 1].end) {
          return i - 1;
        }
        return -1;
      }
    }

    // After last segment
    if (currentTime >= segments[segments.length - 1].end) {
      return segments.length - 1;
    }

    return -1;
  }, [segments, currentTime]);

  const isActiveIndex = useCallback((index) => {
    return index === currentSegmentIndex;
  }, [currentSegmentIndex]);

  return { currentSegmentIndex, isActiveIndex };
}

export default useCaptionSync;
