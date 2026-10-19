// Batched subtitle translation with Gemini: one call translates many caption
// lines (cheaper on the daily quota than a call per line, and neighbouring
// lines give the model context).

export function buildLineTranslationPrompt(lines, langName) {
  return `Translate these English video subtitle lines into ${langName}.
A line may be a fragment of a sentence that continues on the next line: use the neighbouring lines as context, but translate each line on its own so every translation stays aligned with its line. Keep them natural and concise, like subtitles.

Lines (JSON array):
${JSON.stringify(lines)}

Return ONLY valid JSON, no markdown: {"translations": ["...", ...]} with exactly ${lines.length} strings, in the same order.`;
}

/**
 * Validate a parsed reply against the request. Returns the trimmed
 * translations, or null if the count or types don't line up (a misaligned
 * batch would put translations under the wrong lines).
 */
export function readLineTranslations(parsed, expectedCount) {
  const list = Array.isArray(parsed) ? parsed : parsed?.translations;
  if (!Array.isArray(list) || list.length !== expectedCount) return null;
  if (!list.every((item) => typeof item === 'string')) return null;
  const trimmed = list.map((item) => item.trim());
  return trimmed.some(Boolean) ? trimmed : null;
}
