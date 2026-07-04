import { TranslatableText } from '../../components/translatable';
import { safeJsonParse } from '../../utils/errors';
import FitBox from './FitBox';

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

// 문법 카드 앞면: 저장 시 캡처한 '실제 문장 속 표현(spans)'만 볼드, 나머지는 라이트.
// spans는 원문에서 글자 그대로 복사·검증된 것이라 활용/대소문자 그대로 정확히 매칭된다.
function renderSentenceWithPatterns(sentence, patterns) {
  if (!sentence) return sentence;

  const spans = [];
  for (const p of patterns || []) {
    for (const s of p?.spans || []) {
      if (typeof s === 'string' && s.trim()) spans.push(s.trim());
    }
  }
  if (spans.length === 0) return sentence; // 구 카드/타깃 없음 → 문장 원문 그대로

  // 각 span의 모든 출현 위치를 범위로 수집 (대소문자 무시).
  // 단어 경계 가드: span의 끝이 글자/숫자면 그 바깥도 글자/숫자인 경우 스킵 →
  // "not"이 "nothing" 안에서 볼드되는 등 단어 내부 오매칭을 막는다.
  const isWordChar = (ch) => !!ch && /[\p{L}\p{N}_]/u.test(ch);
  const low = sentence.toLowerCase();
  const ranges = [];
  for (const s of spans) {
    const needle = s.toLowerCase();
    const guardHead = isWordChar(s[0]);
    const guardTail = isWordChar(s[s.length - 1]);
    let from = 0;
    for (;;) {
      const idx = low.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      const okHead = !guardHead || !isWordChar(sentence[idx - 1]);
      const okTail = !guardTail || !isWordChar(sentence[end]);
      if (okHead && okTail) ranges.push([idx, end]);
      from = end;
    }
  }
  if (ranges.length === 0) return sentence;

  // 겹치거나 맞닿은 범위 병합 → <strong> 중첩/이중 래핑 방지
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  // 원문에서 슬라이스해 대소문자 유지, 일반/볼드 노드 번갈아 출력
  const out = [];
  let cursor = 0;
  merged.forEach(([s, e], i) => {
    if (s > cursor) out.push(<span key={`t${i}`}>{sentence.slice(cursor, s)}</span>);
    out.push(<strong key={`b${i}`} className="pattern-hl">{sentence.slice(s, e)}</strong>);
    cursor = e;
  });
  if (cursor < sentence.length) out.push(<span key="tail">{sentence.slice(cursor)}</span>);
  return out;
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
            <FitBox>
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
            </FitBox>
          </div>
        </div>

        <div className="flashcard-back">
          <div className="card-label">
            <TranslatableText textKey="flashcard.answer">Answer</TranslatableText>
          </div>
          <div className="card-content">
            <FitBox>
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
            </FitBox>
          </div>
        </div>
      </div>
    </div>
  );
}
