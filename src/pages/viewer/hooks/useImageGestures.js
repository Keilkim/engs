import { useCallback, useRef } from 'react';

/**
 * Hook for image gesture handling (tap, long-press, pinch, pan)
 */
export function useImageGestures({
  zoomScale,
  panOffset,
  setPanOffset,
  setZoomScale,
  setZoomOrigin,
  imageContainerRef,
  zoomWrapperRef,
  penModeActive,
  findWordAtPoint,
  findAnnotationAtPoint,
  findSentenceFromWord,
  openModal,
  closeModal,
  activeModal,
  showVocabWord,
  isVocabularyAnnotation,
  isGrammarAnnotation,
  currentPage,
}) {
  // Refs for gesture tracking
  const isPanning = useRef(false);
  const panStartRef = useRef(null);
  const pinchStartRef = useRef(null);
  const twoFingerPanRef = useRef(null);
  const singleFingerPanRef = useRef(null);
  const lastTapRef = useRef(null);
  const wordTapTimer = useRef(null);
  const wordTapStart = useRef(null);
  const menuJustOpened = useRef(false);

  // Get coordinates from mouse or touch event
  const getEventCoords = useCallback((e) => {
    if (e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    }
    return { clientX: e.clientX, clientY: e.clientY };
  }, []);

  // Calculate distance between two touch points
  const getTouchDistance = useCallback((touches) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  // Clamp pan offset to stay within bounds
  const clampPanOffset = useCallback((offset, scale) => {
    if (scale <= 1) return { x: 0, y: 0 };

    const container = imageContainerRef?.current;
    if (!container) return offset;

    const rect = container.getBoundingClientRect();
    const maxPanX = (rect.width * (scale - 1)) / 2;
    const maxPanY = (rect.height * (scale - 1)) / 2;

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, offset.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, offset.y)),
    };
  }, [imageContainerRef]);

  // Get percentage coordinates relative to image
  const getPercentageCoords = useCallback((clientX, clientY) => {
    const wrapper = zoomWrapperRef?.current;
    if (!wrapper) return null;

    const rect = wrapper.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    return { x, y };
  }, [zoomWrapperRef]);

  // Handle word tap (short tap = vocabulary, long press = grammar/sentence)
  const handleWordTap = useCallback((x, y, isLongPress, clientX, clientY) => {
    // Check for existing annotation first
    const existingAnnotation = findAnnotationAtPoint(x, y, isLongPress);

    if (existingAnnotation) {
      const isVocab = isVocabularyAnnotation(existingAnnotation);
      const isGrammar = isGrammarAnnotation(existingAnnotation);

      if (isVocab && !isLongPress) {
        try {
          const analysisData = JSON.parse(existingAnnotation.ai_analysis_json);
          const definition = analysisData.definition || '';
          const selectionData = JSON.parse(existingAnnotation.selection_rect);
          const bounds = selectionData.bounds || selectionData;

          const container = imageContainerRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            const fakeRect = {
              left: containerRect.left + (bounds.x / 100) * containerRect.width,
              right: containerRect.left + ((bounds.x + bounds.width) / 100) * containerRect.width,
              top: containerRect.top + (bounds.y / 100) * containerRect.height,
              bottom: containerRect.top + ((bounds.y + bounds.height) / 100) * containerRect.height,
              width: (bounds.width / 100) * containerRect.width,
              height: (bounds.height / 100) * containerRect.height,
            };
            showVocabWord(existingAnnotation.selected_text, definition, fakeRect, existingAnnotation);
          }
        } catch (err) {
          console.error('Failed to show vocab tooltip:', err);
        }
        return;
      }

      if (isGrammar && isLongPress) {
        try {
          const analysisData = JSON.parse(existingAnnotation.ai_analysis_json);
          const selectionData = JSON.parse(existingAnnotation.selection_rect);
          const bounds = selectionData.bounds || selectionData;
          const lines = selectionData.lines;

          const container = imageContainerRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            const markerTop = containerRect.top + (bounds.y / 100) * containerRect.height;
            const markerBottom = containerRect.top + ((bounds.y + bounds.height) / 100) * containerRect.height;

            menuJustOpened.current = true;
            setTimeout(() => { menuJustOpened.current = false; }, 300);

            openModal('grammarTooltip', {
              annotation: existingAnnotation,
              grammarData: analysisData,
              position: { x: clientX, y: markerBottom + 8 },
              markerRect: { top: markerTop, bottom: markerBottom },
              lines,
            });
          }
        } catch (err) {
          console.error('Failed to show grammar tooltip:', err);
        }
        return;
      }
    }

    // Find word at tap position via OCR
    const word = findWordAtPoint(x, y);
    if (!word) return;

    // For long press (grammar mode), find the full sentence
    if (isLongPress) {
      const sentence = findSentenceFromWord(word);
      if (sentence) {
        menuJustOpened.current = true;
        setTimeout(() => { menuJustOpened.current = false; }, 300);

        openModal('wordMenu', {
          position: { x: clientX, y: clientY },
          word: sentence.text,
          wordBbox: sentence.bbox,
          sentenceWords: sentence.words,
          existingAnnotation: null,
          isGrammarMode: true,
        });
        return;
      }
    }

    // Short tap - vocabulary mode (single word)
    menuJustOpened.current = true;
    setTimeout(() => { menuJustOpened.current = false; }, 300);

    openModal('wordMenu', {
      position: { x: clientX, y: clientY },
      word: word.text,
      wordBbox: word.bbox,
      existingAnnotation: null,
      isGrammarMode: false,
    });
  }, [findWordAtPoint, findAnnotationAtPoint, findSentenceFromWord, openModal, showVocabWord, isVocabularyAnnotation, isGrammarAnnotation, imageContainerRef]);

  // Close word menu
  const closeWordMenu = useCallback((force = false) => {
    if (!force && menuJustOpened.current) {
      return;
    }
    if (activeModal.type === 'wordMenu') {
      closeModal();
    }
  }, [activeModal, closeModal]);

  return {
    // Refs
    isPanning,
    panStartRef,
    pinchStartRef,
    twoFingerPanRef,
    singleFingerPanRef,
    lastTapRef,
    wordTapTimer,
    wordTapStart,
    menuJustOpened,

    // Utils
    getEventCoords,
    getTouchDistance,
    clampPanOffset,
    getPercentageCoords,

    // Handlers
    handleWordTap,
    closeWordMenu,
  };
}
