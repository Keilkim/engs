// Vercel Serverless Function - YouTube caption fetcher (server-side).
// Runs server-to-server so it doesn't need the (now mostly-dead) public CORS
// proxies the browser had to use. Returns parsed caption segments.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { videoId, lang = 'en' } = req.body || {};
  if (!videoId) return res.status(400).json({ error: 'videoId is required' });

  try {
    // 1) Get the caption track list from the watch page.
    const wp = await tracksFromWatchPage(videoId);
    const tracks = wp.tracks;
    if (!tracks || tracks.length === 0) {
      // Genuinely no captions, OR YouTube served this datacenter IP a page
      // without them. _debug tells which (removed once confirmed).
      return res.status(200).json({
        segments: [],
        source: 'youtube',
        hasCaptions: false,
        _debug: { watchOk: wp.ok, status: wp.status, htmlLen: wp.htmlLen, hasCaptionSubstr: wp.hasCaptionSubstr, parsed: wp.parsedCount },
      });
    }

    // 2) Pick the best track and fetch its content (json3 preferred, else xml).
    const track = pickTrack(tracks, lang);
    if (!track?.baseUrl) {
      return res.status(200).json({ segments: [], source: 'youtube', hasCaptions: false });
    }
    const baseUrl = decodeUrl(track.baseUrl);
    const urls = [baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`, baseUrl];

    for (const url of urls) {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': `${lang},en;q=0.8` } });
      if (!r.ok) continue;
      const body = await r.text();
      const parsed = parseCaption(body, track.languageCode || lang);
      if (parsed) return res.status(200).json({ ...parsed, hasCaptions: true });
    }

    return res.status(200).json({ segments: [], source: 'youtube', hasCaptions: false });
  } catch (err) {
    // Network/parse failure — NOT a confirmed absence of captions.
    return res.status(502).json({ error: err.message || 'Caption fetch failed' });
  }
}

async function tracksFromWatchPage(videoId) {
  const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      // Bypass the EU consent interstitial that hides the player data.
      Cookie: 'CONSENT=YES+1; SOCS=CAI',
    },
  });
  const out = { ok: r.ok, status: r.status, htmlLen: 0, hasCaptionSubstr: false, parsedCount: 0, tracks: null };
  if (!r.ok) return out;

  const html = await r.text();
  out.htmlLen = html.length;
  const key = '"captionTracks":';
  const i = html.indexOf(key);
  out.hasCaptionSubstr = i !== -1;
  if (i === -1) return out;

  // Bracket-match the array so a caption name's nested `runs:[...]` can't
  // truncate it (which a non-greedy regex would).
  const start = html.indexOf('[', i);
  if (start === -1) return out;
  let depth = 0, end = -1;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end === -1) return out;
  try {
    const arr = JSON.parse(html.slice(start, end + 1).replace(/\\u0026/g, '&'));
    out.parsedCount = arr.length;
    out.tracks = arr;
  } catch { /* leave tracks null */ }
  return out;
}

function pickTrack(tracks, lang) {
  return (
    tracks.find((t) => t.languageCode === lang && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode?.startsWith(lang) && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode === lang) ||
    tracks.find((t) => t.languageCode?.startsWith(lang)) ||
    tracks[0]
  );
}

function decodeUrl(url) {
  return url.replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
}

function parseCaption(text, lang) {
  const t = (text || '').trim();
  if (!t) return null;
  if (t.startsWith('{')) {
    try { return parseJson3(JSON.parse(t), lang); } catch { return null; }
  }
  if (t.startsWith('<')) return parseXml(t, lang);
  return null;
}

function parseJson3(data, lang) {
  if (!data?.events || data.events.length === 0) return null;
  const segments = [];
  for (const ev of data.events) {
    if (!ev.segs || ev.tStartMs === undefined) continue;
    const text = ev.segs.map((s) => s.utf8).join('').trim();
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

function parseXml(xml, lang) {
  const segments = [];
  const re = /<text start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const start = parseFloat(m[1]);
    const dur = m[2] ? parseFloat(m[2]) : 3;
    const text = decodeEntities(m[3]).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    segments.push({ id: segments.length, start, end: start + dur, text });
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
