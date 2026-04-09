import { TranslatableText } from '../../components/translatable';

export default function Flashcard({ item, showAnswer, onReveal }) {
  const annotation = item.annotation;
  const analysisData = annotation?.ai_analysis_json
    ? JSON.parse(annotation.ai_analysis_json)
    : null;

  function handleClick() {
    if (!showAnswer) {
      onReveal?.();
    }
  }

  return (
    <div
      className={`flashcard ${showAnswer ? 'flipped' : ''}`}
      onClick={handleClick}
    >
      <div className="flashcard-inner">
        <div className="flashcard-front">
          <div className="card-label">
            <TranslatableText textKey="flashcard.tapToReveal">Tap to reveal answer</TranslatableText>
          </div>
          <div className="card-content">
            <p className="question-text">{annotation.selected_text}</p>
          </div>
        </div>

        <div className="flashcard-back">
          <div className="card-label">
            <TranslatableText textKey="flashcard.answer">Answer</TranslatableText>
          </div>
          <div className="card-content">
            {analysisData?.isVocabulary ? (
              <div className="analysis-content">
                <p className="answer-word">{analysisData.word}</p>
                {analysisData.phonetic && (
                  <p className="answer-phonetic">{analysisData.phonetic}</p>
                )}
                <p className="answer-definition">{analysisData.definition}</p>
              </div>
            ) : analysisData?.type === 'grammar' ? (
              <div className="analysis-content">
                <p className="answer-translation">{analysisData.translation}</p>
                {analysisData.patterns?.length > 0 && (
                  <div className="answer-patterns">
                    {analysisData.patterns.map((p, i) => (
                      <div key={i} className="pattern-item">
                        <span className="pattern-words">{p.words?.join(', ')}</span>
                        <span className="pattern-explanation">{p.explanation}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="no-analysis">
                <p className="answer-text">{annotation.selected_text}</p>
                {annotation.memo_content && (
                  <p className="memo-text">{annotation.memo_content}</p>
                )}
              </div>
            )}
          </div>
          <div className="source-info">
            {annotation.source?.title || 'Source'}
          </div>
        </div>
      </div>
    </div>
  );
}
