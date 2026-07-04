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
      author_url: data.author_url || null, // channel URL — backfill material for channel_id
      thumbnail_url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      thumbnail_url_hq: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch (error) {
    console.error('[YouTube] Metadata fetch error:', error);
    return {
      title: 'YouTube Video',
      author: 'Unknown',
      author_url: null,
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
  // Always return an object (segments may be []) so the caller can read the
  // video duration even when there are no captions.
  return {
    segments: data.segments || [],
    language: data.language || lang,
    source: data.source || 'youtube',
    durationSec: data.durationSec || 0,
    channelId: data.channelId || null,
  };
}

/**
 * Full Whisper transcription flow via server-side API route
 * Audio extraction + transcription happens entirely on the server
 */
export async function transcribeYouTubeWithWhisper(videoId, language = 'en', onProgress, durationSec = 0) {
  onProgress?.(durationSec > 1200 ? '긴 영상을 나눠 음성 인식 중... (시간이 좀 걸려요)' : '오디오 추출 + 음성 인식 중...');

  const response = await fetch('/api/whisper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // durationSec lets the server chunk long videos under Whisper's 25MB limit.
    body: JSON.stringify({ videoId, language, durationSec }),
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
 * Shared confirm copy for the paid Whisper transcription. Used by both the
 * AddSourceModal (no-captions path) and the viewer's "정밀 타이밍 업그레이드"
 * flow so the cost/consent wording never drifts between the two.
 */
export function buildWhisperConfirmText(durationSec) {
  const cost = durationSec > 0 ? calculateWhisperCost(durationSec) : calculateWhisperCost(60);
  const costLine = durationSec > 0
    ? `비용: 이 영상(약 ${Math.round(durationSec / 60)}분) 약 $${cost.usd.toFixed(2)} (약 ${cost.krw.toLocaleString()}원)\n`
    : `비용: 영상 1분당 약 $${cost.usd.toFixed(3)} (약 ${cost.krw}원)\n`;
  return (
    '음성 인식(Whisper)은 서버에서 유료 API를 사용합니다.\n\n' +
    costLine +
    '소요 시간: 영상 길이에 따라 수 분이 걸릴 수 있어요.\n\n계속하시겠어요?'
  );
}

/**
 * Map a Whisper transcription error to a user-facing Korean message. Shared so
 * the 25MB/extraction/generic branches stay identical across call sites.
 */
export function mapWhisperError(err) {
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('413') || msg.includes('content size') || msg.includes('maximum') || msg.includes('too large')) {
    return '영상이 너무 길어요 — 음성 파일이 25MB 한도를 넘었어요. 약 25분 이내의 짧은 영상을 쓰거나, 자막이 있는 영상을 이용해 주세요.';
  }
  if (msg.includes('extract') || msg.includes('audio') || msg.includes('추출')) {
    return '이 영상의 음성을 가져오지 못했어요. 유튜브 제한이거나 오디오 추출 서버 문제일 수 있어요. 자막이 있는 다른 영상을 이용하거나 잠시 후 다시 시도해 주세요.';
  }
  return `음성 인식에 실패했어요: ${err?.message || err}`;
}

/**
 * Check if Whisper is available (server-side key, always true if API route exists)
 */
export function isWhisperAvailable() {
  return true;
}
