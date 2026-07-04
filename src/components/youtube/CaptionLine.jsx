import { memo, useRef, useEffect, useCallback, useMemo } from 'react';
import { formatTime } from '../../services/ai/youtube';

const LONG_PRESS_DURATION = 500;
const TAP_MOVE_THRESHOLD = 10;
const PUNCT_RE = /^[.,;:!?"'()[\]{}]+|[.,;:!?"'()[\]{}]+$/g;

// Normalize a token for text-based matching between the caption text and the
// Whisper word list (strips punctuation/spacing, lowercases).
const normalizeToken = (s) => (s || '').toLowerCase().replace(/[^a-z0-9']/g, '');

/**
 * Individual caption line component
 * Touch handling is completely separate from Viewer's touch system:
 * - Short press on word: seek to that word's timestamp
 * - Long press on word: show word definition menu
 */
function CaptionLine({
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
  translation,
}) {
  const touchStateRef = useRef(null);
  const timerRef = useRef(null);
  const lastTouchEndRef = useRef(0); // Prevent synthetic mouse events after touch

  // Word timings aligned 1:1 with the rendered words (punctuation stripped).
  // This is the single source of truth for both seeking and highlighting, so
  // it MUST stay index-aligned with renderWords() below.
  const wordTimings = useMemo(() => {
    if (!segment?.text) return [];

    // Rendered words = whitespace-split tokens with surrounding punctuation
    // removed and empty (punctuation-only) tokens dropped.
    const tokens = segment.text
      .split(/\s+/)
      .map(t => t.replace(PUNCT_RE, ''))
      .filter(t => t.length > 0);
    if (tokens.length === 0) return [];

    const segStart = segment.start;
    const segEnd = segment.end || segment.start + 3;
    const estimate = (i) => ({
      word: tokens[i],
      start: segStart + ((segEnd - segStart) * i) / tokens.length,
      end: segStart + ((segEnd - segStart) * (i + 1)) / tokens.length,
      index: i,
    });

    const whisper = segment.words;
    if (!whisper || whisper.length === 0) {
      // Fallback: estimate by uniform distribution
      return tokens.map((_, i) => estimate(i));
    }

    // Align Whisper words to rendered tokens by text (not raw index) so a
    // dropped/extra Whisper word or a punctuation-only token cannot shift every
    // subsequent timestamp. A short look-ahead absorbs minor mismatches; when
    // nothing lines up we fall back to a positional/estimated timing.
    const timings = [];
    let wi = 0;
    for (let ti = 0; ti < tokens.length; ti++) {
      const tnorm = normalizeToken(tokens[ti]);
      let matched = null;
      for (let scan = wi; scan < whisper.length && scan <= wi + 2; scan++) {
        if (normalizeToken(whisper[scan].word) === tnorm) {
          matched = whisper[scan];
          wi = scan + 1;
          break;
        }
      }
      if (!matched && wi < whisper.length) {
        matched = whisper[wi];
        wi += 1;
      }
      timings.push(
        matched
          ? { word: tokens[ti], start: matched.start, end: matched.end, index: ti }
          : estimate(ti)
      );
    }
    return timings;
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

  // Clear a pending long-press timer if the component unmounts mid-press
  // (e.g. user navigates back) so the stale callback never fires.
  useEffect(() => () => clearTimer(), [clearTimer]);

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

      const cleanWord = part.replace(PUNCT_RE, '');
      // Punctuation-only token (e.g. a leading "-"): render as plain text and
      // do NOT consume a word index, otherwise every following word's index
      // (and its timestamp) would be shifted by one.
      if (!cleanWord) return <span key={i}>{part}</span>;

      const thisWordIdx = wordIdx;
      wordIdx++;

      const isCurrentWord = isActive && isPlaying && thisWordIdx === currentWordIndex;
      const isSavedWord = savedWords?.has(cleanWord.toLowerCase());

      return (
        <span
          key={i}
          className={`caption-word ${isCurrentWord ? 'reading' : ''} ${isSavedWord ? 'saved' : ''}`}
          data-word={cleanWord}
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
        {translation && <div className="caption-translation">{translation}</div>}
      </div>
    </div>
  );
}

// Memoized so the 200ms playback poll only re-renders the active line.
// Inactive lines receive a stable `currentTime={undefined}` (see CaptionDisplay)
// and stable callback/props, so shallow comparison skips their re-render.
export default memo(CaptionLine);
