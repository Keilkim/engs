import { useCallback } from 'react';

/**
 * Renders grammar pattern underlines with long-press interaction
 */
export default function GrammarPatternRenderer({
  annotation,
  patternIdx,
  imageContainerRef,
  openModal,
}) {
  if (!annotation.selection_rect) return null;

  let selectionData;
  try {
    selectionData = JSON.parse(annotation.selection_rect);
  } catch {
    return null;
  }

  const bounds = selectionData.bounds || selectionData;
  const lines = selectionData.lines;

  if (!bounds || bounds.width === undefined) return null;

  const centerX = bounds.x + bounds.width / 2;

  // Show grammar tooltip below the underline
  const showGrammarTooltipBelow = useCallback(() => {
    const currentRect = imageContainerRef?.current?.getBoundingClientRect();
    if (!currentRect) return;

    const lastLine = lines && lines.length > 0 ? lines[lines.length - 1] : bounds;
    const posX = currentRect.left + centerX * currentRect.width / 100;
    const posY = currentRect.top + (lastLine.y + lastLine.height) * currentRect.height / 100 + 15;

    openModal('wordMenu', {
      word: annotation.selected_text,
      existingAnnotation: annotation,
      isGrammarMode: true,
      position: { x: posX, y: posY },
      placement: 'below',
    });
  }, [imageContainerRef, openModal, annotation, bounds, lines, centerX]);

  // Long press detection (500ms)
  let longPressTimer = null;
  let longPressTriggered = false;
  const LONG_PRESS_DURATION = 500;

  const handlePointerDown = (e) => {
    if (e.pointerType === 'touch') return;

    longPressTriggered = false;
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      showGrammarTooltipBelow();
      longPressTimer = null;
    }, LONG_PRESS_DURATION);
  };

  const handlePointerUp = (e) => {
    if (e.pointerType === 'touch') return;

    if (longPressTriggered) {
      e.stopPropagation();
      e.preventDefault();
    }
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

  // Render lines if available
  if (lines && lines.length > 0) {
    const underlines = lines.map((line, i) => {
      const underlineY = line.y + line.height;
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

  // Single underline based on bounds
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
