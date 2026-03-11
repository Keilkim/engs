import { useState, useEffect, useRef, useCallback } from 'react';

const PLAYER_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1.0];

export function useYouTubePlayer() {
  const playerRef = useRef(null);
  const intervalRef = useRef(null);

  const [isReady, setIsReady] = useState(false);
  const [playerState, setPlayerState] = useState(PLAYER_STATES.UNSTARTED);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const pendingSeekRef = useRef(null); // For seeking from UNSTARTED state

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (playerState === PLAYER_STATES.PLAYING) {
      intervalRef.current = setInterval(() => {
        if (playerRef.current) {
          setCurrentTime(playerRef.current.getCurrentTime());
        }
      }, 50);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playerState]);

  const onReady = useCallback((event) => {
    playerRef.current = event.target;
    setIsReady(true);
    setDuration(event.target.getDuration());
  }, []);

  const onStateChange = useCallback((event) => {
    setPlayerState(event.data);
    if (event.target && event.data !== PLAYER_STATES.UNSTARTED) {
      const dur = event.target.getDuration();
      if (dur > 0 && dur !== duration) setDuration(dur);
    }
    // Handle pending seek from UNSTARTED state: once player starts, seek and pause
    if (pendingSeekRef.current !== null && (event.data === PLAYER_STATES.PLAYING || event.data === PLAYER_STATES.BUFFERING)) {
      const seekTime = pendingSeekRef.current;
      pendingSeekRef.current = null;
      event.target.seekTo(seekTime, true);
      event.target.pauseVideo();
    }
  }, [duration]);

  const onEnd = useCallback(() => {
    setPlayerState(PLAYER_STATES.ENDED);
  }, []);

  const seekTo = useCallback((seconds, allowSeekAhead = true) => {
    if (!playerRef.current) return;
    if (playerState === PLAYER_STATES.UNSTARTED || playerState === PLAYER_STATES.CUED) {
      // UNSTARTED: start playback, then seek+pause via onStateChange callback
      pendingSeekRef.current = seconds;
      playerRef.current.playVideo();
    } else {
      playerRef.current.seekTo(seconds, allowSeekAhead);
    }
    setCurrentTime(seconds);
  }, [playerState]);

  const pauseVideo = useCallback(() => {
    if (playerRef.current && playerRef.current.pauseVideo) {
      playerRef.current.pauseVideo();
    }
  }, []);

  const playVideo = useCallback(() => {
    if (playerRef.current && playerRef.current.playVideo) {
      playerRef.current.playVideo();
    }
  }, []);

  const setPlaybackRate = useCallback((rate) => {
    if (playerRef.current) {
      playerRef.current.setPlaybackRate(rate);
      setPlaybackRateState(rate);
    }
  }, []);

  return {
    playerRef,
    isReady,
    currentTime,
    duration,
    isPlaying: playerState === PLAYER_STATES.PLAYING,
    playbackRate,
    onReady,
    onStateChange,
    onEnd,
    seekTo,
    pauseVideo,
    playVideo,
    setPlaybackRate,
  };
}

export default useYouTubePlayer;
