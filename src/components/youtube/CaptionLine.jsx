import { useRef, useCallback, useMemo } from 'react';
import { formatTime } from '../../services/ai/youtube';

const LONG_PRESS_DURATION = 500;
const TAP_MOVE_THRESHOLD = 10;

/**
 * Individual caption line component
 * Touch handling is completely separate from Viewer's touch system:
 * - Short press on word: seek to that word's timestamp
 * - Long press on word: show word definition menu
 */
export default function CaptionLine({
  segment,
  index,
  isActive,
  isPlaying,
  currentTime,
  onSeek,
  onWordLongPress,
  onLineLongPress,
  onPressStart,
  onPressEndNoMenu,
  savedWords,
}) {
  const touchStateRef = useRef(null);
  const timerRef = useRef(null);
  const lastTouchEndRef = useRef(0); // Prevent synthetic mouse events after touch

  // Use word timings from Whisper if available, otherwise estimate
  const wordTimings = useMemo(() => {
    if (!segment?.text) return [];

    if (segment.words && segment.words.length > 0) {
      return segment.words.map((w, i) => ({
        word: w.word,
        start: w.start,
        end: w.end,
        index: i,
      }));
    }

    // Fallback: estimate by uniform distribution
    const words = segment.text.split(/\s+/).filter(w => w.length > 0);
    const segmentDuration = (segment.end || segment.start + 3) - segment.start;
    const timePerWord = segmentDuration / words.length;

    return words.map((word, i) => ({
      word,
      start: segment.start + i * timePerWord,
      end: segment.start + (i + 1) * timePerWord,
      index: i,
    }));
  }, [segment]);

  // Find which word is currently active based on currentTime
  const currentWordIndex = useMemo(() => {
    if (!isActive || currentTime === undefined) return -1;
    for (let i = 0; i < wordTimings.length; i++) {
      if (currentTime >= wordTimings[i].start && currentTime < wordTimings[i].end) return i;
    }
    return -1;
  }, [isActive, currentTime, wordTimings]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((e) => {
    // Ignore synthetic mouse events after touch
    if (e.type === 'mousedown' && Date.now() - lastTouchEndRef.current < 500) return;

    const target = e.target;
    const word = target.dataset?.word;
    const wordIdx = target.dataset?.wordIndex;
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;

    touchStateRef.current = {
      startX: clientX,
      startY: clientY,
      startTime: Date.now(),
      word: word || null,
      wordIndex: wordIdx !== undefined ? parseInt(wordIdx, 10) : undefined,
      target,
      moved: false,
      executed: false,
    };

    // Pause video immediately on press
    onPressStart?.();

    timerRef.current = setTimeout(() => {
      if (touchStateRef.current && !touchStateRef.current.moved && !touchStateRef.current.executed) {
        touchStateRef.current.executed = true;
        if (word) {
          // Word long-press → vocab search
          const wIdx = touchStateRef.current.wordIndex;
          const timestamp = wordTimings[wIdx]?.start;
          onWordLongPress?.(word, target.getBoundingClientRect(), index, wIdx, timestamp);
        } else {
          // Line long-press (non-word area) → grammar search
          const lineEl = target.closest('.caption-line');
          const rect = lineEl ? lineEl.getBoundingClientRect() : target.getBoundingClientRect();
          onLineLongPress?.(segment.text, rect, index, segment.start);
        }
      }
    }, LONG_PRESS_DURATION);
  }, [onWordLongPress, onLineLongPress, onPressStart, index, wordTimings, segment]);

  const handlePointerMove = useCallback((e) => {
    if (!touchStateRef.current) return;
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    const dx = Math.abs(clientX - touchStateRef.current.startX);
    const dy = Math.abs(clientY - touchStateRef.current.startY);
    if (dx > TAP_MOVE_THRESHOLD || dy > TAP_MOVE_THRESHOLD) {
      touchStateRef.current.moved = true;
      clearTimer();
    }
  }, [clearTimer]);

  const handlePointerUp = useCallback((e) => {
    // Track touch end time to suppress synthetic mouse events
    if (e.type === 'touchend') lastTouchEndRef.current = Date.now();
    // Ignore synthetic mouse events after touch
    if (e.type === 'mouseup' && Date.now() - lastTouchEndRef.current < 500) return;

    clearTimer();
    if (!touchStateRef.current) return;

    const { moved, executed, startTime, wordIndex } = touchStateRef.current;
    const duration = Date.now() - startTime;

    // Long press already fired (menu opened) → prevent synthetic mouse events
    if (executed) {
      e.preventDefault?.();
      touchStateRef.current = null;
      return;
    }

    if (!moved && duration < LONG_PRESS_DURATION) {
      // Short tap → seek + resume if was playing
      if (wordIndex !== undefined && wordIndex >= 0 && wordTimings[wordIndex]) {
        onSeek?.(wordTimings[wordIndex].start);
      } else {
        onSeek?.(segment.start);
      }
      onPressEndNoMenu?.();
    } else if (moved) {
      // Drag cancelled, no menu opened → resume if was playing
      onPressEndNoMenu?.();
    }

    touchStateRef.current = null;
  }, [clearTimer, segment.start, onSeek, wordTimings, onPressEndNoMenu]);

  const handlePointerCancel = useCallback(() => {
    clearTimer();
    if (touchStateRef.current && !touchStateRef.current.executed) {
      onPressEndNoMenu?.();
    }
    touchStateRef.current = null;
  }, [clearTimer, onPressEndNoMenu]);

  const renderWords = (text) => {
    if (!text) return null;
    const parts = text.split(/(\s+)/);
    let wordIdx = 0;

    return parts.map((part, i) => {
      if (/^\s+$/.test(part)) return <span key={i}>{part}</span>;

      const cleanWord = part.replace(/^[.,;:!?"'()[\]{}]+|[.,;:!?"'()[\]{}]+$/g, '');
      const thisWordIdx = wordIdx;
      wordIdx++;

      const isCurrentWord = isActive && isPlaying && thisWordIdx === currentWordIndex;
      const isSavedWord = savedWords?.has(cleanWord.toLowerCase());

      return (
        <span
          key={i}
          className={`caption-word ${isCurrentWord ? 'reading' : ''} ${isSavedWord ? 'saved' : ''}`}
          data-word={cleanWord || undefined}
          data-word-index={thisWordIdx}
        >
          {part}
        </span>
      );
    });
  };

  return (
    <div
      className={`caption-line ${isActive ? 'active' : ''}`}
      data-segment-index={index}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerCancel}
      onTouchStart={handlePointerDown}
      onTouchMove={handlePointerMove}
      onTouchEnd={handlePointerUp}
      onTouchCancel={handlePointerCancel}
    >
      <span className="caption-time">{formatTime(segment.start)}</span>
      <div className="caption-text">
        <div className="caption-original">{renderWords(segment.text)}</div>
      </div>
    </div>
  );
}
