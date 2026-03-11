import { useEffect, useRef } from 'react';

/**
 * Hook for mobile touch state machine
 * Handles: single tap (vocab), long press (grammar), double tap (zoom reset),
 * single-finger pan (when zoomed), two-finger pinch/pan, swipe page navigation
 */
export function useTouchStateMachine({
  imageContainerRef,
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

  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const pages = getPages();
    const isMultiPage = pages && pages.length > 1;
    const LONG_PRESS_DURATION = 500;
    const TAP_MOVE_THRESHOLD = 10;
    const DOUBLE_TAP_DELAY = 300;
    const DOUBLE_TAP_DISTANCE = 50;

    const handleTouchStart = (e) => {
      const state = touchState.current;

      // 2손가락 → pinch zoom
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        singleFingerPanRef.current = null;
        handleImagePointerDown(e);
        return;
      }

      const touch = e.touches[0];

      // 확대 상태면 패닝 준비
      if (zoomScale > 1) {
        singleFingerPanRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          startPanX: panOffset.x,
          startPanY: panOffset.y,
        };
      }

      // 모달 열려있으면 탭 감지 안함
      if (activeModal.type === 'wordMenu') {
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
          handleWordTap(state.startX, state.startY, true);
        }
      }, LONG_PRESS_DURATION);
    };

    const handleTouchMove = (e) => {
      const state = touchState.current;

      // 2손가락 → pinch zoom
      if (e.touches.length >= 2) {
        e.preventDefault();
        singleFingerPanRef.current = null;
        handleImagePointerMove(e);
        return;
      }

      const touch = e.touches[0];

      // 확대 상태 패닝
      if (zoomScale > 1 && singleFingerPanRef.current) {
        const deltaX = touch.clientX - singleFingerPanRef.current.startX;
        const deltaY = touch.clientY - singleFingerPanRef.current.startY;

        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          e.preventDefault();
          state.moved = true;
          if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
          }
          setPanOffset(clampPanOffset(
            singleFingerPanRef.current.startPanX + deltaX,
            singleFingerPanRef.current.startPanY + deltaY,
            zoomScale
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
      const state = touchState.current;

      // 타이머 취소
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }

      // 2손가락 pinch 종료 → 남은 손가락의 후속 이벤트 차단
      if (pinchStartRef.current || twoFingerPanRef.current) {
        pinchStartRef.current = null;
        twoFingerPanRef.current = null;
        state.actionExecuted = true;
        return;
      }

      // 이미 롱프레스 실행됨 → 무시
      if (state.actionExecuted) {
        e.preventDefault();
        singleFingerPanRef.current = null;
        return;
      }

      // 움직임 없이 짧은 탭 (< 500ms)
      if (!state.moved) {
        const duration = Date.now() - state.startTime;

        if (duration < LONG_PRESS_DURATION) {
          const now = Date.now();

          // 더블탭 감지
          if (lastTapRef.current) {
            const timeSince = now - lastTapRef.current.time;
            const distX = Math.abs(state.startX - lastTapRef.current.x);
            const distY = Math.abs(state.startY - lastTapRef.current.y);

            if (timeSince < DOUBLE_TAP_DELAY && distX < DOUBLE_TAP_DISTANCE && distY < DOUBLE_TAP_DISTANCE) {
              lastTapRef.current = null;
              setZoomScale(1);
              setPanOffset({ x: 0, y: 0 });
              singleFingerPanRef.current = null;
              return;
            }
          }

          // 첫 탭 기록 & 딜레이 후 단일 탭 처리
          lastTapRef.current = { time: now, x: state.startX, y: state.startY };
          const tapX = state.startX;
          const tapY = state.startY;

          setTimeout(() => {
            if (lastTapRef.current && Date.now() - lastTapRef.current.time >= DOUBLE_TAP_DELAY) {
              handleWordTap(tapX, tapY, false);
              lastTapRef.current = null;
            }
          }, DOUBLE_TAP_DELAY);

          singleFingerPanRef.current = null;
          return;
        }
      }

      // 스와이프 감지 (움직임 있고, 확대 안된 상태)
      if (state.moved && isMultiPage && zoomScale <= 1) {
        const touch = e.changedTouches?.[0];
        if (touch) {
          const deltaY = touch.clientY - state.startY;
          const deltaTime = Date.now() - state.startTime;
          if (deltaTime < 300 && Math.abs(deltaY) > 50) {
            if (deltaY > 0 && currentPage > 0) {
              setCurrentPage(currentPage - 1);
            } else if (deltaY < 0 && pages && currentPage < pages.length - 1) {
              setCurrentPage(currentPage + 1);
            } else {
              triggerShake();
            }
          }
        }
      }

      singleFingerPanRef.current = null;
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
  }, [
    imageContainerRef, getPages, currentPage, setCurrentPage,
    handleImagePointerDown, handleImagePointerMove, triggerShake,
    zoomScale, setZoomScale, panOffset, setPanOffset, clampPanOffset,
    activeModal, handleWordTap,
    singleFingerPanRef, pinchStartRef, twoFingerPanRef,
  ]);
}
