/**
 * Modal/Tooltip positioning utilities
 * Shared logic for ContextMenu, WordQuickMenu, GrammarTooltip
 */

/**
 * Calculate modal position with screen boundary checks
 * @param {Object} options
 * @param {Object} options.position - { x, y } click/target position
 * @param {number} options.menuWidth - modal width
 * @param {number} options.menuHeight - modal height (optional, for vertical clamping)
 * @param {number} options.margin - screen edge margin (default: 12)
 * @param {'below'|'above'} options.placement - vertical placement
 * @param {boolean} options.centerHorizontal - center on position.x (default: true)
 * @returns {Object} { left, top, transform, transformOrigin, arrowLeft }
 */
export function calculateModalPosition({
  position,
  menuWidth,
  menuHeight = 0,
  margin = 12,
  placement = 'below',
  centerHorizontal = true,
}) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Horizontal position (centered on position.x, clamped to screen)
  let left;
  if (centerHorizontal) {
    left = Math.max(margin, Math.min(position.x - menuWidth / 2, vw - menuWidth - margin));
  } else {
    left = Math.max(margin, Math.min(position.x, vw - menuWidth - margin));
  }

  // Vertical position
  let top = position.y;

  // Vertical clamping if height provided
  if (menuHeight > 0) {
    if (placement === 'below') {
      // Ensure doesn't go below screen
      if (top + menuHeight > vh - margin) {
        top = vh - margin - menuHeight;
      }
    } else {
      // Ensure doesn't go above screen
      if (top - menuHeight < margin) {
        top = margin + menuHeight;
      }
    }
    // Top boundary
    if (top < margin) {
      top = margin;
    }
  }

  // Transform based on placement
  const translateY = placement === 'below' ? '0' : '-100%';
  const transformOrigin = placement === 'below' ? 'top center' : 'bottom center';

  // Arrow position (percentage within modal)
  const arrowLeft = Math.min(Math.max(((position.x - left) / menuWidth) * 100, 15), 85);

  return {
    left,
    top,
    transform: `translateY(${translateY})`,
    transformOrigin,
    arrowLeft,
  };
}

/**
 * Calculate modal position using getBoundingClientRect (for dynamic content)
 * Call this in useEffect after render
 * @param {Object} options
 * @param {HTMLElement} options.element - modal element ref
 * @param {Object} options.position - { x, y } target position
 * @param {number} options.padding - screen edge padding (default: 16)
 * @returns {Object} { x, y } adjusted position
 */
export function adjustPositionToViewport({ element, position, padding = 16 }) {
  if (!element) return position;

  const rect = element.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x = position.x;
  let y = position.y;

  // Right boundary (centered modal)
  const rightEdge = x + rect.width / 2;
  if (rightEdge > vw - padding) {
    x = vw - padding - rect.width / 2;
  }

  // Left boundary (centered modal)
  const leftEdge = x - rect.width / 2;
  if (leftEdge < padding) {
    x = padding + rect.width / 2;
  }

  // Bottom boundary
  if (y + rect.height > vh - padding) {
    y = vh - padding - rect.height;
  }

  // Top boundary
  if (y < padding) {
    y = padding;
  }

  return { x, y };
}

/**
 * Get arrow CSS class based on placement
 * @param {'below'|'above'} placement
 * @returns {string} CSS class name
 */
export function getArrowClass(placement) {
  return placement === 'below' ? 'arrow-above' : 'arrow-below';
}

/**
 * Calculate responsive menu dimensions
 * @param {Object} options
 * @param {number} options.baseWidth - base width
 * @param {number} options.maxWidthPercent - max width as viewport percentage (default: 0.94)
 * @param {number} options.maxHeightPercent - max height as viewport percentage (default: 0.7)
 * @param {number} options.zoomScale - current zoom scale (default: 1)
 * @returns {Object} { width, maxHeight, scaleFactor }
 */
export function calculateMenuDimensions({
  baseWidth = 300,
  maxWidthPercent = 0.94,
  maxHeightPercent = 0.7,
  zoomScale = 1,
}) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const scaleFactor = Math.max(1, zoomScale * 0.8);
  const width = Math.min(baseWidth * scaleFactor, vw * maxWidthPercent);
  const maxHeight = Math.min(vh * maxHeightPercent * scaleFactor, vh * 0.85);

  return { width, maxHeight, scaleFactor };
}
