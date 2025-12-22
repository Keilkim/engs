import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook for vocabulary panel state and interactions
 */
export function useVocabularyPanel(openModal, closeModal) {
  const [vocabulary, setVocabulary] = useState([]);
  const [showVocabPanel, setShowVocabPanel] = useState(false);
  const [highlightedVocabId, setHighlightedVocabId] = useState(null);
  const [deletingVocab, setDeletingVocab] = useState(false);

  const vocabTooltipTimer = useRef(null);
  const highlightTimer = useRef(null);

  // Show vocabulary tooltip with smart positioning
  const showVocabWord = useCallback((word, definition, markerRect = null, annotation = null) => {
    if (vocabTooltipTimer.current) {
      clearTimeout(vocabTooltipTimer.current);
    }

    let position = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let placement = 'below';

    if (markerRect) {
      const viewportHeight = window.innerHeight;
      const spaceAbove = markerRect.top;
      const spaceBelow = viewportHeight - markerRect.bottom;

      placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

      const x = Math.min(
        Math.max(20, markerRect.left + markerRect.width / 2),
        window.innerWidth - 20
      );

      const y = placement === 'below'
        ? markerRect.bottom + 12
        : markerRect.top - 12;

      position = { x, y };
    }

    openModal('vocabTooltip', { word, definition, position, placement, annotation });

    if (!annotation) {
      vocabTooltipTimer.current = setTimeout(() => {
        closeModal();
      }, 5000);
    }
  }, [openModal, closeModal]);

  // Close vocabulary tooltip
  const closeVocabTooltip = useCallback(() => {
    if (vocabTooltipTimer.current) {
      clearTimeout(vocabTooltipTimer.current);
    }
    closeModal();
  }, [closeModal]);

  // Highlight vocabulary item temporarily
  const highlightVocab = useCallback((vocabId, duration = 2000) => {
    setHighlightedVocabId(vocabId);
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
    }
    highlightTimer.current = setTimeout(() => {
      setHighlightedVocabId(null);
    }, duration);
  }, []);

  // Clear highlight
  const clearHighlight = useCallback(() => {
    setHighlightedVocabId(null);
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
  }, []);

  // Escape special regex characters
  const escapeRegex = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Highlight vocabulary words in HTML content
  const highlightVocabularyWords = useCallback((htmlContent) => {
    if (!vocabulary || vocabulary.length === 0) return htmlContent;

    let result = htmlContent;
    vocabulary.forEach(item => {
      const word = item.selected_text;
      if (!word || word.length < 2) return;

      const regex = new RegExp(`\\b(${escapeRegex(word)})\\b`, 'gi');
      result = result.replace(regex, `<mark class="vocab-highlight" data-vocab-id="${item.id}">$1</mark>`);
    });
    return result;
  }, [vocabulary]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (vocabTooltipTimer.current) {
        clearTimeout(vocabTooltipTimer.current);
      }
      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
      }
    };
  }, []);

  return {
    vocabulary,
    setVocabulary,
    showVocabPanel,
    setShowVocabPanel,
    highlightedVocabId,
    setHighlightedVocabId,
    deletingVocab,
    setDeletingVocab,
    showVocabWord,
    closeVocabTooltip,
    highlightVocab,
    clearHighlight,
    highlightVocabularyWords,
  };
}
