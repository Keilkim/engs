import { useState, useMemo } from 'react';
import { useTapToClose } from '../hooks/useTapToClose';
import { getArrowClass } from '../utils/positioning';

export default function GrammarTooltip({ pattern, annotation, position, placement = 'below', zoomScale = 1, onClose, onDelete }) {
  const [deleting, setDeleting] = useState(false);

  // 탭으로 닫기 핸들러
  const { handleTouchStart, handleTouchEnd, handleClick } = useTapToClose(onClose);

  // 줌 스케일에 따라 크기 조정
  const scaleFactor = Math.max(1, zoomScale * 0.8);

  // 화살표 방향
  const arrowClass = getArrowClass(placement);

  // Parse saved grammar data from annotation
  const savedData = useMemo(() => {
    if (!annotation?.ai_analysis_json) return null;
    try {
      const data = JSON.parse(annotation.ai_analysis_json);
      if (data.type === 'grammar') return data;
    } catch {}
    return null;
  }, [annotation]);

  // If we have saved grammar data, show all patterns
  const allPatterns = savedData?.patterns || (pattern ? [pattern] : []);
  const translation = savedData?.translation || '';

  if (allPatterns.length === 0) return null;

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete?.();
    } finally {
      setDeleting(false);
    }
  };

  // 모달 위치: Viewer.jsx에서 이미 계산된 값 그대로 사용
  // placement가 above면 모달을 위로 올려야 함 (translateY(-100%))
  const top = position.y;
  const translateY = placement === 'below' ? '0' : '-100%';
  const transformOrigin = placement === 'below' ? 'top center' : 'bottom center';

  return (
    <>
      <div
        className="grammar-tooltip-overlay"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      />
      <div
        className={`grammar-tooltip saved-grammar ${arrowClass}`}
        style={{
          top,
          left: position.x,
          transform: `translate(-50%, ${translateY}) scale(${scaleFactor})`,
          transformOrigin,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {translation && (
          <div className="grammar-translation">
            {translation}
          </div>
        )}

        <div className="grammar-patterns-list">
          {allPatterns.map((p, idx) => (
            <div key={idx} className="grammar-pattern-item">
              <span className="pattern-color-dot" style={{ background: p.color }} />
              <div className="pattern-content">
                <span className="pattern-type" style={{ color: p.color }}>{p.typeKr || p.type}</span>
                <span className="pattern-words">{p.words?.join(' ')}</span>
                <span className="pattern-explanation">{p.explanation}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="grammar-tooltip-actions">
          {onDelete && (
            <button className="delete-btn" onClick={handleDelete} disabled={deleting}>
              {deleting ? '...' : '삭제'}
            </button>
          )}
          <button className="close-btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </>
  );
}
