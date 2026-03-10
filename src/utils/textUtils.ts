/**
 * Remove special characters from text for display.
 * Keeps: letters, numbers, spaces, Korean characters, hyphens, underscores.
 */
export function cleanDisplayText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/[^\w\s\uAC00-\uD7AF\u3130-\u318F-_]/g, '').trim();
}

/**
 * Check if text is a word or short phrase (vs. a sentence).
 */
export function isWordOrPhrase(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).length;
  return wordCount <= 2 && !/[.!?]$/.test(trimmed);
}

/**
 * Escape special regex characters in a string.
 */
export function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
