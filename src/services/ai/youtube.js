// YouTube Service - URL parsing, metadata, captions, Whisper transcription

/**
 * Parse YouTube URL and extract video ID
 * Supports: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/
 */
export function parseYouTubeUrl(url) {
  if (!url) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        video_id: match[1],
        type: url.includes('/shorts/') ? 'shorts' : 'video',
      };
    }
  }

  return null;
}

/**
 * Get YouTube video metadata using noembed.com (CORS-friendly)
 */
export async function getYouTubeMetadata(videoId) {
  try {
    const url = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch metadata');
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    return {
      title: data.title || 'Untitled Video',
      author: data.author_name || 'Unknown',
      thumbnail_url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      thumbnail_url_hq: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch (error) {
    console.error('[YouTube] Metadata fetch error:', error);
    return {
      title: 'YouTube Video',
      author: 'Unknown',
      thumbnail_url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      thumbnail_url_hq: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  }
}

/**
 * Fetch YouTube captions.
 *
 * Note: the browser cannot call YouTube's timedtext/watch endpoints directly
 * (CORS), so we load the watch page through a CORS proxy, read its embedded
 * caption track list, then fetch the chosen track (also via proxy).
 *
 * Returns null when the video genuinely has no caption tracks. A proxy/network
 * failure also returns null but is logged distinctly so it is clear the video
 * may in fact have captions (do not blindly treat null as "no captions").
 */
export async function fetchYouTubeCaptions(videoId, lang = 'en') {
  console.log('[YouTube] Fetching captions for:', videoId);

  try {
    const result = await fetchCaptionsFromPage(videoId, lang);
    if (result) {
      console.log(`[YouTube] Got captions (${result.segments.length} segments)`);
      return result;
    }
    console.log('[YouTube] No caption tracks found for this video');
    return null;
  } catch (e) {
    // Distinct log: this is a fetch/proxy failure, NOT a confirmed absence of
    // captions. Callers should avoid over-eagerly steering the user to paid
    // Whisper transcription on this path.
    console.warn('[YouTube] Caption fetch failed (proxy/network):', e.message);
    return null;
  }
}

// CORS proxy helper - try multiple proxies, return the first that responds.
async function fetchWithProxy(url) {
  const proxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ];

  for (const proxyFn of proxies) {
    try {
      const response = await fetch(proxyFn(url));
      if (response.ok) return response;
    } catch (e) {
      console.log('[YouTube] Proxy attempt failed:', e.message);
    }
  }
  return null;
}

// Load the watch page, extract the caption track list, and fetch the best track.
async function fetchCaptionsFromPage(videoId, lang) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetchWithProxy(pageUrl);
  if (!response) throw new Error('Could not load video page through any proxy');

  const html = await response.text();
  const tracks = extractCaptionTracks(html);
  if (!tracks || tracks.length === 0) return null; // genuinely no captions

  const track = pickCaptionTrack(tracks, lang);
  if (!track?.baseUrl) return null;

  const baseUrl = decodeCaptionUrl(track.baseUrl);
  // Prefer json3 (has word-ish segments); fall back to the track's default
  // XML format if json3 isn't served.
  const candidateUrls = [
    baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`,
    baseUrl,
  ];

  for (const url of candidateUrls) {
    const capRes = await fetchWithProxy(url);
    if (!capRes) continue;
    const parsed = parseCaptionText(await capRes.text(), track.languageCode || lang);
    if (parsed) return parsed;
  }
  return null;
}

// Extract the captionTracks JSON array from the watch page HTML.
function extractCaptionTracks(html) {
  const match = html.match(/"captionTracks":\s*(\[.*?\])/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1].replace(/\\u0026/g, '&'));
  } catch {
    return null;
  }
}

// Prefer a human (non-ASR) track in the requested language, then any variant,
// then any track at all.
function pickCaptionTrack(tracks, lang) {
  return (
    tracks.find(t => t.languageCode === lang && t.kind !== 'asr') ||
    tracks.find(t => t.languageCode?.startsWith(lang) && t.kind !== 'asr') ||
    tracks.find(t => t.languageCode === lang) ||
    tracks.find(t => t.languageCode?.startsWith(lang)) ||
    tracks[0]
  );
}

function decodeCaptionUrl(url) {
  return url.replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
}

// Parse a caption payload that may be json3 or XML.
function parseCaptionText(text, lang) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return parseYouTubeCaptionData(JSON.parse(trimmed), lang);
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith('<')) {
    return parseCaptionXml(trimmed, lang);
  }
  return null;
}

// Parse YouTube caption json3 format
function parseYouTubeCaptionData(data, lang) {
  if (!data?.events || data.events.length === 0) return null;

  const segments = [];
  for (const event of data.events) {
    if (!event.segs || event.tStartMs === undefined) continue;
    const text = event.segs.map(s => s.utf8).join('').trim();
    if (!text) continue;

    segments.push({
      id: segments.length,
      start: event.tStartMs / 1000,
      end: (event.tStartMs + (event.dDurationMs || 3000)) / 1000,
      text,
    });
  }

  if (segments.length === 0) return null;

  return { segments, language: lang, source: 'youtube' };
}

// Parse the legacy XML caption format (<text start="" dur="">...</text>)
function parseCaptionXml(xml, lang) {
  const segments = [];
  const re = /<text start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const start = parseFloat(m[1]);
    const dur = m[2] ? parseFloat(m[2]) : 3;
    const text = decodeHtmlEntities(m[3]).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    segments.push({ id: segments.length, start, end: start + dur, text });
  }
  if (segments.length === 0) return null;
  return { segments, language: lang, source: 'youtube' };
}

function decodeHtmlEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/**
 * Full Whisper transcription flow via server-side API route
 * Audio extraction + transcription happens entirely on the server
 */
export async function transcribeYouTubeWithWhisper(videoId, language = 'en', onProgress) {
  onProgress?.('오디오 추출 + 음성 인식 중...');

  const response = await fetch('/api/whisper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, language }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Whisper transcription failed');
  }

  return await response.json();
}

/**
 * Parse manual captions (SRT or plain text)
 */
export function parseManualCaptions(text) {
  const lines = text.trim().split('\n');
  const segments = [];
  let currentSegment = null;
  const srtPattern = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^\d+$/.test(line)) continue;

    const srtMatch = line.match(srtPattern);
    if (srtMatch) {
      const startTime = parseInt(srtMatch[1]) * 3600 + parseInt(srtMatch[2]) * 60 + parseInt(srtMatch[3]) + parseInt(srtMatch[4]) / 1000;
      const endTime = parseInt(srtMatch[5]) * 3600 + parseInt(srtMatch[6]) * 60 + parseInt(srtMatch[7]) + parseInt(srtMatch[8]) / 1000;
      currentSegment = { start: startTime, end: endTime, text: '' };
    } else if (currentSegment) {
      currentSegment.text += (currentSegment.text ? ' ' : '') + line;
      const nextLine = lines[i + 1]?.trim();
      if (!nextLine || /^\d+$/.test(nextLine) || srtPattern.test(nextLine || '')) {
        if (currentSegment.text) segments.push({ ...currentSegment, id: segments.length });
        currentSegment = null;
      }
    } else {
      if (line.length > 0) {
        const start = segments.length * 3;
        segments.push({ id: segments.length, start, end: start + 3, text: line });
      }
    }
  }

  return { segments, language: 'en', source: 'manual' };
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
export function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Calculate Whisper cost estimate
 */
export function calculateWhisperCost(durationSeconds) {
  const durationMinutes = durationSeconds / 60;
  const usd = durationMinutes * 0.006;
  const krw = Math.round(usd * 1350);
  return { usd, krw };
}

/**
 * Check if Whisper is available (server-side key, always true if API route exists)
 */
export function isWhisperAvailable() {
  return true;
}
