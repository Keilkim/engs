import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook for zoom and pan functionality
 */
export function useZoomPan(containerRef) {
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isShaking, setIsShaking] = useState(false);

  // Refs for gesture tracking
  const isPanning = useRef(false);
  const spacebarHeld = useRef(false);
  const panStartRef = useRef(null);
  const pinchStartRef = useRef(null);
  const twoFingerPanRef = useRef(null);
  const singleFingerPanRef = useRef(null);
  const lastTapRef = useRef(null);

  // Trigger shake animation (boundary feedback)
  const triggerShake = useCallback(() => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 300);
  }, []);

  // Clamp pan offset to stay within bounds
  const clampPanOffset = useCallback((offset, scale) => {
    if (scale <= 1) return { x: 0, y: 0 };

    const container = containerRef?.current;
    if (!container) return offset;

    const rect = container.getBoundingClientRect();
    const maxPanX = (rect.width * (scale - 1)) / 2;
    const maxPanY = (rect.height * (scale - 1)) / 2;

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, offset.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, offset.y)),
    };
  }, [containerRef]);

  // Reset zoom to 1x
  const resetZoom = useCallback(() => {
    setZoomScale(1);
    setZoomOrigin({ x: 50, y: 50 });
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Set zoom with clamping
  const setZoomWithClamp = useCallback((newScale, origin = null) => {
    const clampedScale = Math.max(1, Math.min(3, newScale));
    setZoomScale(clampedScale);

    if (origin) {
      setZoomOrigin(origin);
    }

    if (clampedScale <= 1) {
      setPanOffset({ x: 0, y: 0 });
    } else {
      setPanOffset(prev => clampPanOffset(prev, clampedScale));
    }

    return clampedScale;
  }, [clampPanOffset]);

  // Handle double tap to toggle zoom
  const handleDoubleTap = useCallback((clientX, clientY) => {
    const container = containerRef?.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const originX = ((clientX - rect.left) / rect.width) * 100;
    const originY = ((clientY - rect.top) / rect.height) * 100;

    if (zoomScale > 1) {
      resetZoom();
    } else {
      setZoomWithClamp(2, { x: originX, y: originY });
    }
  }, [containerRef, zoomScale, resetZoom, setZoomWithClamp]);

  // Check for double tap
  const checkDoubleTap = useCallback((clientX, clientY) => {
    const now = Date.now();
    const last = lastTapRef.current;

    if (last && now - last.time < 300) {
      const dx = Math.abs(clientX - last.x);
      const dy = Math.abs(clientY - last.y);
      if (dx < 30 && dy < 30) {
        lastTapRef.current = null;
        return true;
      }
    }

    lastTapRef.current = { time: now, x: clientX, y: clientY };
    return false;
  }, []);

  // Start panning
  const startPan = useCallback((clientX, clientY) => {
    isPanning.current = true;
    panStartRef.current = {
      clientX,
      clientY,
      startPanX: panOffset.x,
      startPanY: panOffset.y,
    };
  }, [panOffset]);

  // Update pan during movement
  const updatePan = useCallback((clientX, clientY) => {
    if (!isPanning.current || !panStartRef.current) return;

    const dx = clientX - panStartRef.current.clientX;
    const dy = clientY - panStartRef.current.clientY;

    const newOffset = {
      x: panStartRef.current.startPanX + dx,
      y: panStartRef.current.startPanY + dy,
    };

    setPanOffset(clampPanOffset(newOffset, zoomScale));
  }, [zoomScale, clampPanOffset]);

  // End panning
  const endPan = useCallback(() => {
    isPanning.current = false;
    panStartRef.current = null;
  }, []);

  // Handle pinch zoom start
  const startPinch = useCallback((touches, container) => {
    if (touches.length < 2) return;

    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const centerX = (touches[0].clientX + touches[1].clientX) / 2;
    const centerY = (touches[0].clientY + touches[1].clientY) / 2;

    const rect = container.getBoundingClientRect();
    const originX = ((centerX - rect.left) / rect.width) * 100;
    const originY = ((centerY - rect.top) / rect.height) * 100;

    pinchStartRef.current = {
      distance,
      scale: zoomScale,
      originX,
      originY,
    };

    twoFingerPanRef.current = {
      centerX,
      centerY,
      startPanX: panOffset.x,
      startPanY: panOffset.y,
    };
  }, [zoomScale, panOffset]);

  // Handle pinch zoom move
  const updatePinch = useCallback((touches) => {
    if (touches.length < 2 || !pinchStartRef.current) return;

    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const centerX = (touches[0].clientX + touches[1].clientX) / 2;
    const centerY = (touches[0].clientY + touches[1].clientY) / 2;

    // Calculate new scale
    const scaleFactor = distance / pinchStartRef.current.distance;
    const newScale = Math.max(1, Math.min(3, pinchStartRef.current.scale * scaleFactor));

    setZoomScale(newScale);
    setZoomOrigin({
      x: pinchStartRef.current.originX,
      y: pinchStartRef.current.originY,
    });

    // Two-finger pan
    if (twoFingerPanRef.current && newScale > 1) {
      const panDx = centerX - twoFingerPanRef.current.centerX;
      const panDy = centerY - twoFingerPanRef.current.centerY;

      const newOffset = {
        x: twoFingerPanRef.current.startPanX + panDx,
        y: twoFingerPanRef.current.startPanY + panDy,
      };

      setPanOffset(clampPanOffset(newOffset, newScale));
    }

    if (newScale <= 1) {
      setPanOffset({ x: 0, y: 0 });
    }
  }, [clampPanOffset]);

  // End pinch
  const endPinch = useCallback(() => {
    pinchStartRef.current = null;
    twoFingerPanRef.current = null;
  }, []);

  // Keyboard handler for spacebar pan
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !spacebarHeld.current && zoomScale > 1) {
        spacebarHeld.current = true;
        e.preventDefault();
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        spacebarHeld.current = false;
        endPan();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [zoomScale, endPan]);

  return {
    // State
    zoomScale,
    zoomOrigin,
    panOffset,
    isShaking,

    // Setters
    setZoomScale,
    setZoomOrigin,
    setPanOffset,

    // Refs (for external gesture handling)
    isPanning,
    spacebarHeld,
    singleFingerPanRef,
    pinchStartRef,

    // Actions
    resetZoom,
    setZoomWithClamp,
    triggerShake,
    clampPanOffset,
    checkDoubleTap,
    handleDoubleTap,
    startPan,
    updatePan,
    endPan,
    startPinch,
    updatePinch,
    endPinch,
  };
}
