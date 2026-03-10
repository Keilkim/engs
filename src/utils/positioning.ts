import type { Position } from '../types';

/**
 * Modal/Tooltip positioning utilities
 */

interface ModalPositionOptions {
  position: Position;
  menuWidth: number;
  menuHeight?: number;
  margin?: number;
  placement?: 'below' | 'above';
  centerHorizontal?: boolean;
}

interface ModalPositionResult {
  left: number;
  top: number;
  transform: string;
  transformOrigin: string;
  arrowLeft: number;
}

interface AdjustPositionOptions {
  element: HTMLElement | null;
  position: Position;
  padding?: number;
}

interface MenuDimensionOptions {
  baseWidth?: number;
  maxWidthPercent?: number;
  maxHeightPercent?: number;
  zoomScale?: number;
}

/**
 * Get the mobile safe area bottom inset.
 */
export function getMobileSafeAreaBottom(): number {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile) return 0;

  const safeAreaBottom = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom') || '0',
    10
  ) || 0;

  const mobileBottomBarPadding = 50;
  return Math.max(safeAreaBottom, mobileBottomBarPadding);
}

/**
 * Calculate modal position with screen boundary checks.
 */
export function calculateModalPosition({
  position,
  menuWidth,
  menuHeight = 0,
  margin = 12,
  placement = 'below',
  centerHorizontal = true,
}: ModalPositionOptions): ModalPositionResult {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safeAreaBottom = getMobileSafeAreaBottom();

  let left: number;
  if (centerHorizontal) {
    left = Math.max(margin, Math.min(position.x - menuWidth / 2, vw - menuWidth - margin));
  } else {
    left = Math.max(margin, Math.min(position.x, vw - menuWidth - margin));
  }

  let top = position.y;

  if (menuHeight > 0) {
    if (placement === 'below') {
      const maxBottom = vh - margin - safeAreaBottom;
      if (top + menuHeight > maxBottom) {
        top = maxBottom - menuHeight;
      }
    } else {
      if (top - menuHeight < margin) {
        top = margin + menuHeight;
      }
    }
    if (top < margin) {
      top = margin;
    }
  } else {
    const maxTop = vh - margin - safeAreaBottom - 100;
    if (placement === 'below' && top > maxTop) {
      top = maxTop;
    }
  }

  const translateY = placement === 'below' ? '0' : '-100%';
  const transformOrigin = placement === 'below' ? 'top center' : 'bottom center';
  const arrowLeft = Math.min(Math.max(((position.x - left) / menuWidth) * 100, 10), 90);

  return { left, top, transform: `translateY(${translateY})`, transformOrigin, arrowLeft };
}

/**
 * Adjust position to keep element within viewport.
 */
export function adjustPositionToViewport({ element, position, padding = 16 }: AdjustPositionOptions): Position {
  if (!element) return position;

  const rect = element.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safeAreaBottom = getMobileSafeAreaBottom();

  let x = position.x;
  let y = position.y;

  const rightEdge = x + rect.width / 2;
  if (rightEdge > vw - padding) {
    x = vw - padding - rect.width / 2;
  }

  const leftEdge = x - rect.width / 2;
  if (leftEdge < padding) {
    x = padding + rect.width / 2;
  }

  const maxBottom = vh - padding - safeAreaBottom;
  if (y + rect.height > maxBottom) {
    y = maxBottom - rect.height;
  }

  if (y < padding) {
    y = padding;
  }

  return { x, y };
}

/**
 * Get arrow CSS class based on placement.
 */
export function getArrowClass(placement: 'below' | 'above'): string {
  return placement === 'below' ? 'arrow-above' : 'arrow-below';
}

/**
 * Calculate responsive menu dimensions.
 */
export function calculateMenuDimensions({
  baseWidth = 300,
  maxWidthPercent = 0.94,
  maxHeightPercent = 0.7,
  zoomScale = 1,
}: MenuDimensionOptions = {}): { width: number; maxHeight: number; scaleFactor: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const scaleFactor = Math.max(1, zoomScale * 0.8);
  const width = Math.min(baseWidth * scaleFactor, vw * maxWidthPercent);
  const maxHeight = Math.min(vh * maxHeightPercent * scaleFactor, vh * 0.85);

  return { width, maxHeight, scaleFactor };
}
