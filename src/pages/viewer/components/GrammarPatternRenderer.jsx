import { useCallback, useMemo, useRef, useEffect } from 'react';
import { getMobileSafeAreaBottom } from '../../../utils/positioning';

const LONG_PRESS_DURATION = 500;

/**
 * Renders grammar pattern underlines with long-press interaction
 */
export default function GrammarPatternRenderer({
  annotation,
  patternIdx,
  imageContainerRef,
  openModal,
}) {
  // ---- Hooks first (Rules of Hooks): never call hooks conditionally ----

  // Parse selection_rect once; null when missing or malformed.
  const selectionData = useMemo(() => {
    if (!annotation.selection_rect) return null;
    try {
      return JSON.parse(annotation.selection_rect);
    } catch {
      return null;
    }
  }, [annotation.selection_rect]);

  const bounds = selectionData ? (selectionData.bounds || selectionData) : null;
  const lines = selectionData ? selectionData.lines : null;
  const hasValidBounds = !!bounds && bounds.width !== undefined;
  const centerX = hasValidBounds ? bounds.x + bounds.width / 2 : 0;

  // Timer state kept in refs (not render-local variables) so it survives
  // re-renders triggered by zoom/pan without leaking or firing stray tooltips.
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  // Show grammar tooltip below the underline
  const showGrammarTooltipBelow = useCallback(() => {
    const currentRect = imageContainerRef?.current?.getBoundingClientRect();
    if (!currentRect || !bounds) return;

    const firstLine = lines && lines.length > 0 ? lines[0] : bounds;
    const lastLine = lines && lines.length > 0 ? lines[lines.length - 1] : bounds;
    const posX = currentRect.left + centerX * currentRect.width / 100;

    // 모바일 하단 주소창을 고려한 placement 결정
    const viewportHeight = window.innerHeight;
    const safeAreaBottom = getMobileSafeAreaBottom();
    const markerTopPx = currentRect.top + firstLine.y * currentRect.height / 100;
    const markerBottomPx = currentRect.top + (lastLine.y + lastLine.height) * currentRect.height / 100;
    const spaceAbove = markerTopPx;
    const spaceBelow = viewportHeight - markerBottomPx - safeAreaBottom;
    const placement = spaceBelow >= 200 || spaceBelow > spaceAbove ? 'below' : 'above';

    const posY = placement === 'below'
      ? Math.min(markerBottomPx + 15, viewportHeight - safeAreaBottom - 50)
      : Math.max(markerTopPx - 15, 50);

    openModal('wordMenu', {
      word: annotation.selected_text,
      existingAnnotation: annotation,
      isGrammarMode: true,
      position: { x: posX, y: posY },
      placement,
      wordBbox: bounds, // 동적 위치 업데이트를 위해 전달
    });
  }, [imageContainerRef, openModal, annotation, bounds, lines, centerX]);

  const handlePointerDown = useCallback((e) => {
    if (e.pointerType === 'touch') return;

    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      showGrammarTooltipBelow();
      longPressTimerRef.current = null;
    }, LONG_PRESS_DURATION);
  }, [showGrammarTooltipBelow]);

  const handlePointerUp = useCallback((e) => {
    if (e.pointerType === 'touch') return;

    if (longPressTriggeredRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTriggeredRef.current = false;
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTriggeredRef.current = false;
  }, []);

  // Clean up any pending timer on unmount.
  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  // ---- Early returns AFTER all hooks ----
  if (!selectionData || !hasValidBounds) return null;

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
