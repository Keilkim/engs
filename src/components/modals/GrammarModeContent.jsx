export default function GrammarModeContent({
  grammarData, checkedPatterns, loading, error,
  existingAnnotation,
  onSave, onDelete, onClose,
  onTogglePattern,
  ko,
}) {
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
              <label key={i} className="pattern-checkbox">
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
