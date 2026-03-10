import { useState, useEffect, useCallback, useRef } from 'react';
import { calculateModalPosition, getArrowClass, getMobileSafeAreaBottom } from '../../utils/positioning';
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
}) {
  const isYouTube = sourceType === 'youtube';
  const { ko } = useTranslation();
  const [dynamicPosition, setDynamicPosition] = useState(null);
  const [positionReady, setPositionReady] = useState(false);
  const rafRef = useRef(null);
  const modalRef = useRef(null);
  const openTimeRef = useRef(0);

  // Track when menu opens (to ignore synthetic mouse events from the long-press touch)
  useEffect(() => {
    if (isOpen) openTimeRef.current = Date.now();
  }, [isOpen]);

  const vocab = useWordLookup({ word, wordBbox, sourceId, currentPage, onSaved, onClose, sourceType, segmentIndex, wordIndex, timestamp });
  const grammar = useGrammarAnalysis({ word, wordBbox, sentenceWords, sourceId, currentPage, onSaved, onClose, sourceType, segmentIndex, wordIndex, timestamp });

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
      className="word-quick-menu-backdrop"
      onTouchStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onMouseDown={(e) => {
        // Ignore synthetic mouse events from the touch that triggered this menu
        if (Date.now() - openTimeRef.current < 500) return;
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
          onTogglePattern={grammar.togglePattern}
          ko={ko}
        />
      ) : (
        <VocabModeContent
          word={word}
          definition={vocab.definition}
          loading={vocab.loading}
          error={vocab.error}
          speaking={vocab.speaking}
          existingAnnotation={existingAnnotation}
          onSave={vocab.handleSave}
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
