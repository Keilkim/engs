// Vercel Serverless Function - Whisper Transcription
// Extracts audio from YouTube (via the Railway audio server) and transcribes
// with OpenAI Whisper. Long videos are split into overlapping time chunks so
// each stays under Whisper's 25MB limit; chunks are transcribed in parallel and
// stitched back together on a single timeline (chunk start offset + overlap
// dedup), so the result is seamless regardless of length.
/* global process, Buffer */

import { handleCors, requireUser, consumeQuota, QUOTAS, VIDEO_ID_RE, LANG_RE } from './_lib/security.js';

export const config = {
  maxDuration: 300, // best-effort; Hobby plans cap at 60s (see notes to user)
};

const CHUNK_SEC = 1200;  // 20 min per chunk (~19MB at 128kbps < 25MB limit)
const OVERLAP_SEC = 8;   // small overlap so a word isn't cut at a boundary
const UNKNOWN_DURATION_SEC = 5400; // unknown length → cover up to ~90min in one section
// Longest video we'll transcribe. Bounds the parallel chunk fan-out (and spend)
// no matter what durationSec a caller claims.
const MAX_DURATION_SEC = Number(process.env.WHISPER_MAX_DURATION_SEC) || 3 * 3600;
const VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.60.19 ' +
  '(Linux; U; Android 12L; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip';

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI API key not configured' });

  const user = await requireUser(req, res);
  if (!user) return;

  const { videoId, language = 'en', durationSec } = req.body || {};
  if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) {
    return res.status(400).json({ error: 'valid videoId is required' });
  }
  if (typeof language !== 'string' || !LANG_RE.test(language)) {
    return res.status(400).json({ error: 'invalid language' });
  }

  const RAILWAY = process.env.RAILWAY_AUDIO_URL || 'https://youtube-audio-server-production-711c.up.railway.app';
  // Railway verifies the same Supabase session, so forward the caller's token.
  const auth = `Bearer ${user.token}`;

  try {
    // Duration source, most reliable first: caller → Railway (yt-dlp, works even
    // on bot-gated videos where InnerTube returns nothing) → InnerTube.
    const claimed = Number(durationSec);
    const duration = (Number.isFinite(claimed) && claimed > 0 ? claimed : 0)
      || (await getRailwayDuration(RAILWAY, videoId, auth).catch(() => 0))
      || (await getDuration(videoId).catch(() => 0));

    if (duration > MAX_DURATION_SEC) {
      return res.status(413).json({ error: `영상이 너무 길어요 (최대 ${Math.floor(MAX_DURATION_SEC / 60)}분)` });
    }

    const billedSec = duration > 0 ? duration : UNKNOWN_DURATION_SEC;

    let segments;
    if (duration <= CHUNK_SEC + OVERLAP_SEC) {
      // Single pass — but ALWAYS via a [0, dur] section, never a whole-stream
      // download: the direct audio stream 403s / exceeds --max-filesize on many
      // videos, while the sectioned (ffmpeg range) path works reliably.
      const dur = duration > 0 ? duration + 2 : UNKNOWN_DURATION_SEC;
      const buf = await extractSection(RAILWAY, videoId, 0, dur, auth);
      // Extraction failures spend no Whisper credit and must not consume the
      // user's daily transcription allowance. Still check before the paid API.
      if (!(await consumeQuota(res, user, 'whisper_sec', billedSec, QUOTAS.whisper_sec))) return;
      const data = await transcribe(buf, language, OPENAI_API_KEY);
      segments = buildSegments(data, 0, 0, Infinity);
    } else {
      // Split into overlapping chunks, transcribe in parallel, then stitch.
      const n = Math.ceil(duration / CHUNK_SEC);
      const chunks = [];
      for (let i = 0; i < n; i++) {
        const nominal = i * CHUNK_SEC;
        const start = Math.max(0, nominal - (i > 0 ? OVERLAP_SEC : 0));
        const end = Math.min(duration, nominal + CHUNK_SEC) + (i < n - 1 ? OVERLAP_SEC : 0);
        chunks.push({ i, start, dur: end - start, nominal });
      }

      // Prepare every chunk before charging quota or starting a paid call:
      // one blocked section must not leave a partly billed transcription.
      const audioChunks = await Promise.all(chunks.map(async (c) => ({
        c,
        buf: await extractSection(RAILWAY, videoId, c.start, c.dur, auth),
      })));
      if (!(await consumeQuota(res, user, 'whisper_sec', billedSec, QUOTAS.whisper_sec))) return;
      const results = await Promise.all(audioChunks.map(async ({ c, buf }) => ({
        c,
        data: await transcribe(buf, language, OPENAI_API_KEY),
      })));
      results.sort((a, b) => a.c.i - b.c.i);

      segments = [];
      for (const { c, data } of results) {
        // Each chunk owns exactly its nominal window [nominal, nextNominal):
        // drop the leading overlap (previous chunk's tail) and the trailing
        // overlap (next chunk's head) so nothing is duplicated or gapped.
        const dropBefore = c.i > 0 ? c.nominal : 0;
        const dropAfter = c.i < n - 1 ? (c.i + 1) * CHUNK_SEC : Infinity;
        segments.push(...buildSegments(data, c.start, dropBefore, dropAfter));
      }
    }

    segments.forEach((s, i) => { s.id = i; });
    res.status(200).json({ segments, language, source: 'whisper', duration });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
}

