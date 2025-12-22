import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook for page navigation (multi-page documents)
 */
export function usePageNavigation(totalPages, onPageChange) {
  const [currentPage, setCurrentPage] = useState(0);
  const mobileNavRef = useRef(null);
  const touchStartRef = useRef(null);

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

  // Reset to first page
  const resetPage = useCallback(() => {
    setCurrentPage(0);
    onPageChange?.(0);
  }, [onPageChange]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') {
        handlePrevPage();
      } else if (e.key === 'ArrowRight') {
        handleNextPage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevPage, handleNextPage]);

  // Auto-scroll mobile nav to show current page
  useEffect(() => {
    if (mobileNavRef.current) {
      const nav = mobileNavRef.current;
      const activeBtn = nav.querySelector('.active');
      if (activeBtn) {
        const navRect = nav.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        const scrollLeft = btnRect.left - navRect.left - navRect.width / 2 + btnRect.width / 2;
        nav.scrollTo({ left: nav.scrollLeft + scrollLeft, behavior: 'smooth' });
      }
    }
  }, [currentPage]);

  // Start swipe detection
  const startSwipe = useCallback((clientX, clientY) => {
    touchStartRef.current = { x: clientX, y: clientY, time: Date.now() };
  }, []);

  // End swipe detection and navigate if valid
  const endSwipe = useCallback((clientX, clientY, zoomScale = 1) => {
    if (!touchStartRef.current || zoomScale > 1) {
      touchStartRef.current = null;
      return false;
    }

    const dx = clientX - touchStartRef.current.x;
    const dy = clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;

    touchStartRef.current = null;

    // Swipe detection: horizontal > 50px, faster than 300ms, more horizontal than vertical
    if (Math.abs(dx) > 50 && dt < 300 && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) {
        handlePrevPage();
        return true;
      } else {
        handleNextPage();
        return true;
      }
    }

    return false;
  }, [handlePrevPage, handleNextPage]);

  return {
    // State
    currentPage,

    // Actions
    setCurrentPage,
    handlePrevPage,
    handleNextPage,
    goToPage,
    resetPage,
    startSwipe,
    endSwipe,

    // Refs
    mobileNavRef,
    touchStartRef,

    // Helpers
    hasPrevPage: currentPage > 0,
    hasNextPage: currentPage < totalPages - 1,
  };
}
