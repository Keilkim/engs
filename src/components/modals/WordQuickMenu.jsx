import { useState, useEffect, useCallback, useRef } from 'react';
import { calculateModalPosition, getArrowClass, getMobileSafeAreaBottom } from '../../utils/positioning';
import { cleanDisplayText } from '../../utils/textUtils';
import { useTranslation } from '../../i18n';
import { useWordLookup } from './useWordLookup';
import { useGrammarAnalysis } from './useGrammarAnalysis';
import VocabModeContent from './VocabModeContent';
import GrammarModeContent from './GrammarModeContent';

export default function WordQuickMenu({
  isOpen,
  position,
  placement = 'below',
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
  const isYouTube = sourceType === 'youtube';
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
  const [dynamicPosition, setDynamicPosition] = useState(null);
  const [positionReady, setPositionReady] = useState(false);
  const rafRef = useRef(null);
  const modalRef = useRef(null);
  const backdropRef = useRef(null);
  const openTimeRef = useRef(0);
  const lastTouchRef = useRef(0); // timestamp of the most recent touch (to reject synthetic mouse)

  // Track when menu opens (to ignore synthetic mouse events from the long-press touch)
  useEffect(() => {
    if (isOpen) openTimeRef.current = Date.now();
  }, [isOpen]);

  // The backdrop closes the menu on ANY outside touch — a single tap, or the
  // first finger of a pinch (the user wants the tooltip to disappear when they
  // zoom, not ride along and land in a weird spot). We do NOT preventDefault, so
  // if the gesture is a two-finger pinch the browser's native zoom still runs
  // after the menu closes. The synthetic mouse a closing tap emits is rejected by
  // the container's touch-recency guard (useDesktopGestures), so it can't start a
  // fresh lookup once the backdrop unmounts. (React 19 registers the delegated
  // touch listener as passive, hence a native listener here.)
  useEffect(() => {
    const el = backdropRef.current;
    if (!isOpen || !el) return;
    const onTouchStart = (e) => {
      e.stopPropagation();
      onClose();
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    return () => el.removeEventListener('touchstart', onTouchStart);
  }, [isOpen, onClose]);

  // Record the most recent touch anywhere on the page so the backdrop's mouse
  // handler can reject the synthetic mouse events that follow a touch. Without
  // this, a long-press (which opens the menu while the finger is still down)
  // fires a synthetic mousedown on the finger-lift that closes the menu it just
  // opened ("손 떼면 사라진다"). Real touch taps close via the native touchstart
  // listener above; real desktop clicks (no preceding touch) still close.
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

  // Position update (wordBbox % → viewport coords)
  const updatePosition = useCallback(() => {
    if (!wordBbox || !containerRef?.current) {
      setDynamicPosition(null);
      if (position) setPositionReady(true);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const centerX = wordBbox.x + wordBbox.width / 2;
    const bottomY = wordBbox.y + wordBbox.height;
    const topY = wordBbox.y;

    const newX = containerRect.left + (centerX * containerRect.width / 100);
    const newY = placement === 'below'
      ? containerRect.top + (bottomY * containerRect.height / 100) + 12
      : containerRect.top + (topY * containerRect.height / 100) - 12;

    setDynamicPosition({ x: newX, y: newY });
    setPositionReady(true);
  }, [wordBbox, containerRef, placement, position]);

  // Update position on zoom/pan change
  useEffect(() => {
    if (!isOpen) return;
    if (wordBbox && containerRef?.current) {
      updatePosition();
    } else if (position) {
      setPositionReady(true);
    }
  }, [isOpen, wordBbox, containerRef, updatePosition, zoomScale, panOffset, position]);

  // Update position on scroll/resize
  useEffect(() => {
    if (!isOpen || !wordBbox || !containerRef?.current) return;

    const handleUpdate = () => {
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
  }, [isOpen, wordBbox, containerRef, updatePosition]);

  // Load data on open / reset on close
  useEffect(() => {
    if (!isOpen) {
      vocab.reset();
      grammar.reset();
      setPositionReady(false);
      return;
    }

    if (existingAnnotation) {
      try {
        const data = JSON.parse(existingAnnotation.ai_analysis_json || '{}');
        if (data.type === 'grammar') {
          grammar.loadExisting(data);
        } else {
          vocab.loadExisting(data);
        }
      } catch {
        // Existing annotation data corrupt - no-op
      }
      return;
    }

    if (isGrammarMode && word) {
      grammar.handleAnalyze();
    } else if (!isGrammarMode && word) {
      vocab.handleLookup();
    }
  }, [isOpen, word, existingAnnotation, isGrammarMode]);

  if (!isOpen) return null;

  // Position calculation
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safeAreaBottom = getMobileSafeAreaBottom();
  const menuWidth = isGrammarMode ? Math.min(340, vw - 24) : Math.min(300, vw - 24);
  const effectivePosition = dynamicPosition || position;

  const { left, top, transform, arrowLeft } = calculateModalPosition({
    position: effectivePosition,
    menuWidth,
    margin: 12,
    placement,
  });

  const maxHeight = Math.min(vh * 0.6, vh - safeAreaBottom - 100);

  const menuStyle = {
    position: 'fixed',
    left,
    top,
    transform,
    zIndex: 1000,
    width: menuWidth,
    maxHeight,
    '--arrow-left': `${arrowLeft}%`,
    opacity: positionReady ? 1 : 0,
    visibility: positionReady ? 'visible' : 'hidden',
  };

  const arrowClass = getArrowClass(placement);
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
