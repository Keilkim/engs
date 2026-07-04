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
 * Fetch YouTube captions via our server function (server-to-server, no dead
 * CORS proxies).
 *
 * Contract:
 *  - returns a caption object when captions exist,
 *  - returns null ONLY when the video genuinely has NO captions,
 *  - THROWS when the fetch itself fails, so the caller can report a real
 *    failure and NOT mistake it for "no captions" (which would wrongly steer
 *    the user toward paid Whisper).
 */
export async function fetchYouTubeCaptions(videoId, lang = 'en') {
  const res = await fetch('/api/youtube-captions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, lang }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '자막을 불러오지 못했어요');
  }

  const data = await res.json();
  if (!data.segments || data.segments.length === 0) return null; // genuinely no captions
  return {
    segments: data.segments,
    language: data.language || lang,
    source: data.source || 'youtube',
  };
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
