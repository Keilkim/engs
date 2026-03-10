import { cleanDisplayText } from '../../utils/textUtils';

export default function VocabModeContent({
  word, definition, loading, error, speaking,
  existingAnnotation,
  onSave, onDelete, onClose,
  onSpeak, onStopSpeaking,
  ko,
}) {
  if (existingAnnotation) {
    return (
      <>
        {error && <div className="modal-error">{error}</div>}
        <div className="word-menu-header">
          <span className="word-text">{cleanDisplayText(existingAnnotation.selected_text)}</span>
          <button
            className={`listen-btn ${speaking ? 'speaking' : ''}`}
            onClick={() => speaking ? onStopSpeaking() : onSpeak(existingAnnotation.selected_text)}
          >
            {speaking ? '■' : '🔊'}
          </button>
        </div>
        <div className="word-definition">
          {definition || 'No definition'}
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

  return (
    <>
      <div className="word-menu-header">
        <span className="word-text">{cleanDisplayText(word)}</span>
        <button
          className={`listen-btn ${speaking ? 'speaking' : ''}`}
          onClick={() => speaking ? onStopSpeaking() : onSpeak(word)}
        >
          {speaking ? '■' : '🔊'}
        </button>
      </div>
      {loading ? (
        <div className="loading-state">{ko('wordMenu.lookingUp')}</div>
      ) : (
        <>
          {definition && <div className="word-definition">{definition}</div>}
          <div className="word-menu-actions">
            <button className="save-btn" onClick={onSave}>
              Save
            </button>
            <button className="close-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </>
  );
}
