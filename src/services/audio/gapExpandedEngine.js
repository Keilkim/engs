// Gap-expanded playback engine. Plays each glued word-span at NATIVE speed via
// Web Audio and inserts controlled silence between spans so the total duration
// matches a sub-1.0 "rate" — without ever time-stretching the sound. The muted
// YouTube video plays continuously at `rate` and is nudged (seek-only) to stay
// aligned. See spanPlanner for the timeline math; audioWindowCache for audio.
//
// v1 cuts spans at Whisper word boundaries with short fades + a lead-in (onset
// preservation). RMS-refined cut points (silenceAnalysis) are a documented
// follow-up hook, layered once the basic transport is proven on-device.

import {
  planTimeline,
  contentTimeAtWall,
  videoContentAtWall,
  wallAtContent,
  snapSeekContent,
} from './spanPlanner.js';

const HORIZON = 1.5;          // schedule this far ahead (s)
const TICK_MS = 100;
const LEAD_IN = 0.09;         // pre-roll to avoid clipping Whisper's slightly-late word onsets
const FADE = 0.008;           // click-free ramp at cut points
const AMBIENT_FADE = 0.03;
const NUDGE_THRESHOLD = 0.75; // |video − ideal| beyond this → correct
const NUDGE_MIN_INTERVAL = 5; // s between video nudges
const NEAR = 0.03;            // don't schedule things already (nearly) in the past
const BUFFER_TIMEOUT_MS = 25000; // give up (→ error/native fallback) if a window won't load

export class GapExpandedEngine {
  constructor({ ctx, cache, chunks, videoAdapter, callbacks = {} }) {
    this.ctx = ctx;
    this.cache = cache;
    this.chunks = chunks || [];
    this.video = videoAdapter;
    this.cb = callbacks;

    this.state = 'idle';
    this.rate = 0.5;
    this.plan = { entries: [], totalWall: 0, contentStart: 0, contentEnd: 0, rate: 0.5 };
    this.anchorWall = 0;       // ctx.currentTime that corresponds to engine wall 0
    this.scheduled = new Set(); // entry indices already scheduled
    this.nodes = [];            // { source, gain, idx }
    this.timer = null;
    this.lastNudge = -Infinity;
    this.buffering = false;
    this.stallStart = null;    // ctx time a mid-playback stall began (for clock re-anchor)
    this.stallContent = 0;     // content time to freeze the clock at during a stall
    this.pausedContent = 0;
    this.gen = 0;               // invalidates async work after seek/stop
  }

  getState() { return this.state; }
  // `buffering` is a boolean orthogonal to state; either counts as "playing".
  isActive() { return this.state === 'playing' || this.buffering; }

  engineWall() { return this.ctx.currentTime - this.anchorWall; }
  getContentTime() {
    if (this.state === 'paused' || this.state === 'idle' || this.state === 'loading') return this.pausedContent;
    if (this.buffering) return this.stallContent; // frozen while a window loads
    return contentTimeAtWall(this.plan, this.engineWall());
  }

  _emit(name, arg) { try { this.cb[name]?.(arg); } catch { /* ignore */ } }
  _setState(s) { if (s !== this.state) { this.state = s; this._emit('statechange', s); } }
  _setBuffering(b) { if (b !== this.buffering) { this.buffering = b; this._emit('bufferingchange', b); } }

  // (Re)build the plan and anchor so that `contentTime` plays right now.
  _reset(contentTime) {
    this.plan = planTimeline(this.chunks, this.rate);
    const snapped = snapSeekContent(this.plan, Math.max(this.plan.contentStart, contentTime));
    const wall0 = wallAtContent(this.plan, snapped);
    this.anchorWall = this.ctx.currentTime - wall0;
    this.scheduled.clear();
    this._setBuffering(false);
    this.stallStart = null;
    this.pausedContent = snapped; // so getContentTime() is correct while 'loading'
    this._stopNodes(true);
    return snapped;
  }

  _stopNodes(silent) {
    for (const n of this.nodes) {
      try {
        if (silent) {
          n.gain.gain.cancelScheduledValues(this.ctx.currentTime);
          n.gain.gain.setValueAtTime(0, this.ctx.currentTime);
        }
        n.source.onended = null;
        n.source.stop();
      } catch { /* already stopped */ }
    }
    this.nodes = [];
  }

  // ---- lifecycle ----------------------------------------------------------

