import { TranslatableText } from '../../components/translatable';
import { safeJsonParse } from '../../utils/errors';

// 원문 문장에서 대상 단어를 강조해 렌더링 (없으면 문장 그대로)
function renderSentenceWithHighlight(sentence, word) {
  if (!word) return sentence;
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return sentence;
  return (
    <>
      {sentence.slice(0, idx)}
      <strong className="highlight-word">{sentence.slice(idx, idx + word.length)}</strong>
      {sentence.slice(idx + word.length)}
    </>
  );
}

export default function Flashcard({ item, showAnswer, onReveal }) {
  const annotation = item?.annotation;
  // 손상된 ai_analysis_json이 복습 화면 전체를 크래시시키지 않도록 안전 파싱 후 null 폴백
  const analysisData = safeJsonParse(annotation?.ai_analysis_json, null);
  const selectedText = annotation?.selected_text || '';
  // 하위호환: 저장 시 sentence가 포함되면 원문 문장을 맥락으로 표시(단어 강조)
  const sentence = analysisData?.sentence;

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
            {sentence ? (
              <p className="question-sentence">
                {renderSentenceWithHighlight(sentence, selectedText)}
              </p>
            ) : (
              <p className="question-text">{selectedText}</p>
            )}
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
                <p className="answer-text">{selectedText}</p>
                {annotation?.memo_content && (
                  <p className="memo-text">{annotation.memo_content}</p>
                )}
              </div>
            )}
          </div>
          <div className="source-info">
            {annotation?.source?.title || 'Source'}
          </div>
        </div>
      </div>
    </div>
  );
}
