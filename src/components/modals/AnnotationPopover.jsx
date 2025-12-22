import { useState } from 'react';
import { deleteAnnotation } from '../../services/annotation';
import { TranslatableText } from '../translatable';

export default function AnnotationPopover({
  isOpen,
  position,
  annotation,
  onClose,
  onDelete,
}) {
  const [error, setError] = useState('');

  if (!isOpen || !annotation) return null;

  async function handleDelete() {
    try {
      await deleteAnnotation(annotation.id);
      onDelete();
    } catch {
      setError('주석 삭제 실패');
    }
  }

  // Parse AI analysis if available
  let aiAnalysis = null;
  if (annotation.ai_analysis_json) {
    try {
      aiAnalysis = JSON.parse(annotation.ai_analysis_json);
    } catch (e) {
      // Invalid JSON, ignore
    }
  }

  return (
    <>
      <div className="annotation-popover-overlay" onClick={onClose} />
      <div
        className="annotation-popover"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: 'translateX(-50%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {error && <div className="modal-error">{error}</div>}
        <div className="annotation-popover-header">
          <span className="annotation-type-badge">
            {annotation.type === 'highlight' ? 'Highlight' : 'Memo'}
          </span>
          <button className="popover-close" onClick={onClose}>×</button>
        </div>

        <div className="annotation-popover-content">
          {/* Selected text */}
          <div className="annotation-text">
            "{annotation.selected_text}"
          </div>

          {/* Memo content */}
          {annotation.memo_content && (
            <div className="annotation-memo">
              <strong><TranslatableText textKey="annotation.memo">Memo</TranslatableText>:</strong>
              <p>{annotation.memo_content}</p>
            </div>
          )}

          {/* AI Analysis */}
          {aiAnalysis && (
            <div className="annotation-analysis">
              {aiAnalysis.definition && (
                <div className="analysis-item">
                  <strong><TranslatableText textKey="annotation.definition">Definition</TranslatableText>:</strong>
                  <p>{aiAnalysis.definition}</p>
                </div>
              )}
              {aiAnalysis.pronunciation && (
                <div className="analysis-item">
                  <strong><TranslatableText textKey="annotation.pronunciation">Pronunciation</TranslatableText>:</strong>
                  <p>{aiAnalysis.pronunciation}</p>
                </div>
              )}
              {aiAnalysis.examples && aiAnalysis.examples.length > 0 && (
                <div className="analysis-item">
                  <strong><TranslatableText textKey="annotation.examples">Examples</TranslatableText>:</strong>
                  <ul>
                    {aiAnalysis.examples.map((ex, i) => (
                      <li key={i}>{ex}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiAnalysis.grammar && (
                <div className="analysis-item">
                  <strong><TranslatableText textKey="annotation.grammar">Grammar</TranslatableText>:</strong>
                  <p>{aiAnalysis.grammar}</p>
                </div>
              )}
            </div>
          )}

          {/* Created date */}
          <div className="annotation-date">
            {new Date(annotation.created_at).toLocaleDateString()}
          </div>
        </div>

        <div className="annotation-popover-actions">
          <button className="delete-btn" onClick={handleDelete}>
            <TranslatableText textKey="annotation.delete">Delete</TranslatableText>
          </button>
        </div>
      </div>
    </>
  );
}
