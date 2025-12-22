// API Configuration
export const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
export const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
export const GEMINI_STREAM_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent';

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
