import { useState, useCallback, useRef } from 'react';

/**
 * Hook for centralized modal state management
 * Only one modal can be open at a time
 *
 * Modal types:
 * - 'contextMenu'
 * - 'annotationPopover'
 * - 'vocabTooltip'
 * - 'grammarTooltip'
 * - 'vocabDeleteConfirm'
 * - 'wordMenu'
 */
export function useModalState() {
  const [activeModal, setActiveModal] = useState({
    type: null,
    data: {},
  });

  // Highlighted vocabulary ID (for blue glow effect)
  const [highlightedVocabId, setHighlightedVocabId] = useState(null);
  const highlightTimer = useRef(null);

  // Vocabulary tooltip auto-hide timer
  const vocabTooltipTimer = useRef(null);

  // Open modal (closes any existing modal and clears vocab highlight)
  const openModal = useCallback((type, data = {}) => {
    // Stop any highlight effect
    setHighlightedVocabId(null);
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
    setActiveModal({ type, data });
  }, []);

  // Close modal
  const closeModal = useCallback(() => {
    setActiveModal({ type: null, data: {} });
  }, []);

  // Show vocabulary tooltip with auto-hide
  const showVocabTooltip = useCallback((word, definition, position, placement = 'below', annotation = null) => {
    // Clear existing timer
    if (vocabTooltipTimer.current) {
      clearTimeout(vocabTooltipTimer.current);
    }

    openModal('vocabTooltip', { word, definition, position, placement, annotation });

    // Auto-hide only if no annotation (can't delete)
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

  // Highlight a vocabulary item temporarily
  const highlightVocab = useCallback((vocabId, duration = 2000) => {
    setHighlightedVocabId(vocabId);
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
    }
    highlightTimer.current = setTimeout(() => {
      setHighlightedVocabId(null);
    }, duration);
  }, []);

  // Cleanup timers
  const cleanup = useCallback(() => {
    if (vocabTooltipTimer.current) {
      clearTimeout(vocabTooltipTimer.current);
    }
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
    }
  }, []);

  return {
    // State
    activeModal,
    highlightedVocabId,

    // Actions
    openModal,
    closeModal,
    showVocabTooltip,
    closeVocabTooltip,
    highlightVocab,
    setHighlightedVocabId,
    cleanup,
  };
}
