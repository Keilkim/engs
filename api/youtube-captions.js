// Vercel Serverless Function - YouTube caption fetcher (server-side).
//
// Uses the InnerTube "ANDROID_VR" player client — the same trick yt-dlp relies
// on to bypass YouTube's datacenter-IP / PO-token gating. This works from a
// server without CORS proxies (now dead) or a scraped watch page (which YouTube
// serves without caption data to blocked IPs).

const VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.60.19 ' +
  '(Linux; U; Android 12L; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { videoId, lang = 'en' } = req.body || {};
  if (!videoId) return res.status(400).json({ error: 'videoId is required' });

  try {
    const player = await getPlayer(videoId);
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
    const durationSec = Number(player?.videoDetails?.lengthSeconds) || 0;

    if (!tracks || tracks.length === 0) {
      // Genuinely no caption tracks for this video.
      return res.status(200).json({ segments: [], source: 'youtube', hasCaptions: false, durationSec });
    }

    const track = pickTrack(tracks, lang);
    if (!track?.baseUrl) {
      return res.status(200).json({ segments: [], source: 'youtube', hasCaptions: false, durationSec });
    }

    // Force json3 (strip any format the track URL already carries).
    const jsonUrl = track.baseUrl.replace(/&fmt=[^&]*/g, '') + '&fmt=json3';
    const r = await fetch(jsonUrl, { headers: { 'User-Agent': VR_UA } });
    if (!r.ok) return res.status(502).json({ error: `Caption content fetch failed (${r.status})` });

    const body = await r.text();
    const parsed = parseCaption(body, track.languageCode || lang);
    if (!parsed) return res.status(200).json({ segments: [], source: 'youtube', hasCaptions: false, durationSec });
    return res.status(200).json({ ...parsed, hasCaptions: true, durationSec });
  } catch (err) {
    // Network/parse failure — NOT a confirmed absence of captions.
    return res.status(502).json({ error: err.message || 'Caption fetch failed' });
  }
}

async function getPlayer(videoId) {
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
  if (!r.ok) throw new Error(`InnerTube player request failed (${r.status})`);
  return r.json();
}

// Prefer a human (non-ASR) track in the requested language, then any variant,
// then any track at all.
function pickTrack(tracks, lang) {
  return (
    tracks.find((t) => t.languageCode === lang && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode?.startsWith(lang) && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode === lang) ||
    tracks.find((t) => t.languageCode?.startsWith(lang)) ||
    tracks[0]
  );
}

function parseCaption(text, lang) {
  const t = (text || '').trim();
  if (!t) return null;
  if (t.startsWith('{')) {
    try { return parseJson3(JSON.parse(t), lang); } catch { return null; }
  }
  if (t.startsWith('<')) return parseSrv3Xml(t, lang);
  return null;
}

function parseJson3(data, lang) {
  if (!data?.events || data.events.length === 0) return null;
  const segments = [];
  for (const ev of data.events) {
    if (!ev.segs || ev.tStartMs === undefined) continue;
    const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    segments.push({
      id: segments.length,
      start: ev.tStartMs / 1000,
      end: (ev.tStartMs + (ev.dDurationMs || 3000)) / 1000,
      text,
    });
  }
  if (segments.length === 0) return null;
  return { segments, language: lang, source: 'youtube' };
}

// srv3 XML fallback: <p t="ms" d="ms"> ... (<s>word</s>) ... </p>
function parseSrv3Xml(xml, lang) {
  const segments = [];
  const re = /<p t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const startMs = parseInt(m[1], 10);
    const durMs = m[2] ? parseInt(m[2], 10) : 3000;
    const text = decodeEntities(m[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    segments.push({ id: segments.length, start: startMs / 1000, end: (startMs + durMs) / 1000, text });
  }
  if (segments.length === 0) return null;
  return { segments, language: lang, source: 'youtube' };
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