// Fetch the audio for a [startSec, +durationSec] slice of a video.
async function extractSection(railway, videoId, startSec, durationSec, auth) {
  const r = await fetch(`${railway}/api/extract-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ videoId, startSec, durationSec }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    // Older Railway deployments only return a generic error + raw details.
    // Recognize the observed bot gate without forwarding stderr to the client.
    const botBlocked = /confirm.*not a bot/i.test(e.details || '');
    throw Object.assign(new Error(botBlocked
      ? 'YouTube blocked audio extraction'
      : e.error || 'Audio extraction failed'), {
      status: r.status,
      code: botBlocked ? 'YOUTUBE_BOT_BLOCKED' : e.code || 'AUDIO_EXTRACTION_FAILED',
    });
  }
  const d = await r.json();
  if (!d.audioBase64) throw new Error('No audio data returned');
  return Buffer.from(d.audioBase64, 'base64');
}

async function transcribe(audioBuffer, language, apiKey) {
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/mp3' }), 'audio.mp3');
  form.append('model', 'whisper-1');
  form.append('language', language);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('timestamp_granularities[]', 'word');

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error?.message || `Whisper transcription failed (${r.status})`);
  }
  return r.json();
}

// Convert one chunk's verbose_json into global-timeline segments.
// `offset` shifts chunk-relative times to the whole-video timeline; segments
// starting before `dropBefore` (the overlap head) are discarded as duplicates.
function buildSegments(data, offset, dropBefore, dropAfter = Infinity) {
  const words = data.words || [];
  const out = [];
  for (const seg of data.segments || []) {
    const gStart = seg.start + offset;
    // A chunk keeps only segments that start within its owned window.
    if (gStart < dropBefore || gStart >= dropAfter) continue;
    // Assign each word to its segment by midpoint (neither drops nor
    // double-counts boundary words), then shift to the global timeline.
    const segWords = words
      .filter((w) => {
        const mid = (w.start + w.end) / 2;
        return mid >= seg.start && mid < seg.end;
      })
      .map((w) => ({ word: w.word, start: w.start + offset, end: w.end + offset }));
    // Keep Whisper's own confidence signals so the client can reject hallucinated
    // segments (music/noise) before pause-chunking / gap-expanded playback.
    out.push({
      start: gStart,
      end: seg.end + offset,
      text: (seg.text || '').trim(),
      words: segWords,
      no_speech_prob: seg.no_speech_prob,
      avg_logprob: seg.avg_logprob,
    });
  }
  return out;
}

// Video length via the Railway server (yt-dlp knows the duration even when
// InnerTube is bot-gated). Cheap: no download.
async function getRailwayDuration(railway, videoId, auth) {
  const r = await fetch(`${railway}/api/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ videoId }),
  });
  if (!r.ok) return 0;
  const d = await r.json();
  return Number(d.duration) || 0;
}

// Video length via the InnerTube ANDROID_VR client (same bypass used for captions).
async function getDuration(videoId) {
  const r = await fetch('https://youtubei.googleapis.com/youtubei/v1/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': VR_UA },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: 'ANDROID_VR',
          clientVersion: '1.60.19',
          deviceMake: 'Oculus',
          deviceModel: 'Quest 3',
          androidSdkVersion: 32,
          hl: 'en',
          gl: 'US',
        },
      },
    }),
  });
  if (!r.ok) return 0;
  const d = await r.json();
  return Number(d?.videoDetails?.lengthSeconds) || 0;
}
