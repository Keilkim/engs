import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { deleteSource } from '../../services/source';
import { deleteAnnotation } from '../../services/annotation';
import WordQuickMenu from '../../components/modals/WordQuickMenu';
import ChatPanel from '../../components/ChatPanel';
import { TranslatableText } from '../../components/translatable';
import { PenModeToggle, ColorPalette, usePenStrokes } from '../../components/pen-mode';
import { useChat } from '../../hooks';
import { extractOcrText } from '../../services/ai/chat';
import { useSourceData, useOcrWords, useSentenceFinder, useMinimap, useAnnotationHelpers, useModalState, useVocabularyPanel, usePageNavigation, useDesktopGestures, useTouchStateMachine } from './hooks';
import { ImageContentView, VocabPanel } from './components';
import { getMobileSafeAreaBottom } from '../../utils/positioning';

export default function Viewer() {
  const { id } = useParams();
  const navigate = useNavigate();

  // Source data (from custom hook)
  const {
    source, annotations, vocabulary, loading, error,
    loadData, refreshAnnotations, getPages,
    setSource, setAnnotations,
  } = useSourceData(id);

  // Chat integration
  const sourceContext = source ? extractOcrText(source) : '';
  const chatHook = useChat({ sourceId: id, sourceContext, topicTitle: source?.title || '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const contentRef = useRef(null);
  const imageContainerRef = useRef(null);
  const zoomWrapperRef = useRef(null); // For accurate coordinate calculation when zoomed
  const touchStartRef = useRef(null); // For swipe detection
  const [isShaking, setIsShaking] = useState(false); // Boundary shake effect
  const [zoomScale, setZoomScale] = useState(1); // Pinch zoom scale
  // zoomOrigin fixed at (0,0) - pan handles zoom point instead
const zoomOrigin = { x: 0, y: 0 };
  const pinchStartRef = useRef(null); // For pinch zoom tracking
  const scrollContainerRef = useRef(null); // For scroll tracking

  // Page navigation (from custom hook)
  const pages = getPages();
  const totalPages = pages ? pages.length : 0;
  const {
    currentPage, setCurrentPage,
    handlePrevPage, handleNextPage,
    mobileNavRef,
  } = usePageNavigation(totalPages);

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

  // Sidebar toggle state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Pen mode state
  const [penModeActive, setPenModeActive] = useState(false);
  const [penColor, setPenColor] = useState('#0A84FF');
  const [penStrokeWidth, setPenStrokeWidth] = useState(1);
  const [showColorPalette, setShowColorPalette] = useState(false);
  const { strokes: penStrokes, addStroke: addPenStroke, removeStrokes: removePenStrokes } = usePenStrokes(id);

  // Note: Drawing mode removed - using tap/long-press for word selection instead

  // Centralized modal state (from custom hook)
  const {
    activeModal,
    highlightedVocabId,
    openModal,
    closeModal,
    highlightVocab,
  } = useModalState();

  // Vocabulary panel state (from custom hook)
  const {
    showVocabPanel, setShowVocabPanel,
    deletingVocab, setDeletingVocab,
    showVocabWord,
    highlightVocabularyWords,
  } = useVocabularyPanel(openModal, vocabulary);

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
  const menuJustClosed = useRef(false); // Prevent new lookup when closing menu

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
    setCurrentPage(0);
    loadData(source);
  }, [id]);


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




  function handleHighlightClick(e) {
    e.stopPropagation();
    // Pen mode disabled - no action needed
  }


  // Handle word tap (short tap = vocabulary, long press = grammar/sentence)
  const handleWordTap = useCallback((clientX, clientY, isLongPress = false) => {
    console.log(`[handleWordTap] ${isLongPress ? 'LONG PRESS' : 'SHORT TAP'} at (${clientX}, ${clientY})`);

    // 메뉴가 방금 닫혔으면 새 검색 방지
    if (menuJustClosed.current) {
      return;
    }

    // 모달이 열려있으면 닫기만 하고 return
    if (activeModal.type === 'wordMenu' || activeModal.type === 'grammarTooltip') {
      closeModal();
      menuJustClosed.current = true;
      setTimeout(() => { menuJustClosed.current = false; }, 400);
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
        try {
          const selectionData = JSON.parse(existingAnnotation.selection_rect);
          const bounds = selectionData.bounds || selectionData;

          // bounds(%)로 위치 계산
          const markerTopPx = rect.top + bounds.y * rect.height / 100;
          const markerBottomPx = rect.top + (bounds.y + bounds.height) * rect.height / 100;

          // 위/아래 공간 비교하여 placement 결정
          const viewportHeight = window.innerHeight;
          const safeAreaBottom = getMobileSafeAreaBottom();
          const spaceAbove = markerTopPx;
          const spaceBelow = viewportHeight - markerBottomPx - safeAreaBottom;
          const placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

          const posX = clientX;
          const posY = placement === 'below'
            ? Math.min(markerBottomPx + 12, viewportHeight - safeAreaBottom - 50)
            : Math.max(markerTopPx - 12, 50);

          openModal('wordMenu', {
            word: existingAnnotation.selected_text,
            existingAnnotation,
            isGrammarMode: false,
            position: { x: posX, y: posY },
            placement,
            wordBbox: bounds, // 줌/팬 시 동적 위치 업데이트용
          });
          return;
        } catch {
          // fallback: 기존 방식
          const definition = existingAnnotation.ai_analysis_json
            ? JSON.parse(existingAnnotation.ai_analysis_json).definition || ''
            : '';
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
    menuJustClosed.current = true;
    setTimeout(() => { menuJustClosed.current = false; }, 400);
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

  // Desktop gesture handlers (from custom hook)
  const {
    handleImagePointerDown,
    handleImagePointerMove,
    handleImagePointerUp,
    clampPanOffset,
    triggerShake: _triggerShake,
  } = useDesktopGestures({
    imageContainerRef,
    zoomScale, setZoomScale,
    panOffset, setPanOffset,
    handleWordTap,
    isPanning, spacebarHeld, panStartRef,
    pinchStartRef, twoFingerPanRef, touchStartRef,
  });

  const triggerShake = useCallback(() => _triggerShake(setIsShaking), [_triggerShake]);

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

  // Wheel handler: trackpad pinch zoom + page navigation (combined to prevent conflicts)
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const pages = getPages();
    const isMultiPage = pages && pages.length > 1;
    let lastPinchTime = 0;

    const handleWheel = (e) => {
      // Trackpad pinch (ctrlKey) → zoom
      if (e.ctrlKey) {
        e.preventDefault();
        lastPinchTime = Date.now();

        const delta = -e.deltaY * 0.01;
        const newScale = Math.min(6, Math.max(1, zoomScale * (1 + delta)));
        if (newScale === zoomScale) return;

        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const imageX = (cx - panOffset.x) / zoomScale;
        const imageY = (cy - panOffset.y) / zoomScale;

        setZoomScale(newScale);
        setPanOffset(clampPanOffset(cx - imageX * newScale, cy - imageY * newScale, newScale));
        return;
      }

      // Page navigation (multi-page only)
      if (!isMultiPage) return;

      // Block page nav when zoomed or within cooldown after pinch
      if (zoomScale > 1 || Date.now() - lastPinchTime < 300) {
        e.preventDefault();
        return;
      }

      e.preventDefault();

      if (e.deltaY > 0) {
        if (currentPage < pages.length - 1) {
          handleNextPage();
        } else {
          triggerShake();
        }
      } else if (e.deltaY < 0) {
        if (currentPage > 0) {
          handlePrevPage();
        } else {
          triggerShake();
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [source, currentPage, handleNextPage, handlePrevPage, triggerShake, zoomScale, panOffset, clampPanOffset, setZoomScale, setPanOffset]);

  // Reset zoom and pan when page changes
  useEffect(() => {
    setZoomScale(1);
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

  // Touch state machine (from custom hook)
  useTouchStateMachine({
    imageContainerRef,
    zoomScale, setZoomScale,
    panOffset, setPanOffset,
    clampPanOffset,
    activeModal,
    handleWordTap,
    handleImagePointerDown,
    handleImagePointerMove,
    singleFingerPanRef,
    pinchStartRef,
    twoFingerPanRef,
    triggerShake,
    getPages, currentPage, setCurrentPage,
  });



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
          {source.file_path && (
            <a
              href={source.file_path}
              target="_blank"
              rel="noopener noreferrer"
              className="viewer-open-original-btn"
            >
              <TranslatableText textKey="viewer.openOriginal">Open Original</TranslatableText>
            </a>
          )}
          <button
            className="viewer-delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <TranslatableText textKey="common.delete">Delete</TranslatableText>
          </button>
        </div>
      </header>

      <main className="viewer-content">
        <ImageContentView
          source={source}
          annotations={annotations}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          imageContainerRef={imageContainerRef}
          zoomWrapperRef={zoomWrapperRef}
          scrollContainerRef={scrollContainerRef}
          contentRef={contentRef}
          mobileNavRef={mobileNavRef}
          zoomScale={zoomScale}
          zoomOrigin={zoomOrigin}
          panOffset={panOffset}
          isShaking={isShaking}
          handleImagePointerDown={handleImagePointerDown}
          handleImagePointerMove={handleImagePointerMove}
          handleImagePointerUp={handleImagePointerUp}
          penModeActive={penModeActive}
          penColor={penColor}
          penStrokeWidth={penStrokeWidth}
          penStrokes={penStrokes}
          onStrokeComplete={addPenStroke}
          onStrokesDelete={removePenStrokes}
          activeModal={activeModal}
          openModal={openModal}
          highlightedVocabId={highlightedVocabId}
          isVocabularyAnnotation={isVocabularyAnnotation}
          isGrammarAnnotation={isGrammarAnnotation}
          getVocabularyAnnotations={getVocabularyAnnotations}
          getGrammarAnnotations={getGrammarAnnotations}
          highlightVocabularyWords={highlightVocabularyWords}
          viewportPosition={viewportPosition}
          minimapRef={minimapRef}
          handleMinimapMouseDown={handleMinimapMouseDown}
          handleMinimapMouseMove={handleMinimapMouseMove}
          handleMinimapMouseUp={handleMinimapMouseUp}
          handleMinimapTouchStart={handleMinimapTouchStart}
          handleMinimapTouchMove={handleMinimapTouchMove}
          handleMinimapTouchEnd={handleMinimapTouchEnd}
          pages={pages}
          hasPages={hasPages}
          displayImage={getDisplayImage()}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
        />

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

      {zoomScale > 1 && (
        <button
          className="zoom-reset-btn"
          onClick={() => { setZoomScale(1); setPanOffset({ x: 0, y: 0 }); }}
        >
          1:1
        </button>
      )}

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

      <VocabPanel
        getVocabularyAnnotations={getVocabularyAnnotations}
        showVocabPanel={showVocabPanel}
        setShowVocabPanel={setShowVocabPanel}
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        closeModal={closeModal}
        highlightVocab={highlightVocab}
        scrollContainerRef={scrollContainerRef}
      />

      <ChatPanel chat={chatHook} sourceTitle={source?.title} />


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
            <p className="vocab-delete-question"><TranslatableText textKey="viewer.confirmDeleteVocab">Delete this word?</TranslatableText></p>
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
