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

/**
 * Call Gemini API via server-side proxy (non-streaming)
 */
export async function fetchGemini(body) {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error('Gemini API request failed');
  }

  return response.json();
}

/**
 * Call Gemini API via server-side proxy (streaming SSE)
 */
export async function fetchGeminiStream(body) {
  const response = await fetch('/api/gemini-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error('Gemini streaming request failed');
  }

  return response;
}
