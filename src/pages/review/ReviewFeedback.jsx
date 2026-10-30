import { useEffect, useRef } from 'react';
import Buddy from '../../components/Buddy';
import { DustPuffs } from '../../components/BuddyLoader';

// Leave time after the initial pop/shake to actually read the answer.
const FEEDBACK_MS = { correct: 1100, incorrect: 1800 };

export default function ReviewFeedback({ result, answer, busy, onAdvance }) {
  const advance = useRef(onAdvance);
  useEffect(() => { advance.current = onAdvance; }, [onAdvance]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Visibility changes pause the parent; also guard an already queued timer.
      if (!document.hidden) advance.current();
    }, result.correct ? FEEDBACK_MS.correct : FEEDBACK_MS.incorrect);
    return () => window.clearTimeout(timer);
  }, [result]);

  return <>
    <div className="practice-feedback-shade" aria-hidden="true" />
    <div className={`practice-feedback ${result.correct ? 'is-correct' : 'is-incorrect'}`} role="status" aria-live="polite" aria-atomic="true">
      <Buddy pose={result.correct ? 'correct' : 'surprised'} className="practice-feedback-buddy" animated={false} />
      <div className="practice-feedback-copy">
        <strong>{result.correct ? '맞았어요!' : '앗, 이 뜻이었어요!'}</strong>
        <span>{busy ? <>다음 카드 준비 중<DustPuffs /></> : result.correct ? '기억이 하나 더 쌓였어요' : '괜찮아요, 한 번 더 눈에 담아요'}</span>
        <span className="sr-only">정답: {answer}. 잠시 후 다음 카드로 넘어가요.</span>
      </div>
    </div>
  </>;
}
