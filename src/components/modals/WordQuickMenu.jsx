import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { calculateModalPosition, getArrowClass, getMobileSafeAreaBottom, placeAnchoredMenu } from '../../utils/positioning';
import { cleanDisplayText } from '../../utils/textUtils';
import { useTranslation } from '../../i18n';
import { useWordLookup } from './useWordLookup';
import { useGrammarAnalysis } from './useGrammarAnalysis';
import VocabModeContent from './VocabModeContent';
import GrammarModeContent from './GrammarModeContent';

// Finger travel that turns a touch on the backdrop from a tap into a drag.
const DRAG_THRESHOLD = 10;

// What would scroll at (x, y) if the backdrop weren't covering it.
function findScrollerAt(backdrop, x, y) {
  backdrop.style.pointerEvents = 'none';
  const below = document.elementFromPoint(x, y);
  backdrop.style.pointerEvents = '';
  for (let node = below; node && node !== document.documentElement; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement;
}

export default function WordQuickMenu({
  isOpen,
  position,
  placement = 'below',
  // The tapped word/row element, for callers without a wordBbox. The menu
  // tracks it, so it can flip sides without covering the word and follow it
  // when the content scrolls.
  anchorEl,
  // Viewer only: move the zoomed page by (dx, dy) when the user drags the
  // backdrop (there is no native scroll to forward to while zoomed).
  onBackdropPan,
  word,
  wordBbox,
  sentenceWords,
  sourceId,
  currentPage,
  existingAnnotation,
  isGrammarMode,
  containerRef,
  zoomScale,
  panOffset,
  onClose,
  onSaved,
  onDeleted,
  // YouTube-specific props (completely separate from Viewer's touch system)
  sourceType,
  segmentIndex,
  wordIndex,
  timestamp,
  // Authoritative scene bounds of the tapped row (pause chunk or cue).
  sceneStart,
  sceneEnd,
  // Optional source sentence for context/recall (omitted when unavailable)
  sentence,
}) {
  const { ko } = useTranslation();

  // Vocabulary tokens arrive straight from OCR / caption text and often carry
  // surrounding punctuation ("time:", "hello,"). Normalize ONCE here so the word
  // we look up, save (selected_text), display, and speak are all identical —
  // previously only the display was cleaned, so punctuation leaked into the DB
  // and the definition query. Grammar mode operates on a whole sentence, so it
  // is left untouched.
  const vocabWord = isGrammarMode ? word : cleanDisplayText(word);

  // Context sentence for the saved card: prefer an explicit `sentence`, else
  // reconstruct one from the tapped line's words (Viewer passes sentenceWords).
  const contextSentence = sentence
    || (Array.isArray(sentenceWords) && sentenceWords.length > 0
      ? sentenceWords.map((w) => (typeof w === 'string' ? w : w?.text || '')).join(' ').replace(/\s+/g, ' ').trim()
      : undefined);
  const [dynamicAnchor, setDynamicAnchor] = useState(null);
  // Natural (unconstrained) height of the menu, measured before paint. Drives
  // the above/below choice instead of a fixed guess, so a long idiom list never
  // runs off the bottom of the screen.
  const [menuHeight, setMenuHeight] = useState(null);
  const [, setViewportTick] = useState(0);
  const rafRef = useRef(null);
  const modalRef = useRef(null);
  const backdropRef = useRef(null);
  const openTimeRef = useRef(0);
  const lastTouchRef = useRef(0); // timestamp of the most recent touch (to reject synthetic mouse)

  // Track when menu opens (to ignore synthetic mouse events from the long-press touch)
  useEffect(() => {
    if (isOpen) openTimeRef.current = Date.now();
  }, [isOpen]);

  // Latest callbacks for the native backdrop listeners below, which must not
  // re-subscribe (and lose an in-progress drag) when a parent re-renders.
  const onCloseRef = useRef(onClose);
  const onBackdropPanRef = useRef(onBackdropPan);
  useEffect(() => {
    onCloseRef.current = onClose;
    onBackdropPanRef.current = onBackdropPan;
  });

  // Outside the menu: a tap closes it; a drag moves the content underneath
  // (scrolls it, or pans the zoomed Viewer page) and the menu follows its
  // word, so a long menu near the bottom can be brought fully into view. A
  // flick keeps gliding like native scrolling. A second finger (pinch) closes
  // the menu so it doesn't ride along the zoom and land in a weird spot; we
  // don't preventDefault that, so the browser's native zoom still runs.
  // Closing on touchend with preventDefault also stops the synthetic
  // mouse/click from landing on the page and starting a fresh lookup.
  // (React 19 registers delegated touch listeners as passive, hence native.)
  useEffect(() => {
    const el = backdropRef.current;
    if (!isOpen || !el) return;
    let gesture = null;
    let glideFrame = null;

    const stopGlide = () => {
      if (glideFrame) cancelAnimationFrame(glideFrame);
      glideFrame = null;
    };
    const moveContent = (scroller, dx, dy) => {
      if (onBackdropPanRef.current) onBackdropPanRef.current(dx, dy);
      else scroller?.scrollBy(-dx, -dy);
    };

    const onTouchStart = (e) => {
      e.stopPropagation();
      stopGlide();
      if (e.touches.length > 1) {
        gesture = null;
        onCloseRef.current();
        return;
      }
      const t = e.touches[0];
      gesture = {
        startX: t.clientX, startY: t.clientY,
        x: t.clientX, y: t.clientY, time: e.timeStamp,
        vx: 0, vy: 0, dragging: false,
        scroller: findScrollerAt(el, t.clientX, t.clientY),
      };
    };
    const onTouchMove = (e) => {
      if (!gesture || e.touches.length > 1) return;
      const t = e.touches[0];
      if (!gesture.dragging) {
        if (Math.hypot(t.clientX - gesture.startX, t.clientY - gesture.startY) < DRAG_THRESHOLD) return;
        gesture.dragging = true;
      }
      if (e.cancelable) e.preventDefault();
      const dx = t.clientX - gesture.x;
      const dy = t.clientY - gesture.y;
      const dt = Math.max(1, e.timeStamp - gesture.time);
      gesture.vx = dx / dt;
      gesture.vy = dy / dt;
      gesture.x = t.clientX;
      gesture.y = t.clientY;
      gesture.time = e.timeStamp;
      moveContent(gesture.scroller, dx, dy);
    };
    const onTouchEnd = (e) => {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      if (e.cancelable) e.preventDefault();
      if (!g.dragging) {
        onCloseRef.current();
        return;
      }
      // Glide only after a flick (finger still moving when it lifted).
      if (e.timeStamp - g.time > 80 || Math.hypot(g.vx, g.vy) < 0.2) return;
      let { vx, vy } = g;
      let last = performance.now();
      const step = (now) => {
        const dt = now - last;
        last = now;
        moveContent(g.scroller, vx * dt, vy * dt);
        const decay = Math.pow(0.95, dt / 16);
        vx *= decay;
        vy *= decay;
        glideFrame = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : null;
      };
      glideFrame = requestAnimationFrame(step);
    };
    const onTouchCancel = () => { gesture = null; };
    // Desktop: the wheel over the backdrop scrolls what's underneath too.
    const onWheel = (e) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 16 : 1; // lines → px
      findScrollerAt(el, e.clientX, e.clientY)?.scrollBy(e.deltaX * scale, e.deltaY * scale);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      stopGlide();
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('wheel', onWheel);
    };
  }, [isOpen]);

  // Record the most recent touch anywhere on the page so the backdrop's mouse
  // handler can reject the synthetic mouse events that follow a touch. Without
  // this, a long-press (which opens the menu while the finger is still down)
  // fires a synthetic mousedown on the finger-lift that closes the menu it just
  // opened ("손 떼면 사라진다"). Real touch taps close via the native touch
  // listeners above; real desktop clicks (no preceding touch) still close.
  useEffect(() => {
    if (!isOpen) return;
    const mark = () => { lastTouchRef.current = Date.now(); };
    window.addEventListener('touchstart', mark, { passive: true, capture: true });
    window.addEventListener('touchend', mark, { passive: true, capture: true });
    return () => {
      window.removeEventListener('touchstart', mark, { capture: true });
      window.removeEventListener('touchend', mark, { capture: true });
    };
  }, [isOpen]);

  const vocab = useWordLookup({ word: vocabWord, wordBbox, sourceId, currentPage, onSaved, onClose, sourceType, segmentIndex, wordIndex, timestamp, sceneStart, sceneEnd, sentence: contextSentence });
  const grammar = useGrammarAnalysis({ word, wordBbox, sentenceWords, sourceId, currentPage, onSaved, onClose, sourceType, segmentIndex, wordIndex, timestamp, sceneStart, sceneEnd });
  const { reset: resetVocab, loadExisting: loadVocab, handleLookup } = vocab;
  const { reset: resetGrammar, loadExisting: loadGrammar, handleAnalyze } = grammar;

  // Anchor update: the tracked element's rect, or wordBbox % → viewport coords
  // of the word's top/bottom edges.
  const updatePosition = useCallback(() => {
    if (anchorEl) {
      // A re-rendered list may have replaced the element; keep the last anchor.
      if (!anchorEl.isConnected) return;
      const rect = anchorEl.getBoundingClientRect();
      setDynamicAnchor({ x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
      return;
    }
    if (!wordBbox || !containerRef?.current) {
      setDynamicAnchor(null);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const centerX = wordBbox.x + wordBbox.width / 2;

    setDynamicAnchor({
      x: containerRect.left + (centerX * containerRect.width / 100),
      top: containerRect.top + (wordBbox.y * containerRect.height / 100),
      bottom: containerRect.top + ((wordBbox.y + wordBbox.height) * containerRect.height / 100),
    });
  }, [anchorEl, wordBbox, containerRef]);

  // The transformed DOM bounds are only available after commit. Measure before
  // paint so opening/repositioning the menu cannot flash its previous location.
  useLayoutEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize measured DOM geometry before paint.
    updatePosition();
  }, [isOpen, updatePosition, zoomScale, panOffset]);

  // Natural height = rendered height plus whatever the capped body hides, so
  // the measurement doesn't depend on the cap. The 1px tolerance lets it settle.
  const measureMenu = useCallback(() => {
    const el = modalRef.current;
    if (!el) return;
    const body = el.querySelector('.word-menu-body');
    const natural = el.offsetHeight + (body ? body.scrollHeight - body.clientHeight : 0);
    setMenuHeight((prev) => (prev === null || Math.abs(natural - prev) > 1 ? natural : prev));
  }, []);

  // Re-measure after every render (content grows when the lookup/analysis
  // arrives) and whenever the content reflows on its own — e.g. the Korean
  // web font swapping in after the first measurement.
  useLayoutEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    measureMenu();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureMenu);
    observer.observe(el);
    el.querySelectorAll('.word-menu-body > *').forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  });

  // Callers without an anchor to track still need a re-layout when the
  // viewport changes (e.g. the mobile browser bar collapsing).
  useEffect(() => {
    if (!isOpen) return;
    const handleResize = () => setViewportTick((t) => t + 1);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  // Update position on scroll/resize
  useEffect(() => {
    if (!isOpen || (!anchorEl && (!wordBbox || !containerRef?.current))) return;

    const handleUpdate = (e) => {
      // Scrolling the menu's own body doesn't move the word.
      if (e?.target instanceof Node && modalRef.current?.contains(e.target)) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePosition);
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, anchorEl, wordBbox, containerRef, updatePosition]);

  // Load data on open / reset on close
  useEffect(() => {
    if (!isOpen) {
      resetVocab();
      resetGrammar();
      return;
    }

    if (existingAnnotation) {
      try {
        const data = JSON.parse(existingAnnotation.ai_analysis_json || '{}');
        if (data.type === 'grammar') {
          loadGrammar(data);
        } else {
          loadVocab(data);
        }
      } catch {
        // Existing annotation data corrupt - no-op
      }
      return;
    }

    if (isGrammarMode && word) {
      handleAnalyze();
    } else if (!isGrammarMode && word) {
      handleLookup();
    }
  }, [isOpen, word, existingAnnotation, isGrammarMode, resetVocab, resetGrammar, loadVocab, loadGrammar, handleAnalyze, handleLookup]);

  if (!isOpen) return null;

  // Position calculation
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuWidth = isGrammarMode ? Math.min(340, vw - 24) : Math.min(300, vw - 24);
  const gap = 12;
  // Until the anchor is measured, the caller's position is already offset by
  // `gap` from the word's near edge; the far edge is unknown.
  const fallbackEdge = position && (placement === 'below' ? position.y - gap : position.y + gap);
  const anchor = dynamicAnchor || (position && { x: position.x, top: fallbackEdge, bottom: fallbackEdge });
  const positionReady = Boolean(anchor) && menuHeight !== null;

  const { left, arrowLeft } = calculateModalPosition({
    position: { x: anchor?.x ?? 0, y: 0 },
    menuWidth,
    margin: 12,
  });

  const vertical = placeAnchoredMenu({
    anchor: anchor || { top: 0, bottom: 0 },
    menuHeight: menuHeight ?? 0,
    preferred: placement,
    viewportHeight: vh,
    bottomInset: getMobileSafeAreaBottom(),
    margin: 12,
    gap,
  });

  const menuStyle = {
    position: 'fixed',
    left,
    top: vertical.top,
    zIndex: 1000,
    width: menuWidth,
    // Unmeasured: let the menu take its natural height so it can be measured.
    maxHeight: menuHeight === null ? 'none' : vertical.maxHeight,
    '--arrow-left': `${arrowLeft}%`,
    opacity: positionReady ? 1 : 0,
    visibility: positionReady ? 'visible' : 'hidden',
  };

  const arrowClass = vertical.detached ? 'no-arrow' : getArrowClass(vertical.placement);
  const grammarClass = isGrammarMode ? ' grammar' : '';
  const existingClass = existingAnnotation ? ' existing' : '';

  return (
    <>
    <div
      ref={backdropRef}
      className="word-quick-menu-backdrop"
      onMouseDown={(e) => {
        // Reject synthetic mouse events that follow a touch (real touch taps are
        // handled by the native touchstart listener above). This is what keeps a
        // long-press's finger-lift from closing the menu it just opened.
        if (Date.now() - lastTouchRef.current < 700) return;
        // Also ignore the opening click's own synthetic tail on desktop.
        if (Date.now() - openTimeRef.current < 300) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    />
    <div ref={modalRef} className={`word-quick-menu${grammarClass}${existingClass} ${arrowClass}`} style={menuStyle}>
      {isGrammarMode ? (
        <GrammarModeContent
          grammarData={grammar.grammarData}
          checkedPatterns={grammar.checkedPatterns}
          loading={grammar.loading}
          error={grammar.error}
          existingAnnotation={existingAnnotation}
          onSave={grammar.handleSave}
          onDelete={onDeleted}
          onClose={onClose}
          onRetry={grammar.handleAnalyze}
          onTogglePattern={grammar.togglePattern}
          ko={ko}
        />
      ) : (
        <VocabModeContent
          word={vocabWord}
          definition={vocab.definition}
          phonetic={vocab.phonetic}
          loading={vocab.loading}
          error={vocab.error}
          speaking={vocab.speaking}
          canSave={vocab.canSave}
          existingAnnotation={existingAnnotation}
          onSave={vocab.handleSave}
          onRetry={vocab.handleLookup}
          onDelete={onDeleted}
          onClose={onClose}
          onSpeak={vocab.speak}
          onStopSpeaking={vocab.stopSpeaking}
          ko={ko}
        />
      )}
    </div>
    </>
  );
}
