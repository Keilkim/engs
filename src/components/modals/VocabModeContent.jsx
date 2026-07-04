import { cleanDisplayText } from '../../utils/textUtils';

// Map internal error codes to a user-facing Korean message.
function errorMessage(error, ko) {
  if (!error) return '';
  if (error === 'saveFailed') return '저장에 실패했습니다. 다시 시도해 주세요.';
  return ko(`wordMenu.${error}`, '오류가 발생했습니다. 다시 시도해 주세요.');
}

export default function VocabModeContent({
  word, definition, phonetic, loading, error, speaking, canSave = true,
  existingAnnotation,
  onSave, onRetry, onDelete, onClose,
  onSpeak, onStopSpeaking,
  ko,
}) {
  // Defensive: never render a non-string definition (legacy corrupted rows
  // stored the whole lookup object here, which crashes React).
  const safeDefinition = typeof definition === 'string' ? definition : '';

  if (existingAnnotation) {
    return (
      <>
        {error && <div className="modal-error">{errorMessage(error, ko)}</div>}
        <div className="word-menu-header">
          <span className="word-text">{cleanDisplayText(existingAnnotation.selected_text)}</span>
          <button
            className={`listen-btn ${speaking ? 'speaking' : ''}`}
            onClick={() => speaking ? onStopSpeaking() : onSpeak(existingAnnotation.selected_text)}
          >
            {speaking ? '■' : '🔊'}
          </button>
        </div>
        {phonetic && (
          <div className="word-phonetic">{phonetic}</div>
        )}
        <div className="word-definition">
          {safeDefinition || 'No definition'}
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
          {error ? (
            <div className="modal-error-state">
              {errorMessage(error, ko)}
              {onRetry && (
                <button className="retry-btn" onClick={onRetry}>
                  다시 시도
                </button>
              )}
            </div>
          ) : (
            safeDefinition && <div className="word-definition">{safeDefinition}</div>
          )}
          <div className="word-menu-actions">
            {canSave ? (
              // Prevent saving an empty/errored card (would show blank on review).
              <button
                className="save-btn"
                onClick={onSave}
                disabled={loading || !!error || !safeDefinition}
              >
                Save
              </button>
            ) : (
              <span className="save-unavailable">저장할 수 없는 위치입니다</span>
            )}
            <button className="close-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </>
  );
}
