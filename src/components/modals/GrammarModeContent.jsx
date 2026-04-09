import { useState } from 'react';
import { createSentencePattern } from '../../services/annotation';

export default function GrammarModeContent({
  grammarData, checkedPatterns, loading, error,
  existingAnnotation,
  onSave, onDelete, onClose,
  onTogglePattern,
  ko,
}) {
  const [savedPatternIds, setSavedPatternIds] = useState(new Set());

  async function handleSaveAsPattern(pattern, index) {
    if (savedPatternIds.has(index)) return;
    const parts = pattern.words || [];
    const patternText = parts.join('...');
    const explanation = pattern.explanation || '';
    const example = grammarData.originalText || '';
    try {
      await createSentencePattern(patternText, parts, explanation, example);
      setSavedPatternIds(prev => new Set([...prev, index]));
    } catch (err) {
      console.error('Failed to save pattern:', err);
    }
  }

  if (existingAnnotation && grammarData) {
    return (
      <>
        <div className="grammar-patterns">
          {grammarData.patterns?.map((pattern, i) => (
            <div key={i} className="pattern-item">
              <div className="pattern-content">
                <span className="pattern-words">{pattern.words?.join(' ')}</span>
                <span className="pattern-explanation">{pattern.explanation}</span>
              </div>
              <button
                className={`save-pattern-btn${savedPatternIds.has(i) ? ' saved' : ''}`}
                onClick={() => handleSaveAsPattern(pattern, i)}
                disabled={savedPatternIds.has(i)}
                title="Save as sentence pattern"
              >
                {savedPatternIds.has(i) ? '✓' : '+P'}
              </button>
            </div>
          ))}
        </div>
        <div className="word-menu-actions">
          <button className="delete-btn" onClick={onDelete} disabled={loading}>
            Delete
          </button>
          <button className="close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </>
    );
  }

  if (loading) {
    return <div className="loading-state">{ko('wordMenu.analyzing')}</div>;
  }

  if (grammarData) {
    const hasPatterns = grammarData.patterns?.length > 0;
    return (
      <>
        {hasPatterns ? (
          <div className="grammar-patterns">
            {grammarData.patterns.map((pattern, i) => (
              <div key={i} className="pattern-checkbox-row">
                <label className="pattern-checkbox">
                  <input
                    type="checkbox"
                    checked={checkedPatterns.includes(i)}
                    onChange={() => onTogglePattern(i)}
                  />
                  <div className="pattern-content">
                    <span className="pattern-words">{pattern.words?.join(' ')}</span>
                    <span className="pattern-explanation">{pattern.explanation}</span>
                  </div>
                </label>
                <button
                  className={`save-pattern-btn${savedPatternIds.has(i) ? ' saved' : ''}`}
                  onClick={() => handleSaveAsPattern(pattern, i)}
                  disabled={savedPatternIds.has(i)}
                  title="Save as sentence pattern"
                >
                  {savedPatternIds.has(i) ? '✓' : '+P'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">{ko('wordMenu.noPatterns')}</div>
        )}
        <div className="word-menu-actions">
          <button
            className="save-btn"
            onClick={onSave}
            disabled={!hasPatterns || checkedPatterns.length === 0}
          >
            Save
          </button>
          <button className="close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </>
    );
  }

  return <div className="modal-error-state">{error || ko('wordMenu.analysisFailed')}</div>;
}
