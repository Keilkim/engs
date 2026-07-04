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

  // Map a clientY on the minimap to a document percentage.
  // The minimap image lives inside a scrollable `.minimap-content`; when it is
  // scrolled we must add its scrollTop and divide by its full scrollHeight,
  // otherwise clicking near the top jumps to the wrong place.
  const clientYToPercentage = useCallback((clientY) => {
    const sidebar = minimapRef.current;
    if (!sidebar) return null;
    const content = sidebar.querySelector('.minimap-content') || sidebar;
    const rect = content.getBoundingClientRect();
    const localY = clientY - rect.top;
    const denom = content.scrollHeight || rect.height;
    const percentage = ((content.scrollTop + localY) / denom) * 100;
    return Math.max(0, Math.min(100, percentage));
  }, []);

  // Minimap click handler
  const handleMinimapClick = useCallback((e) => {
    const percentage = clientYToPercentage(e.clientY);
    if (percentage !== null) scrollToPosition(percentage);
  }, [scrollToPosition, clientYToPercentage]);

  // Minimap drag handlers
  const handleMinimapMouseDown = useCallback((e) => {
    minimapDragging.current = true;
    handleMinimapClick(e);
  }, [handleMinimapClick]);

  const handleMinimapMouseMove = useCallback((e) => {
    if (!minimapDragging.current) return;
    const percentage = clientYToPercentage(e.clientY);
    if (percentage !== null) scrollToPosition(percentage);
  }, [scrollToPosition, clientYToPercentage]);

  const handleMinimapMouseUp = useCallback(() => {
    minimapDragging.current = false;
  }, []);

  // Touch handlers
  const handleMinimapTouchStart = useCallback((e) => {
    minimapDragging.current = true;
    if (e.touches[0]) {
      const percentage = clientYToPercentage(e.touches[0].clientY);
      if (percentage !== null) scrollToPosition(percentage);
    }
  }, [scrollToPosition, clientYToPercentage]);

  const handleMinimapTouchMove = useCallback((e) => {
    if (!minimapDragging.current || !e.touches[0]) return;
    const percentage = clientYToPercentage(e.touches[0].clientY);
    if (percentage !== null) scrollToPosition(percentage);
  }, [scrollToPosition, clientYToPercentage]);

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
