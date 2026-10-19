import { useMemo, useCallback } from 'react';

/**
 * Hook for managing OCR word data
 */
export function useOcrWords(source, currentPage) {
  const rawOcr = source?.ocr_data;
  // Derive during rendering: a page change must never use the previous page's
  // hitboxes for one frame while an effect catches up.
  const ocrWords = useMemo(() => {
    if (!rawOcr) return [];

    try {
      const ocrData = typeof rawOcr === 'string' ? JSON.parse(rawOcr) : rawOcr;
      const pages = Array.isArray(ocrData?.pages) ? ocrData.pages : [];
      const pageData = pages.find(page => page?.pageIndex === currentPage);
      return Array.isArray(pageData?.words) ? pageData.words : [];
    } catch (err) {
      console.error('Failed to parse OCR data:', err);
      return [];
    }
  }, [rawOcr, currentPage]);

  // Find word at point (x, y in %)
  const findWordAtPoint = useCallback((x, y) => {
    for (const word of ocrWords) {
      const bbox = word?.bbox;
      if (!bbox) continue;
      if (
        x >= bbox.x &&
        x <= bbox.x + bbox.width &&
        y >= bbox.y &&
        y <= bbox.y + bbox.height
      ) {
        return word;
      }
    }
    return null;
  }, [ocrWords]);

  return {
    ocrWords,
    findWordAtPoint,
  };
}
