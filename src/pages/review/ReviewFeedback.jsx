import { useEffect, useRef } from 'react';
import Buddy from '../../components/Buddy';
import { DustPuffs } from '../../components/BuddyLoader';

export default function ReviewFeedback({ result, answer, busy, onAdvance }) {
  const continueButton = useRef(null);
  const pending = useRef(false);

  useEffect(() => {
    continueButton.current?.focus({ preventScroll: true });
  }, [result]);

  async function advance(event) {
    event.stopPropagation();
    if (busy || pending.current || document.hidden) return;
    pending.current = true;
    try { await onAdvance(); } finally { pending.current = false; }
  }

  return <>
    <div className="practice-feedback-shade" aria-hidden="true" />
    <button ref={continueButton} type="button" className="practice-feedback-continue" disabled={busy}
      onClick={advance} onKeyDown={event => { if (event.repeat) event.preventDefault(); }}
      aria-label={busy ? '복습 결과 저장 중' : '확인하고 터치! 다음 카드로 넘어가기'} />
    <div className={`practice-feedback ${result.correct ? 'is-correct' : 'is-incorrect'}`} role="status" aria-live="polite" aria-atomic="true">
      <Buddy pose={result.correct ? 'correct' : 'surprised'} className="practice-feedback-buddy" animated={false} />
      <div className="practice-feedback-copy">
        <strong>{result.correct ? '맞았어요!' : '앗, 이 뜻이었어요!'}</strong>
        <span>{busy ? <>다음 카드 준비 중<DustPuffs /></> : result.correct ? '기억이 하나 더 쌓였어요' : '괜찮아요, 한 번 더 눈에 담아요'}</span>
        <span className="sr-only">정답: {answer}. 화면 아무 곳이나 터치하거나 Enter 키를 누르면 다음 카드로 넘어가요.</span>
      </div>
    </div>
  </>;
}
