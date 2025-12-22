import { useRef, useCallback } from 'react';

/**
 * Hook to detect tap gestures vs pan/zoom on touch devices.
 * Returns handlers for overlay touch/click events to close modals on tap.
 *
 * A "tap" is defined as: < 200ms duration + < 10px movement
 */
export function useTapToClose(onClose) {
  const touchStartRef = useRef({ time: 0, x: 0, y: 0 });

  const handleTouchStart = useCallback((e) => {
    touchStartRef.current = {
      time: Date.now(),
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  const handleTouchEnd = useCallback((e) => {
    const { time, x, y } = touchStartRef.current;
    const duration = Date.now() - time;
    const dx = Math.abs(e.changedTouches[0].clientX - x);
    const dy = Math.abs(e.changedTouches[0].clientY - y);
    const distance = Math.sqrt(dx * dx + dy * dy);

    // < 200ms duration + < 10px movement = tap
    if (duration < 200 && distance < 10) {
      onClose();
    }
  }, [onClose]);

  const handleClick = useCallback((e) => {
    // Only close if clicking directly on the overlay (not children)
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return { handleTouchStart, handleTouchEnd, handleClick };
}

export default useTapToClose;
