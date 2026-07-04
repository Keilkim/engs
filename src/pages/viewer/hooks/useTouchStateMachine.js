import { useEffect, useRef } from 'react';

/**
 * Hook for mobile touch state machine
 * Handles: single tap (vocab), long press (grammar), double tap (zoom reset),
 * single-finger pan (when zoomed), two-finger pinch/pan, swipe page navigation
 */
export function useTouchStateMachine({
  imageContainerRef,
  containerNode, // published by Viewer's callback ref; changes when the container mounts/swaps
  zoomScale, setZoomScale,
  panOffset, setPanOffset,
  clampPanOffset,
  activeModal,
  handleWordTap,
  handleImagePointerDown,
  handleImagePointerMove,
  // Shared refs (owned by Viewer.jsx)
  singleFingerPanRef,
  pinchStartRef,
  twoFingerPanRef,
  triggerShake,
  // Page navigation
  getPages, currentPage, setCurrentPage,
}) {
  // Owned by this hook
  const touchState = useRef({
    startTime: 0,
    startX: 0,
    startY: 0,
    moved: false,
    actionExecuted: false,
    timer: null,
  });
  const lastTapRef = useRef(null);

  // Mirror all frequently-changing inputs into a single ref so the touch
  // listeners can be registered ONCE on mount and read fresh values from the
  // ref. Previously pinch/pan (which change zoomScale/panOffset every frame)
  // forced the effect to tear down and re-add listeners on every frame.
  // The ref is updated in an effect (after render) so the touch handlers, which
  // only run on user interaction, always see the latest props.
  const propsRef = useRef({
    zoomScale, setZoomScale,
    panOffset, setPanOffset,
    clampPanOffset,
    activeModal,
    handleWordTap,
    handleImagePointerDown,
    handleImagePointerMove,
    singleFingerPanRef,
    pinchStartRef,
    twoFingerPanRef,
    triggerShake,
    getPages, currentPage, setCurrentPage,
  });
  useEffect(() => {
    propsRef.current = {
      zoomScale, setZoomScale,
      panOffset, setPanOffset,
      clampPanOffset,
      activeModal,
      handleWordTap,
      handleImagePointerDown,
      handleImagePointerMove,
      singleFingerPanRef,
      pinchStartRef,
      twoFingerPanRef,
      triggerShake,
      getPages, currentPage, setCurrentPage,
    };
  });

  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const LONG_PRESS_DURATION = 500;
    const TAP_MOVE_THRESHOLD = 10;
    const DOUBLE_TAP_DELAY = 300;
    const DOUBLE_TAP_DISTANCE = 50;

    const handleTouchStart = (e) => {
      const p = propsRef.current;
      const state = touchState.current;

      // 2손가락 → pinch zoom
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        p.singleFingerPanRef.current = null;
        p.handleImagePointerDown(e);
        return;
      }

      const touch = e.touches[0];

      // 확대 상태면 패닝 준비
      if (p.zoomScale > 1) {
        p.singleFingerPanRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          startPanX: p.panOffset.x,
          startPanY: p.panOffset.y,
        };
      }

      // 모달 열려있으면 탭 감지 안함
      if (p.activeModal.type === 'wordMenu') {
        return;
      }

      // 이전 타이머 정리 & 새 터치 시작
      if (state.timer) clearTimeout(state.timer);
      state.startTime = Date.now();
      state.startX = touch.clientX;
      state.startY = touch.clientY;
      state.moved = false;
      state.actionExecuted = false;

      // 롱프레스 타이머 (500ms)
      state.timer = setTimeout(() => {
        if (!state.moved) {
          state.actionExecuted = true;
          state.timer = null;
          propsRef.current.handleWordTap(state.startX, state.startY, true);
        }
      }, LONG_PRESS_DURATION);
    };

    const handleTouchMove = (e) => {
      const p = propsRef.current;
      const state = touchState.current;

      // 2손가락 → pinch zoom
      if (e.touches.length >= 2) {
        e.preventDefault();
        p.singleFingerPanRef.current = null;
        p.handleImagePointerMove(e);
        return;
      }

      const touch = e.touches[0];

      // 확대 상태 패닝
      if (p.zoomScale > 1 && p.singleFingerPanRef.current) {
        const deltaX = touch.clientX - p.singleFingerPanRef.current.startX;
        const deltaY = touch.clientY - p.singleFingerPanRef.current.startY;

        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          e.preventDefault();
          state.moved = true;
          if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
          }
          p.setPanOffset(p.clampPanOffset(
            p.singleFingerPanRef.current.startPanX + deltaX,
            p.singleFingerPanRef.current.startPanY + deltaY,
            p.zoomScale
          ));
          return;
        }
      }

      // 움직임 감지 → 탭/롱프레스 취소
      const deltaX = Math.abs(touch.clientX - state.startX);
      const deltaY = Math.abs(touch.clientY - state.startY);
      if (deltaX > TAP_MOVE_THRESHOLD || deltaY > TAP_MOVE_THRESHOLD) {
        state.moved = true;
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
      }
    };

    const handleTouchEnd = (e) => {
      const p = propsRef.current;
      const state = touchState.current;

      // 타이머 취소
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }

      // 2손가락 pinch 종료 → 남은 손가락의 후속 이벤트 차단
      if (p.pinchStartRef.current || p.twoFingerPanRef.current) {
        p.pinchStartRef.current = null;
        p.twoFingerPanRef.current = null;
        state.actionExecuted = true;
        return;
      }

      // 이미 롱프레스 실행됨 → 무시
      if (state.actionExecuted) {
        e.preventDefault();
        p.singleFingerPanRef.current = null;
        return;
      }

      // 움직임 없이 짧은 탭 (< 500ms)
      if (!state.moved) {
        const duration = Date.now() - state.startTime;

        if (duration < LONG_PRESS_DURATION) {
          // 탭을 처리하면 뒤따르는 synthetic mouse 이벤트를 막아 이중 트리거 방지
          e.preventDefault();

          const now = Date.now();
          const isZoomed = p.zoomScale > 1;

          // 더블탭 줌 리셋은 확대 상태에서만 활성화한다.
          // 비확대 시에는 더블탭 대기 없이 탭을 즉시 처리한다.
          if (isZoomed) {
            if (lastTapRef.current) {
              const timeSince = now - lastTapRef.current.time;
              const distX = Math.abs(state.startX - lastTapRef.current.x);
              const distY = Math.abs(state.startY - lastTapRef.current.y);

              if (timeSince < DOUBLE_TAP_DELAY && distX < DOUBLE_TAP_DISTANCE && distY < DOUBLE_TAP_DISTANCE) {
                lastTapRef.current = null;
                p.setZoomScale(1);
                p.setPanOffset({ x: 0, y: 0 });
                p.singleFingerPanRef.current = null;
                return;
              }
            }

            // 첫 탭 기록 & 딜레이 후 단일 탭 처리 (더블탭 여부 확인 대기)
            lastTapRef.current = { time: now, x: state.startX, y: state.startY };
            const tapX = state.startX;
            const tapY = state.startY;

            setTimeout(() => {
              if (lastTapRef.current && Date.now() - lastTapRef.current.time >= DOUBLE_TAP_DELAY) {
                propsRef.current.handleWordTap(tapX, tapY, false);
                lastTapRef.current = null;
              }
            }, DOUBLE_TAP_DELAY);
          } else {
            // 비확대: 즉시 단어 탭 처리
            lastTapRef.current = null;
            p.handleWordTap(state.startX, state.startY, false);
          }

          p.singleFingerPanRef.current = null;
          return;
        }
      }

      // 스와이프 감지 (움직임 있고, 확대 안된 상태)
      const pages = p.getPages();
      const isMultiPage = pages && pages.length > 1;
      if (state.moved && isMultiPage && p.zoomScale <= 1) {
        const touch = e.changedTouches?.[0];
        if (touch) {
          const deltaY = touch.clientY - state.startY;
          const deltaTime = Date.now() - state.startTime;
          if (deltaTime < 300 && Math.abs(deltaY) > 50) {
            if (deltaY > 0 && p.currentPage > 0) {
              p.setCurrentPage(p.currentPage - 1);
            } else if (deltaY < 0 && pages && p.currentPage < pages.length - 1) {
              p.setCurrentPage(p.currentPage + 1);
            } else {
              p.triggerShake();
            }
          }
        }
      }

      p.singleFingerPanRef.current = null;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      if (touchState.current.timer) {
        clearTimeout(touchState.current.timer);
      }
    };
    // Re-register when the container node mounts or the layout swaps it.
    // (Keyed on containerNode, not the stable ref object, so listeners actually
    // attach after the source finishes loading — otherwise long-press is dead.)
    // All other mutable inputs are still read via propsRef.
  }, [imageContainerRef, containerNode]);
}
