import { useCallback, useRef } from 'react';

// Get coordinates from mouse or touch event
function getEventCoords(e) {
  if (e.touches && e.touches.length > 0) {
    return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
  }
  return { clientX: e.clientX, clientY: e.clientY };
}

// Calculate distance between two touch points
function getTouchDistance(touches) {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Hook for desktop pointer gestures (mouse click/drag, spacebar pan, pinch zoom)
 * Also handles 2-finger touch events delegated from the touch state machine
 */
export function useDesktopGestures({
  imageContainerRef,
  zoomScale, setZoomScale,
  panOffset, setPanOffset,
  handleWordTap,
  // Shared refs (owned by Viewer.jsx)
  isPanning, spacebarHeld, panStartRef,
  pinchStartRef, twoFingerPanRef, touchStartRef,
}) {
  const mouseClickStart = useRef(null);
  const mouseTimer = useRef(null);

  // Clamp pan offset so the zoomed image fills the visible viewport.
  // Accounts for container being centered within screenshot-main.
  const clampPanOffset = useCallback((offsetX, offsetY, scale) => {
    if (scale <= 1) return { x: 0, y: 0 };

    const container = imageContainerRef.current;
    if (!container) return { x: offsetX, y: offsetY };

    const w = container.offsetWidth;
    const h = container.offsetHeight;

    // Find the visible viewport (screenshot-main) and container's offset within it
    const parent = container.closest('.screenshot-main');
    if (!parent) {
      // Fallback: simple clamp
      return {
        x: Math.max(w - w * scale, Math.min(0, offsetX)),
        y: Math.max(h - h * scale, Math.min(0, offsetY)),
      };
    }

    const containerRect = container.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const offsetLeft = containerRect.left - parentRect.left;
    const offsetTop = containerRect.top - parentRect.top;

    // Image left edge in parent coords: offsetLeft + panX
    // Image right edge: offsetLeft + panX + w * scale
    // Constraints: left edge <= 0, right edge >= parentWidth
    const maxX = -offsetLeft;
    const minX = parentRect.width - offsetLeft - w * scale;
    const maxY = -offsetTop;
    const minY = parentRect.height - offsetTop - h * scale;

    return {
      x: minX > maxX ? 0 : Math.max(minX, Math.min(maxX, offsetX)),
      y: minY > maxY ? 0 : Math.max(minY, Math.min(maxY, offsetY)),
    };
  }, [imageContainerRef]);

  // Trigger shake animation for boundary feedback
  const triggerShake = useCallback((setIsShaking) => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 300);
  }, []);

  // Mouse/Touch pointer down
  const handleImagePointerDown = useCallback((e) => {
    if (!imageContainerRef.current) return;

    // Middle mouse button - start panning
    if (e.button === 1) {
      e.preventDefault();
      isPanning.current = true;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
      };
      return;
    }

    // Spacebar held + left click - start panning
    if (spacebarHeld.current && e.button === 0) {
      e.preventDefault();
      isPanning.current = true;
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
      };
      return;
    }

    // Two-finger touch - start pinch zoom OR pan
    if (e.touches && e.touches.length >= 2) {
      touchStartRef.current = null;

      const rect = imageContainerRef.current.getBoundingClientRect();
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      const imageX = (centerX - rect.left - panOffset.x) / zoomScale;
      const imageY = (centerY - rect.top - panOffset.y) / zoomScale;

      pinchStartRef.current = {
        distance: getTouchDistance(e.touches),
        scale: zoomScale,
        imageX,
        imageY,
        panX: panOffset.x,
        panY: panOffset.y,
      };
      twoFingerPanRef.current = {
        centerX,
        centerY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
      };
      return;
    }

    // Left mouse button - start click/long-press detection
    if (e.button === 0 && !e.touches) {
      const { clientX, clientY } = getEventCoords(e);
      mouseClickStart.current = {
        x: clientX,
        y: clientY,
        time: Date.now(),
        moved: false,
      };

      mouseTimer.current = setTimeout(() => {
        if (mouseClickStart.current && !mouseClickStart.current.moved) {
          const clickData = mouseClickStart.current;
          mouseClickStart.current = null;
          mouseTimer.current = null;
          handleWordTap(clickData.x, clickData.y, true);
        }
      }, 500);
    }
  }, [imageContainerRef, zoomScale, panOffset, handleWordTap, isPanning, spacebarHeld, panStartRef, pinchStartRef, twoFingerPanRef, touchStartRef]);

  // Mouse/Touch pointer move
  const handleImagePointerMove = useCallback((e) => {
    // Desktop panning (middle button or spacebar + drag)
    if (isPanning.current && panStartRef.current) {
      const { clientX, clientY } = getEventCoords(e);
      const deltaX = clientX - panStartRef.current.clientX;
      const deltaY = clientY - panStartRef.current.clientY;
      const newOffset = clampPanOffset(
        panStartRef.current.startPanX + deltaX,
        panStartRef.current.startPanY + deltaY,
        zoomScale
      );
      setPanOffset(newOffset);
      return;
    }

    // Two-finger touch - handle pinch zoom AND pan
    if (e.touches && e.touches.length >= 2) {
      touchStartRef.current = null;

      const rect = imageContainerRef.current.getBoundingClientRect();
      const currentDistance = getTouchDistance(e.touches);
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      if (pinchStartRef.current) {
        const scaleFactor = currentDistance / pinchStartRef.current.distance;
        const newScale = Math.min(6, Math.max(1, pinchStartRef.current.scale * scaleFactor));

        const newPanX = centerX - rect.left - pinchStartRef.current.imageX * newScale;
        const newPanY = centerY - rect.top - pinchStartRef.current.imageY * newScale;

        const newOffset = clampPanOffset(newPanX, newPanY, newScale);
        setZoomScale(newScale);
        setPanOffset(newOffset);

        pinchStartRef.current.distance = currentDistance;
        pinchStartRef.current.scale = newScale;
        pinchStartRef.current.panX = newOffset.x;
        pinchStartRef.current.panY = newOffset.y;
        pinchStartRef.current.imageX = (centerX - rect.left - newOffset.x) / newScale;
        pinchStartRef.current.imageY = (centerY - rect.top - newOffset.y) / newScale;
      }
      return;
    }

    // Mouse movement detection - cancel click if moved too much
    if (mouseClickStart.current && !e.touches) {
      const { clientX, clientY } = getEventCoords(e);
      const deltaX = Math.abs(clientX - mouseClickStart.current.x);
      const deltaY = Math.abs(clientY - mouseClickStart.current.y);

      if (deltaX > 10 || deltaY > 10) {
        mouseClickStart.current.moved = true;
        if (mouseTimer.current) {
          clearTimeout(mouseTimer.current);
          mouseTimer.current = null;
        }
      }
    }
  }, [imageContainerRef, clampPanOffset, zoomScale, setZoomScale, setPanOffset, isPanning, panStartRef, pinchStartRef, twoFingerPanRef, touchStartRef]);

  // Mouse/Touch pointer up
  const handleImagePointerUp = useCallback((e) => {
    // Reset panning state
    if (isPanning.current) {
      isPanning.current = false;
      panStartRef.current = null;
      return;
    }

    // Reset pinch zoom and two-finger pan tracking
    pinchStartRef.current = null;
    twoFingerPanRef.current = null;

    // Clear long-press timer
    if (mouseTimer.current) {
      clearTimeout(mouseTimer.current);
      mouseTimer.current = null;
    }

    // Mouse click detection (desktop)
    if (mouseClickStart.current && !e.touches) {
      const clickData = mouseClickStart.current;
      mouseClickStart.current = null;

      if (!clickData.moved) {
        const deltaTime = Date.now() - clickData.time;
        if (deltaTime < 500) {
          handleWordTap(clickData.x, clickData.y, false);
        }
      }
      return;
    }

    touchStartRef.current = null;
  }, [handleWordTap, isPanning, panStartRef, pinchStartRef, twoFingerPanRef, touchStartRef]);

  return {
    handleImagePointerDown,
    handleImagePointerMove,
    handleImagePointerUp,
    clampPanOffset,
    triggerShake,
    getEventCoords,
    getTouchDistance,
  };
}
