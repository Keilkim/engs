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

// 문법 카드 앞면: 문장에서 '패턴 표현'만 볼드, 나머지는 라이트.
// 플레이스홀더(A/B/C, ~, ..., V/Ving/Ved)는 제외하고 실제 표현 조각만 강조.
function renderSentenceWithPatterns(sentence, patterns) {
  const fragments = [];
  for (const p of patterns || []) {
    for (const w of p?.words || []) {
      if (typeof w !== 'string') continue;
      w.split(/\b[A-C]\b|~|\.{2,}|\bV(?:ing|ed)?\b/g).forEach((frag) => {
        const f = frag.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
        if (f.length >= 2) fragments.push(f);
      });
    }
  }
  if (fragments.length === 0) return sentence;
  fragments.sort((a, b) => b.length - a.length);
  const escaped = fragments.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const lowSet = new Set(fragments.map((f) => f.toLowerCase()));
  return sentence.split(re).map((part, i) =>
    part && lowSet.has(part.toLowerCase())
      ? <strong key={i} className="pattern-hl">{part}</strong>
      : <span key={i}>{part}</span>
  );
}

export default function Flashcard({ item, showAnswer, exiting, onReveal }) {
  const annotation = item?.annotation;
  // 손상된 ai_analysis_json이 복습 화면 전체를 크래시시키지 않도록 안전 파싱 후 null 폴백
  const analysisData = safeJsonParse(annotation?.ai_analysis_json, null);
  const selectedText = annotation?.selected_text || '';
  // 하위호환: 저장 시 sentence가 포함되면 원문 문장을 맥락으로 표시(단어 강조)
  const sentence = analysisData?.sentence;
  const isGrammar = analysisData?.type === 'grammar';

  function handleClick() {
    if (!showAnswer) {
      onReveal?.();
    }
  }

  return (
    <div
      className={`flashcard ${showAnswer ? 'flipped' : ''} ${exiting ? 'card-exit' : ''}`}
      onClick={handleClick}
    >
      <div className="flashcard-inner">
        <div className="flashcard-front">
          <div className="card-label">
            <TranslatableText textKey="flashcard.tapToReveal">Tap to reveal answer</TranslatableText>
          </div>
          <div className="card-content">
            {isGrammar ? (
              // 문법 문장: 패턴만 볼드, 나머지는 라이트
              <p className="question-text question-grammar">
                {renderSentenceWithPatterns(selectedText, analysisData.patterns)}
              </p>
            ) : (
              <>
                <p className="question-text">{selectedText}</p>
                {sentence && sentence !== selectedText && (
                  <p className="question-sentence-context">
                    {renderSentenceWithHighlight(sentence, selectedText)}
                  </p>
                )}
              </>
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
        </div>
      </div>
    </div>
  );
}
