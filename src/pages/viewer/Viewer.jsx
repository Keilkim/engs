import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSource, deleteSource } from '../../services/source';
import { getAnnotations, getVocabulary, deleteAnnotation } from '../../services/annotation';
import WordQuickMenu from '../../components/modals/WordQuickMenu';
import { TranslatableText } from '../../components/translatable';
import { PenModeToggle, ColorPalette, PenCanvas, usePenStrokes } from '../../components/pen-mode';
import { useOcrWords, useSentenceFinder, useMinimap, useAnnotationHelpers } from './hooks';
import { GrammarPatternRenderer } from './components';
import { getMobileSafeAreaBottom } from '../../utils/positioning';

export default function Viewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [source, setSource] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const contentRef = useRef(null);
  const imageContainerRef = useRef(null);
  const zoomWrapperRef = useRef(null); // For accurate coordinate calculation when zoomed
  const touchStartRef = useRef(null); // For swipe detection
  const [isShaking, setIsShaking] = useState(false); // Boundary shake effect
  const [zoomScale, setZoomScale] = useState(1); // Pinch zoom scale
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 }); // Zoom origin point (%)
  const pinchStartRef = useRef(null); // For pinch zoom tracking
  const mobileNavRef = useRef(null); // For auto-scrolling mobile nav
  const scrollContainerRef = useRef(null); // For scroll tracking

  // Minimap navigation (from custom hook)
  const {
    viewportPosition,
    setViewportPosition,
    minimapRef,
    handleMinimapMouseDown,
    handleMinimapMouseMove,
    handleMinimapMouseUp,
    handleMinimapTouchStart,
    handleMinimapTouchMove,
    handleMinimapTouchEnd,
  } = useMinimap(scrollContainerRef);

  // Panning state (for zoomed view navigation)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false); // Currently panning (spacebar or middle button)
  const spacebarHeld = useRef(false); // Spacebar is held down
  const panStartRef = useRef(null); // { clientX, clientY, startPanX, startPanY }
  const twoFingerPanRef = useRef(null); // { centerX, centerY, startPanX, startPanY }
  const singleFingerPanRef = useRef(null); // For single finger panning when zoomed
  const lastTapRef = useRef(null); // For double-tap detection { time, x, y }

  // Mouse click tracking for desktop tap detection
  const mouseClickStart = useRef(null); // { x, y, time }
  const mouseTimer = useRef(null); // Long-press timer for desktop

  // Pen mode state
  const [penModeActive, setPenModeActive] = useState(false);
  const [penColor, setPenColor] = useState('#0A84FF');
  const [penStrokeWidth, setPenStrokeWidth] = useState(1);
  const [showColorPalette, setShowColorPalette] = useState(false);
  const { strokes: penStrokes, addStroke: addPenStroke, removeStrokes: removePenStrokes } = usePenStrokes(id);

  // Note: Drawing mode removed - using tap/long-press for word selection instead

  // Centralized modal state - only one modal open at a time
  // Types: 'wordMenu' | 'vocabDeleteConfirm' | null
  const [activeModal, setActiveModal] = useState({
    type: null,
    data: {},
  });

  // Helper to open modal (closes any existing modal and clears vocab highlight)
  const openModal = useCallback((type, data = {}) => {
    // 다른 깜빡임 효과 중지 (한 번에 하나만 깜빡이도록)
    setHighlightedVocabId(null);
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
    setActiveModal({ type, data });
  }, []);

  // Helper to close modal
  const closeModal = useCallback(() => {
    setActiveModal({ type: null, data: {} });
  }, []);

  // Vocabulary panel state (sidebar - not a popup modal)
  const [vocabulary, setVocabulary] = useState([]);
  const [showVocabPanel, setShowVocabPanel] = useState(false);
  const [highlightedVocabId, setHighlightedVocabId] = useState(null); // 파란 글로우 효과용
  const highlightTimer = useRef(null);

  // 단어 삭제 상태
  const [deletingVocab, setDeletingVocab] = useState(false);

  // OCR word data (from custom hook)
  const { ocrWords, findWordAtPoint } = useOcrWords(source, currentPage);
  const { findSentenceFromWord } = useSentenceFinder(ocrWords);

  // Annotation helpers (from custom hook)
  const {
    isVocabularyAnnotation,
    isGrammarAnnotation,
    getVocabularyAnnotations,
    getGrammarAnnotations,
    findAnnotationAtPoint,
  } = useAnnotationHelpers(annotations, currentPage);

  const menuJustOpened = useRef(false); // Prevent menu from closing immediately
  // 단순화된 터치 상태 (하나의 ref로 통합)
  const touchState = useRef({
    startTime: 0,
    startX: 0,
    startY: 0,
    moved: false,
    actionExecuted: false,  // 핵심: 액션이 이미 실행되었는지
    timer: null,
  });

  // Delete vocabulary annotation
  async function handleDeleteVocabAnnotation() {
    if (activeModal.type !== 'vocabDeleteConfirm' || !activeModal.data.annotation || deletingVocab) return;

    setDeletingVocab(true);
    try {
      await deleteAnnotation(activeModal.data.annotation.id);
      closeModal();
      loadData(); // Reload to refresh annotations
    } catch (err) {
      console.error('Failed to delete vocabulary:', err);
    } finally {
      setDeletingVocab(false);
    }
  }

  useEffect(() => {
    // 페이지 진입 시 스크롤 상단으로 이동
    window.scrollTo(0, 0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    loadData();
  }, [id]);

  // Escape special regex characters
  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Highlight vocabulary words in HTML content
  function highlightVocabularyWords(htmlContent) {
    if (!vocabulary || vocabulary.length === 0) return htmlContent;

    let result = htmlContent;
    vocabulary.forEach(item => {
      const word = item.selected_text;
      if (!word || word.length < 2) return;

      // Create regex to match whole words (case-insensitive)
      const regex = new RegExp(`\\b(${escapeRegex(word)})\\b`, 'gi');
      result = result.replace(regex, `<mark class="vocab-highlight" data-vocab-id="${item.id}">$1</mark>`);
    });
    return result;
  }

  // Handle vocabulary highlight click
  function handleVocabHighlightClick(e) {
    const vocabId = e.target.getAttribute('data-vocab-id');
    const vocabItem = vocabulary.find(v => v.id === vocabId);

    if (vocabItem) {
      const definition = vocabItem.ai_analysis_json
        ? JSON.parse(vocabItem.ai_analysis_json).definition || ''
        : '';
      showVocabWord(vocabItem.selected_text, definition);
    }
  }

  // Add click listeners to highlights after render
  useEffect(() => {
    if (contentRef.current) {
      // Regular annotation highlights
      const highlights = contentRef.current.querySelectorAll('mark.highlight');
      highlights.forEach((mark) => {
        mark.addEventListener('click', handleHighlightClick);
      });

      // Vocabulary highlights
      const vocabHighlights = contentRef.current.querySelectorAll('mark.vocab-highlight');
      vocabHighlights.forEach((mark) => {
        mark.addEventListener('click', handleVocabHighlightClick);
      });

      return () => {
        highlights.forEach((mark) => {
          mark.removeEventListener('click', handleHighlightClick);
        });
        vocabHighlights.forEach((mark) => {
          mark.removeEventListener('click', handleVocabHighlightClick);
        });
      };
    }
  }, [source, annotations, vocabulary]);

  // Parse pages from source
  function getPages() {
    if (source?.pages) {
      try {
        return JSON.parse(source.pages);
      } catch {
        return null;
      }
    }
    return null;
  }

  async function loadData() {
    console.log('[Viewer] loadData called, id:', id, 'current source:', source?.id);

    // source가 이미 있으면 로딩 상태로 변경하지 않음 (깜빡임 방지)
    if (!source) {
      setLoading(true);
    }

    try {
      const [sourceData, annotationsData, vocabData] = await Promise.all([
        getSource(id),
        getAnnotations(id),
        getVocabulary(),
      ]);
      console.log('[Viewer] loadData success:', {
        sourceId: sourceData?.id,
        sourceType: sourceData?.type,
        hasPages: !!sourceData?.pages,
        hasScreenshot: !!sourceData?.screenshot,
      });
      setSource(sourceData);
      setAnnotations(annotationsData || []);
      setVocabulary(vocabData || []);
      setCurrentPage(0); // Reset to first page on initial load
    } catch (err) {
      console.error('[Viewer] loadData error:', err);
      setError('Unable to load source');
    } finally {
      setLoading(false);
    }
  }

  // Refresh annotations only (without resetting page position)
  async function refreshAnnotations() {
    try {
      const [annotationsData, vocabData] = await Promise.all([
        getAnnotations(id),
        getVocabulary(),
      ]);
      setAnnotations(annotationsData || []);
      setVocabulary(vocabData || []);
    } catch (err) {
      console.error('Failed to refresh annotations:', err);
    }
  }

  // Show vocabulary tooltip with smart positioning
  function showVocabWord(word, definition, markerRect = null, annotation = null) {
    // Calculate smart position based on available space
    let position = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let placement = 'below';

    if (markerRect) {
      const viewportHeight = window.innerHeight;
      const safeAreaBottom = getMobileSafeAreaBottom();
      const spaceAbove = markerRect.top;
      // 모바일 하단 주소창 영역을 고려한 실제 사용 가능 공간
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
  }


  function handleHighlightClick(e) {
    e.stopPropagation();
    // Pen mode disabled - no action needed
  }

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

  // Handle word tap (short tap = vocabulary, long press = grammar/sentence)
  const handleWordTap = useCallback((clientX, clientY, isLongPress = false) => {
    console.log(`[handleWordTap] ${isLongPress ? 'LONG PRESS' : 'SHORT TAP'} at (${clientX}, ${clientY})`);

    // 모달이 열려있으면 닫기만 하고 return
    if (activeModal.type === 'wordMenu' || activeModal.type === 'grammarTooltip') {
      closeModal();
      return;
    }

    // 펜 모드가 활성화되면 단어 탭 무시
    if (penModeActive) return;
    if (!imageContainerRef.current) return;

    const targetRef = zoomWrapperRef.current || imageContainerRef.current;
    const rect = targetRef.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    console.log(`[handleWordTap] Relative position: (${x.toFixed(2)}%, ${y.toFixed(2)}%)`);

    // 저장된 annotation 클릭 → 해당 tooltip 표시
    // 롱프레스: grammar 우선, 짧은 탭: vocabulary 우선
    const existingAnnotation = findAnnotationAtPoint(x, y, isLongPress);
    console.log(`[handleWordTap] Found existing annotation:`, existingAnnotation?.id, existingAnnotation?.selected_text);

    if (existingAnnotation) {
      const isVocab = isVocabularyAnnotation(existingAnnotation);
      const isGrammar = isGrammarAnnotation(existingAnnotation);
      console.log(`[handleWordTap] Annotation type - isVocab: ${isVocab}, isGrammar: ${isGrammar}`);

      // 단어(vocab) 탭 - vocab tooltip 표시
      if (isVocab && !isLongPress) {
        const definition = existingAnnotation.ai_analysis_json
          ? JSON.parse(existingAnnotation.ai_analysis_json).definition || ''
          : '';
        // 클릭 위치 기준으로 tooltip 표시
        const fakeRect = {
          left: clientX - 20,
          right: clientX + 20,
          top: clientY - 10,
          bottom: clientY + 10,
          width: 40,
        };
        showVocabWord(existingAnnotation.selected_text, definition, fakeRect, existingAnnotation);
        return;
      }

      // 문법(grammar) 롱프레스 - 저장된 문법 tooltip 표시 (다시 분석하지 않음)
      if (isGrammar && isLongPress) {
        try {
          const selectionData = JSON.parse(existingAnnotation.selection_rect);
          const bounds = selectionData.bounds || selectionData;
          const lines = selectionData.lines;

          // 위/아래 위치 계산
          const firstLine = lines && lines.length > 0 ? lines[0] : bounds;
          const lastLine = lines && lines.length > 0 ? lines[lines.length - 1] : bounds;

          const markerTopPx = rect.top + firstLine.y * rect.height / 100;
          const markerBottomPx = rect.top + (lastLine.y + lastLine.height) * rect.height / 100;

          // 위/아래 공간 비교하여 placement 결정 (모바일 하단 주소창 고려)
          const viewportHeight = window.innerHeight;
          const safeAreaBottom = getMobileSafeAreaBottom();
          const spaceAbove = markerTopPx;
          const spaceBelow = viewportHeight - markerBottomPx - safeAreaBottom;
          const placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

          // 모달 위치: 클릭한 X 위치 사용 (가장 정확), Y는 마킹 위/아래
          const posX = clientX;
          const posY = placement === 'below'
            ? Math.min(markerBottomPx + 12, viewportHeight - safeAreaBottom - 50)
            : Math.max(markerTopPx - 12, 50);

          // lines 데이터를 sentenceWords 형식으로 변환 (줄별 하이라이트용)
          const sentenceWords = lines && lines.length > 0
            ? lines.map((line, i) => ({ text: `line-${i}`, bbox: line }))
            : null;

          openModal('wordMenu', {
            word: existingAnnotation.selected_text,
            existingAnnotation: existingAnnotation,
            isGrammarMode: true,
            position: { x: posX, y: posY },
            placement,
            wordBbox: bounds, // 동적 위치 업데이트용
            sentenceWords, // 줄별 하이라이트용
          });
          return;
        } catch {
          // fallback to new analysis
        }
      }
    }

    // Find word at tap position via OCR
    const word = findWordAtPoint(x, y);
    if (!word) return;

    console.log(`[Tap] ${isLongPress ? 'Long press' : 'Tap'} on word: "${word.text}"`);

    // For long press (grammar mode), find the full sentence
    if (isLongPress) {
      const sentence = findSentenceFromWord(word);
      if (sentence) {
        menuJustOpened.current = true;
        setTimeout(() => { menuJustOpened.current = false; }, 100);

        // 개별 단어들 중 가장 위/아래 라인 찾기
        let minTopY = sentence.bbox.y;
        let maxBottomY = sentence.bbox.y + sentence.bbox.height;
        if (sentence.words && sentence.words.length > 0) {
          minTopY = Math.min(...sentence.words.map(w => w.bbox.y));
          maxBottomY = Math.max(...sentence.words.map(w => w.bbox.y + w.bbox.height));
        }

        // 마킹의 화면상 위치 계산 (줌/팬 고려)
        const markerTopPx = rect.top + (minTopY * rect.height / 100);
        const markerBottomPx = rect.top + (maxBottomY * rect.height / 100);

        // 위/아래 공간 비교하여 placement 결정 (모바일 하단 주소창 고려)
        const viewportHeight = window.innerHeight;
        const safeAreaBottom = getMobileSafeAreaBottom();
        const spaceAbove = markerTopPx;
        const spaceBelow = viewportHeight - markerBottomPx - safeAreaBottom;
        const placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

        // 모달 위치: 클릭한 X 위치 사용 (가장 정확), Y는 마킹 위/아래
        const posX = clientX;
        const posY = placement === 'below'
          ? Math.min(markerBottomPx + 12, viewportHeight - safeAreaBottom - 50)
          : Math.max(markerTopPx - 12, 50);

        openModal('wordMenu', {
          position: { x: posX, y: posY },
          placement,
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
    setTimeout(() => { menuJustOpened.current = false; }, 100);

    // 단어의 화면상 위치 계산 (줌/팬 고려)
    const wordTopY = word.bbox.y;
    const wordBottomY = word.bbox.y + word.bbox.height;
    const markerTopPx = rect.top + (wordTopY * rect.height / 100);
    const markerBottomPx = rect.top + (wordBottomY * rect.height / 100);

    // 위/아래 공간 비교하여 placement 결정 (모바일 하단 주소창 고려)
    const viewportHeight = window.innerHeight;
    const safeAreaBottom2 = getMobileSafeAreaBottom();
    const spaceAbove = markerTopPx;
    const spaceBelow = viewportHeight - markerBottomPx - safeAreaBottom2;
    const placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

    // 모달 위치: 클릭한 X 위치 사용 (가장 정확), Y는 마킹 위/아래
    const posX = clientX;
    const posY = placement === 'below'
      ? Math.min(markerBottomPx + 12, viewportHeight - safeAreaBottom2 - 50)
      : Math.max(markerTopPx - 12, 50);

    openModal('wordMenu', {
      position: { x: posX, y: posY },
      placement,
      word: word.text,
      wordBbox: word.bbox,
      existingAnnotation: null,
      isGrammarMode: false,
    });
  }, [penModeActive, findWordAtPoint, findAnnotationAtPoint, findSentenceFromWord, openModal, activeModal, closeModal]);

  // Close word menu (with protection against immediate close)
  const closeWordMenu = useCallback((force = false) => {
    // Don't close if menu was just opened (prevents click-through issues)
    // Unless force is true (e.g., when saving)
    if (!force && menuJustOpened.current) {
      return;
    }
    closeModal();
  }, [closeModal]);

  // Handle word menu saved (with optimistic update)
  const handleWordMenuSaved = useCallback((tempAnnotation) => {
    // 낙관적 업데이트: 임시 어노테이션을 즉시 로컬 상태에 추가
    if (tempAnnotation) {
      setAnnotations(prev => [...prev, tempAnnotation]);
    }
    // closeWordMenu는 WordQuickMenu의 onClose에서 호출되므로 여기서는 생략
    // 백그라운드에서 서버 데이터 동기화 (실제 ID 가져오기)
    setTimeout(() => refreshAnnotations(), 500);
  }, []);

  // Handle word menu delete
  const handleWordMenuDelete = useCallback(async () => {
    if (activeModal.type !== 'wordMenu' || !activeModal.data.existingAnnotation) return;
    try {
      await deleteAnnotation(activeModal.data.existingAnnotation.id);
      refreshAnnotations();
      closeWordMenu();
    } catch (err) {
      console.error('Failed to delete annotation:', err);
    }
  }, [activeModal, closeWordMenu]);

  // Clamp pan offset to keep image within bounds
  const clampPanOffset = useCallback((offsetX, offsetY, scale) => {
    if (scale <= 1) return { x: 0, y: 0 }; // No pan when not zoomed

    const container = imageContainerRef.current;
    if (!container) return { x: offsetX, y: offsetY };

    const rect = container.getBoundingClientRect();
    const scaledWidth = rect.width * scale;
    const scaledHeight = rect.height * scale;

    // Calculate max pan based on zoom origin and scale
    const maxPanX = (scaledWidth - rect.width) / 2;
    const maxPanY = (scaledHeight - rect.height) / 2;

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, offsetX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, offsetY)),
    };
  }, []);

  // Image pointer handlers (mouse) - for panning and pinch zoom only
  const handleImagePointerDown = useCallback((e) => {
    if (!imageContainerRef.current) return;

    // Middle mouse button - start panning (desktop)
    if (e.button === 1) {
      e.preventDefault();
      isPanning.current = true;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
      };
      return;
    }

    // Spacebar held + left click - start panning (desktop)
    if (spacebarHeld.current && e.button === 0) {
      e.preventDefault();
      isPanning.current = true;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
      };
      return;
    }

    // Two-finger touch - start pinch zoom OR pan
    if (e.touches && e.touches.length >= 2) {
      touchStartRef.current = null;

      // Calculate pinch center point relative to container
      const rect = imageContainerRef.current.getBoundingClientRect();
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const originX = ((centerX - rect.left) / rect.width) * 100;
      const originY = ((centerY - rect.top) / rect.height) * 100;

      setZoomOrigin({ x: originX, y: originY });
      pinchStartRef.current = {
        distance: getTouchDistance(e.touches),
        scale: zoomScale
      };
      // Also track for pan detection
      twoFingerPanRef.current = {
        centerX,
        centerY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
      };
      return;
    }

    // Left mouse button - start click/long-press detection
    if (e.button === 0 && !e.touches) {
      const { clientX, clientY } = getEventCoords(e);
      mouseClickStart.current = {
        x: clientX,
        y: clientY,
        time: Date.now(),
        moved: false,
      };

      // Start long-press timer for grammar mode
      mouseTimer.current = setTimeout(() => {
        if (mouseClickStart.current && !mouseClickStart.current.moved) {
          const clickData = mouseClickStart.current;
          mouseClickStart.current = null; // 먼저 null로 설정하여 중복 호출 방지
          mouseTimer.current = null; // 타이머도 클리어
          handleWordTap(clickData.x, clickData.y, true);
        }
      }, 500);
    }
  }, [getEventCoords, getTouchDistance, zoomScale, panOffset, handleWordTap]);

  const handleImagePointerMove = useCallback((e) => {
    // Desktop panning (middle button or spacebar + drag)
    if (isPanning.current && panStartRef.current) {
      const { clientX, clientY } = getEventCoords(e);
      const deltaX = clientX - panStartRef.current.clientX;
      const deltaY = clientY - panStartRef.current.clientY;
      const newOffset = clampPanOffset(
        panStartRef.current.startPanX + deltaX,
        panStartRef.current.startPanY + deltaY,
        zoomScale
      );
      setPanOffset(newOffset);
      return;
    }

    // Two-finger touch during move - handle pinch zoom AND pan
    if (e.touches && e.touches.length >= 2) {
      touchStartRef.current = null;

      const currentDistance = getTouchDistance(e.touches);
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      // Pinch zoom
      let newScale = zoomScale;
      if (pinchStartRef.current) {
        const scaleFactor = currentDistance / pinchStartRef.current.distance;
        newScale = Math.min(3, Math.max(1, pinchStartRef.current.scale * scaleFactor));
        setZoomScale(newScale);

        // Update reference for continuous zoom
        pinchStartRef.current.distance = currentDistance;
        pinchStartRef.current.scale = newScale;
      }

      // Two-finger pan (both fingers moving together) - with bounds
      if (twoFingerPanRef.current) {
        const deltaX = centerX - twoFingerPanRef.current.centerX;
        const deltaY = centerY - twoFingerPanRef.current.centerY;
        const newOffset = clampPanOffset(
          twoFingerPanRef.current.startPanX + deltaX,
          twoFingerPanRef.current.startPanY + deltaY,
          newScale
        );
        setPanOffset(newOffset);
      }
      return;
    }

    // Mouse movement detection - cancel click if moved too much
    if (mouseClickStart.current && !e.touches) {
      const { clientX, clientY } = getEventCoords(e);
      const deltaX = Math.abs(clientX - mouseClickStart.current.x);
      const deltaY = Math.abs(clientY - mouseClickStart.current.y);

      if (deltaX > 10 || deltaY > 10) {
        mouseClickStart.current.moved = true;
        if (mouseTimer.current) {
          clearTimeout(mouseTimer.current);
          mouseTimer.current = null;
        }
      }
    }
  }, [getEventCoords, getTouchDistance, clampPanOffset, zoomScale]);

  // Trigger shake animation for boundary feedback
  const triggerShake = useCallback(() => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 300);
  }, []);

  const handleImagePointerUp = useCallback((e) => {
    // Reset panning state
    if (isPanning.current) {
      isPanning.current = false;
      panStartRef.current = null;
      return;
    }

    // Reset pinch zoom and two-finger pan tracking
    pinchStartRef.current = null;
    twoFingerPanRef.current = null;

    // Clear long-press timer
    if (mouseTimer.current) {
      clearTimeout(mouseTimer.current);
      mouseTimer.current = null;
    }

    // Mouse click detection (desktop)
    if (mouseClickStart.current && !e.touches) {
      const clickData = mouseClickStart.current;
      mouseClickStart.current = null;

      // If not moved and quick release = click (vocabulary mode)
      if (!clickData.moved) {
        const deltaTime = Date.now() - clickData.time;
        if (deltaTime < 500) {
          // Short click - vocabulary mode
          handleWordTap(clickData.x, clickData.y, false);
        }
        // Long press is already handled by timer
      }
      return;
    }

    touchStartRef.current = null;
  }, [handleWordTap]);

  // Convert path points to SVG path string
  function pathToSvg(points) {
    if (!points || points.length < 2) return '';
    return points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
    ).join(' ');
  }

  // Get the display image (screenshot or original)
  function getDisplayImage() {
    const pages = getPages();
    if (pages && pages.length > 0) {
      return pages[currentPage];
    }
    if (source.screenshot) return source.screenshot;
    if (source.thumbnail) return source.thumbnail;
    if (source.type === 'image') return source.file_path;
    return null;
  }

  // Page navigation
  const handlePrevPage = useCallback(() => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  }, [currentPage]);

  const handleNextPage = useCallback(() => {
    const pages = getPages();
    if (pages && currentPage < pages.length - 1) {
      setCurrentPage(currentPage + 1);
    }
  }, [currentPage, source]);

  // Keyboard navigation + Spacebar for panning
  useEffect(() => {
    function handleKeyDown(e) {
      // Spacebar for pan mode
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        spacebarHeld.current = true;
        // Change cursor to grab
        if (imageContainerRef.current) {
          imageContainerRef.current.style.cursor = 'grab';
        }
        return;
      }

      const pages = getPages();
      if (!pages || pages.length <= 1) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleNextPage();
      }
    }

    function handleKeyUp(e) {
      if (e.code === 'Space') {
        spacebarHeld.current = false;
        isPanning.current = false;
        panStartRef.current = null;
        // Reset cursor
        if (imageContainerRef.current) {
          imageContainerRef.current.style.cursor = '';
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [currentPage, source, handlePrevPage, handleNextPage]);

  // Scroll wheel page navigation (for PDF/image pages)
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const pages = getPages();
    if (!pages || pages.length <= 1) return;

    const handleWheel = (e) => {
      e.preventDefault();

      if (e.deltaY > 0) {
        // Scroll down - next page
        if (currentPage < pages.length - 1) {
          handleNextPage();
        } else {
          triggerShake();
        }
      } else if (e.deltaY < 0) {
        // Scroll up - prev page
        if (currentPage > 0) {
          handlePrevPage();
        } else {
          triggerShake();
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [source, currentPage, handleNextPage, handlePrevPage, triggerShake]);

  // Auto-scroll mobile nav to active page
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

  // Reset zoom and pan when page changes
  useEffect(() => {
    setZoomScale(1);
    setZoomOrigin({ x: 50, y: 50 });
    setPanOffset({ x: 0, y: 0 });
  }, [currentPage]);

  // Scroll tracking for minimap viewport indicator + minimap sync
  useEffect(() => {
    const container = scrollContainerRef.current;
    const minimapContent = minimapRef.current?.querySelector('.minimap-content');
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const totalScrollable = scrollHeight - clientHeight;

      if (totalScrollable <= 0) {
        setViewportPosition({ top: 0, height: 100 });
        return;
      }

      const viewportHeightPercent = (clientHeight / scrollHeight) * 100;
      const topPercent = (scrollTop / scrollHeight) * 100;

      setViewportPosition({
        top: topPercent,
        height: viewportHeightPercent,
      });

      // Sync minimap scroll with main content
      if (minimapContent) {
        const minimapScrollable = minimapContent.scrollHeight - minimapContent.clientHeight;
        if (minimapScrollable > 0) {
          const scrollPercent = scrollTop / totalScrollable;
          minimapContent.scrollTop = scrollPercent * minimapScrollable;
        }
      }
    };

    // Initial calculation
    handleScroll();

    container.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', handleScroll);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [source, currentPage]);

  // Note: Boundary shake effect removed for single-page
  // Native scrolling with touch-action: pan-y handles overscroll feedback (rubber-band on iOS)

  // 터치 핸들링 - 단순화된 상태 머신
  // - 짧은 탭 (<500ms): 단어 검색
  // - 롱프레스 (>=500ms): 문법 검색
  // - 2손가락: pinch zoom + pan
  // - 스와이프: 페이지 이동
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const pages = getPages();
    const isMultiPage = pages && pages.length > 1;
    const LONG_PRESS_DURATION = 500;
    const TAP_MOVE_THRESHOLD = 10;
    const DOUBLE_TAP_DELAY = 300;
    const DOUBLE_TAP_DISTANCE = 50;

    const handleTouchStart = (e) => {
      const state = touchState.current;

      // 2손가락 → pinch zoom
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        singleFingerPanRef.current = null;
        handleImagePointerDown(e);
        return;
      }

      const touch = e.touches[0];

      // 확대 상태면 패닝 준비
      if (zoomScale > 1) {
        singleFingerPanRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          startPanX: panOffset.x,
          startPanY: panOffset.y,
        };
      }

      // 모달 열려있으면 탭 감지 안함
      if (activeModal.type === 'wordMenu') {
        return;
      }

      // 이전 타이머 정리 & 새 터치 시작
      if (state.timer) clearTimeout(state.timer);
      state.startTime = Date.now();
      state.startX = touch.clientX;
      state.startY = touch.clientY;
      state.moved = false;
      state.actionExecuted = false;

      // 롱프레스 타이머 (500ms)
      state.timer = setTimeout(() => {
        if (!state.moved) {
          state.actionExecuted = true;  // 먼저 플래그!
          state.timer = null;
          handleWordTap(state.startX, state.startY, true);
        }
      }, LONG_PRESS_DURATION);
    };

    const handleTouchMove = (e) => {
      const state = touchState.current;

      // 2손가락 → pinch zoom
      if (e.touches.length >= 2) {
        e.preventDefault();
        singleFingerPanRef.current = null;
        handleImagePointerMove(e);
        return;
      }

      const touch = e.touches[0];

      // 확대 상태 패닝
      if (zoomScale > 1 && singleFingerPanRef.current) {
        const deltaX = touch.clientX - singleFingerPanRef.current.startX;
        const deltaY = touch.clientY - singleFingerPanRef.current.startY;

        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          e.preventDefault();
          state.moved = true;
          if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
          }
          setPanOffset(clampPanOffset(
            singleFingerPanRef.current.startPanX + deltaX,
            singleFingerPanRef.current.startPanY + deltaY,
            zoomScale
          ));
          return;
        }
      }

      // 움직임 감지 → 탭/롱프레스 취소
      const deltaX = Math.abs(touch.clientX - state.startX);
      const deltaY = Math.abs(touch.clientY - state.startY);
      if (deltaX > TAP_MOVE_THRESHOLD || deltaY > TAP_MOVE_THRESHOLD) {
        state.moved = true;
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
      }
    };

    const handleTouchEnd = (e) => {
      const state = touchState.current;

      // 타이머 취소
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }

      // 2손가락 pinch 종료
      if (pinchStartRef.current || twoFingerPanRef.current) {
        pinchStartRef.current = null;
        twoFingerPanRef.current = null;
        return;
      }

      // 이미 롱프레스 실행됨 → 무시
      if (state.actionExecuted) {
        e.preventDefault(); // synthetic click 차단
        singleFingerPanRef.current = null;
        return;
      }

      // 움직임 없이 짧은 탭 (< 500ms)
      if (!state.moved) {
        const duration = Date.now() - state.startTime;

        if (duration < LONG_PRESS_DURATION) {
          const now = Date.now();

          // 더블탭 감지
          if (lastTapRef.current) {
            const timeSince = now - lastTapRef.current.time;
            const distX = Math.abs(state.startX - lastTapRef.current.x);
            const distY = Math.abs(state.startY - lastTapRef.current.y);

            if (timeSince < DOUBLE_TAP_DELAY && distX < DOUBLE_TAP_DISTANCE && distY < DOUBLE_TAP_DISTANCE) {
              lastTapRef.current = null;
              setZoomScale(1);
              setPanOffset({ x: 0, y: 0 });
              singleFingerPanRef.current = null;
              return;
            }
          }

          // 첫 탭 기록 & 딜레이 후 단일 탭 처리
          lastTapRef.current = { time: now, x: state.startX, y: state.startY };
          const tapX = state.startX;
          const tapY = state.startY;

          setTimeout(() => {
            if (lastTapRef.current && Date.now() - lastTapRef.current.time >= DOUBLE_TAP_DELAY) {
              handleWordTap(tapX, tapY, false);
              lastTapRef.current = null;
            }
          }, DOUBLE_TAP_DELAY);

          singleFingerPanRef.current = null;
          return;
        }
      }

      // 스와이프 감지 (움직임 있고, 확대 안된 상태)
      if (state.moved && isMultiPage && zoomScale <= 1) {
        const touch = e.changedTouches?.[0];
        if (touch) {
          const deltaY = touch.clientY - state.startY;
          const deltaTime = Date.now() - state.startTime;
          if (deltaTime < 300 && Math.abs(deltaY) > 50) {
            if (deltaY > 0 && currentPage > 0) {
              setCurrentPage(currentPage - 1);
            } else if (deltaY < 0 && currentPage < pages.length - 1) {
              setCurrentPage(currentPage + 1);
            } else {
              triggerShake();
            }
          }
        }
      }

      singleFingerPanRef.current = null;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      if (touchState.current.timer) {
        clearTimeout(touchState.current.timer);
      }
    };
  }, [source, currentPage, handleImagePointerDown, handleImagePointerMove, triggerShake, zoomScale, panOffset, clampPanOffset, activeModal, handleWordTap]);

  // Render vocabulary markers (shared helper)
  function renderVocabMarkers(vocabAnnotations) {
    return vocabAnnotations.map(annotation => {
      const selectionData = JSON.parse(annotation.selection_rect);
      const bounds = selectionData.bounds || selectionData;

      const padX = 0.3;
      const heightScale = 0.7;
      const x = Math.max(0, bounds.x - padX);
      const y = bounds.y + bounds.height * (1 - heightScale) / 2;
      const w = bounds.width + padX * 2;
      const h = bounds.height * heightScale;

      const isHighlighted = highlightedVocabId === annotation.id;
      return (
        <g key={`vocab-${annotation.id}`}>
          <rect
            x={`${x}%`} y={`${y}%`}
            width={`${w}%`} height={`${h}%`}
            rx="0.5" ry="0.5"
            className={`vocab-marker-bg${isHighlighted ? ' highlighted' : ''}`}
            style={{ pointerEvents: 'none' }}
          />
        </g>
      );
    });
  }

  // Render captured screenshot viewer
  function renderContent() {
    try {
      const displayImage = getDisplayImage();
      const pages = getPages();
      const hasPages = pages && pages.length > 1;

      console.log('[Viewer] renderContent:', {
        displayImage: displayImage?.substring?.(0, 50) || displayImage,
        sourceType: source?.type,
        sourceId: source?.id,
        pagesCount: pages?.length,
        currentPage,
        hasPages,
      });

    // For URL type with content, show article view
    if (source.type === 'url' && source.content) {
      return (
        <div className="article-viewer" ref={contentRef}>
          {/* OG Image as header */}
          {source.screenshot && (
            <div className="article-header-image">
              <img src={source.screenshot} alt={source.title} />
            </div>
          )}

          {/* Article content with vocabulary highlighting */}
          <div
            className="article-content"
            dangerouslySetInnerHTML={{ __html: highlightVocabularyWords(source.content) }}
          />

          {/* Open original link */}
          <a
            href={source.file_path}
            target="_blank"
            rel="noopener noreferrer"
            className="open-original-btn"
          >
            <TranslatableText textKey="viewer.openOriginal">Open Original</TranslatableText>
          </a>
        </div>
      );
    }

    // If we have a captured screenshot, show it
    if (displayImage) {
      // PDF/Image with multiple pages - show page thumbnails on left
      if (hasPages) {
        return (
          <div className="screenshot-viewer with-sidebar">
            {/* Left Page Thumbnail Sidebar */}
            <div className="page-sidebar">
              <div className="page-sidebar-scroll">
                {pages.map((pageImg, index) => (
                  <div
                    key={index}
                    className={`page-thumbnail ${currentPage === index ? 'active' : ''}`}
                    onClick={() => setCurrentPage(index)}
                  >
                    <img src={pageImg} alt={`Page ${index + 1}`} />
                    <span className="page-number">{index + 1}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Main Content */}
            <div className="screenshot-main">
              <div
                ref={imageContainerRef}
                className={`screenshot-container multi-page${isShaking ? ' shake' : ''}${zoomScale > 1 ? ' zoomed' : ''}`}
                onMouseDown={handleImagePointerDown}
                onMouseMove={handleImagePointerMove}
                onMouseUp={handleImagePointerUp}
                onAuxClick={(e) => e.preventDefault()}
              >
                <div
                  ref={zoomWrapperRef}
                  className="zoom-wrapper"
                  style={{
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                    transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`
                  }}
                >
                <img
                  src={displayImage}
                  alt={source.title}
                  className="screenshot-image"
                  draggable={false}
                />

                {/* SVG overlay for annotation markers */}
                <svg className="highlighter-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {/* Regular annotations (non-vocabulary, non-grammar) */}
                  {annotations
                    .filter(a => {
                      if (!a.selection_rect) return false;
                      const isVocab = isVocabularyAnnotation(a);
                      const isGrammar = isGrammarAnnotation(a);
                      if (isVocab) return false; // Skip vocabulary
                      if (isGrammar) return false; // Skip grammar (rendered separately)
                      const data = JSON.parse(a.selection_rect);
                      return data.page === currentPage;
                    })
                    .map(annotation => {
                      const data = JSON.parse(annotation.selection_rect);
                      if (data.path) {
                        const bounds = data.bounds || { x: 50, y: 50 };
                        return (
                          <path
                            key={annotation.id}
                            d={pathToSvg(data.path)}
                            className="highlighter-stroke saved"
                          />
                        );
                      }
                      return (
                        <rect
                          key={annotation.id}
                          x={data.x} y={data.y} width={data.width} height={data.height}
                          className="highlighter-rect saved"
                        />
                      );
                    })}
                  {/* Vocabulary markers (green shadow + rounded) */}
                  {renderVocabMarkers(getVocabularyAnnotations(currentPage))}
                  {/* Grammar pattern arcs */}
                  {(() => {
                    const grammarAnns = getGrammarAnnotations(currentPage);
                    return grammarAnns.map(annotation => {
                      try {
                        const analysisData = JSON.parse(annotation.ai_analysis_json);
                        return analysisData.patterns?.map((_, idx) =>
                          <GrammarPatternRenderer
                            key={`${annotation.id}-${idx}`}
                            annotation={annotation}
                            patternIdx={idx}
                            imageContainerRef={imageContainerRef}
                            openModal={openModal}
                          />
                        );
                      } catch (err) {
                        console.error('Grammar parse error:', err);
                        return null;
                      }
                    });
                  })()}
                  {/* Active selection highlight - 줄별 하이라이트 */}
                  {activeModal.type === 'wordMenu' && activeModal.data.sentenceWords && activeModal.data.sentenceWords.length > 0 ? (
                    // 문장 모드: 줄별로 하이라이트 (처음~끝 단어)
                    (() => {
                      const words = activeModal.data.sentenceWords;
                      const lines = [];
                      let currentLine = [words[0]];

                      for (let i = 1; i < words.length; i++) {
                        const prev = currentLine[currentLine.length - 1];
                        const curr = words[i];
                        const avgHeight = (prev.bbox.height + curr.bbox.height) / 2;

                        // Y 차이가 높이의 50% 이상이면 새 줄
                        if (Math.abs(curr.bbox.y - prev.bbox.y) > avgHeight * 0.5) {
                          lines.push(currentLine);
                          currentLine = [curr];
                        } else {
                          currentLine.push(curr);
                        }
                      }
                      lines.push(currentLine);

                      return lines.map((lineWords, i) => {
                        const minX = Math.min(...lineWords.map(w => w.bbox.x));
                        const maxX = Math.max(...lineWords.map(w => w.bbox.x + w.bbox.width));
                        const minY = Math.min(...lineWords.map(w => w.bbox.y));
                        const maxY = Math.max(...lineWords.map(w => w.bbox.y + w.bbox.height));

                        return (
                          <rect
                            key={`sel-line-${i}`}
                            x={`${minX}%`}
                            y={`${minY}%`}
                            width={`${maxX - minX}%`}
                            height={`${maxY - minY}%`}
                            className="selection-highlight"
                          />
                        );
                      });
                    })()
                  ) : activeModal.type === 'wordMenu' && activeModal.data.wordBbox && (
                    // 단어 모드: 단일 하이라이트
                    <rect
                      x={`${activeModal.data.wordBbox.x}%`}
                      y={`${activeModal.data.wordBbox.y}%`}
                      width={`${activeModal.data.wordBbox.width}%`}
                      height={`${activeModal.data.wordBbox.height}%`}
                      className="selection-highlight"
                    />
                  )}
                  {/* Grammar tooltip active - 문장 파란 배경 깜빡임 */}
                  {activeModal.type === 'grammarTooltip' && activeModal.data.annotation && (() => {
                    try {
                      const selData = JSON.parse(activeModal.data.annotation.selection_rect);
                      const gLines = selData.lines;
                      const gBounds = selData.bounds || selData;

                      if (gLines && gLines.length > 0) {
                        return gLines.map((line, i) => (
                          <rect
                            key={`grammar-hl-${i}`}
                            x={`${line.x}%`}
                            y={`${line.y}%`}
                            width={`${line.width}%`}
                            height={`${line.height}%`}
                            className="selection-highlight"
                          />
                        ));
                      } else if (gBounds) {
                        return (
                          <rect
                            x={`${gBounds.x}%`}
                            y={`${gBounds.y}%`}
                            width={`${gBounds.width}%`}
                            height={`${gBounds.height}%`}
                            className="selection-highlight"
                          />
                        );
                      }
                    } catch {
                      return null;
                    }
                    return null;
                  })()}
                </svg>

                {/* Pen Canvas for drawing */}
                <PenCanvas
                  containerRef={zoomWrapperRef}
                  penModeActive={penModeActive}
                  penColor={penColor}
                  strokeWidth={penStrokeWidth}
                  currentPage={currentPage}
                  zoomScale={zoomScale}
                  panOffset={panOffset}
                  strokes={penStrokes}
                  onStrokeComplete={addPenStroke}
                  onStrokesDelete={removePenStrokes}
                />
                </div>
              </div>

              <div className="page-indicator-bottom">
                {currentPage + 1} / {pages.length}
              </div>

              {/* Mobile bottom thumbnail navigation */}
              <div className="page-nav-mobile">
                <div className="page-nav-mobile-scroll" ref={mobileNavRef}>
                  {pages.map((pageImg, index) => (
                    <div
                      key={index}
                      className={`page-nav-mobile-thumb ${currentPage === index ? 'active' : ''}`}
                      onClick={() => setCurrentPage(index)}
                    >
                      <img src={pageImg} alt={`Page ${index + 1}`} />
                      <span className="page-nav-number">{index + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {source.type === 'pdf' && (
              <a href={source.file_path} target="_blank" rel="noopener noreferrer" className="open-original-btn floating">
                <TranslatableText textKey="viewer.openPdf">Open PDF</TranslatableText>
              </a>
            )}
          </div>
        );
      }

      // Regular image (from gallery) - simple view without minimap
      if (source.type === 'image') {
        return (
          <div className="screenshot-viewer single-image">
            <div className="screenshot-main">
              <div
                ref={imageContainerRef}
                className={`screenshot-container${isShaking ? ' shake' : ''}${zoomScale > 1 ? ' zoomed' : ''}`}
                onMouseDown={handleImagePointerDown}
                onMouseMove={handleImagePointerMove}
                onMouseUp={handleImagePointerUp}
                onAuxClick={(e) => e.preventDefault()}
              >
                <div
                  ref={zoomWrapperRef}
                  className="zoom-wrapper"
                  style={{
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                    transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`
                  }}
                >
                <img
                  src={displayImage}
                  alt={source.title}
                  className="screenshot-image"
                  draggable={false}
                />

                <svg className="highlighter-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {/* Vocabulary markers */}
                  {renderVocabMarkers(getVocabularyAnnotations())}
                  {/* Grammar patterns */}
                  {getGrammarAnnotations().map(annotation => {
                    try {
                      const analysisData = JSON.parse(annotation.ai_analysis_json);
                      return analysisData.patterns?.map((_, idx) =>
                        <GrammarPatternRenderer
                            key={`${annotation.id}-${idx}`}
                            annotation={annotation}
                            patternIdx={idx}
                            imageContainerRef={imageContainerRef}
                            openModal={openModal}
                          />
                      );
                    } catch (err) {
                      return null;
                    }
                  })}
                  {/* Active selection highlight */}
                  {activeModal.type === 'wordMenu' && activeModal.data.wordBbox && (
                    <rect
                      x={`${activeModal.data.wordBbox.x}%`}
                      y={`${activeModal.data.wordBbox.y}%`}
                      width={`${activeModal.data.wordBbox.width}%`}
                      height={`${activeModal.data.wordBbox.height}%`}
                      className="selection-highlight"
                    />
                  )}
                </svg>

                {/* Pen Canvas for drawing */}
                <PenCanvas
                  containerRef={zoomWrapperRef}
                  penModeActive={penModeActive}
                  penColor={penColor}
                  strokeWidth={penStrokeWidth}
                  currentPage={currentPage}
                  zoomScale={zoomScale}
                  panOffset={panOffset}
                  strokes={penStrokes}
                  onStrokeComplete={addPenStroke}
                  onStrokesDelete={removePenStrokes}
                />
                </div>
              </div>
            </div>
          </div>
        );
      }

      // URL screenshot (single long image) - show minimap with viewport indicator
      return (
        <div className="screenshot-viewer with-minimap">
          {/* Left Minimap Navigation - supports drag */}
          <div
            className="minimap-sidebar"
            ref={minimapRef}
            onMouseDown={handleMinimapMouseDown}
            onMouseMove={handleMinimapMouseMove}
            onMouseUp={handleMinimapMouseUp}
            onMouseLeave={handleMinimapMouseUp}
            onTouchStart={handleMinimapTouchStart}
            onTouchMove={handleMinimapTouchMove}
            onTouchEnd={handleMinimapTouchEnd}
          >
            <div className="minimap-content">
              <div className="minimap-image-wrapper">
                <img src={displayImage} alt="Minimap" className="minimap-image" draggable={false} />
                <div
                  className="minimap-viewport"
                  style={{
                    top: `${viewportPosition.top}%`,
                    height: `${viewportPosition.height}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Right Scrollable Content Area */}
          <div className="screenshot-main">
            <div ref={scrollContainerRef} className="screenshot-scroll-container">
              <div
                ref={imageContainerRef}
                className={`screenshot-container${isShaking ? ' shake' : ''}${zoomScale > 1 ? ' zoomed' : ''}`}
                onMouseDown={handleImagePointerDown}
                onMouseMove={handleImagePointerMove}
                onMouseUp={handleImagePointerUp}
                onAuxClick={(e) => e.preventDefault()}
              >
                <div
                  ref={zoomWrapperRef}
                  className="zoom-wrapper"
                  style={{
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                    transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`
                  }}
                >
                <img
                  src={displayImage}
                  alt={source.title}
                  className="screenshot-image"
                  draggable={false}
                />

                <svg className="highlighter-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {/* Regular annotations (non-vocabulary, non-grammar) */}
                  {annotations
                    .filter(a => {
                      if (!a.selection_rect) return false;
                      const isVocab = isVocabularyAnnotation(a);
                      const isGrammar = isGrammarAnnotation(a);
                      return !isVocab && !isGrammar;
                    })
                    .map(annotation => {
                      const data = JSON.parse(annotation.selection_rect);
                      if (data.path) {
                        const bounds = data.bounds || { x: 50, y: 50 };
                        return (
                          <path
                            key={annotation.id}
                            d={pathToSvg(data.path)}
                            className="highlighter-stroke saved"
                          />
                        );
                      }
                      return (
                        <rect
                          key={annotation.id}
                          x={data.x} y={data.y} width={data.width} height={data.height}
                          className="highlighter-rect saved"
                        />
                      );
                    })}
                  {/* Vocabulary markers (green shadow + rounded) */}
                  {renderVocabMarkers(getVocabularyAnnotations())}
                  {/* Grammar pattern arcs */}
                  {(() => {
                    const grammarAnns = getGrammarAnnotations();
                    console.log('[URL Screenshot] Grammar annotations:', grammarAnns.length, grammarAnns.map(a => a.id));
                    return grammarAnns.map(annotation => {
                      try {
                        const analysisData = JSON.parse(annotation.ai_analysis_json);
                        console.log('[URL Screenshot] Annotation', annotation.id, 'has', analysisData.patterns?.length, 'patterns');
                        return analysisData.patterns?.map((_, idx) =>
                          <GrammarPatternRenderer
                            key={`${annotation.id}-${idx}`}
                            annotation={annotation}
                            patternIdx={idx}
                            imageContainerRef={imageContainerRef}
                            openModal={openModal}
                          />
                        );
                      } catch (err) {
                        console.error('Grammar parse error:', err);
                        return null;
                      }
                    });
                  })()}
                  {/* Active selection highlight - 줄별 하이라이트 */}
                  {activeModal.type === 'wordMenu' && activeModal.data.sentenceWords && activeModal.data.sentenceWords.length > 0 ? (
                    (() => {
                      const words = activeModal.data.sentenceWords;
                      const lines = [];
                      let currentLine = [words[0]];

                      for (let i = 1; i < words.length; i++) {
                        const prev = currentLine[currentLine.length - 1];
                        const curr = words[i];
                        const avgHeight = (prev.bbox.height + curr.bbox.height) / 2;

                        if (Math.abs(curr.bbox.y - prev.bbox.y) > avgHeight * 0.5) {
                          lines.push(currentLine);
                          currentLine = [curr];
                        } else {
                          currentLine.push(curr);
                        }
                      }
                      lines.push(currentLine);

                      return lines.map((lineWords, i) => {
                        const minX = Math.min(...lineWords.map(w => w.bbox.x));
                        const maxX = Math.max(...lineWords.map(w => w.bbox.x + w.bbox.width));
                        const minY = Math.min(...lineWords.map(w => w.bbox.y));
                        const maxY = Math.max(...lineWords.map(w => w.bbox.y + w.bbox.height));

                        return (
                          <rect
                            key={`sel-line-${i}`}
                            x={`${minX}%`}
                            y={`${minY}%`}
                            width={`${maxX - minX}%`}
                            height={`${maxY - minY}%`}
                            className="selection-highlight"
                          />
                        );
                      });
                    })()
                  ) : activeModal.type === 'wordMenu' && activeModal.data.wordBbox && (
                    <rect
                      x={`${activeModal.data.wordBbox.x}%`}
                      y={`${activeModal.data.wordBbox.y}%`}
                      width={`${activeModal.data.wordBbox.width}%`}
                      height={`${activeModal.data.wordBbox.height}%`}
                      className="selection-highlight"
                    />
                  )}
                  {/* Grammar tooltip active - 문장 파란 배경 깜빡임 */}
                  {activeModal.type === 'grammarTooltip' && activeModal.data.annotation && (() => {
                    try {
                      const selData = JSON.parse(activeModal.data.annotation.selection_rect);
                      const gLines = selData.lines;
                      const gBounds = selData.bounds || selData;

                      if (gLines && gLines.length > 0) {
                        return gLines.map((line, i) => (
                          <rect
                            key={`grammar-hl-${i}`}
                            x={`${line.x}%`}
                            y={`${line.y}%`}
                            width={`${line.width}%`}
                            height={`${line.height}%`}
                            className="selection-highlight"
                          />
                        ));
                      } else if (gBounds) {
                        return (
                          <rect
                            x={`${gBounds.x}%`}
                            y={`${gBounds.y}%`}
                            width={`${gBounds.width}%`}
                            height={`${gBounds.height}%`}
                            className="selection-highlight"
                          />
                        );
                      }
                    } catch {
                      return null;
                    }
                    return null;
                  })()}
                </svg>

                {/* Pen Canvas for drawing */}
                <PenCanvas
                  containerRef={zoomWrapperRef}
                  penModeActive={penModeActive}
                  penColor={penColor}
                  strokeWidth={penStrokeWidth}
                  currentPage={currentPage}
                  zoomScale={zoomScale}
                  panOffset={panOffset}
                  strokes={penStrokes}
                  onStrokeComplete={addPenStroke}
                  onStrokesDelete={removePenStrokes}
                />
                </div>
              </div>
            </div>
          </div>

          <a href={source.file_path} target="_blank" rel="noopener noreferrer" className="open-original-btn floating">
            <TranslatableText textKey="viewer.openOriginal">Open Original</TranslatableText>
          </a>
        </div>
      );
    }

    // Fallback: no screenshot available yet
    return (
      <div className="no-screenshot">
        <div className="no-screenshot-placeholder">
          <span className="placeholder-letter">{source.type.charAt(0).toUpperCase()}</span>
        </div>
        <p className="no-screenshot-text">
          <TranslatableText textKey="viewer.noScreenshot">Screenshot not available</TranslatableText>
        </p>
        {source.file_path && (
          <a
            href={source.file_path}
            target="_blank"
            rel="noopener noreferrer"
            className="open-original-btn"
          >
            <TranslatableText textKey="viewer.openOriginal">Open Original</TranslatableText>
          </a>
        )}
      </div>
    );
    } catch (err) {
      console.error('[Viewer] renderContent error:', err);
      return (
        <div className="no-screenshot">
          <p style={{ color: '#ff6b6b' }}>이미지를 불러올 수 없습니다</p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '16px', padding: '8px 16px', borderRadius: '8px', background: '#0A84FF', color: '#fff', border: 'none' }}
          >
            새로고침
          </button>
        </div>
      );
    }
  }

  if (loading) {
    return (
      <div className="viewer-screen">
        <div className="viewer-loading">
          <div className="spinner" />
          <p><TranslatableText textKey="viewer.loading">Loading...</TranslatableText></p>
        </div>
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className="viewer-screen">
        <div className="viewer-error">
          <p>{error || <TranslatableText textKey="viewer.sourceNotFound">Source not found</TranslatableText>}</p>
          <button onClick={() => navigate('/')}>
            <TranslatableText textKey="viewer.goHome">Go Home</TranslatableText>
          </button>
        </div>
      </div>
    );
  }

  async function handleDeleteSource() {
    setDeleting(true);
    try {
      await deleteSource(id);
      navigate('/');
    } catch (err) {
      console.error('Failed to delete source:', err);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  const pages = getPages();
  const hasPages = pages && pages.length > 1;

  return (
    <div className="viewer-screen">
      <header className="viewer-header">
        <button
          className="back-button"
          onClick={() => navigate('/')}
        >
          <TranslatableText textKey="nav.back">Back</TranslatableText>
        </button>
        <h1 className="viewer-title">{source.title}</h1>
        <div className="viewer-actions">
          <span className="source-type-badge">
            {source.type.toUpperCase()}
            {hasPages && ` • ${pages.length}p`}
          </span>
          <button
            className="viewer-delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <TranslatableText textKey="common.delete">Delete</TranslatableText>
          </button>
        </div>
      </header>

      <main className="viewer-content">
        {renderContent()}

        {/* Memo markers displayed as floating indicators */}
        {annotations
          .filter((a) => a.type === 'memo')
          .map((memo, index) => (
            <div
              key={memo.id}
              className="memo-marker"
              style={{ top: `${100 + index * 40}px` }}
              title={memo.memo_content}
            >
              M
            </div>
          ))}
      </main>

      {/* Pen Mode Toggle Button - temporarily hidden */}
      {/* <PenModeToggle
        isActive={penModeActive}
        onToggle={() => setPenModeActive(!penModeActive)}
        onLongPress={() => setShowColorPalette(true)}
        penColor={penColor}
      />

      <ColorPalette
        isOpen={showColorPalette}
        selectedColor={penColor}
        onColorSelect={setPenColor}
        strokeWidth={penStrokeWidth}
        onStrokeWidthChange={setPenStrokeWidth}
        onClose={() => setShowColorPalette(false)}
      /> */}

      {/* Vocabulary floating button - 이 소스의 모든 단어 표시 */}
      {(() => {
        const allVocab = getVocabularyAnnotations(); // 페이지 필터 없이 전체
        if (allVocab.length === 0) return null;
        return (
          <button
            className="vocab-float-btn"
            onClick={() => setShowVocabPanel(!showVocabPanel)}
          >
            {allVocab.length}
          </button>
        );
      })()}

      {/* Vocabulary Panel - 이 소스의 모든 단어 표시 */}
      {showVocabPanel && (
        <div className="vocab-panel-overlay" onClick={() => setShowVocabPanel(false)}>
          <div className="vocab-panel" onClick={(e) => e.stopPropagation()}>
            <div className="vocab-panel-header">
              <h3>저장한 단어 ({getVocabularyAnnotations().length})</h3>
              <button onClick={() => setShowVocabPanel(false)}>×</button>
            </div>
            <div className="vocab-panel-list">
              {getVocabularyAnnotations().map((item) => {
                const definition = item.ai_analysis_json
                  ? JSON.parse(item.ai_analysis_json).definition || ''
                  : '';
                // 페이지 번호 추출
                let pageNum = 0;
                try {
                  const selData = JSON.parse(item.selection_rect || '{}');
                  pageNum = selData.page || 0;
                } catch { /* ignore */ }

                return (
                  <div
                    key={item.id}
                    className="vocab-item"
                    onClick={() => {
                      // 해당 페이지로 이동 & 파란 글로우 효과
                      try {
                        const selData = JSON.parse(item.selection_rect || '{}');
                        const targetPage = selData.page || 0;

                        // 페이지 이동
                        if (targetPage !== currentPage) {
                          setCurrentPage(targetPage);
                        }

                        // 다른 깜빡임 효과 중지 (한 번에 하나만 깜빡이도록)
                        closeModal();

                        // 하이라이트 효과 (5초)
                        if (highlightTimer.current) {
                          clearTimeout(highlightTimer.current);
                        }
                        setHighlightedVocabId(item.id);
                        highlightTimer.current = setTimeout(() => {
                          setHighlightedVocabId(null);
                        }, 5000);

                        // 스크롤 (페이지 변경 후 약간 딜레이)
                        setTimeout(() => {
                          const bounds = selData.bounds || selData;
                          if (scrollContainerRef.current && bounds) {
                            const scrollY = (bounds.y / 100) * scrollContainerRef.current.scrollHeight - 100;
                            scrollContainerRef.current.scrollTo({ top: Math.max(0, scrollY), behavior: 'smooth' });
                          }
                        }, targetPage !== currentPage ? 100 : 0);
                      } catch {
                        // ignore
                      }
                      setShowVocabPanel(false);
                    }}
                  >
                    <span className="vocab-word">{item.selected_text}</span>
                    <span className="vocab-page">p.{pageNum + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}


      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3><TranslatableText textKey="source.deleteTitle">Delete Source</TranslatableText></h3>
            <p><TranslatableText textKey="source.deleteMessage">Are you sure you want to delete this source? This action cannot be undone.</TranslatableText></p>
            <div className="delete-modal-actions">
              <button
                className="cancel-btn"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                <TranslatableText textKey="common.cancel">Cancel</TranslatableText>
              </button>
              <button
                className="confirm-delete-btn"
                onClick={handleDeleteSource}
                disabled={deleting}
              >
                {deleting ? '...' : <TranslatableText textKey="common.delete">Delete</TranslatableText>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vocabulary Delete Confirmation */}
      {activeModal.type === 'vocabDeleteConfirm' && activeModal.data.annotation && (
        <div
          className="vocab-delete-confirm"
          style={{
            position: 'fixed',
            top: activeModal.data.position.y,
            left: activeModal.data.position.x,
            transform: 'translate(-50%, -50%)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="vocab-delete-content">
            <p>"{activeModal.data.annotation.selected_text}"</p>
            <p className="vocab-delete-question">삭제하시겠습니까?</p>
            <div className="vocab-delete-actions">
              <button
                className="cancel-btn"
                onClick={closeModal}
                disabled={deletingVocab}
              >
                Cancel
              </button>
              <button
                className="delete-btn"
                onClick={handleDeleteVocabAnnotation}
                disabled={deletingVocab}
              >
                {deletingVocab ? '...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Word Quick Menu (tap/long-press) */}
      <WordQuickMenu
        isOpen={activeModal.type === 'wordMenu'}
        position={activeModal.data.position || { x: 0, y: 0 }}
        placement={activeModal.data.placement || 'below'}
        word={activeModal.data.word || ''}
        wordBbox={activeModal.data.wordBbox || null}
        sentenceWords={activeModal.data.sentenceWords || null}
        sourceId={id}
        currentPage={currentPage}
        existingAnnotation={activeModal.data.existingAnnotation || null}
        isGrammarMode={activeModal.data.isGrammarMode || false}
        containerRef={zoomWrapperRef}
        zoomScale={zoomScale}
        panOffset={panOffset}
        onClose={closeWordMenu}
        onSaved={handleWordMenuSaved}
        onDeleted={handleWordMenuDelete}
      />
    </div>
  );
}
