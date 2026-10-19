// Gemini word lookup: the prompt, and turning its JSON reply into the
// plain-string `definition` that annotations and review cards store.

const OTHER_MEANINGS_LABEL = {
  Korean: '다른 뜻',
  Chinese: '其他意思',
  German: 'Weitere Bedeutungen',
  English: 'Also',
};

// Long OCR "sentences" can be whole paragraphs; the nearby words are enough.
const MAX_SENTENCE_CHARS = 500;

export function buildWordLookupPrompt(word, sentence, langName) {
  const context = typeof sentence === 'string' ? sentence.trim().slice(0, MAX_SENTENCE_CHARS) : '';
  const meaningRule = context
    ? 'the meaning of the word AS USED IN THE SENTENCE (not a generic list of senses)'
    : 'its most common meaning';
  const expressionRule = context
    ? `if, in the sentence, the word is part of an idiom, phrasal verb or fixed collocation, give its dictionary form in "phrase" (use A/B for variable parts, e.g. "take A into account") and its meaning in ${langName}. Otherwise null.`
    : 'null.';

  return `You are an English dictionary for a learner whose native language is ${langName}.

Word: "${word}"${context ? `\nSentence: "${context}"` : ''}

RULES:
- "meaning": ${meaningRule}. A few words, natural ${langName}.
- "partOfSpeech": the word's part of speech${context ? ' in the sentence' : ''}, written in ${langName}.
- "phonetic": IPA between slashes, e.g. "/əˈkaʊnt/".
- "expression": ${expressionRule}
- "otherMeanings": up to 2 other common meanings in ${langName}, different from "meaning". Empty array if none.

Return ONLY valid JSON, no markdown:
{
  "phonetic": "/.../",
  "partOfSpeech": "...",
  "meaning": "...",
  "expression": { "phrase": "...", "meaning": "..." },
  "otherMeanings": ["..."]
}`;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Format a parsed Gemini reply, e.g.
 *   [동사] 고려하다
 *   ▸ take A into account: A를 고려하다
 *   다른 뜻: 계좌, 설명
 * Returns null when the reply has no usable meaning (caller falls back).
 */
export function formatWordDefinition(data, translationLang = 'Korean') {
  const meaning = text(data?.meaning);
  if (!meaning) return null;

  const partOfSpeech = text(data.partOfSpeech);
  const lines = [partOfSpeech ? `[${partOfSpeech}] ${meaning}` : meaning];

  const phrase = text(data.expression?.phrase);
  const phraseMeaning = text(data.expression?.meaning);
  if (phrase && phraseMeaning) lines.push(`▸ ${phrase}: ${phraseMeaning}`);

  const others = (Array.isArray(data.otherMeanings) ? data.otherMeanings : [])
    .map(text)
    .filter((m) => m && m !== meaning)
    .slice(0, 2);
  if (others.length > 0) {
    const label = OTHER_MEANINGS_LABEL[translationLang] || OTHER_MEANINGS_LABEL.English;
    lines.push(`${label}: ${others.join(', ')}`);
  }

  return { phonetic: text(data.phonetic), definition: lines.join('\n') };
}
