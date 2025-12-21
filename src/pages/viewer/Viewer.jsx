import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSource, deleteSource } from '../../services/source';
import { getAnnotations, getVocabulary, deleteAnnotation } from '../../services/annotation';
import ContextMenu from '../../components/modals/ContextMenu';
import AnnotationPopover from '../../components/modals/AnnotationPopover';
import WordQuickMenu from '../../components/modals/WordQuickMenu';
import GrammarTooltip from '../../components/GrammarTooltip';
import { TranslatableText } from '../../components/translatable';
import { PenModeToggle, ColorPalette, PenCanvas, usePenStrokes } from '../../components/pen-mode';

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
  const mouseDownPos = useRef(null);
  const touchStartRef = useRef(null); // For swipe detection
  const [isShaking, setIsShaking] = useState(false); // Boundary shake effect
  const [zoomScale, setZoomScale] = useState(1); // Pinch zoom scale
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 }); // Zoom origin point (%)
  const pinchStartRef = useRef(null); // For pinch zoom tracking
  const mobileNavRef = useRef(null); // For auto-scrolling mobile nav
  const scrollContainerRef = useRef(null); // For scroll tracking
  const minimapRef = useRef(null); // For minimap viewport indicator
  const minimapDragging = useRef(false); // For minimap drag

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

  // Scroll tracking for minimap viewport indicator
  const [viewportPosition, setViewportPosition] = useState({ top: 0, height: 100 });

  // Pen mode state
  const [penModeActive, setPenModeActive] = useState(false);
  const [penColor, setPenColor] = useState('#0A84FF');
  const [penStrokeWidth, setPenStrokeWidth] = useState(1);
  const [showColorPalette, setShowColorPalette] = useState(false);
  const { strokes: penStrokes, addStroke: addPenStroke, removeStrokes: removePenStrokes } = usePenStrokes(id);

  // Note: Drawing mode removed - using tap/long-press for word selection instead

  // Centralized modal state - only one modal open at a time
  // Types: 'contextMenu' | 'annotationPopover' | 'vocabTooltip' | 'grammarTooltip' | 'vocabDeleteConfirm' | 'wordMenu' | null
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
  const vocabTooltipTimer = useRef(null);
  const [highlightedVocabId, setHighlightedVocabId] = useState(null); // 파란 글로우 효과용
  const highlightTimer = useRef(null);

  // 단어 삭제 상태
  const [deletingVocab, setDeletingVocab] = useState(false);

  // OCR word data from source (pre-computed on upload)
  const [ocrWords, setOcrWords] = useState([]); // Current page's words with bbox
  const [selectedWords, setSelectedWords] = useState([]); // Words selected by brush
  const wordTapTimer = useRef(null); // For long-press detection
  const wordTapStart = useRef(null); // { x, y, time, word, bbox }
  const menuJustOpened = useRef(false); // Prevent menu from closing immediately

  // Check if annotation is a vocabulary item
  function isVocabularyAnnotation(annotation) {
    if (!annotation.ai_analysis_json) return false;
    try {
      const data = JSON.parse(annotation.ai_analysis_json);
      return data.isVocabulary === true;
    } catch {
      return false;
    }
  }

  // Check if annotation is a grammar pattern
  function isGrammarAnnotation(annotation) {
    if (!annotation.ai_analysis_json) return false;
    try {
      const data = JSON.parse(annotation.ai_analysis_json);
      return data.type === 'grammar';
    } catch {
      return false;
    }
  }

  // Get vocabulary annotations for image (with selection_rect)
  function getVocabularyAnnotations(pageNum = null) {
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
  }

  // 단어 마킹 터치 핸들러는 이미지 레벨에서 통합 처리 - 제거됨

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
      // 첫 5개 단어의 좌표 출력
      if (pageData?.words?.length > 0) {
        console.log('[OCR] Sample words:', pageData.words.slice(0, 5).map(w => ({
          text: w.text,
          bbox: `x:${w.bbox.x.toFixed(1)}% y:${w.bbox.y.toFixed(1)}% w:${w.bbox.width.toFixed(1)}% h:${w.bbox.height.toFixed(1)}%`
        })));
      }
    } catch (err) {
      console.error('Failed to parse OCR data:', err);
      setOcrWords([]);
    }
  }, [source, currentPage]);

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
    setLoading(true);
    try {
      const [sourceData, annotationsData, vocabData] = await Promise.all([
        getSource(id),
        getAnnotations(id),
        getVocabulary(),
      ]);
      setSource(sourceData);
      setAnnotations(annotationsData || []);
      setVocabulary(vocabData || []);
      setCurrentPage(0); // Reset to first page on initial load
    } catch (err) {
      setError('Unable to load source');
      console.error(err);
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
    // Clear existing timer
    if (vocabTooltipTimer.current) {
      clearTimeout(vocabTooltipTimer.current);
    }

    // Calculate smart position based on available space
    let position = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let placement = 'below';

    if (markerRect) {
      const viewportHeight = window.innerHeight;
      const spaceAbove = markerRect.top;
      const spaceBelow = viewportHeight - markerRect.bottom;

      // Position below if there's enough space (200px) or more space than above
      placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

      // Center horizontally on the marker, clamp to screen edges
      const x = Math.min(
        Math.max(20, markerRect.left + markerRect.width / 2),
        window.innerWidth - 20
      );

      // Position above or below the marker
      const y = placement === 'below'
        ? markerRect.bottom + 12
        : markerRect.top - 12;

      position = { x, y };
    }

    openModal('vocabTooltip', { word, definition, position, placement, annotation });

    // Auto-hide는 annotation이 있으면 (삭제 가능한 상태) 비활성화
    if (!annotation) {
      vocabTooltipTimer.current = setTimeout(() => {
        closeModal();
      }, 5000);
    }
  }

  // Close vocabulary tooltip
  function closeVocabTooltip() {
    if (vocabTooltipTimer.current) {
      clearTimeout(vocabTooltipTimer.current);
    }
    closeModal();
  }

  // Delete vocabulary from tooltip
  async function handleDeleteVocabFromTooltip() {
    if (activeModal.type !== 'vocabTooltip' || !activeModal.data.annotation) return;
    try {
      await deleteAnnotation(activeModal.data.annotation.id);
      closeVocabTooltip();
      refreshAnnotations();
    } catch (err) {
      console.error('Failed to delete vocabulary:', err);
    }
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (vocabTooltipTimer.current) {
        clearTimeout(vocabTooltipTimer.current);
      }
    };
  }, []);

  function handleHighlightClick(e) {
    e.stopPropagation();
    const annotationId = e.target.getAttribute('data-id');
    const annotation = annotations.find((a) => a.id === annotationId);

    if (annotation) {
      const rect = e.target.getBoundingClientRect();
      openModal('annotationPopover', {
        position: {
          x: rect.left + rect.width / 2,
          y: rect.bottom + 10,
        },
        annotation,
      });
    }
  }

  const handleMouseDown = useCallback((e) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

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

  // Find the full sentence containing a word from OCR data
  // Uses target word's neighbor gaps to determine column/row boundaries
  const findSentenceFromWord = useCallback((targetWord) => {
    if (!ocrWords || ocrWords.length === 0 || !targetWord) return null;

    const targetY = targetWord.bbox.y;
    const targetHeight = targetWord.bbox.height;
    const targetX = targetWord.bbox.x;
    const targetRight = targetX + targetWord.bbox.width;
    const targetBottom = targetY + targetHeight;

    // === 1단계: 타겟 단어 기준 좌/우/위/아래 최소 간격 계산 ===
    let minLeftGap = Infinity;
    let minRightGap = Infinity;
    let minTopGap = Infinity;
    let minBottomGap = Infinity;

    for (const w of ocrWords) {
      if (w === targetWord) continue;
      const wRight = w.bbox.x + w.bbox.width;
      const wBottom = w.bbox.y + w.bbox.height;

      // 같은 줄에 있는 단어 (Y 겹침)
      const yOverlap = Math.min(targetBottom, wBottom) - Math.max(targetY, w.bbox.y);
      if (yOverlap > targetHeight * 0.3) {
        if (wRight <= targetX) {
          // 왼쪽 단어
          const gap = targetX - wRight;
          if (gap < minLeftGap) minLeftGap = gap;
        } else if (w.bbox.x >= targetRight) {
          // 오른쪽 단어
          const gap = w.bbox.x - targetRight;
          if (gap < minRightGap) minRightGap = gap;
        }
      }

      // 같은 컬럼에 있는 단어 (X 겹침)
      const xOverlap = Math.min(targetRight, wRight) - Math.max(targetX, w.bbox.x);
      if (xOverlap > targetWord.bbox.width * 0.3) {
        if (wBottom <= targetY) {
          // 위쪽 단어
          const gap = targetY - wBottom;
          if (gap < minTopGap) minTopGap = gap;
        } else if (w.bbox.y >= targetBottom) {
          // 아래쪽 단어
          const gap = w.bbox.y - targetBottom;
          if (gap < minBottomGap) minBottomGap = gap;
        }
      }
    }

    // threshold 계산: 최소 간격의 1.5배 (기본값 설정)
    const horizontalGap = Math.min(minLeftGap, minRightGap);
    const verticalGap = Math.min(minTopGap, minBottomGap);
    const H_THRESHOLD = horizontalGap === Infinity ? 5 : horizontalGap * 1.5;
    const V_THRESHOLD = verticalGap === Infinity ? targetHeight * 1.5 : verticalGap * 1.5;

    console.log(`[Sentence] Target: "${targetWord.text}", gaps: L=${minLeftGap.toFixed(2)}, R=${minRightGap.toFixed(2)}, T=${minTopGap.toFixed(2)}, B=${minBottomGap.toFixed(2)}`);
    console.log(`[Sentence] Thresholds: H=${H_THRESHOLD.toFixed(2)}, V=${V_THRESHOLD.toFixed(2)}`);

    // === 2단계: threshold 기반으로 같은 블록의 단어만 필터링 ===
    // 타겟에서 시작해서 연결된 단어들을 flood-fill 방식으로 찾기
    const blockWords = new Set([targetWord]);
    const queue = [targetWord];

    while (queue.length > 0) {
      const current = queue.shift();
      const curX = current.bbox.x;
      const curRight = curX + current.bbox.width;
      const curY = current.bbox.y;
      const curBottom = curY + current.bbox.height;

      for (const w of ocrWords) {
        if (blockWords.has(w)) continue;

        const wRight = w.bbox.x + w.bbox.width;
        const wBottom = w.bbox.y + w.bbox.height;

        // 같은 줄 체크 (Y 겹침)
        const yOverlap = Math.min(curBottom, wBottom) - Math.max(curY, w.bbox.y);
        if (yOverlap > current.bbox.height * 0.3) {
          // 수평 간격 체크
          let hGap = Infinity;
          if (wRight <= curX) hGap = curX - wRight;
          else if (w.bbox.x >= curRight) hGap = w.bbox.x - curRight;
          else hGap = 0; // 겹침

          if (hGap <= H_THRESHOLD) {
            blockWords.add(w);
            queue.push(w);
            continue;
          }
        }

        // 같은 컬럼 체크 (X 겹침)
        const xOverlap = Math.min(curRight, wRight) - Math.max(curX, w.bbox.x);
        if (xOverlap > current.bbox.width * 0.3) {
          // 수직 간격 체크
          let vGap = Infinity;
          if (wBottom <= curY) vGap = curY - wBottom;
          else if (w.bbox.y >= curBottom) vGap = w.bbox.y - curBottom;
          else vGap = 0; // 겹침

          if (vGap <= V_THRESHOLD) {
            blockWords.add(w);
            queue.push(w);
          }
        }
      }
    }

    // === 3단계: 블록 단어들을 줄로 그룹화 ===
    console.log(`[Sentence] Block words found: ${blockWords.size}`);
    const blockWordsArray = Array.from(blockWords);
    const lineGroups = [];
    const sortedWords = [...blockWordsArray].sort((a, b) => {
      const yDiff = a.bbox.y - b.bbox.y;
      const avgHeight = (a.bbox.height + b.bbox.height) / 2;
      if (Math.abs(yDiff) > avgHeight * 0.5) return yDiff;
      return a.bbox.x - b.bbox.x;
    });

    let currentLine = [];
    let lastY = null;
    let lastHeight = null;

    for (const word of sortedWords) {
      const lineGap = lastY !== null ? Math.abs(word.bbox.y - lastY) : 0;
      const avgHeight = lastHeight !== null ? (word.bbox.height + lastHeight) / 2 : word.bbox.height;

      if (lastY === null || lineGap <= avgHeight * 0.5) {
        currentLine.push(word);
      } else {
        if (currentLine.length > 0) lineGroups.push(currentLine);
        currentLine = [word];
      }
      lastY = word.bbox.y;
      lastHeight = word.bbox.height;
    }
    if (currentLine.length > 0) lineGroups.push(currentLine);

    // Sort each line by X
    lineGroups.forEach(line => line.sort((a, b) => a.bbox.x - b.bbox.x));

    // Calculate average height per line for paragraph detection
    const lineHeights = lineGroups.map(line => {
      const heights = line.map(w => w.bbox.height);
      return heights.reduce((a, b) => a + b, 0) / heights.length;
    });

    // Calculate gaps between lines
    const lineGaps = [];
    for (let i = 1; i < lineGroups.length; i++) {
      const prevLineBottom = Math.max(...lineGroups[i - 1].map(w => w.bbox.y + w.bbox.height));
      const currLineTop = Math.min(...lineGroups[i].map(w => w.bbox.y));
      lineGaps.push(currLineTop - prevLineBottom);
    }

    // Find which line contains the target word
    let targetLineIdx = -1;
    let targetWordIdx = -1;
    for (let i = 0; i < lineGroups.length; i++) {
      const idx = lineGroups[i].findIndex(w => w === targetWord);
      if (idx !== -1) {
        targetLineIdx = i;
        targetWordIdx = idx;
        break;
      }
    }

    if (targetLineIdx === -1) return null;

    // Multi-language sentence end detection
    const isSentenceEnd = (text) => /[.!?。！？]$/.test(text) || /^[.!?。！？]+$/.test(text);

    // Check if height change indicates new section (e.g., title vs body)
    const isHeightBreak = (lineIdx) => {
      if (lineIdx < 0 || lineIdx >= lineGroups.length) return true;
      const currentHeight = lineHeights[targetLineIdx];
      const otherHeight = lineHeights[lineIdx];
      // Height difference > 40% = different section
      return Math.abs(currentHeight - otherHeight) > currentHeight * 0.4;
    };

    // Check if line gap indicates paragraph break
    const isParagraphBreak = (gapIdx) => {
      if (gapIdx < 0 || gapIdx >= lineGaps.length) return false;
      const gap = lineGaps[gapIdx];
      const avgHeight = lineHeights[targetLineIdx];
      // Gap > 1.3x line height = paragraph break
      return gap > avgHeight * 1.3;
    };

    let startLineIdx = targetLineIdx;
    let startWordIdx = 0;
    let endLineIdx = targetLineIdx;
    let endWordIdx = lineGroups[targetLineIdx].length - 1;

    // Search backwards for sentence/paragraph start (no line limit)
    outerBack: for (let li = targetLineIdx; li >= 0; li--) {
      // Check paragraph break before this line
      if (li < targetLineIdx && isParagraphBreak(li)) {
        startLineIdx = li + 1;
        startWordIdx = 0;
        break outerBack;
      }

      // Check height break (different font size = new section)
      if (li < targetLineIdx && isHeightBreak(li)) {
        startLineIdx = li + 1;
        startWordIdx = 0;
        break outerBack;
      }

      const line = lineGroups[li];
      const searchStart = li === targetLineIdx ? targetWordIdx - 1 : line.length - 1;

      for (let wi = searchStart; wi >= 0; wi--) {
        if (isSentenceEnd(line[wi].text)) {
          startLineIdx = li;
          startWordIdx = wi + 1;
          if (startWordIdx >= line.length && li + 1 < lineGroups.length) {
            startLineIdx = li + 1;
            startWordIdx = 0;
          }
          break outerBack;
        }
      }
      startLineIdx = li;
      startWordIdx = 0;
    }

    // Search forwards for sentence/paragraph end (no line limit)
    outerForward: for (let li = targetLineIdx; li < lineGroups.length; li++) {
      // Check paragraph break after this line
      if (li > targetLineIdx && isParagraphBreak(li - 1)) {
        endLineIdx = li - 1;
        endWordIdx = lineGroups[li - 1].length - 1;
        break outerForward;
      }

      // Check height break
      if (li > targetLineIdx && isHeightBreak(li)) {
        endLineIdx = li - 1;
        endWordIdx = lineGroups[li - 1].length - 1;
        break outerForward;
      }

      const line = lineGroups[li];
      const searchStart = li === targetLineIdx ? targetWordIdx : 0;

      for (let wi = searchStart; wi < line.length; wi++) {
        if (isSentenceEnd(line[wi].text)) {
          endLineIdx = li;
          endWordIdx = wi;
          break outerForward;
        }
      }
      endLineIdx = li;
      endWordIdx = line.length - 1;
    }

    // Collect all words in the sentence
    const sentenceWords = [];
    for (let li = startLineIdx; li <= endLineIdx; li++) {
      const line = lineGroups[li];
      const start = li === startLineIdx ? startWordIdx : 0;
      const end = li === endLineIdx ? endWordIdx : line.length - 1;

      for (let wi = start; wi <= end; wi++) {
        if (line[wi]) sentenceWords.push(line[wi]);
      }
    }

    if (sentenceWords.length === 0) return null;

    // Calculate combined bbox
    const minX = Math.min(...sentenceWords.map(w => w.bbox.x));
    const minY = Math.min(...sentenceWords.map(w => w.bbox.y));
    const maxX = Math.max(...sentenceWords.map(w => w.bbox.x + w.bbox.width));
    const maxY = Math.max(...sentenceWords.map(w => w.bbox.y + w.bbox.height));

    const combinedText = sentenceWords.map(w => w.text).join(' ');
    const combinedBbox = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    console.log(`[Sentence] Found: "${combinedText}" (${sentenceWords.length} words, lines ${startLineIdx}-${endLineIdx})`);

    return {
      text: combinedText,
      bbox: combinedBbox,
      words: sentenceWords,
    };
  }, [ocrWords]);

  // Check if a point (x, y in %) intersects with a word's bbox
  const findWordAtPoint = useCallback((x, y) => {
    console.log(`[Match] Checking point: x=${x.toFixed(2)}%, y=${y.toFixed(2)}%, ocrWords: ${ocrWords.length}`);

    for (const word of ocrWords) {
      const { bbox } = word;
      if (
        x >= bbox.x &&
        x <= bbox.x + bbox.width &&
        y >= bbox.y &&
        y <= bbox.y + bbox.height
      ) {
        console.log(`[Match] HIT: "${word.text}" at bbox(${bbox.x.toFixed(1)}, ${bbox.y.toFixed(1)}, ${bbox.width.toFixed(1)}, ${bbox.height.toFixed(1)})`);
        return word;
      }
    }
    // 가장 가까운 단어 찾기 (디버깅용)
    if (ocrWords.length > 0) {
      let closest = null;
      let minDist = Infinity;
      for (const word of ocrWords) {
        const cx = word.bbox.x + word.bbox.width / 2;
        const cy = word.bbox.y + word.bbox.height / 2;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = word;
        }
      }
      if (closest) {
        console.log(`[Match] MISS - Closest word: "${closest.text}" at dist=${minDist.toFixed(1)}% (bbox: x=${closest.bbox.x.toFixed(1)}, y=${closest.bbox.y.toFixed(1)})`);
      }
    }
    return null;
  }, [ocrWords]);

  // Find existing annotation at point (vocabulary or grammar)
  const findAnnotationAtPoint = useCallback((x, y, preferGrammar = false) => {
    // 클릭 위치에 맞는 모든 annotation 수집
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
          // annotation 타입과 영역 크기 저장
          const area = bounds.width * bounds.height;
          const isVocab = isVocabularyAnnotation(annotation);
          matchingAnnotations.push({ annotation, area, isVocab });
        }
      } catch {
        continue;
      }
    }

    if (matchingAnnotations.length === 0) return null;

    // 정렬: preferGrammar이면 grammar 우선, 아니면 vocabulary 우선
    matchingAnnotations.sort((a, b) => {
      if (preferGrammar) {
        // grammar(문장)가 vocabulary(단어)보다 우선
        if (!a.isVocab && b.isVocab) return -1;
        if (a.isVocab && !b.isVocab) return 1;
      } else {
        // vocabulary(단어)가 grammar(문장)보다 우선
        if (a.isVocab && !b.isVocab) return -1;
        if (!a.isVocab && b.isVocab) return 1;
      }
      // 같은 타입이면 더 작은 영역 우선
      return a.area - b.area;
    });

    return matchingAnnotations[0].annotation;
  }, [annotations, currentPage]);

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
          const analysisData = JSON.parse(existingAnnotation.ai_analysis_json);
          const selectionData = JSON.parse(existingAnnotation.selection_rect);
          const bounds = selectionData.bounds || selectionData;
          const lines = selectionData.lines;

          // 위/아래 위치 계산
          const firstLine = lines && lines.length > 0 ? lines[0] : bounds;
          const lastLine = lines && lines.length > 0 ? lines[lines.length - 1] : bounds;

          const markerTopPx = rect.top + firstLine.y * rect.height / 100;
          const markerBottomPx = rect.top + (lastLine.y + lastLine.height) * rect.height / 100;

          // 위/아래 공간 비교하여 placement 결정
          const viewportHeight = window.innerHeight;
          const spaceAbove = markerTopPx;
          const spaceBelow = viewportHeight - markerBottomPx;
          const placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

          // 모달 위치: 클릭한 X 위치 사용 (가장 정확), Y는 마킹 위/아래
          const posX = clientX;
          const posY = placement === 'below'
            ? Math.min(markerBottomPx + 12, viewportHeight - 50)
            : Math.max(markerTopPx - 12, 50);

          // 저장된 첫 번째 패턴 사용 (또는 전체 패턴)
          const pattern = analysisData.patterns?.[0] || {
            type: 'grammar',
            typeKr: '문법',
            words: [existingAnnotation.selected_text],
            explanation: analysisData.translation || '',
          };

          openModal('grammarTooltip', {
            pattern: pattern,
            annotation: existingAnnotation,
            position: { x: posX, y: posY },
            placement,
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

        // 위/아래 공간 비교하여 placement 결정
        const viewportHeight = window.innerHeight;
        const spaceAbove = markerTopPx;
        const spaceBelow = viewportHeight - markerBottomPx;
        const placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

        // 모달 위치: 클릭한 X 위치 사용 (가장 정확), Y는 마킹 위/아래
        const posX = clientX;
        const posY = placement === 'below'
          ? Math.min(markerBottomPx + 12, viewportHeight - 50)
          : Math.max(markerTopPx - 12, 50);

        // screenshot-main bounds 계산
        const mainContainer = imageContainerRef.current?.parentElement;
        const mainBounds = mainContainer ? mainContainer.getBoundingClientRect() : null;

        openModal('wordMenu', {
          position: { x: posX, y: posY },
          placement,
          word: sentence.text,
          wordBbox: sentence.bbox,
          sentenceWords: sentence.words,
          existingAnnotation: null,
          isGrammarMode: true,
          containerBounds: mainBounds ? {
            left: mainBounds.left,
            top: mainBounds.top,
            right: mainBounds.right,
            bottom: mainBounds.bottom,
          } : null,
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

    // 위/아래 공간 비교하여 placement 결정
    const viewportHeight = window.innerHeight;
    const spaceAbove = markerTopPx;
    const spaceBelow = viewportHeight - markerBottomPx;
    const placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

    // 모달 위치: 클릭한 X 위치 사용 (가장 정확), Y는 마킹 위/아래
    const posX = clientX;
    const posY = placement === 'below'
      ? Math.min(markerBottomPx + 12, viewportHeight - 50)
      : Math.max(markerTopPx - 12, 50);

    // screenshot-main bounds 계산
    const mainContainer = imageContainerRef.current?.parentElement;
    const mainBounds = mainContainer ? mainContainer.getBoundingClientRect() : null;

    openModal('wordMenu', {
      position: { x: posX, y: posY },
      placement,
      word: word.text,
      wordBbox: word.bbox,
      existingAnnotation: null,
      isGrammarMode: false,
      containerBounds: mainBounds ? {
        left: mainBounds.left,
        top: mainBounds.top,
        right: mainBounds.right,
        bottom: mainBounds.bottom,
      } : null,
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
      wordTapTimer.current = setTimeout(() => {
        if (mouseClickStart.current && !mouseClickStart.current.moved) {
          handleWordTap(mouseClickStart.current.x, mouseClickStart.current.y, true);
          mouseClickStart.current = null;
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
        if (wordTapTimer.current) {
          clearTimeout(wordTapTimer.current);
          wordTapTimer.current = null;
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
    if (wordTapTimer.current) {
      clearTimeout(wordTapTimer.current);
      wordTapTimer.current = null;
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

  // Get grammar annotations with patterns
  function getGrammarAnnotations(pageNum = null) {
    const grammarAnnotations = annotations.filter(a => {
      if (!a.ai_analysis_json) return false;
      try {
        const data = JSON.parse(a.ai_analysis_json);
        return data.type === 'grammar';
      } catch {
        return false;
      }
    });

    // 페이지 필터 적용
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
  }

  // 문법 패턴 렌더링 (lines 데이터 또는 bounds 사용)
  function renderGrammarPattern(annotation, pattern, patternIdx) {
    console.log(`[renderGrammarPattern] annotation: ${annotation.id}, pattern: ${patternIdx}, text: "${annotation.selected_text}"`);

    if (!annotation.selection_rect) return null;

    let selectionData;
    try {
      selectionData = JSON.parse(annotation.selection_rect);
    } catch {
      return null;
    }

    const bounds = selectionData.bounds || selectionData;
    const lines = selectionData.lines; // 줄별 bbox 데이터

    if (!bounds || bounds.width === undefined) return null;

    const centerX = bounds.x + bounds.width / 2;

    // 탭/클릭 시 grammar-tooltip을 밑줄 아래에 표시
    const showGrammarTooltipBelow = () => {
      console.log(`[Grammar] showGrammarTooltipBelow - annotation: ${annotation.id}, pattern: ${patternIdx}`);
      const currentRect = imageContainerRef.current?.getBoundingClientRect();
      if (!currentRect) return;

      // 마지막 줄의 아래쪽 위치 계산
      const lastLine = lines && lines.length > 0 ? lines[lines.length - 1] : bounds;
      const posX = currentRect.left + centerX * currentRect.width / 100;
      const posY = currentRect.top + (lastLine.y + lastLine.height) * currentRect.height / 100 + 15;

      openModal('grammarTooltip', {
        pattern: pattern,
        annotation: annotation,
        position: { x: posX, y: posY },
      });
    };

    // 롱프레스 감지 (500ms 이상 눌러야 표시)
    let longPressTimer = null;
    let longPressTriggered = false;
    const LONG_PRESS_DURATION = 500;

    const handlePointerDown = (e) => {
      // 터치 이벤트는 handleTouchStart에서 처리 - 중복 방지
      if (e.pointerType === 'touch') return;

      console.log(`[Grammar] PointerDown on annotation: ${annotation.id}, pattern: ${patternIdx}`);
      // 롱프레스가 완료되기 전까지는 이벤트를 차단하지 않음
      // 이렇게 해야 짧은 클릭이 아래의 vocab-marker로 전파됨
      longPressTriggered = false;
      longPressTimer = setTimeout(() => {
        console.log(`[Grammar] LongPress triggered! annotation: ${annotation.id}, pattern: ${patternIdx}`);
        longPressTriggered = true;
        showGrammarTooltipBelow();
        longPressTimer = null;
      }, LONG_PRESS_DURATION);
    };

    const handlePointerUp = (e) => {
      // 터치 이벤트는 handleTouchEnd에서 처리 - 중복 방지
      if (e.pointerType === 'touch') return;

      // 롱프레스가 트리거됐으면 이벤트 차단
      if (longPressTriggered) {
        e.stopPropagation();
        e.preventDefault();
      }
      // 타이머가 아직 있으면 (롱프레스 전) 취소
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressTriggered = false;
    };

    const handlePointerLeave = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressTriggered = false;
    };

    // 터치 이벤트는 이미지 레벨에서 통합 처리 - 여기서는 제거

    // lines 데이터가 있으면 각 줄별로 밑줄 렌더링
    if (lines && lines.length > 0) {
      const underlines = lines.map((line, i) => {
        const underlineY = line.y + line.height; // 텍스트 바로 아래
        return (
          <line
            key={`line-${i}`}
            x1={`${line.x}%`}
            y1={`${underlineY}%`}
            x2={`${line.x + line.width}%`}
            y2={`${underlineY}%`}
            className="grammar-underline"
          />
        );
      });

      return (
        <g
          key={`${annotation.id}-${patternIdx}`}
          className="grammar-pattern-group"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onPointerCancel={handlePointerLeave}
        >
          {underlines}
        </g>
      );
    }

    // lines가 없으면 bounds 기준 단일 밑줄
    const underlineY = bounds.y + bounds.height;
    return (
      <g
        key={`${annotation.id}-${patternIdx}`}
        className="grammar-pattern-group"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerLeave}
      >
        <line
          x1={`${bounds.x}%`}
          y1={`${underlineY}%`}
          x2={`${bounds.x + bounds.width}%`}
          y2={`${underlineY}%`}
          className="grammar-underline"
        />
      </g>
    );
  }

  // Handle minimap click/drag to jump to position
  function handleMinimapClick(e) {
    const container = scrollContainerRef.current;
    const minimap = minimapRef.current;
    if (!container || !minimap) return;

    const rect = minimap.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const clickPercent = clickY / rect.height;

    const targetScroll = clickPercent * container.scrollHeight - container.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: minimapDragging.current ? 'auto' : 'smooth',
    });
  }

  // Minimap drag handlers (mouse)
  function handleMinimapMouseDown(e) {
    minimapDragging.current = true;
    handleMinimapClick(e);
  }

  function handleMinimapMouseMove(e) {
    if (!minimapDragging.current) return;
    handleMinimapClick(e);
  }

  function handleMinimapMouseUp() {
    minimapDragging.current = false;
  }

  // Minimap drag handlers (touch)
  function handleMinimapTouchStart(e) {
    e.preventDefault();
    minimapDragging.current = true;
    const touch = e.touches[0];
    handleMinimapClick({ clientY: touch.clientY });
  }

  function handleMinimapTouchMove(e) {
    if (!minimapDragging.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    handleMinimapClick({ clientY: touch.clientY });
  }

  function handleMinimapTouchEnd() {
    minimapDragging.current = false;
  }

  // Global mouse/touch up for minimap drag
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      minimapDragging.current = false;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchend', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchend', handleGlobalMouseUp);
    };
  }, []);

  const handleTextSelection = useCallback((e) => {
    // Don't show context menu if clicking on a highlight
    if (e.target.classList?.contains('highlight')) {
      return;
    }

    // Check if mouse actually moved (dragged) - minimum 10px
    if (mouseDownPos.current) {
      const dx = Math.abs(e.clientX - mouseDownPos.current.x);
      const dy = Math.abs(e.clientY - mouseDownPos.current.y);
      if (dx < 10 && dy < 10) {
        mouseDownPos.current = null;
        return; // Just a click, not a drag
      }
    }
    mouseDownPos.current = null;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const selectedText = selection.toString().trim();

    if (selectedText && selectedText.length > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      openModal('contextMenu', {
        position: {
          x: rect.left + window.scrollX,
          y: rect.bottom + window.scrollY + 10,
        },
        selectedText,
      });
    }
  }, [openModal]);

  function closeContextMenu() {
    closeModal();
    setSelectedWords([]);
    window.getSelection()?.removeAllRanges();
  }

  function closeAnnotationPopover() {
    closeModal();
  }

  function handleAnnotationCreated() {
    refreshAnnotations(); // Don't reset page position
  }

  function handleAnnotationDeleted() {
    closeAnnotationPopover();
    refreshAnnotations(); // Don't reset page position
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

  // Register touch events for tap/long-press word selection
  // - 탭: 단어 선택 (vocabulary)
  // - 롱프레스 (500ms): 문법 분석 (grammar)
  // - 2손가락: pinch zoom + pan
  // - 스와이프: 페이지 이동 (multi-page)
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const pages = getPages();
    const isMultiPage = pages && pages.length > 1;
    const LONG_PRESS_DURATION = 500; // ms
    const TAP_MOVE_THRESHOLD = 10; // px - 이 이상 움직이면 탭이 아님

    const handleTouchStart = (e) => {
      // 2손가락(pinch zoom)은 항상 처리
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (wordTapTimer.current) {
          clearTimeout(wordTapTimer.current);
          wordTapTimer.current = null;
        }
        wordTapStart.current = null;
        singleFingerPanRef.current = null;
        handleImagePointerDown(e);
        return;
      }

      const touch = e.touches[0];

      // 확대 상태면 한 손가락 패닝 준비
      if (zoomScale > 1) {
        singleFingerPanRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          startPanX: panOffset.x,
          startPanY: panOffset.y,
        };
      }

      // 1손가락: 탭/롱프레스 감지 시작
      wordTapStart.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
        moved: false,
      };

      // 롱프레스 타이머 시작
      wordTapTimer.current = setTimeout(() => {
        if (wordTapStart.current && !wordTapStart.current.moved) {
          // 롱프레스 성공 - grammar mode
          handleWordTap(wordTapStart.current.x, wordTapStart.current.y, true);
          wordTapStart.current = null;
        }
      }, LONG_PRESS_DURATION);
    };

    const handleTouchMove = (e) => {
      // 2손가락(pinch zoom)
      if (e.touches.length >= 2) {
        e.preventDefault();
        singleFingerPanRef.current = null;
        handleImagePointerMove(e);
        return;
      }

      const touch = e.touches[0];

      // 확대 상태에서 한 손가락 패닝 - moved 체크 전에 먼저 패닝 처리
      if (zoomScale > 1 && singleFingerPanRef.current) {
        const deltaX = touch.clientX - singleFingerPanRef.current.startX;
        const deltaY = touch.clientY - singleFingerPanRef.current.startY;

        // 조금이라도 움직이면 패닝 시작 (탭/롱프레스 취소)
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          e.preventDefault();

          // 탭/롱프레스 취소
          if (wordTapStart.current) {
            wordTapStart.current.moved = true;
          }
          if (wordTapTimer.current) {
            clearTimeout(wordTapTimer.current);
            wordTapTimer.current = null;
          }

          const newOffset = clampPanOffset(
            singleFingerPanRef.current.startPanX + deltaX,
            singleFingerPanRef.current.startPanY + deltaY,
            zoomScale
          );
          setPanOffset(newOffset);
          return;
        }
      }

      // 탭 이동 감지 (확대 안된 상태에서)
      if (wordTapStart.current) {
        const deltaX = Math.abs(touch.clientX - wordTapStart.current.x);
        const deltaY = Math.abs(touch.clientY - wordTapStart.current.y);

        if (deltaX > TAP_MOVE_THRESHOLD || deltaY > TAP_MOVE_THRESHOLD) {
          // 너무 많이 움직임 - 탭/롱프레스 취소
          wordTapStart.current.moved = true;
          if (wordTapTimer.current) {
            clearTimeout(wordTapTimer.current);
            wordTapTimer.current = null;
          }
        }
      }
    };

    const handleTouchEnd = (e) => {
      // 롱프레스 타이머 클리어
      if (wordTapTimer.current) {
        clearTimeout(wordTapTimer.current);
        wordTapTimer.current = null;
      }

      // 2손가락 pinch 종료
      if (pinchStartRef.current || twoFingerPanRef.current) {
        pinchStartRef.current = null;
        twoFingerPanRef.current = null;
        wordTapStart.current = null;
        return;
      }

      // 탭 감지
      if (wordTapStart.current && !wordTapStart.current.moved) {
        const tapData = wordTapStart.current;
        wordTapStart.current = null;

        const deltaTime = Date.now() - tapData.time;

        // 롱프레스가 아닌 짧은 탭 (500ms 이전에 손 뗌)
        if (deltaTime < 500) {
          const now = Date.now();
          const DOUBLE_TAP_DELAY = 300; // ms
          const DOUBLE_TAP_DISTANCE = 50; // px

          // 더블탭 감지
          if (lastTapRef.current) {
            const timeSinceLastTap = now - lastTapRef.current.time;
            const distX = Math.abs(tapData.x - lastTapRef.current.x);
            const distY = Math.abs(tapData.y - lastTapRef.current.y);

            if (timeSinceLastTap < DOUBLE_TAP_DELAY && distX < DOUBLE_TAP_DISTANCE && distY < DOUBLE_TAP_DISTANCE) {
              // 더블탭! 줌 리셋
              lastTapRef.current = null;
              setZoomScale(1);
              setPanOffset({ x: 0, y: 0 });
              return;
            }
          }

          // 첫 번째 탭 기록
          lastTapRef.current = { time: now, x: tapData.x, y: tapData.y };

          // 짧은 딜레이 후 단일 탭 처리 (더블탭 대기)
          setTimeout(() => {
            if (lastTapRef.current && Date.now() - lastTapRef.current.time >= DOUBLE_TAP_DELAY) {
              // 더블탭 아님 - 단일 탭 처리
              handleWordTap(tapData.x, tapData.y, false);
              lastTapRef.current = null;
            }
          }, DOUBLE_TAP_DELAY);
        }
        // 롱프레스는 이미 타이머에서 처리됨
        return;
      }

      // 스와이프 감지 (움직임이 있었던 경우, 확대 안된 상태에서만)
      if (wordTapStart.current?.moved && isMultiPage && zoomScale <= 1) {
        const touch = e.changedTouches?.[0];
        if (touch && wordTapStart.current) {
          const deltaY = touch.clientY - wordTapStart.current.y;
          const deltaTime = Date.now() - wordTapStart.current.time;
          const isQuickSwipe = deltaTime < 300 && Math.abs(deltaY) > 50;

          if (isQuickSwipe) {
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

      wordTapStart.current = null;
      singleFingerPanRef.current = null;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      if (wordTapTimer.current) {
        clearTimeout(wordTapTimer.current);
      }
    };
  }, [source, currentPage, handleImagePointerDown, handleImagePointerMove, triggerShake, handleWordTap, zoomScale, panOffset, clampPanOffset]);

  // Render captured screenshot viewer
  function renderContent() {
    const displayImage = getDisplayImage();
    const pages = getPages();
    const hasPages = pages && pages.length > 1;

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
                            onClick={(e) => {
                              e.stopPropagation();
                              const containerRect = imageContainerRef.current.getBoundingClientRect();
                              openModal('annotationPopover', {
                                position: {
                                  x: containerRect.left + (bounds.x + (bounds.width || 0) / 2) * containerRect.width / 100,
                                  y: containerRect.top + (bounds.y + (bounds.height || 0)) * containerRect.height / 100 + 10,
                                },
                                annotation,
                              });
                            }}
                          />
                        );
                      }
                      return (
                        <rect
                          key={annotation.id}
                          x={data.x} y={data.y} width={data.width} height={data.height}
                          className="highlighter-rect saved"
                          onClick={(e) => {
                            e.stopPropagation();
                            const containerRect = imageContainerRef.current.getBoundingClientRect();
                            openModal('annotationPopover', {
                              position: {
                                x: containerRect.left + (data.x + data.width / 2) * containerRect.width / 100,
                                y: containerRect.top + (data.y + data.height) * containerRect.height / 100 + 10,
                              },
                              annotation,
                            });
                          }}
                        />
                      );
                    })}
                  {/* Vocabulary markers (green shadow + rounded) - 이벤트는 이미지 레벨에서 통합 처리 */}
                  {getVocabularyAnnotations(currentPage).map(annotation => {
                    const selectionData = JSON.parse(annotation.selection_rect);
                    const bounds = selectionData.bounds || selectionData;
                    console.log('[VocabMarker] annotation:', annotation.selected_text, 'bounds:', bounds);

                    // Padding for visual effect
                    const pad = 0.3;
                    const x = Math.max(0, bounds.x - pad);
                    const y = Math.max(0, bounds.y - pad);
                    const w = bounds.width + pad * 2;
                    const h = bounds.height + pad * 2;

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
                  })}
                  {/* Grammar pattern arcs */}
                  {(() => {
                    const grammarAnns = getGrammarAnnotations(currentPage);
                    return grammarAnns.map(annotation => {
                      try {
                        const analysisData = JSON.parse(annotation.ai_analysis_json);
                        return analysisData.patterns?.map((pattern, idx) =>
                          renderGrammarPattern(annotation, pattern, idx)
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
                  {/* Vocabulary markers - 이벤트는 이미지 레벨에서 통합 처리 */}
                  {getVocabularyAnnotations().map(annotation => {
                    const selectionData = JSON.parse(annotation.selection_rect);
                    const bounds = selectionData.bounds || selectionData;
                    const pad = 0.3;
                    const x = Math.max(0, bounds.x - pad);
                    const y = Math.max(0, bounds.y - pad);
                    const w = bounds.width + pad * 2;
                    const h = bounds.height + pad * 2;
                    return (
                      <g key={`vocab-${annotation.id}`}>
                        <rect
                          x={`${x}%`} y={`${y}%`}
                          width={`${w}%`} height={`${h}%`}
                          rx="0.5" ry="0.5"
                          className="vocab-marker-bg"
                          style={{ pointerEvents: 'none' }}
                        />
                      </g>
                    );
                  })}
                  {/* Grammar patterns */}
                  {getGrammarAnnotations().map(annotation => {
                    try {
                      const analysisData = JSON.parse(annotation.ai_analysis_json);
                      return analysisData.patterns?.map((pattern, idx) =>
                        renderGrammarPattern(annotation, pattern, idx)
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
                            onClick={(e) => {
                              e.stopPropagation();
                              const containerRect = imageContainerRef.current.getBoundingClientRect();
                              openModal('annotationPopover', {
                                position: {
                                  x: containerRect.left + (bounds.x + (bounds.width || 0) / 2) * containerRect.width / 100,
                                  y: containerRect.top + (bounds.y + (bounds.height || 0)) * containerRect.height / 100 + 10,
                                },
                                annotation,
                              });
                            }}
                          />
                        );
                      }
                      return (
                        <rect
                          key={annotation.id}
                          x={data.x} y={data.y} width={data.width} height={data.height}
                          className="highlighter-rect saved"
                          onClick={(e) => {
                            e.stopPropagation();
                            const containerRect = imageContainerRef.current.getBoundingClientRect();
                            openModal('annotationPopover', {
                              position: {
                                x: containerRect.left + (data.x + data.width / 2) * containerRect.width / 100,
                                y: containerRect.top + (data.y + data.height) * containerRect.height / 100 + 10,
                              },
                              annotation,
                            });
                          }}
                        />
                      );
                    })}
                  {/* Vocabulary markers (green shadow + rounded) - 이벤트는 이미지 레벨에서 통합 처리 */}
                  {getVocabularyAnnotations().map(annotation => {
                    const selectionData = JSON.parse(annotation.selection_rect);
                    const bounds = selectionData.bounds || selectionData;

                    // Padding for visual effect
                    const pad = 0.3;
                    const x = Math.max(0, bounds.x - pad);
                    const y = Math.max(0, bounds.y - pad);
                    const w = bounds.width + pad * 2;
                    const h = bounds.height + pad * 2;

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
                  })}
                  {/* Grammar pattern arcs */}
                  {(() => {
                    const grammarAnns = getGrammarAnnotations();
                    console.log('[URL Screenshot] Grammar annotations:', grammarAnns.length, grammarAnns.map(a => a.id));
                    return grammarAnns.map(annotation => {
                      try {
                        const analysisData = JSON.parse(annotation.ai_analysis_json);
                        console.log('[URL Screenshot] Annotation', annotation.id, 'has', analysisData.patterns?.length, 'patterns');
                        return analysisData.patterns?.map((pattern, idx) =>
                          renderGrammarPattern(annotation, pattern, idx)
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

      <main
        className="viewer-content"
        onMouseDown={handleMouseDown}
        onMouseUp={handleTextSelection}
        onTouchEnd={handleTextSelection}
        onClick={() => activeModal.type === 'annotationPopover' && closeAnnotationPopover()}
      >
        {renderContent()}

        {/* Memo markers displayed as floating indicators */}
        {annotations
          .filter((a) => a.type === 'memo')
          .map((memo, index) => (
            <div
              key={memo.id}
              className="memo-marker"
              style={{ top: `${100 + index * 40}px` }}
              onClick={(e) => {
                e.stopPropagation();
                openModal('annotationPopover', {
                  position: {
                    x: window.innerWidth - 60,
                    y: 100 + index * 40,
                  },
                  annotation: memo,
                });
              }}
              title={memo.memo_content}
            >
              M
            </div>
          ))}
      </main>

      <ContextMenu
        isOpen={activeModal.type === 'contextMenu'}
        position={activeModal.data.position || { x: 0, y: 0 }}
        selectedText={activeModal.data.selectedText || ''}
        selectionRect={activeModal.data.selectionRect || null}
        selectedWords={selectedWords}
        sourceId={id}
        pages={getPages()}
        zoomScale={zoomScale}
        onClose={closeContextMenu}
        onAnnotationCreated={handleAnnotationCreated}
      />

      <AnnotationPopover
        isOpen={activeModal.type === 'annotationPopover'}
        position={activeModal.data.position || { x: 0, y: 0 }}
        annotation={activeModal.data.annotation || null}
        onClose={closeAnnotationPopover}
        onDelete={handleAnnotationDeleted}
      />

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

      {/* Vocabulary Tooltip with listen/delete buttons */}
      {activeModal.type === 'vocabTooltip' && activeModal.data.word && (
        <>
          <div className="vocab-tooltip-overlay" />
          <div
            className={`vocab-tooltip ${activeModal.data.placement}${activeModal.data.annotation ? ' with-actions' : ''}`}
            style={{
              left: activeModal.data.position.x,
              top: activeModal.data.position.y,
              transform: activeModal.data.placement === 'below'
                ? 'translateX(-50%)'
                : 'translate(-50%, -100%)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="vocab-tooltip-header">
              <span className="vocab-tooltip-word">{activeModal.data.word}</span>
              <button
                className="listen-btn"
                onClick={() => {
                  const utterance = new SpeechSynthesisUtterance(activeModal.data.word);
                  utterance.lang = 'en-US';
                  utterance.rate = 0.9;
                  window.speechSynthesis.cancel();
                  window.speechSynthesis.speak(utterance);
                }}
                title="듣기"
              >
                🔊
              </button>
            </div>
            <pre className="vocab-tooltip-definition">{activeModal.data.definition}</pre>
            {activeModal.data.annotation && (
              <div className="vocab-tooltip-actions">
                <button className="delete-btn" onClick={handleDeleteVocabFromTooltip}>
                  삭제
                </button>
                <button className="close-btn" onClick={closeVocabTooltip}>
                  닫기
                </button>
              </div>
            )}
          </div>
        </>
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

      {/* Grammar Tooltip */}
      {activeModal.type === 'grammarTooltip' && activeModal.data.pattern && (
        <>
          <div className="grammar-tooltip-overlay" />
          <GrammarTooltip
            pattern={activeModal.data.pattern}
            annotation={activeModal.data.annotation}
            position={activeModal.data.position}
            placement={activeModal.data.placement || 'below'}
            zoomScale={zoomScale}
            onClose={closeModal}
            onDelete={async () => {
              if (activeModal.data.annotation) {
                await deleteAnnotation(activeModal.data.annotation.id);
                closeModal();
                refreshAnnotations();
              }
            }}
          />
        </>
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
        containerBounds={activeModal.data.containerBounds || null}
        zoomScale={zoomScale}
        onClose={closeWordMenu}
        onSaved={handleWordMenuSaved}
        onDeleted={handleWordMenuDelete}
      />
    </div>
  );
}
