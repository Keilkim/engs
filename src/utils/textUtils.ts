/**
 * Remove special characters from text for display.
 * Keeps: any Unicode letter (incl. accented like caf\u00E9) or number, spaces,
 * apostrophes (straight ' and curly \u2019) so contractions like "don't" survive,
 * hyphens, and underscores.
 */
export function cleanDisplayText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/[^\p{L}\p{N}\s'\u2019\-_]/gu, '').trim();
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
