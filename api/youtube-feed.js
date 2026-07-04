// Vercel Serverless Function — YouTube channel RSS + channel_id resolver.
//
// Powers the Home "next to decode" shelf. No API key, no quota. Two POST modes:
//  - { channelIds: [UC...] }  → fetch each channel's public Atom feed. The browser
//    can't fetch these directly (YouTube serves no CORS header on the feed), so we
//    proxy them server-to-server. Shorts are flagged per-entry from the alternate
//    link (/shorts/), so the client can filter them without a duration lookup.
//  - { resolveVideoId }       → read channelId + lengthSeconds from the InnerTube
//    ANDROID_VR player response (same trick youtube-captions.js uses). This backfills
//    the UC... channel id the add flow never stored (youtube_data.channel is only a
//    display name), so each legacy video is resolved at most once.

const VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.60.19 ' +
  '(Linux; U; Android 12L; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip';

// A normal browser UA for the public RSS feed request.
const FEED_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const MAX_CHANNELS = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { channelIds, resolveVideoId } = req.body || {};

  try {
    if (resolveVideoId) {
      return res.status(200).json(await resolveVideo(resolveVideoId));
    }
    if (Array.isArray(channelIds) && channelIds.length > 0) {
      const channels = await fetchChannels(channelIds.slice(0, MAX_CHANNELS));
      return res.status(200).json({ channels });
    }
    return res.status(400).json({ error: 'channelIds or resolveVideoId required' });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'shelf feed failed' });
  }
}

async function fetchChannels(channelIds) {
  const results = await Promise.allSettled(channelIds.map(fetchOneChannel));
  const out = {};
  results.forEach((r, i) => {
    // Per-channel failure is a null, not a 502 — one dead feed must not blank the shelf.
    out[channelIds[i]] = r.status === 'fulfilled' ? r.value : null;
  });
  return out;
}

async function fetchOneChannel(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const r = await fetch(url, { headers: { 'User-Agent': FEED_UA } });
  if (!r.ok) throw new Error(`feed ${channelId} ${r.status}`);
  return parseFeed(await r.text());
}

function parseFeed(xml) {
  // The channel name is the feed-level <title>, which sits before the first <entry>.
  const firstEntry = xml.indexOf('<entry>');
  const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
  const channelName = decodeEntities((head.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();

  const items = [];
  const entries = xml.split('<entry>').slice(1);
  for (const e of entries) {
    const videoId = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    if (!videoId) continue;
    const title = decodeEntities((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    const published = (e.match(/<published>([\s\S]*?)<\/published>/) || [])[1] || null;
    const href = (e.match(/<link[^>]*href="([^"]*)"/) || [])[1] || '';
    items.push({
      videoId,
      title,
      published,
      isShort: href.includes('/shorts/'),
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    });
  }
  return { channelName, items };
}

async function resolveVideo(videoId) {
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
  if (!r.ok) throw new Error(`player ${r.status}`);
  const player = await r.json();
  const channelId = player?.videoDetails?.channelId || null;
  const duration = Number(player?.videoDetails?.lengthSeconds) || null;
  return { channelId, duration, ok: !!channelId };
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
