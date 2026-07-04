import { useTapToClose } from '../hooks/useTapToClose';
import { calculateModalPosition, getArrowClass } from '../utils/positioning';

export default function VocabTooltip({
  word,
  definition,
  position,
  placement = 'below',
  annotation,
  leftMargin = 12,
  onClose,
  onDelete
}) {
  // 탭으로 닫기 핸들러
  const { handleTouchStart, handleTouchEnd, handleClick } = useTapToClose(onClose);

  // 모달 크기 계산
  const vw = typeof window !== 'undefined' ? window.innerWidth : 375;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 667;
  const menuWidth = Math.min(300, vw - 32);

  // 위치 계산 (WordQuickMenu와 동일한 로직)
  const { left, top, transform, arrowLeft } = calculateModalPosition({
    position,
    menuWidth,
    margin: 12,
    leftMargin,
    placement,
  });

  const tooltipStyle = {
    position: 'fixed',
    left,
    top,
    transform,
    width: menuWidth,
    maxHeight: vh * 0.6,
    overflow: 'visible',
    '--arrow-left': `${arrowLeft}%`,
  };

  const handleListen = () => {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  return (
    <>
      <div
        className="vocab-tooltip-overlay"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      />
      <div
        className={`vocab-tooltip ${getArrowClass(placement)}${annotation ? ' with-actions' : ''}`}
        style={tooltipStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vocab-tooltip-header">
          <span className="vocab-tooltip-word">{word}</span>
          <button
            className="listen-btn"
            onClick={handleListen}
            title="듣기"
          >
            🔊
          </button>
        </div>
        <pre className="vocab-tooltip-definition">{typeof definition === 'string' ? definition : ''}</pre>
        {annotation && (
          <div className="vocab-tooltip-actions">
            <button className="delete-btn" onClick={onDelete}>
              삭제
            </button>
            <button className="close-btn" onClick={onClose}>
              닫기
            </button>
          </div>
        )}
      </div>
    </>
  );
}
