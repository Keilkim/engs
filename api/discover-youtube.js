// Vercel Serverless Function — YouTube keyword discovery.
//
// KEYLESS BY DEFAULT: scrapes the public search results page (ytInitialData), the same
// posture the app already uses for captions/channel resolution — no key, no quota, but
// best-effort (Google can bot-check datacenter IPs → self-hides on failure). If a
// YOUTUBE_API_KEY is set it uses the official Data API instead (more robust; free 100
// searches/day). Either way returns normalized-but-idless candidates; the client ranks.

const FEED_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { q, publishedAfter, maxResults = 15 } = req.body || {};
  if (!q || !String(q).trim()) return res.status(400).json({ error: 'q required' });

  try {
    const key = process.env.YOUTUBE_API_KEY;
    const items = key
      ? await searchViaApi(key, String(q), publishedAfter, maxResults)
      : await searchViaScrape(String(q), maxResults);
    return res.status(200).json({ items, configured: true });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'youtube discovery failed' });
  }
}

// --- keyless: results-page scrape (ytInitialData) --------------------------------
async function searchViaScrape(q, maxResults) {
  // sp=EgIQAQ%3D%3D → filter results to type:Video.
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%3D%3D`;
  const r = await fetch(url, { headers: { 'User-Agent': FEED_UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!r.ok) throw new Error(`results ${r.status}`);
  const html = await r.text();
  const m = html.match(/var ytInitialData = (\{.+?\});<\/script>/s) || html.match(/ytInitialData"?\]?\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const vids = [];
  const seen = new Set();
  collectVideos(data, vids, seen);
  return vids.slice(0, maxResults).map((v) => ({
    kind: 'youtube',
    videoId: v.videoId,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    title: v.title,
    snippet: v.channel || '',
    thumbnail: `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
    source: v.channel || '',
    published: v.published,
    extra: { videoId: v.videoId, durationSec: v.durationSec },
  }));
}

// Recursively find video-renderer-ish nodes (has videoId + a title). Robust against
// exact-path changes in ytInitialData across YouTube layout tweaks.
function collectVideos(node, out, seen) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectVideos(n, out, seen);
    return;
  }
  const vid = node.videoId;
  const title = textOf(node.title) || textOf(node.headline);
  if (typeof vid === 'string' && vid.length === 11 && title && !seen.has(vid)) {
    seen.add(vid);
    out.push({
      videoId: vid,
      title,
      channel: textOf(node.longBylineText) || textOf(node.shortBylineText) || textOf(node.ownerText),
      durationSec: lengthToSec(textOf(node.lengthText)),
      published: relativeToIso(textOf(node.publishedTimeText)),
    });
  }
  for (const k in node) collectVideos(node[k], out, seen);
}

function textOf(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.simpleText) return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text).join('');
  return '';
}

function lengthToSec(s) {
  if (!s) return 0;
  const parts = s.split(':').map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// "3 days ago" / "Streamed 2 weeks ago" → approximate ISO (freshness only needs ~accuracy).
function relativeToIso(s) {
  if (!s) return null;
  const m = s.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }[unit];
  return new Date(Date.now() - n * ms).toISOString();
}

// --- optional: official Data API (used only when YOUTUBE_API_KEY is set) ----------
async function searchViaApi(key, q, publishedAfter, maxResults) {
  const after = publishedAfter || new Date(Date.now() - 60 * 86400000).toISOString();
  const sp = new URLSearchParams({
    key, part: 'snippet', type: 'video', order: 'relevance', relevanceLanguage: 'en',
    videoEmbeddable: 'true', safeSearch: 'moderate',
    maxResults: String(Math.min(25, Math.max(1, maxResults))), publishedAfter: after, q,
  });
  const sr = await fetch(`${SEARCH_URL}?${sp}`);
  if (!sr.ok) throw new Error(`search ${sr.status}`);
  const sData = await sr.json();
  const ids = (sData.items || []).map((it) => it?.id?.videoId).filter(Boolean);
  if (ids.length === 0) return [];

  const vp = new URLSearchParams({ key, part: 'contentDetails,snippet', id: ids.join(',') });
  const vr = await fetch(`${VIDEOS_URL}?${vp}`);
  const vData = vr.ok ? await vr.json() : { items: [] };
  const byId = {};
  for (const v of vData.items || []) byId[v.id] = v;

  return ids.map((videoId) => {
    const v = byId[videoId];
    const sn = v?.snippet || {};
    return {
      kind: 'youtube', videoId, url: `https://www.youtube.com/watch?v=${videoId}`,
      title: decodeEntities(sn.title || ''),
      snippet: decodeEntities(sn.description || '').slice(0, 400),
      thumbnail: sn.thumbnails?.medium?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      source: decodeEntities(sn.channelTitle || ''), published: sn.publishedAt || null,
      extra: { videoId, channelId: sn.channelId || null, durationSec: parseIsoDuration(v?.contentDetails?.duration) },
    };
  }).filter((it) => it.title);
}

function parseIsoDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}
