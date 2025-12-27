import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook for minimap navigation
 */
export function useMinimap(scrollContainerRef) {
  const [viewportPosition, setViewportPosition] = useState({ top: 0, height: 100 });
  const minimapRef = useRef(null);
  const minimapDragging = useRef(false);

  // Update viewport position based on scroll
  const updateViewportPosition = useCallback(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const top = (scrollTop / scrollHeight) * 100;
    const height = (clientHeight / scrollHeight) * 100;

    setViewportPosition({ top, height });
  }, [scrollContainerRef]);

  // Scroll tracking
  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    const handleScroll = () => updateViewportPosition();
    container.addEventListener('scroll', handleScroll);
    updateViewportPosition();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, updateViewportPosition]);

  // Scroll to position from minimap
  const scrollToPosition = useCallback((percentage) => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    const { scrollHeight, clientHeight } = container;
    const targetScroll = (percentage / 100) * scrollHeight - clientHeight / 2;
    container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
  }, [scrollContainerRef]);

  // Minimap click handler
  const handleMinimapClick = useCallback((e) => {
    if (!minimapRef.current) return;

    const rect = minimapRef.current.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const percentage = (clickY / rect.height) * 100;
    scrollToPosition(percentage);
  }, [scrollToPosition]);

  // Minimap drag handlers
  const handleMinimapMouseDown = useCallback((e) => {
    minimapDragging.current = true;
    handleMinimapClick(e);
  }, [handleMinimapClick]);

  const handleMinimapMouseMove = useCallback((e) => {
    if (!minimapDragging.current || !minimapRef.current) return;

    const rect = minimapRef.current.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const percentage = Math.max(0, Math.min(100, (clickY / rect.height) * 100));
    scrollToPosition(percentage);
  }, [scrollToPosition]);

  const handleMinimapMouseUp = useCallback(() => {
    minimapDragging.current = false;
  }, []);

  // Touch handlers
  const handleMinimapTouchStart = useCallback((e) => {
    minimapDragging.current = true;
    if (e.touches[0]) {
      const rect = minimapRef.current?.getBoundingClientRect();
      if (rect) {
        const touchY = e.touches[0].clientY - rect.top;
        const percentage = (touchY / rect.height) * 100;
        scrollToPosition(percentage);
      }
    }
  }, [scrollToPosition]);

  const handleMinimapTouchMove = useCallback((e) => {
    if (!minimapDragging.current || !minimapRef.current) return;

    const rect = minimapRef.current.getBoundingClientRect();
    const touchY = e.touches[0].clientY - rect.top;
    const percentage = Math.max(0, Math.min(100, (touchY / rect.height) * 100));
    scrollToPosition(percentage);
  }, [scrollToPosition]);

  const handleMinimapTouchEnd = useCallback(() => {
    minimapDragging.current = false;
  }, []);

  return {
    viewportPosition,
    setViewportPosition,
    minimapRef,
    handleMinimapClick,
    handleMinimapMouseDown,
    handleMinimapMouseMove,
    handleMinimapMouseUp,
    handleMinimapTouchStart,
    handleMinimapTouchMove,
    handleMinimapTouchEnd,
    updateViewportPosition,
  };
}
