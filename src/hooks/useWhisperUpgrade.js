import { useState, useCallback, useRef } from 'react';
import { transcribeYouTubeWithWhisper, buildWhisperConfirmText, mapWhisperError } from '../services/ai/youtube';
import { attachWhisperTimings } from '../services/source';
import { getWordTimeline } from '../utils/captionWords';

// Cross-tab / retry guard so a re-tap or a second tab can't pay for the same
// transcription twice while one is already in flight.
const LOCK_PREFIX = 'whisper_upgrade_lock:';
const LOCK_TTL_MS = 30 * 60 * 1000; // 30 min — longer than any realistic transcription

/**
 * Drives the paid "정밀 타이밍 업그레이드" (Whisper re-transcription) for an
 * EXISTING source that only has YouTube-caption timing. On success it attaches
 * the word timings non-destructively and hands the updated row back via
 * `onUpgraded` so the viewer can refresh without a refetch.
 *
 * States: idle → transcribing → saving → done | error.
 */
export function useWhisperUpgrade({ source, onUpgraded }) {
  const [status, setStatus] = useState('idle');
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState('');
  const runningRef = useRef(false);

  const startUpgrade = useCallback(async () => {
    const videoId = source?.youtube_data?.video_id;
    if (!videoId || runningRef.current) return;

    // Already has word timings (upgraded elsewhere / whisper-sourced) → nothing to pay for.
    if (getWordTimeline(source.captions_data)) {
      setStatus('done');
      return;
    }

    const durationSec = source.youtube_data?.duration || 0;
    if (!window.confirm(buildWhisperConfirmText(durationSec))) return;

    const lockKey = LOCK_PREFIX + source.id;
    const existing = Number(localStorage.getItem(lockKey) || 0);
    if (existing && Date.now() - existing < LOCK_TTL_MS) {
      setStatus('error');
      setError('이미 업그레이드가 진행 중이에요. 잠시 후 다시 확인해 주세요.');
      return;
    }

    runningRef.current = true;
    localStorage.setItem(lockKey, String(Date.now()));
    setError('');
    setStatus('transcribing');
    try {
      const result = await transcribeYouTubeWithWhisper(videoId, 'en', setProgressMsg, durationSec);
      if (!result || !result.segments?.length) throw new Error('Transcription returned no results');

      setStatus('saving');
      setProgressMsg('타이밍 저장 중...');
      const row = await attachWhisperTimings(source.id, source.captions_data, {
        segments: result.segments,
        language: result.language || 'en',
        duration: result.duration,
      });
      setStatus('done');
      setProgressMsg('');
      onUpgraded?.(row);
    } catch (err) {
      setStatus('error');
      setError(mapWhisperError(err));
    } finally {
      runningRef.current = false;
      localStorage.removeItem(lockKey);
    }
  }, [source, onUpgraded]);

  return {
    status,
    progressMsg,
    error,
    isRunning: status === 'transcribing' || status === 'saving',
    startUpgrade,
  };
}

export default useWhisperUpgrade;
