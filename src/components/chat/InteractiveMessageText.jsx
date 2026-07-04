import { useRef, useCallback, useEffect } from 'react';

const LONG_PRESS_DURATION = 500;
const TAP_MOVE_THRESHOLD = 10;

/**
 * Extract the single sentence that contains the word at `partIndex`
 * (index into text.split(/(\s+)/)). Falls back to the whole text.
 */
function extractSentenceAt(text, partIndex) {
  if (!text) return '';
  if (partIndex == null || Number.isNaN(partIndex)) return text;

  const parts = text.split(/(\s+)/);
  let offset = 0;
  for (let k = 0; k < partIndex && k < parts.length; k++) {
    offset += parts[k].length;
  }
  offset = Math.min(offset, text.length - 1);

  const isBoundary = (ch) => ch === '.' || ch === '!' || ch === '?';

  let start = 0;
  for (let i = offset - 1; i >= 0; i--) {
    if (isBoundary(text[i])) { start = i + 1; break; }
  }
  let end = text.length;
  for (let i = offset; i < text.length; i++) {
    if (isBoundary(text[i])) { end = i + 1; break; }
  }
  return text.slice(start, end).trim() || text;
}

/**
 * Renders message text as interactive word spans with short/long press detection.
 * - Short press (< 500ms): word lookup (onWordPress)
 * - Long press (>= 500ms): grammar analysis (onLongPress)
 * Pattern borrowed from CaptionLine.jsx, simplified for chat messages.
 */
export default function InteractiveMessageText({
  text,
  onWordPress,
  onLongPress,
  onPressStart,
  onPressEndNoMenu,
}) {
  const touchStateRef = useRef(null);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cancel a pending long-press timer if the component unmounts mid-press
  // (e.g. tempId → id swap re-mounts the row), otherwise a stale timer fires
  // and opens the grammar menu at a wrong position.
  useEffect(() => () => clearTimer(), [clearTimer]);

  const handlePointerDown = useCallback((e) => {
    const target = e.target;
    const word = target.dataset?.word;
    const rawIndex = target.dataset?.index;
    const partIndex = rawIndex != null ? parseInt(rawIndex, 10) : null;
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;

    touchStateRef.current = {
      startX: clientX,
      startY: clientY,
      startTime: Date.now(),
      word: word || null,
      partIndex,
      target,
      moved: false,
      executed: false,
    };

    // Pause conversation immediately on press
    onPressStart?.();

    timerRef.current = setTimeout(() => {
      if (touchStateRef.current && !touchStateRef.current.moved && !touchStateRef.current.executed) {
        touchStateRef.current.executed = true;
        // Long press → grammar analysis on the tapped sentence only
        // (not the entire multi-paragraph message).
        const rect = target.getBoundingClientRect();
        onLongPress?.(extractSentenceAt(text, touchStateRef.current.partIndex), rect);
      }
    }, LONG_PRESS_DURATION);
  }, [text, onLongPress, onPressStart]);

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
    clearTimer();
    if (!touchStateRef.current) return;

    const { moved, executed, startTime, word, target } = touchStateRef.current;
    const duration = Date.now() - startTime;

    // Long press already fired (menu opened) → prevent synthetic mouse events
    if (executed) {
      e.preventDefault?.();
      touchStateRef.current = null;
      return;
    }

    if (!moved && duration < LONG_PRESS_DURATION) {
      // Short tap on a word → vocabulary lookup
      if (word) {
        const rect = target.getBoundingClientRect();
        onWordPress?.(word, rect);
      } else {
        // Tapped non-word area, no menu
        onPressEndNoMenu?.();
      }
    } else if (moved) {
      // Drag cancelled, no menu opened
      onPressEndNoMenu?.();
    }

    touchStateRef.current = null;
  }, [clearTimer, onWordPress, onPressEndNoMenu]);

  const handlePointerCancel = useCallback(() => {
    clearTimer();
    if (touchStateRef.current && !touchStateRef.current.executed) {
      onPressEndNoMenu?.();
    }
    touchStateRef.current = null;
  }, [clearTimer, onPressEndNoMenu]);

  // Render text as word spans (same pattern as CaptionLine.renderWords)
  if (!text) return null;

  const parts = text.split(/(\s+)/);

  return (
    <span
      className="interactive-message-text"
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerCancel}
      onTouchStart={handlePointerDown}
      onTouchMove={handlePointerMove}
      onTouchEnd={handlePointerUp}
      onTouchCancel={handlePointerCancel}
    >
      {parts.map((part, i) => {
        if (/^\s+$/.test(part)) return <span key={i}>{part}</span>;

        const cleanWord = part.replace(/^[.,;:!?"'()[\]{}]+|[.,;:!?"'()[\]{}]+$/g, '');

        return (
          <span
            key={i}
            className="interactive-word"
            data-word={cleanWord || undefined}
            data-index={i}
          >
            {part}
          </span>
        );
      })}
    </span>
  );
}
