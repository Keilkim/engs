// Windowed audio fetch + decode cache for the gap-expanded engine.
//
// The Railway audio server (youtube-audio-server) enables CORS for all origins,
// so the browser calls it directly (no Vercel proxy: that would add a 4.5MB body
// cap and a second 60s timeout for zero benefit). We fetch the video's audio in
// ~2-minute windows on demand, decode to PCM, downmix to MONO (halves memory),
// and keep at most a couple of decoded windows plus a small compressed LRU so
// backward seeks don't re-hit yt-dlp.

const RAILWAY_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_RAILWAY_AUDIO_URL) ||
  'https://youtube-audio-server-production-711c.up.railway.app';

const DEFAULTS = {
  windowSec: 120,
  marginSec: 3.5,        // fetch a little before/after so any capped span (≤3s) + lead-in is fully contained
  maxDecoded: 2,
  maxCompressedBytes: 12 * 1024 * 1024,
};

// atob → Uint8Array without blowing the call stack on large payloads.
function base64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Average all channels into one Float32Array (mono). Speech loses nothing
// meaningful and memory drops ~2x versus keeping stereo.
function downmixToMono(audioBuffer, ctx) {
  const ch = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  if (ch === 1) return audioBuffer;
  const mono = ctx.createBuffer(1, len, audioBuffer.sampleRate);
  const out = mono.getChannelData(0);
  for (let c = 0; c < ch; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i] / ch;
  }
  return mono;
}

export class AudioWindowCache {
  constructor({ videoId, ctx, videoDuration, ...opts }) {
    this.videoId = videoId;
    this.ctx = ctx;
    this.videoDuration = videoDuration || Infinity;
    this.opts = { ...DEFAULTS, ...opts };
    this.decoded = new Map();   // windowIndex -> { buffer(mono AudioBuffer), samples(Float32Array), contentStart, sampleRate }
    this.decodedOrder = [];     // LRU order of decoded window indices
    this.compressed = new Map(); // windowIndex -> ArrayBuffer (raw mp3), LRU
    this.compressedOrder = [];
    this.compressedBytes = 0;
    this.inflight = new Map();   // windowIndex -> Promise
    this.generation = 0;         // bumped on seek/rate-off to cancel stale work
  }

  windowIndexFor(contentTime) {
    return Math.max(0, Math.floor(contentTime / this.opts.windowSec));
  }

  // Nominal content start of a window (before margin).
  windowContentStart(index) {
    return index * this.opts.windowSec;
  }

  bumpGeneration() {
    this.generation += 1;
    for (const c of this.inflight.values()) c.controller?.abort?.();
    this.inflight.clear();
  }

  async _fetchCompressed(index, gen, signal) {
    if (this.compressed.has(index)) return this.compressed.get(index);
    const nominalStart = this.windowContentStart(index);
    const startSec = Math.max(0, nominalStart - this.opts.marginSec);
    const rawDur = this.opts.windowSec + this.opts.marginSec * 2;
    const durationSec = Math.min(rawDur, Math.max(1, this.videoDuration - startSec));

    const res = await fetch(`${RAILWAY_URL}/api/extract-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: this.videoId, startSec, durationSec }),
      signal,
    });
    if (gen !== this.generation) throw new DOMException('stale', 'AbortError');
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Audio window fetch failed (${res.status})`);
    }
    const data = await res.json();
    if (!data.audioBase64) throw new Error('No audio data returned');
    const bytes = base64ToBytes(data.audioBase64);
    this._putCompressed(index, bytes.buffer);
    return bytes.buffer;
  }

  _putCompressed(index, arrayBuffer) {
    if (this.compressed.has(index)) return;
    this.compressed.set(index, arrayBuffer);
    this.compressedOrder.push(index);
    this.compressedBytes += arrayBuffer.byteLength;
    while (this.compressedBytes > this.opts.maxCompressedBytes && this.compressedOrder.length > 1) {
      const evict = this.compressedOrder.shift();
      const buf = this.compressed.get(evict);
      if (buf) this.compressedBytes -= buf.byteLength;
      this.compressed.delete(evict);
    }
  }

  // Returns { buffer, samples, contentStart, sampleRate } for the window; fetches
  // + decodes if needed. Concurrent calls for the same window coalesce.
  async getDecoded(index) {
    if (this.decoded.has(index)) {
      this._touchDecoded(index);
      return this.decoded.get(index);
    }
    if (this.inflight.has(index)) return this.inflight.get(index).promise;

    const gen = this.generation;
    const controller = new AbortController();
    const promise = (async () => {
      const mp3 = await this._fetchCompressed(index, gen, controller.signal);
      if (gen !== this.generation) throw new DOMException('stale', 'AbortError');
      // decodeAudioData DETACHES its input ArrayBuffer, which would corrupt the
      // cached mp3 for a later re-decode (backward seek). Decode a copy.
      const decodedRaw = await this.ctx.decodeAudioData(mp3.slice(0));
      if (gen !== this.generation) throw new DOMException('stale', 'AbortError');
      const mono = downmixToMono(decodedRaw, this.ctx);
      const nominalStart = this.windowContentStart(index);
      const contentStart = Math.max(0, nominalStart - this.opts.marginSec); // window-local t=0 maps to this content time
      const entry = {
        buffer: mono,
        samples: mono.getChannelData(0),
        contentStart,
        sampleRate: mono.sampleRate,
      };
      this._putDecoded(index, entry);
      return entry;
    })();

    const entry = { promise, controller };
    this.inflight.set(index, entry);
    try {
      return await promise;
    } finally {
      // Only clear if OUR entry is still current — a stale promise settling after
      // a bumpGeneration + re-request must not erase the new inflight request.
      if (this.inflight.get(index) === entry) this.inflight.delete(index);
    }
  }

  _putDecoded(index, entry) {
    this.decoded.set(index, entry);
    this._touchDecoded(index);
    while (this.decodedOrder.length > this.opts.maxDecoded) {
      const evict = this.decodedOrder.shift();
      if (evict !== index) this.decoded.delete(evict);
    }
  }

  _touchDecoded(index) {
    const i = this.decodedOrder.indexOf(index);
    if (i >= 0) this.decodedOrder.splice(i, 1);
    this.decodedOrder.push(index);
  }

  // Kick off a background fetch+decode for a window (prefetch); errors ignored.
  prefetch(index) {
    if (index < 0) return;
    if (this.windowContentStart(index) >= this.videoDuration) return;
    if (this.decoded.has(index) || this.inflight.has(index)) return;
    this.getDecoded(index).catch(() => {});
  }

  dispose() {
    this.bumpGeneration();
    this.decoded.clear();
    this.decodedOrder = [];
    this.compressed.clear();
    this.compressedOrder = [];
    this.compressedBytes = 0;
  }
}

export default AudioWindowCache;
