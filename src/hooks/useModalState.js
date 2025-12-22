import { useState, useCallback } from 'react';

/**
 * Hook for centralized modal state management.
 * Ensures only one modal is open at a time.
 *
 * Modal types: 'contextMenu' | 'annotationPopover' | 'vocabTooltip' |
 *              'grammarTooltip' | 'vocabDeleteConfirm' | 'wordMenu' | null
 *
 * @param {Function} onBeforeOpen - Optional callback before opening (e.g., clear highlights)
 * @returns {Object} Modal state and handlers
 */
export function useModalState(onBeforeOpen) {
  const [activeModal, setActiveModal] = useState({
    type: null,
    data: {},
  });

  // Open modal (closes any existing modal first)
  const openModal = useCallback((type, data = {}) => {
    if (onBeforeOpen) {
      onBeforeOpen();
    }
    setActiveModal({ type, data });
  }, [onBeforeOpen]);

  // Close modal
  const closeModal = useCallback(() => {
    setActiveModal({ type: null, data: {} });
  }, []);

  // Check if specific modal type is open
  const isModalOpen = useCallback((type) => {
    return activeModal.type === type;
  }, [activeModal.type]);

  // Get modal data for specific type (returns null if not open)
  const getModalData = useCallback((type) => {
    return activeModal.type === type ? activeModal.data : null;
  }, [activeModal]);

  return {
    activeModal,
    openModal,
    closeModal,
    isModalOpen,
    getModalData,
  };
}

export default useModalState;
