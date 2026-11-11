import { useEffect, useEffectEvent, useRef } from 'react';
import Buddy from '../../components/Buddy';

// A right answer only needs a moment to sink in; a wrong one waits for a tap so the answer can be studied.
const CORRECT_HOLD_MS = 1100;

export default function ReviewFeedback({ result, answer, onAdvance }) {
  const continueButton = useRef(null);
  const autoAdvance = useEffectEvent(() => { if (!document.hidden) onAdvance(); });

  useEffect(() => {
    continueButton.current?.focus({ preventScroll: true });
    if (!result.correct) return undefined;
    const timer = setTimeout(autoAdvance, CORRECT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [result]);

  function advance(event) {
    event.stopPropagation();
    if (!document.hidden) onAdvance();
  }

  return <>
    <div className="practice-feedback-shade" aria-hidden="true" />
    <button ref={continueButton} type="button" className="practice-feedback-continue"
      onClick={advance} onKeyDown={event => { if (event.repeat) event.preventDefault(); }}
      aria-label={result.correct ? '다음 카드로 넘어가기' : '확인하고 터치! 다음 카드로 넘어가기'} />
    <div className={`practice-feedback ${result.correct ? 'is-correct' : 'is-incorrect'}`} role="status" aria-live="polite" aria-atomic="true">
      <Buddy pose={result.correct ? 'correct' : 'surprised'} className="practice-feedback-buddy" animated={false} />
      <div className="practice-feedback-copy">
        <div className="practice-feedback-heading">
          <strong>{result.correct ? '맞았어요!' : '앗, 이 뜻이었어요!'}</strong>
        </div>
        <span>{result.correct ? '기억이 하나 더 쌓였어요' : '괜찮아요, 한 번 더 눈에 담아요'}</span>
        <span className="sr-only">정답: {answer}. {result.correct ? '잠시 후 다음 카드로 넘어가요.' : '화면 아무 곳이나 터치하거나 Enter 키를 누르면 다음 카드로 넘어가요.'}</span>
      </div>
    </div>
  </>;
}
