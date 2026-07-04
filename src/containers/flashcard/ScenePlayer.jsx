import { useState, useEffect, useCallback } from 'react';
import YouTube from 'react-youtube';
import useYouTubePlayer, { PLAYBACK_SPEEDS } from '../../hooks/useYouTubePlayer';
import useSceneBounds from '../../hooks/useSceneBounds';
import { TranslatableText } from '../../components/translatable';

// Start a touch before the word so the run-up is audible; keep a small tail past
// the sentence end so the final word isn't clipped.
const LEAD_IN = 0.8;
const TAIL = 0.4;
// When the sentence end is unknown (captions unavailable), stop after this long so
// playback doesn't run on into later scenes and distract from the card.
const FALLBACK_WINDOW = 7;

/**
 * Plays the original YouTube scene a saved word came from, using the Whisper
 * timing stored on the annotation. Rendered *outside* the flashcard so its taps
 * don't trigger the card's tap-to-reveal. The iframe is mounted lazily on first
 * tap so flipping past cards you don't listen to costs nothing.
 */
export default function ScenePlayer({ videoId, sourceId, segmentIndex, fallbackStart, onInteract }) {
  const [mounted, setMounted] = useState(false);
  const { start, end } = useSceneBounds({ sourceId, segmentIndex, fallbackStart });

  const {
    currentTime,
    isPlaying,
    onReady,
    onStateChange,
    onEnd,
    seekTo,
    playVideo,
    pauseVideo,
    playbackRate,
    setPlaybackRate,
  } = useYouTubePlayer();

  const seekStart = Math.max(0, (start ?? 0) - LEAD_IN);
  const stopAt = end != null ? end + TAIL : seekStart + FALLBACK_WINDOW;

  // Auto-pause once the sentence has played through.
  useEffect(() => {
    if (mounted && isPlaying && currentTime >= stopAt) {
      pauseVideo();
    }
  }, [mounted, isPlaying, currentTime, stopAt, pauseVideo]);

  const handleReady = useCallback((e) => {
    onReady(e);
    // playerVars.start is integer-only; do a precise float seek, then play within
    // the tap gesture chain so audio autoplay isn't blocked.
    seekTo(seekStart);
    playVideo();
  }, [onReady, seekTo, playVideo, seekStart]);

  const replay = useCallback(() => {
    onInteract?.();
    seekTo(seekStart);
    playVideo();
  }, [onInteract, seekTo, playVideo, seekStart]);

  if (!mounted) {
    return (
      <button
        className="scene-play-button"
        onClick={() => { onInteract?.(); setMounted(true); }}
      >
        <span className="scene-play-icon" aria-hidden="true">▶</span>
        <TranslatableText textKey="review.listenScene">Listen to this scene</TranslatableText>
      </button>
    );
  }

  const opts = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 1,
      start: Math.floor(seekStart),
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
    },
  };

  return (
    <div className="scene-player">
      <div className="scene-player-video">
        <YouTube
          videoId={videoId}
          opts={opts}
          onReady={handleReady}
          onStateChange={onStateChange}
          onEnd={onEnd}
          className="scene-youtube"
        />
      </div>
      <div className="scene-player-controls">
        <button className="scene-replay-button" onClick={replay}>
          <span className="scene-play-icon" aria-hidden="true">↻</span>
          <TranslatableText textKey="review.replayScene">Replay</TranslatableText>
        </button>
        <div className="scene-speed-buttons">
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              className={`scene-speed-button ${playbackRate === s ? 'active' : ''}`}
              onClick={() => setPlaybackRate(s)}
            >
              {s === 1 ? '1.0x' : `${s}x`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
