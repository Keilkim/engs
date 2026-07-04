// Vercel Serverless Function - Whisper Transcription
// Extracts audio from YouTube (via the Railway audio server) and transcribes
// with OpenAI Whisper. Long videos are split into overlapping time chunks so
// each stays under Whisper's 25MB limit; chunks are transcribed in parallel and
// stitched back together on a single timeline (chunk start offset + overlap
// dedup), so the result is seamless regardless of length.
/* global process, Buffer */

export const config = {
  maxDuration: 300, // best-effort; Hobby plans cap at 60s (see notes to user)
};

const CHUNK_SEC = 1200;  // 20 min per chunk (~19MB at 128kbps < 25MB limit)
const OVERLAP_SEC = 8;   // small overlap so a word isn't cut at a boundary
const VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.60.19 ' +
  '(Linux; U; Android 12L; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OpenAI API key not configured' });

  const { videoId, language = 'en', durationSec } = req.body || {};
  if (!videoId) return res.status(400).json({ error: 'videoId is required' });

  const RAILWAY = process.env.RAILWAY_AUDIO_URL || 'https://youtube-audio-server-production-711c.up.railway.app';

  try {
    const duration = Number(durationSec) || (await getDuration(videoId).catch(() => 0));

    let segments;
    if (!duration || duration <= CHUNK_SEC + OVERLAP_SEC) {
      // Short enough for a single pass.
      const buf = await extractSection(RAILWAY, videoId, null, null);
      const data = await transcribe(buf, language, OPENAI_API_KEY);
      segments = buildSegments(data, 0, 0);
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

      const results = await Promise.all(
        chunks.map(async (c) => {
          const buf = await extractSection(RAILWAY, videoId, c.start, c.dur);
          const data = await transcribe(buf, language, OPENAI_API_KEY);
          return { c, data };
        })
      );
      results.sort((a, b) => a.c.i - b.c.i);

      segments = [];
      for (const { c, data } of results) {
        // Drop the overlap head (already covered by the previous chunk's tail).
        const dropBefore = c.i > 0 ? c.nominal : 0;
        segments.push(...buildSegments(data, c.start, dropBefore));
      }
    }

    segments.forEach((s, i) => { s.id = i; });
    res.status(200).json({ segments, language, source: 'whisper', duration });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Fetch just the audio for a video (whole, or a [startSec, +durationSec] slice).
async function extractSection(railway, videoId, startSec, durationSec) {
  const body = startSec != null && durationSec != null
    ? { videoId, startSec, durationSec }
    : { videoId };
  const r = await fetch(`${railway}/api/extract-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'Audio extraction failed');
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
function buildSegments(data, offset, dropBefore) {
  const words = data.words || [];
  const out = [];
  for (const seg of data.segments || []) {
    const gStart = seg.start + offset;
    if (gStart < dropBefore) continue;
    // Assign each word to its segment by midpoint (neither drops nor
    // double-counts boundary words), then shift to the global timeline.
    const segWords = words
      .filter((w) => {
        const mid = (w.start + w.end) / 2;
        return mid >= seg.start && mid < seg.end;
      })
      .map((w) => ({ word: w.word, start: w.start + offset, end: w.end + offset }));
    out.push({ start: gStart, end: seg.end + offset, text: (seg.text || '').trim(), words: segWords });
  }
  return out;
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
