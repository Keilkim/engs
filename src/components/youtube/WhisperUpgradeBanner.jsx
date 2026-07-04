import { calculateWhisperCost } from '../../services/ai/youtube';

/**
 * Shown under the speed bar (only when the master feature is ON and the source
 * lacks word timings) to offer the paid "정밀 타이밍 업그레이드". Drives the
 * useWhisperUpgrade hook passed in as `upgrade`.
 */
export default function WhisperUpgradeBanner({ upgrade, durationSec = 0, onDismiss }) {
  const { progressMsg, error, isRunning, startUpgrade } = upgrade;
  const cost = calculateWhisperCost(durationSec > 0 ? durationSec : 60);
  const costLabel = durationSec > 0
    ? `약 ${cost.krw.toLocaleString()}원`
    : `분당 약 ${cost.krw}원`;

  if (isRunning) {
    return (
      <div className="whisper-upgrade-banner running">
        <span className="wub-spinner" aria-hidden="true" />
        <span className="wub-text">{progressMsg || '음성 인식 중...'}</span>
      </div>
    );
  }

  return (
    <div className={`whisper-upgrade-banner ${error ? 'has-error' : ''}`}>
      <span className="wub-text">
        {error || '‘또박또박 느리게’는 정밀한 단어 타이밍이 필요해요.'}
      </span>
      <div className="wub-actions">
        <button className="wub-primary" onClick={startUpgrade}>
          정밀 타이밍 업그레이드 · {costLabel}
        </button>
        {onDismiss && (
          <button className="wub-dismiss" onClick={onDismiss}>이번엔 그냥 듣기</button>
        )}
      </div>
    </div>
  );
}
