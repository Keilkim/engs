// API Configuration - keys are now server-side only

// Language name mapping for prompts
export const LANGUAGE_NAMES = {
  Korean: 'Korean (한국어)',
  Chinese: 'Chinese (中文)',
  German: 'German (Deutsch)',
  English: 'English',
};

// Google Translate language codes
export const LANG_CODES = {
  Korean: 'ko',
  Chinese: 'zh-CN',
  German: 'de',
  English: 'en',
};

// Grammar color scheme
export const GRAMMAR_COLORS = {
  Subject: '#60a5fa',      // 파란색 - 주어
  Verb: '#f87171',         // 빨간색 - 동사
  Object: '#4ade80',       // 초록색 - 목적어
  Adjective: '#c084fc',    // 보라색 - 형용사
  Adverb: '#fb923c',       // 주황색 - 부사
  Preposition: '#facc15',  // 노란색 - 전치사
  Conjunction: '#2dd4bf',  // 청록색 - 접속사
  Determiner: '#94a3b8',   // 회색 - 관사/한정사
};

// Statuses worth retrying: rate limit (429) and temporary unavailable (503)
const RETRYABLE_STATUSES = [429, 503];
const MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build a descriptive error from a failed Gemini proxy response.
 * Reads the upstream error.message and keeps the HTTP status so callers
 * (and the user) can tell a rate-limit apart from a hard failure.
 */
async function buildGeminiError(response, fallbackLabel) {
  let message = `${fallbackLabel} (${response.status})`;
  try {
    const body = await response.clone().json();
    const apiMessage = body?.error?.message || body?.error;
    if (apiMessage) {
      message = typeof apiMessage === 'string' ? apiMessage : JSON.stringify(apiMessage);
    }
  } catch {
    // Body was not JSON - keep the status-based message.
  }
  const err = new Error(message);
  err.status = response.status;
  return err;
}

/**
 * Call Gemini API via server-side proxy (non-streaming)
 */
export async function fetchGemini(body) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.ok) return response.json();

    lastError = await buildGeminiError(response, 'Gemini API request failed');
    if (RETRYABLE_STATUSES.includes(response.status) && attempt < MAX_RETRIES) {
      await sleep(400 * 2 ** attempt); // 400ms, 800ms
      continue;
    }
    throw lastError;
  }
  throw lastError;
}

/**
 * Call Gemini API via server-side proxy (streaming SSE)
 */
export async function fetchGeminiStream(body) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch('/api/gemini-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.ok) return response;

    lastError = await buildGeminiError(response, 'Gemini streaming request failed');
    if (RETRYABLE_STATUSES.includes(response.status) && attempt < MAX_RETRIES) {
      await sleep(400 * 2 ** attempt); // 400ms, 800ms
      continue;
    }
    throw lastError;
  }
  throw lastError;
}
