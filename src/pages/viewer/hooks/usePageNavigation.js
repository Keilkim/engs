import { useState, useCallback, useRef, useEffect } from 'react';

const LAST_PAGE_KEY = (sourceId) => `viewer:lastPage:${sourceId}`;

/**
 * Hook for page navigation (multi-page documents)
 * Keyboard/wheel navigation handled externally (coupled to gesture system)
 *
 * When `sourceId` is provided, the last viewed page is persisted to
 * localStorage and restored on return so users resume where they left off.
 */
export function usePageNavigation(totalPages, sourceId, onPageChange) {
  const [currentPage, setCurrentPage] = useState(0);
  const mobileNavRef = useRef(null);
  // Tracks which source we've already restored, so restore runs once per source.
  const restoredForRef = useRef(null);

  // Restore last page for this source once the page count is known.
  // One-time initialization from storage after async page-count load is a
  // recognized exception to set-state-in-effect (guarded to run once per source).
  useEffect(() => {
    if (!sourceId || totalPages <= 0) return;
    if (restoredForRef.current === sourceId) return;
    restoredForRef.current = sourceId;
    try {
      const raw = localStorage.getItem(LAST_PAGE_KEY(sourceId));
      const saved = raw != null ? parseInt(raw, 10) : NaN;
      if (!isNaN(saved) && saved > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCurrentPage(Math.min(saved, totalPages - 1));
      }
    } catch {
      // localStorage unavailable → ignore, start at page 0
    }
  }, [sourceId, totalPages]);

  // Persist current page per source (only after restore has run for it).
  useEffect(() => {
    if (!sourceId || restoredForRef.current !== sourceId) return;
    try {
      localStorage.setItem(LAST_PAGE_KEY(sourceId), String(currentPage));
    } catch {
      // ignore write failures (private mode / quota)
    }
  }, [sourceId, currentPage]);

  // Navigate to previous page
  const handlePrevPage = useCallback(() => {
    if (currentPage > 0) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      onPageChange?.(newPage);
    }
  }, [currentPage, onPageChange]);

  // Navigate to next page
  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages - 1) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      onPageChange?.(newPage);
    }
  }, [currentPage, totalPages, onPageChange]);

  // Go to specific page
  const goToPage = useCallback((pageNum) => {
    if (pageNum >= 0 && pageNum < totalPages) {
      setCurrentPage(pageNum);
      onPageChange?.(pageNum);
    }
  }, [totalPages, onPageChange]);

  // Auto-scroll mobile nav to show current page
  useEffect(() => {
    if (mobileNavRef.current) {
      const activeThumb = mobileNavRef.current.querySelector('.page-nav-mobile-thumb.active');
      if (activeThumb) {
        activeThumb.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest',
        });
      }
    }
  }, [currentPage]);

  return {
    currentPage,
    setCurrentPage,
    handlePrevPage,
    handleNextPage,
    goToPage,
    mobileNavRef,
  };
}
