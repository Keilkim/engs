/**
 * Text utility functions for display and processing.
 */

/**
 * Remove special characters from text for display.
 * Keeps: letters, numbers, spaces, Korean characters, hyphens, underscores.
 * @param {string} text - Input text
 * @returns {string} Cleaned text
 */
export function cleanDisplayText(text) {
  if (!text) return '';
  // Remove special chars except hyphen and underscore
  // \w = [a-zA-Z0-9_]
  // \uAC00-\uD7AF = Korean syllables
  // \u3130-\u318F = Korean compatibility jamo
  return text.replace(/[^\w\s\uAC00-\uD7AF\u3130-\u318F-_]/g, '').trim();
}

/**
 * Check if text is a word or short phrase (vs. a sentence).
 * @param {string} text - Input text
 * @returns {boolean} True if word/phrase, false if sentence
 */
export function isWordOrPhrase(text) {
  if (!text) return false;
  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).length;
  // 2 words or less + doesn't end with sentence punctuation
  return wordCount <= 2 && !/[.!?]$/.test(trimmed);
}

/**
 * Escape special regex characters in a string.
 * @param {string} string - Input string
 * @returns {string} Escaped string safe for use in RegExp
 */
export function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default { cleanDisplayText, isWordOrPhrase, escapeRegex };
