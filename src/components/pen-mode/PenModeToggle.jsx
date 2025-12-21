import { useRef, useCallback } from 'react';
import './PenModeToggle.css';

// 마법봉 아이콘 (비활성 상태) - 심플한 스타 + 봉 디자인
const MagicWandIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {/* 대각선 봉 */}
    <line x1="4" y1="20" x2="16" y2="8" />
    {/* 별 반짝임 */}
    <path d="M18 2v4" />
    <path d="M16 4h4" />
    <path d="M21 9v2" />
    <path d="M20 10h2" />
  </svg>
);

// 펜 아이콘 (활성 상태)
const PenIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

export default function PenModeToggle({
  isActive,
  onToggle,
  onLongPress,
  penColor,
}) {
  const longPressTimer = useRef(null);
  const isLongPressTriggered = useRef(false);

  const handlePointerDown = useCallback(
    (e) => {
      e.preventDefault();
      isLongPressTriggered.current = false;

      longPressTimer.current = setTimeout(() => {
        isLongPressTriggered.current = true;
        onLongPress?.();
      }, 500);
    },
    [onLongPress]
  );

  const handlePointerUp = useCallback(
    (e) => {
      e.preventDefault();
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }

      // 길게 누르기가 트리거되지 않았으면 토글
      if (!isLongPressTriggered.current) {
        onToggle();
      }
    },
    [onToggle]
  );

  const handlePointerLeave = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  return (
    <button
      className={`pen-mode-toggle ${isActive ? 'active' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={isActive ? '펜 모드 끄기' : '펜 모드 켜기'}
    >
      {isActive ? <PenIcon /> : <MagicWandIcon />}
      {isActive && (
        <span
          className="color-indicator"
          style={{ backgroundColor: penColor }}
        />
      )}
    </button>
  );
}
