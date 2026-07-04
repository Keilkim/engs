import { useState, useCallback, useRef, useLayoutEffect } from 'react';

/**
 * Hook for minimap navigation
 */
// `rearmKey` should change whenever the scroll container (re)mounts — e.g. when
// the source finishes loading or the page changes. The scroll listener is set up
// in a layout effect whose deps are otherwise stable refs, so without this the
// effect would run once during the loading state (when scrollContainerRef.current
// is still null) and never re-attach after the container actually mounts.
export function useMinimap(scrollContainerRef, rearmKey) {
  // Kept only as the initial value + for minimap-drag reads; the live scroll
  // updates are written straight to the DOM (below) so we never re-render the
  // heavy viewer tree on the scroll hot-path.
  const [viewportPosition, setViewportPosition] = useState({ top: 0, height: 100 });
  const minimapRef = useRef(null);
  const minimapViewportRef = useRef(null); // the blue viewport box, updated imperatively
  const minimapDragging = useRef(false);
  const rafRef = useRef(null); // rAF throttle for scroll

  // Write the viewport box position + sync the minimap thumbnail scroll directly
  // to the DOM. Nothing on this hot path touches React state, so the box tracks
  // scrolling in real time instead of lagging behind a heavy re-render.
  const applyViewportPosition = useCallback(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight <= 0) return;
    const totalScrollable = scrollHeight - clientHeight;
    const top = (scrollTop / scrollHeight) * 100;
    const height = (clientHeight / scrollHeight) * 100;

    const box = minimapViewportRef.current;
    if (box) {
      box.style.top = `${top}%`;
      box.style.height = `${height}%`;
    }

    // Keep the minimap thumbnail scrolled in step with the main content.
    const minimapContent = minimapRef.current?.querySelector('.minimap-content');
    if (minimapContent && totalScrollable > 0) {
      const minimapScrollable = minimapContent.scrollHeight - minimapContent.clientHeight;
      if (minimapScrollable > 0) {
        minimapContent.scrollTop = (scrollTop / totalScrollable) * minimapScrollable;
      }
    }
  }, [scrollContainerRef]);

  // rAF-throttled scroll handler: coalesce a burst of scroll events into a
  // single DOM write per frame.
  const updateViewportPosition = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyViewportPosition();
    });
  }, [applyViewportPosition]);

  // Scroll tracking — the single source of truth (Viewer no longer runs its own).
  useLayoutEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;

    const handleScroll = () => updateViewportPosition();
    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    applyViewportPosition(); // initial paint (sync, before browser paint → no flash)

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
    // rearmKey re-runs this after the container mounts (source load / page change).
  }, [scrollContainerRef, updateViewportPosition, applyViewportPosition, rearmKey]);

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
    minimapViewportRef,
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
