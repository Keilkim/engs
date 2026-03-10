import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook for page navigation (multi-page documents)
 * Keyboard/wheel navigation handled externally (coupled to gesture system)
 */
export function usePageNavigation(totalPages, onPageChange) {
  const [currentPage, setCurrentPage] = useState(0);
  const mobileNavRef = useRef(null);

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
