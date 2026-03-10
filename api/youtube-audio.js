// Vercel Serverless Function - YouTube Audio Extraction
// Uses working Piped API instances

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { videoId } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  const errors = [];

  // Get list of working Piped instances
  let pipedInstances = [
    'https://api.piped.private.coffee',
  ];

  try {
    const instancesResponse = await fetch('https://piped-instances.kavin.rocks/', {
      signal: AbortSignal.timeout(5000),
    });
    if (instancesResponse.ok) {
      const instances = await instancesResponse.json();
      const goodInstances = instances
        .filter(i => i.api_url && i.uptime_24h > 90)
        .sort((a, b) => b.uptime_24h - a.uptime_24h)
        .slice(0, 5)
        .map(i => i.api_url);
      pipedInstances = [...new Set([...pipedInstances, ...goodInstances])];
    }
  } catch (e) {
    console.log('[API] Could not fetch instances list:', e.message);
  }

  for (const instance of pipedInstances) {
    try {
      const response = await fetch(`${instance}/streams/${videoId}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        errors.push(`${instance}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (data.error) {
        errors.push(`${instance}: ${data.error}`);
        continue;
      }

      const audioStreams = data.audioStreams || [];

      if (audioStreams.length === 0) {
        errors.push(`${instance}: no audio streams`);
        continue;
      }

      // Prefer 128kbps for good quality/size balance
      audioStreams.sort((a, b) => {
        const aScore = Math.abs(128000 - (a.bitrate || 0));
        const bScore = Math.abs(128000 - (b.bitrate || 0));
        return aScore - bScore;
      });

      const bestAudio = audioStreams[0];

      if (!bestAudio.url) {
        errors.push(`${instance}: no URL in audio stream`);
        continue;
      }

      return res.status(200).json({
        audioUrl: bestAudio.url,
        mimeType: bestAudio.mimeType,
        bitrate: bestAudio.bitrate,
        method: 'piped',
        instance,
      });
    } catch (e) {
      errors.push(`${instance}: ${e.message}`);
    }
  }

  return res.status(500).json({
    error: 'YouTube 오디오 추출 실패. 다른 영상을 시도해주세요.',
    details: errors.join('; '),
  });
}
