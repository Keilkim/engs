import { useState, useEffect, useRef, useCallback } from 'react';
import AudioWindowCache from '../services/audio/audioWindowCache';
import GapExpandedEngine from '../services/audio/gapExpandedEngine';

// App-lifetime AudioContext. Created lazily inside a user gesture and NEVER
// closed on unmount — iOS suspend/resume is flaky and decoded buffers survive a
// re-entry, so keeping it makes toggling slow-mode instant.
let sharedCtx = null;
function getCtx() {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  sharedCtx = AC ? new AC() : null;
  return sharedCtx;
}

// iOS: declare 'playback' so the ring/silent switch doesn't mute Web Audio while
// virtual-slow is active, and restore 'auto' on exit so it doesn't outlive the
// feature (else other app sounds would also ignore the silent switch).
function setAudioSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* unsupported */ }
}

/**
 * Wraps the gap-expanded engine as a drop-in for the speed buttons:
 *  - requestRate(r): r<1 && enabled → virtual-slow (native articulation + gaps);
 *    otherwise plain native playbackRate. r===1 exits virtual mode.
 *  - virtualActive / virtualState / virtualTime for clock + UI swaps.
 *  - virtualPlay/Pause/Seek to route the viewer's transport when active.
 *
 * `enabled` = master feature ON && source has word timings && embed honors sub-1x
 * rates. When false, requestRate falls back to native time-stretch.
 */
export function useGapExpandedPlayback({ videoId, videoDuration, chunks, player, enabled }) {
  const [virtualState, setVirtualState] = useState('idle');
  const [virtualTime, setVirtualTime] = useState(0);
  // Derived: any live engine state means virtual mode is on. (Deriving instead of
  // a second state avoids setState-in-effect churn and keeps the two in lockstep.)
  const virtualActive = virtualState === 'loading' || virtualState === 'playing'
    || virtualState === 'buffering' || virtualState === 'paused';

  const engineRef = useRef(null);
  const cacheRef = useRef(null);
  const builtVideoRef = useRef(null);
  const chunksRef = useRef(chunks);
  const rateRef = useRef(0.5);
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);

  // Latest player behind a ref (updated in an effect, not during render) so the
  // engine's stable adapter always calls the current player callbacks.
  const playerRef = useRef(player);
  useEffect(() => { playerRef.current = player; });
  const videoAdapter = useRef({
    mute: () => playerRef.current.mute?.(),
    unMute: () => playerRef.current.unMute?.(),
    isMuted: () => playerRef.current.isMuted?.(),
    seekTo: (t) => playerRef.current.seekTo?.(t, true),
    playVideo: () => playerRef.current.playVideo?.(),
    pauseVideo: () => playerRef.current.pauseVideo?.(),
    setPlaybackRate: (r) => playerRef.current.setPlaybackRate?.(r),
    setVolume: (v) => playerRef.current.setVolume?.(v),
    getCurrentTime: () => playerRef.current.playerRef?.current?.getCurrentTime?.() ?? 0,
  });

  const teardownEngine = useCallback(() => {
    try { engineRef.current?.destroy(); } catch { /* ignore */ }
    try { cacheRef.current?.dispose(); } catch { /* ignore */ }
    engineRef.current = null;
    cacheRef.current = null;
    builtVideoRef.current = null;
    setAudioSession('auto');
  }, []);

  const ensureEngine = useCallback((ctx) => {
    if (engineRef.current && builtVideoRef.current === videoId) return engineRef.current;
    teardownEngine();
    const cache = new AudioWindowCache({ videoId, ctx, videoDuration });
    const engine = new GapExpandedEngine({
      ctx,
      cache,
      chunks: chunksRef.current,
      videoAdapter: videoAdapter.current,
      callbacks: {
        statechange: (s) => setVirtualState(s),
        timeupdate: (t) => setVirtualTime(t),
      },
    });
    cacheRef.current = cache;
    engineRef.current = engine;
    builtVideoRef.current = videoId;
    return engine;
  }, [videoId, videoDuration, teardownEngine]);

  // Exit virtual mode → restore normal 1.0x video. `reason` distinguishes a clean
  // user exit from an error/ended auto-exit (kept for future UX differences).
  const exitVirtual = useCallback(() => {
    const eng = engineRef.current;
    const content = eng ? eng.getContentTime() : videoAdapter.current.getCurrentTime();
    try { eng?.destroy(); } catch { /* ignore */ }
    try {
      // Seek while muted so no wrong-position audio leaks, then restore volume +
      // unmute so normal 1.0x playback is audible again.
      player.mute?.();
      player.seekTo?.(content, true);
      player.setPlaybackRate?.(1.0);
      player.setVolume?.(100);
      player.unMute?.();
      player.playVideo?.();
    } catch { /* ignore */ }
    setAudioSession('auto'); // stop overriding the silent switch once we're done
    setVirtualState('idle');
  }, [player]);

  const requestRate = useCallback((r) => {
    // 1.0x — leave virtual mode (or plain native for non-virtual sources).
    if (r >= 1) {
      if (virtualActive) exitVirtual();
      else player.setPlaybackRate?.(1.0);
      return;
    }
    // Sub-1x on a source that can't do virtual slow → native time-stretch.
    if (!enabled) {
      player.setPlaybackRate?.(r);
      return;
    }
    rateRef.current = r;
    // Already virtual → just change rate (engine re-plans from current position).
    if (virtualActive && engineRef.current) {
      engineRef.current.setRate(r);
      return;
    }
    // Enter virtual mode. MUST create/resume the AudioContext inside this gesture.
    const ctx = getCtx();
    if (!ctx) { player.setPlaybackRate?.(r); return; }
    setAudioSession('playback');
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Silence the video IMMEDIATELY (this gesture), before it starts playing
    // slowed — otherwise the muddy time-stretched video audio bleeds through
    // during the audio-load window and buries the engine's crisp spans. mute()
    // AND volume 0 so a stray native-control tap can't un-silence it.
    player.mute?.();
    player.setVolume?.(0);
    // Instant feedback while audio loads (ARMING): apply native rate now; the
    // engine seeks + takes over once its first window is decoded.
    player.setPlaybackRate?.(r);
    const engine = ensureEngine(ctx);
    const content = videoAdapter.current.getCurrentTime();
    engine.enable(r, content); // synchronously flips state → 'loading' (virtualActive derives true)
  }, [enabled, virtualActive, exitVirtual, ensureEngine, player]);

  const virtualPlay = useCallback(() => { engineRef.current?.play(); }, []);
  const virtualPause = useCallback(() => { engineRef.current?.pause(); }, []);
  const virtualSeek = useCallback((t) => { engineRef.current?.seek(t); }, []);

  // Hard-stop when the page is hidden (mobile throttles timers / suspends audio);
  // only a fresh user tap re-enters.
  useEffect(() => {
    if (!virtualActive) return;
    const onHide = () => { if (document.visibilityState === 'hidden') engineRef.current?.pause(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [virtualActive]);

  // Teardown on unmount (never closes the shared ctx).
  useEffect(() => () => teardownEngine(), [teardownEngine]);
  // If the source changes while active, exit cleanly.
  useEffect(() => {
    if (builtVideoRef.current && builtVideoRef.current !== videoId) teardownEngine();
  }, [videoId, teardownEngine]);

  return {
    virtualActive,
    virtualState,
    virtualTime,
    virtualIsPlaying: virtualState === 'playing' || virtualState === 'buffering',
    requestRate,
    virtualPlay,
    virtualPause,
    virtualSeek,
  };
}

export default useGapExpandedPlayback;
