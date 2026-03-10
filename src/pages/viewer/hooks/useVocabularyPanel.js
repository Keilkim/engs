import { useState, useCallback } from 'react';
import { getMobileSafeAreaBottom } from '../../../utils/positioning';

/**
 * Hook for vocabulary panel UI state and interactions
 * Data (vocabulary list) is provided externally (from useSourceData or Viewer)
 * highlightedVocabId / highlightVocab are managed by useModalState
 */
export function useVocabularyPanel(openModal, vocabulary) {
  const [showVocabPanel, setShowVocabPanel] = useState(false);
  const [deletingVocab, setDeletingVocab] = useState(false);

  // Show vocabulary word via wordMenu modal with smart positioning
  const showVocabWord = useCallback((word, definition, markerRect = null, annotation = null) => {
    let position = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let placement = 'below';

    if (markerRect) {
      const viewportHeight = window.innerHeight;
      const safeAreaBottom = getMobileSafeAreaBottom();
      const spaceAbove = markerRect.top;
      const spaceBelow = viewportHeight - markerRect.bottom - safeAreaBottom;

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

    openModal('wordMenu', {
      word,
      existingAnnotation: annotation,
      isGrammarMode: false,
      position,
      placement,
    });
  }, [openModal]);

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

  return {
    showVocabPanel,
    setShowVocabPanel,
    deletingVocab,
    setDeletingVocab,
    showVocabWord,
    highlightVocabularyWords,
  };
}
