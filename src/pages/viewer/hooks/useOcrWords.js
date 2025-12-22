import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for managing OCR word data
 */
export function useOcrWords(source, currentPage) {
  const [ocrWords, setOcrWords] = useState([]);

  // Load OCR words for current page from source.ocr_data
  useEffect(() => {
    if (!source?.ocr_data) {
      setOcrWords([]);
      return;
    }

    try {
      const ocrData = typeof source.ocr_data === 'string'
        ? JSON.parse(source.ocr_data)
        : source.ocr_data;

      const pageData = ocrData.pages?.find(p => p.pageIndex === currentPage);
      setOcrWords(pageData?.words || []);
      console.log(`[OCR] Page ${currentPage} loaded:`, pageData?.words?.length || 0, 'words');
    } catch (err) {
      console.error('Failed to parse OCR data:', err);
      setOcrWords([]);
    }
  }, [source, currentPage]);

  // Find word at point (x, y in %)
  const findWordAtPoint = useCallback((x, y) => {
    for (const word of ocrWords) {
      const { bbox } = word;
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
    setOcrWords,
    findWordAtPoint,
  };
}
