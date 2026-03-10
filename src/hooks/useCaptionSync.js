import { useMemo, useCallback } from 'react';

export function useCaptionSync(segments, currentTime) {
  const currentSegmentIndex = useMemo(() => {
    if (!segments || segments.length === 0) return -1;

    for (let i = 0; i < segments.length; i++) {
      if (currentTime >= segments[i].start && currentTime < segments[i].end) {
        return i;
      }
    }

    for (let i = 0; i < segments.length; i++) {
      if (currentTime < segments[i].start) {
        return i > 0 ? i - 1 : -1;
      }
    }

    return segments.length - 1;
  }, [segments, currentTime]);

  const isActiveIndex = useCallback((index) => {
    return index === currentSegmentIndex;
  }, [currentSegmentIndex]);

  return { currentSegmentIndex, isActiveIndex };
}

export default useCaptionSync;
