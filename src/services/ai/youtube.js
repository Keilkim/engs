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
 * Fetch YouTube captions using multiple methods
 * Tries: 1) Direct API, 2) CORS proxy, 3) Page scraping
 */
export async function fetchYouTubeCaptions(videoId, lang = 'en') {
  console.log('[YouTube] Fetching captions for:', videoId);

  // Method 1: Try direct timedtext API
  try {
    const directResult = await fetchCaptionsDirect(videoId, lang);
    if (directResult) {
      console.log('[YouTube] Got captions via direct API');
      return directResult;
    }
  } catch (e) {
    console.log('[YouTube] Direct API failed:', e.message);
  }

  // Method 2: Try via CORS proxy
  try {
    const proxyResult = await fetchCaptionsViaProxy(videoId, lang);
    if (proxyResult) {
      console.log('[YouTube] Got captions via proxy');
      return proxyResult;
    }
  } catch (e) {
    console.log('[YouTube] Proxy method failed:', e.message);
  }

  // Method 3: Try scraping YouTube page for caption data
  try {
    const scrapeResult = await fetchCaptionsViaScrape(videoId, lang);
    if (scrapeResult) {
      console.log('[YouTube] Got captions via scraping');
      return scrapeResult;
    }
  } catch (e) {
    console.log('[YouTube] Scrape method failed:', e.message);
  }

  console.log('[YouTube] All caption fetch methods failed');
  return null;
}

// Direct YouTube timedtext API
async function fetchCaptionsDirect(videoId, lang) {
  const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`;
  const response = await fetch(captionUrl);
  if (!response.ok) return null;
  const data = await response.json();
  return parseYouTubeCaptionData(data, lang);
}

// CORS proxy helper - try multiple proxies
async function fetchWithProxy(url) {
  const proxies = [
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ];

  for (const proxyFn of proxies) {
    try {
      const proxyUrl = proxyFn(url);
      const response = await fetch(proxyUrl);
      if (response.ok) return response;
    } catch (e) {
      console.log('[YouTube] Proxy attempt failed:', e.message);
    }
  }
  return null;
}

// Via CORS proxy
async function fetchCaptionsViaProxy(videoId, lang) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetchWithProxy(pageUrl);
  if (!response) return null;

  const html = await response.text();
  const captionUrlMatch = html.match(/"captionTracks":\s*\[(.*?)\]/);
  if (!captionUrlMatch) return null;

  try {
    const captionTracksStr = `[${captionUrlMatch[1]}]`;
    const captionTracks = JSON.parse(captionTracksStr);

    const enTrack = captionTracks.find(t =>
      t.languageCode === lang || t.languageCode?.startsWith(lang)
    ) || captionTracks[0];

    if (!enTrack?.baseUrl) return null;

    const captionResponse = await fetchWithProxy(enTrack.baseUrl + '&fmt=json3');
    if (!captionResponse) return null;

    const captionData = await captionResponse.json();
    return parseYouTubeCaptionData(captionData, lang);
  } catch (e) {
    console.log('[YouTube] Failed to parse caption tracks:', e);
    return null;
  }
}

// Scrape YouTube page for embedded caption data
async function fetchCaptionsViaScrape(videoId, lang) {
  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetchWithProxy(pageUrl);
  if (!response) return null;

  const html = await response.text();
  const timedtextMatch = html.match(/timedtext[^"]*v=([^&"]+)[^"]*/);
  if (timedtextMatch) {
    const extractedUrl = timedtextMatch[0].replace(/\\u0026/g, '&');
    const fullUrl = `https://www.youtube.com/api/${extractedUrl}&fmt=json3&lang=${lang}`;

    try {
      const dataResponse = await fetchWithProxy(fullUrl);
      if (dataResponse) {
        const data = await dataResponse.json();
        return parseYouTubeCaptionData(data, lang);
      }
    } catch {
      // Continue
    }
  }

  return null;
}

// Parse YouTube caption JSON format
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
