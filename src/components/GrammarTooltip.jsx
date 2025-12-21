import { useState, useMemo } from 'react';

export default function GrammarTooltip({ pattern, annotation, position, zoomScale = 1, onClose, onDelete }) {
  const [deleting, setDeleting] = useState(false);

  // 줌 스케일에 따라 크기 조정
  const scaleFactor = Math.max(1, zoomScale * 0.8);

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

  return (
    <div
      className="grammar-tooltip saved-grammar"
      style={{
        top: position.y,
        left: position.x,
        transform: `translate(-50%, 0) scale(${scaleFactor})`,
        transformOrigin: 'top center',
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
  );
}
