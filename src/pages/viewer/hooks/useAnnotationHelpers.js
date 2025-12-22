import { useCallback, useMemo } from 'react';

/**
 * Hook for annotation type checking and filtering
 */
export function useAnnotationHelpers(annotations, currentPage) {
  // Check if annotation is a vocabulary item
  const isVocabularyAnnotation = useCallback((annotation) => {
    if (!annotation.ai_analysis_json) return false;
    try {
      const data = JSON.parse(annotation.ai_analysis_json);
      return data.isVocabulary === true;
    } catch {
      return false;
    }
  }, []);

  // Check if annotation is a grammar pattern
  const isGrammarAnnotation = useCallback((annotation) => {
    if (!annotation.ai_analysis_json) return false;
    try {
      const data = JSON.parse(annotation.ai_analysis_json);
      return data.type === 'grammar';
    } catch {
      return false;
    }
  }, []);

  // Get vocabulary annotations for image (with selection_rect)
  const getVocabularyAnnotations = useCallback((pageNum = null) => {
    return annotations.filter(a => {
      if (!a.selection_rect || !isVocabularyAnnotation(a)) return false;
      if (pageNum !== null) {
        try {
          const rect = JSON.parse(a.selection_rect);
          return rect.page === pageNum;
        } catch {
          return false;
        }
      }
      return true;
    });
  }, [annotations, isVocabularyAnnotation]);

  // Get grammar annotations with optional page filter
  const getGrammarAnnotations = useCallback((pageNum = null) => {
    const grammarAnnotations = annotations.filter(a => {
      if (!a.ai_analysis_json) return false;
      try {
        const data = JSON.parse(a.ai_analysis_json);
        return data.type === 'grammar';
      } catch {
        return false;
      }
    });

    if (pageNum !== null) {
      return grammarAnnotations.filter(a => {
        if (!a.selection_rect) return false;
        try {
          const rect = JSON.parse(a.selection_rect);
          return rect.page === pageNum;
        } catch {
          return false;
        }
      });
    }
    return grammarAnnotations;
  }, [annotations]);

  // Find existing annotation at point (vocabulary or grammar)
  const findAnnotationAtPoint = useCallback((x, y, preferGrammar = false) => {
    const matchingAnnotations = [];

    for (const annotation of annotations) {
      if (!annotation.selection_rect) continue;
      try {
        const data = JSON.parse(annotation.selection_rect);
        if (data.page !== undefined && data.page !== currentPage) continue;

        const bounds = data.bounds || data;
        if (
          x >= bounds.x &&
          x <= bounds.x + bounds.width &&
          y >= bounds.y &&
          y <= bounds.y + bounds.height
        ) {
          const area = bounds.width * bounds.height;
          const isVocab = isVocabularyAnnotation(annotation);
          matchingAnnotations.push({ annotation, area, isVocab });
        }
      } catch {
        continue;
      }
    }

    if (matchingAnnotations.length === 0) return null;

    // Sort by preference
    matchingAnnotations.sort((a, b) => {
      if (preferGrammar) {
        if (a.isVocab !== b.isVocab) return a.isVocab ? 1 : -1;
      } else {
        if (a.isVocab !== b.isVocab) return a.isVocab ? -1 : 1;
      }
      return a.area - b.area;
    });

    return matchingAnnotations[0].annotation;
  }, [annotations, currentPage, isVocabularyAnnotation]);

  // Memoized vocabulary annotations for current page
  const currentPageVocabAnnotations = useMemo(() =>
    getVocabularyAnnotations(currentPage),
    [getVocabularyAnnotations, currentPage]
  );

  // Memoized grammar annotations for current page
  const currentPageGrammarAnnotations = useMemo(() =>
    getGrammarAnnotations(currentPage),
    [getGrammarAnnotations, currentPage]
  );

  return {
    isVocabularyAnnotation,
    isGrammarAnnotation,
    getVocabularyAnnotations,
    getGrammarAnnotations,
    findAnnotationAtPoint,
    currentPageVocabAnnotations,
    currentPageGrammarAnnotations,
  };
}
