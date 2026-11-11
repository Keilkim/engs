// Grammar-pattern prompt and the clean-up of its answer. Kept free of app
// imports so the release evaluation (scripts/eval-grammar-segments.mjs) runs
// the exact prompt and checks the app uses.

export const LEVEL_INSTRUCTIONS = {
  beginner: 'Target A1-A2 level. Extract only basic, high-frequency expressions that beginners should know first. Skip advanced idioms and complex collocations.',
  intermediate: 'Target B1-B2 level. Extract useful everyday expressions including common idioms, phrasal verbs, and collocations.',
  advanced: 'Target C1-C2 level. Extract advanced, sophisticated expressions including nuanced idioms, literary collocations, and complex patterns.',
};

export function buildGrammarPrompt(text, level = 'intermediate') {
  const levelInstruction = LEVEL_INSTRUCTIONS[level] || '';
  return `You are an English tutor making a study card for a Korean learner. Analyze this sentence.

Sentence: "${text}"

LEVEL: ${levelInstruction}

Produce two things:
1. "translation": a natural Korean translation of the WHOLE sentence.
2. "patterns": the most useful things to learn from this sentence. This includes BOTH:
   - Expressions worth memorizing: idioms, phrasal verbs, collocations (use A, B, C for variable parts).
   - Notable grammar structures: relative clauses, participial phrases, conditionals, passive voice, key verb tenses/modals, comparatives, "to-infinitive"/gerund usage, etc.
   For each, put a short form in "words", a concise Korean explanation, and "segments".
   "segments": the pattern's words AS THEY APPEAR IN THE SENTENCE ABOVE, in sentence order, each
   piece copied verbatim (same spelling, conjugation and capitalization) and labeled with a role:
     - "fixed": words that belong to the expression or grammar cue itself and stay the same
       whenever the pattern is used (e.g. "take", "into account", "to", "who", "am used to").
     - "slot": words filling a replaceable part — whatever "words" writes as A/B/C, ~, V, Ving,
       p.p., sb/sth, one's or any other placeholder (e.g. "this risk", the verb after "to").
       Every slot also has "label": that placeholder copied exactly as "words" writes it
       ("A", "B", "~", "v", "V-ing", "p.p.", "sb", "one's", "동사", …).
   Every placeholder written in "words" that the sentence fills gets its own slot piece, and a
   piece is a slot ONLY when "words" writes a placeholder for it (add the placeholder to "words"
   if needed). The expression's own words stay "fixed" even when the sentence inflects them
   ("was" for "be", "played" for "play", "picked" for "pick").
   Start a new piece wherever the role changes or the pattern skips unrelated words. Examples:
     "We take this risk into account" + "take A into account" → [{"text":"take","role":"fixed"},
       {"text":"this risk","role":"slot","label":"A"},{"text":"into account","role":"fixed"}]
     "She decided to leave early" + "to-v" → [{"text":"to","role":"fixed"},{"text":"leave","role":"slot","label":"v"}]
     "It was not cheap but fast" + "not A but B" → [{"text":"not","role":"fixed"},{"text":"cheap","role":"slot","label":"A"},
       {"text":"but","role":"fixed"},{"text":"fast","role":"slot","label":"B"}]
   Every "text" MUST appear character-for-character in the sentence. Exclude unrelated words and
   clauses. NEVER use the whole sentence as a fallback.

RULES:
- ALWAYS fill "translation".
- Give 1-4 patterns, prioritizing what a learner at the level above would find genuinely useful or tricky.
- For a grammar structure, "words" can hold the pattern form (e.g. ["who + 동사"], ["as long as"], ["have been Ving"], ["not A but B"]).
- Only include a pattern if you can fill "segments" with real substrings copied verbatim from the sentence.
- Only return an empty "patterns" list if the text is NOT a real sentence (e.g. a lone interjection). A normal sentence must yield at least one pattern.

Return ONLY valid JSON, no markdown:
{
  "translation": "문장 전체의 자연스러운 한국어 번역",
  "patterns": [
    { "words": ["regardless of A"], "segments": [{ "text": "regardless of", "role": "fixed" }, { "text": "the result", "role": "slot", "label": "A" }], "explanation": "A에 상관없이 (전치사구)" },
    { "words": ["who + 동사"], "segments": [{ "text": "who", "role": "fixed" }, { "text": "runs", "role": "slot", "label": "동사" }], "explanation": "관계대명사 who: 앞의 사람 명사를 꾸며주는 절을 이끔" }
  ]
}`;
}

const cleanLabel = label => (typeof label === 'string' && label.trim() && label.trim().length <= 24 ? label.trim() : null);

function cleanSegment(segment) {
  const role = segment.role === 'slot' ? 'slot' : 'fixed';
  const label = role === 'slot' ? cleanLabel(segment.label) : null;
  return { text: segment.text.trim(), role, ...(label ? { label } : {}) };
}

// "segments" carry each piece's role; flashcards and review still read the
// flat "spans" (fixed words) / "variableSpans" (slot words), so derive them.
export function withSegmentSpans(pattern) {
  const segments = (Array.isArray(pattern?.segments) ? pattern.segments : [])
    .filter(segment => typeof segment?.text === 'string' && segment.text.trim())
    .map(cleanSegment);
  if (!segments.length) return pattern;
  const texts = role => segments.filter(segment => segment.role === role).map(segment => segment.text);
  // A pattern made only of slots still needs words to bold on its card.
  const fixed = texts('fixed');
  return { ...pattern, segments, spans: fixed.length ? fixed : texts('slot'), variableSpans: texts('slot') };
}

// Lower case with straight apostrophes: OCR text often has ’ where the model
// writes ' (same length, so indexes still point into the sentence).
const fold = text => text.toLowerCase().replace(/[’‘]/g, "'");

// Keep only spans that literally occur in the sentence, canonicalized to the
// sentence's real casing so the flashcard front can bold an exact, verbatim
// substring. Drops anything the model hallucinated or normalized away.
export function validateSpans(spans, sentence) {
  if (!sentence) return [];
  const low = fold(sentence);
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(spans) ? spans : []) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (!t) continue;
    const idx = low.indexOf(fold(t));
    if (idx === -1) continue; // not actually in the sentence → drop
    const surface = sentence.slice(idx, idx + t.length); // preserve original casing
    const key = surface.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(surface);
  }
  return out;
}

// Same rule for role-labeled segments, but order and repeats are kept: they
// place the pattern in the sentence ("the more …, the more …").
export function validateSegments(segments, sentence) {
  if (!sentence) return [];
  const low = fold(sentence);
  return (Array.isArray(segments) ? segments : []).flatMap(segment => {
    const t = typeof segment?.text === 'string' ? segment.text.trim() : '';
    const idx = t ? low.indexOf(fold(t)) : -1;
    if (idx === -1) return [];
    return [cleanSegment({ ...segment, text: sentence.slice(idx, idx + t.length) })];
  });
}

export function validatePattern(pattern, sentence) {
  const segments = validateSegments(pattern?.segments, sentence);
  if (segments.length) {
    const fixed = segments.filter(s => s.role === 'fixed').map(s => s.text);
    const slots = segments.filter(s => s.role === 'slot').map(s => s.text);
    // Cards bold "spans"; a pattern made only of slots still needs some.
    return { ...pattern, segments, spans: validateSpans(fixed.length ? fixed : slots, sentence),
      variableSpans: validateSpans(slots, sentence) };
  }
  const { segments: _dropped, ...rest } = pattern || {};
  return { ...rest, spans: validateSpans(pattern?.spans, sentence),
    variableSpans: validateSpans(pattern?.variableSpans, sentence) };
}
