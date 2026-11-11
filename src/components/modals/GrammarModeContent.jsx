import { useMemo, useState } from 'react';
import { createSentencePattern } from '../../services/annotation';
import { prepareSentence, sentencePieces } from '../../utils/grammarRoles';
import BuddyLoader from '../BuddyLoader';

// The pattern inside the sentence: its own words in dark blue dashes, the
// words filling its replaceable parts in light blue with the placeholder
// (A, ~, V-ing …) written under them — the same marks as on the page.
function PatternPieces({ pattern, prepared }) {
  const pieces = useMemo(() => (prepared ? sentencePieces(pattern, prepared) : []), [pattern, prepared]);
  if (!pieces.length) return null;
  return (
    <span className="pattern-pieces">
      {pieces.map((piece, i) => (piece.role
        ? <span key={i} className={`pattern-piece is-${piece.role}`}>
          <span className="pattern-piece-text"><span className="pattern-piece-ink">{piece.text}</span></span>
          {piece.label && <span className="pattern-piece-label">{piece.label}</span>}
        </span>
        : <span key={i} className="pattern-piece-gap">{piece.text}</span>))}
    </span>
  );
}

export default function GrammarModeContent({
  grammarData, checkedPatterns, loading,
  existingAnnotation,
  onSave, onDelete, onClose, onRetry,
  onTogglePattern,
  ko,
}) {
  const [savedPatternIds, setSavedPatternIds] = useState(new Set());
  const sentence = grammarData?.originalText;
  const prepared = useMemo(() => (sentence ? prepareSentence(sentence) : null), [sentence]);

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
        <div className="word-menu-body">
          {grammarData.translation && (
            <p className="grammar-translation">{grammarData.translation}</p>
          )}
          <div className="grammar-patterns">
            {grammarData.patterns?.map((pattern, i) => (
              <div key={i} className="pattern-item">
                <div className="pattern-content">
                  <span className="pattern-words">{pattern.words?.join(' ')}</span>
                  <PatternPieces pattern={pattern} prepared={prepared} />
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
    return <BuddyLoader compact label={ko('wordMenu.analyzing')} />;
  }

  if (grammarData) {
    const hasPatterns = grammarData.patterns?.length > 0;
    return (
      <>
        <div className="word-menu-body">
          {grammarData.translation && (
            <p className="grammar-translation">{grammarData.translation}</p>
          )}
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
                      <PatternPieces pattern={pattern} prepared={prepared} />
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
            <div className="empty-state">
              {grammarData.degraded
                ? ko('wordMenu.aiUnavailable')
                : (grammarData.translation ? ko('wordMenu.translationOnly') : ko('wordMenu.noPatterns'))}
              {grammarData.degraded && grammarData.reason && (
                <span className="empty-reason">{grammarData.reason}</span>
              )}
            </div>
          )}
        </div>
        <div className="word-menu-actions">
          {grammarData.degraded && onRetry && (
            <button className="retry-btn" onClick={onRetry} disabled={loading}>
              {ko('wordMenu.retry')}
            </button>
          )}
          <button
            className="save-btn"
            onClick={onSave}
            disabled={loading || (hasPatterns ? checkedPatterns.length === 0 : !grammarData.translation)}
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

  return (
    <>
      <div className="modal-error-state">{ko('wordMenu.grammarFailed')}</div>
      <div className="word-menu-actions">
        {onRetry && (
          <button className="retry-btn" onClick={onRetry} disabled={loading}>
            {ko('wordMenu.retry')}
          </button>
        )}
        <button className="close-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