  async enable(rate, contentTime) {
    this.rate = rate;
    this.gen += 1;
    const gen = this.gen;
    this._setState('loading');
    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const snapped = this._reset(contentTime);
      // Ensure the starting window is decoded before we begin.
      await this.cache.getDecoded(this.cache.windowIndexFor(snapped));
      if (gen !== this.gen) return;
      // Re-anchor to NOW (decode may have taken a while).
      const wall0 = wallAtContent(this.plan, snapped);
      this.anchorWall = this.ctx.currentTime - wall0;
      this._startVideo(snapped);
      this._setState('playing');
      this._loop();
      this._tick();
    } catch (err) {
      this._fail(err);
    }
  }

  _startVideo(contentTime) {
    try {
      this.video.mute?.();
      this.video.setVolume?.(0); // keep silent even if `muted` gets toggled off
      this.video.seekTo?.(contentTime);
      this.video.setPlaybackRate?.(this.rate);
      this.video.playVideo?.();
    } catch { /* player may be transitioning */ }
  }

  play() {
    if (this.state !== 'paused') return;
    this.gen += 1;
    this._setState('playing');
    const snapped = this._reset(this.pausedContent);
    const wall0 = wallAtContent(this.plan, snapped);
    this.anchorWall = this.ctx.currentTime - wall0;
    this._startVideo(snapped);
    this._loop();
    this._tick();
  }

  pause() {
    // Also honor a pause issued DURING the initial load / a seek reload, so it
    // isn't silently dropped and playback doesn't auto-resume.
    if (!this.isActive() && this.state !== 'loading') return;
    this.pausedContent = this.getContentTime();
    this.gen += 1; // cancels any in-flight enable/seek reload
    this._clearLoop();
    this._stopNodes(true);
    this.scheduled.clear();
    try { this.video.pauseVideo?.(); } catch { /* ignore */ }
    this._setBuffering(false);
    this._setState('paused');
  }

  seek(contentTime) {
    this.gen += 1;
    // 'loading' counts as active here too, else a seek during the initial load
    // would strand the engine in 'loading' (gen++ kills the enable, but the
    // !wasActive branch below returns without restarting playback).
    const wasActive = this.isActive() || this.state === 'loading';
    this._clearLoop();
    this.cache.bumpGeneration?.();
    const snapped = this._reset(contentTime);
    this.pausedContent = snapped;
    if (!wasActive) {
      try { this.video.seekTo?.(snapped); } catch { /* ignore */ }
      return;
    }
    // Re-fetch the target window then resume from there.
    this._setState('loading');
    const gen = this.gen;
    this.cache.getDecoded(this.cache.windowIndexFor(snapped)).then(() => {
      if (gen !== this.gen) return;
      const wall0 = wallAtContent(this.plan, snapped);
      this.anchorWall = this.ctx.currentTime - wall0;
      this._startVideo(snapped);
      this._setState('playing');
      this._loop();
      this._tick();
    }).catch((err) => this._fail(err));
  }

  async setRate(rate) {
    if (rate === this.rate) return;
    const content = this.getContentTime();
    this.rate = rate;
    if (this.isActive()) {
      this.seek(content); // re-plan under the new rate from the current position
    } else {
      this.plan = planTimeline(this.chunks, rate);
    }
  }

  // Restore the muted, rate-shifted video to normal playback. Defensive — the
  // iframe may be mid-teardown.
  _restoreVideo() {
    try {
      this.video.setPlaybackRate?.(1.0);
      this.video.setVolume?.(100); // undo the volume-0 silencing
      this.video.unMute?.();
    } catch { /* ignore */ }
  }

  destroy() {
    this.gen += 1;
    this._clearLoop();
    this._stopNodes(true);
    this.scheduled.clear();
    this.cache.bumpGeneration?.();
    this._restoreVideo();
    this._setState('idle');
  }

  _fail(err) {
    if (err && err.name === 'AbortError') return; // superseded, not a real failure
    this._clearLoop();
    this._stopNodes(true);
    this._restoreVideo(); // fall the video back to normal so playback isn't stuck muted
    this._setState('error');
    this._emit('error', { message: err?.message || String(err) });
  }

  // ---- scheduler ----------------------------------------------------------

  _loop() {
    this._clearLoop();
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }
  _clearLoop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _firstUnscheduledAudioIdx() {
    const entries = this.plan.entries;
    for (let i = 0; i < entries.length; i++) {
      if (this.scheduled.has(i)) continue;
      if (entries[i].type === 'gap') continue;
      return i;
    }
    return -1;
  }

  _tick() {
    if (this.state !== 'playing') return; // buffering is a boolean; state stays 'playing'
    let now = this.ctx.currentTime;

    // Repay a resolved stall: the wall clock kept running while we waited, so
    // shift the anchor forward by the stall duration (the held clock resumes
    // exactly where it stopped — no dropped speech) and un-pause the video.
    if (this.buffering && this.stallStart != null) {
      const nextIdx = this._firstUnscheduledAudioIdx();
      const ready = nextIdx < 0
        || !!this.cache.decoded.get(this.cache.windowIndexFor(this.plan.entries[nextIdx].contentStart));
      if (ready) {
        this.anchorWall += now - this.stallStart;
        this.stallStart = null;
        this._setBuffering(false);
        try { this.video.playVideo?.(); } catch { /* ignore */ }
      } else if (now - this.stallStart > BUFFER_TIMEOUT_MS / 1000) {
        this._fail(new Error('audio buffering timed out'));
        return;
      }
    }

    now = this.ctx.currentTime;
    const engineWall = now - this.anchorWall;

    // End of content — never while buffering (a stall at the end must not drop
    // the last word).
    if (!this.buffering && engineWall >= this.plan.totalWall - 0.01 && this.nodes.length === 0 && this.scheduled.size > 0) {
      this._end();
      return;
    }

    this._emit('timeupdate', this.getContentTime());

    const horizonWall = engineWall + HORIZON;
    const entries = this.plan.entries;
    for (let i = 0; i < entries.length; i++) {
      if (this.scheduled.has(i)) continue;
      const e = entries[i];
      if (e.wallEnd <= engineWall - NEAR) { this.scheduled.add(i); continue; } // fully in the past
      if (e.wallStart > horizonWall) break;
      if (e.type === 'gap') { this.scheduled.add(i); continue; } // silence: nothing to schedule

      const win = this.cache.windowIndexFor(e.contentStart);
      const decoded = this.cache.decoded.get(win);
      if (!decoded) {
        // Stall: HOLD the clock (freeze content, pause the muted video) and wait.
        if (this.stallStart == null) {
          this.stallStart = now;
          this.stallContent = contentTimeAtWall(this.plan, engineWall);
          try { this.video.pauseVideo?.(); } catch { /* ignore */ }
        }
        this._setBuffering(true);
        this.cache.prefetch(win);
        break; // schedule in order; wait for this window
      }
      this._scheduleAudio(e, i, decoded, now);
      this.scheduled.add(i);
    }

    // Prefetch the next window well ahead (huge wall-time headroom at sub-1x).
    const curContent = contentTimeAtWall(this.plan, engineWall);
    this.cache.prefetch(this.cache.windowIndexFor(curContent) + 1);

    if (!this.buffering) this._drift(engineWall);
  }

  _scheduleAudio(e, idx, decoded, now) {
    const { buffer, contentStart } = decoded;
    const absStart = Math.max(now + NEAR, this.anchorWall + e.wallStart);
    const isSpeech = e.type === 'speech';
    const lead = isSpeech ? LEAD_IN : AMBIENT_FADE;
    const fade = isSpeech ? FADE : AMBIENT_FADE;

    // window-local read window, with a lead-in pre-roll so onsets aren't clipped
    let localStart = e.contentStart - contentStart - lead;
    let localEnd = e.contentEnd - contentStart;
    localStart = Math.max(0, localStart);
    localEnd = Math.min(buffer.duration, Math.max(localStart + 0.02, localEnd));
    const playDur = localEnd - localStart;
    // Content beyond the decoded buffer (e.g. Whisper timings past an
    // under-reported duration) → nothing to play; skip rather than throw.
    if (localStart >= buffer.duration || playDur <= 0) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    src.connect(gain).connect(this.ctx.destination);

    const g = gain.gain;
    g.setValueAtTime(0, absStart);
    g.linearRampToValueAtTime(1, absStart + fade);
    const fadeOutAt = absStart + Math.max(fade, playDur - fade);
    g.setValueAtTime(1, fadeOutAt);
    g.linearRampToValueAtTime(0, absStart + playDur);

    const node = { source: src, gain, idx };
    src.onended = () => {
      const k = this.nodes.indexOf(node);
      if (k >= 0) this.nodes.splice(k, 1);
    };
    try {
      src.start(absStart, localStart, playDur);
      this.nodes.push(node);
    } catch { /* start failed (buffer detached / stopped) */ }
  }

  _prune() {
    // onended handles removal; nothing extra needed. Kept for clarity/extension.
  }

  _drift(engineWall) {
    if (this.buffering) return;
    try {
      if (this.video.isMuted && !this.video.isMuted()) this.video.mute?.();
    } catch { /* ignore */ }
    const nowReal = this.ctx.currentTime;
    if (nowReal - this.lastNudge < NUDGE_MIN_INTERVAL) return;
    let actual;
    try { actual = this.video.getCurrentTime?.(); } catch { return; }
    if (typeof actual !== 'number') return;
    const ideal = videoContentAtWall(this.plan, engineWall);
    if (Math.abs(actual - ideal) > NUDGE_THRESHOLD) {
      try { this.video.seekTo?.(ideal); } catch { /* ignore */ }
      this.lastNudge = nowReal;
    }
  }

  _end() {
    this._clearLoop();
    this._stopNodes(false);
    this.pausedContent = this.plan.contentEnd;
    this._restoreVideo(); // let the video continue normally past the last chunk
    this._setState('ended');
    this._emit('ended');
  }
}

export default GapExpandedEngine;
