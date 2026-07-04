import nlp from 'compromise';
import { GRAMMAR_COLORS, LANG_CODES, fetchGemini } from './config';
import { parseGeminiJSON } from './gemini';
import { googleTranslate } from './vocabulary';
import { getSetting, SETTINGS_KEYS } from '../settings';
import { logError } from '../../utils/errors';

/**
 * Check if tags contains any of the target tags
 * Handles both array and object format from compromise.js
 */
function hasTag(tags, ...targetTags) {
  if (!tags) return false;

  if (Array.isArray(tags)) {
    return targetTags.some(target => tags.includes(target));
  }

  if (typeof tags === 'object') {
    return targetTags.some(target => tags[target] === true || tags.hasOwnProperty(target));
  }

  return false;
}

/**
 * Analyze grammar using compromise.js (client-side NLP)
 */
export function analyzeGrammar(text) {
  const doc = nlp(text);
  const terms = doc.terms().json();
  const sentences = doc.sentences().json();

  // Passive voice and relative clauses break the naive
  // "first noun after the verb = object" heuristic (e.g. it colours the noun
  // inside a prepositional phrase as the direct object). Detect them so the
  // S/V/O overlay stays conservative instead of teaching a wrong structure.
  let isComplex = false;
  try {
    isComplex = doc.has('#Passive')
      || doc.has('(am|is|are|was|were|be|been|being) #Adverb? #PastTense')
      || doc.has('(who|whom|whose|which|that) #Verb');
  } catch {
    isComplex = false;
  }

  const words = terms.map((term, index) => {
    const innerTerm = term.terms?.[0] || term;
    const tags = innerTerm.tags || term.tags || [];
    let role = null;
    let color = null;
    let label = null;

    if (hasTag(tags, 'Verb', 'PresentTense', 'PastTense', 'FutureTense', 'Infinitive', 'Gerund', 'Modal', 'Auxiliary', 'Copula')) {
      role = 'Verb';
      color = GRAMMAR_COLORS.Verb;
      if (hasTag(tags, 'PastTense')) label = 'V (past)';
      else if (hasTag(tags, 'PresentTense')) label = 'V (present)';
      else if (hasTag(tags, 'Gerund')) label = 'V-ing';
      else if (hasTag(tags, 'Infinitive')) label = 'to V';
      else if (hasTag(tags, 'Modal')) label = 'Modal';
      else label = 'V';
    }
    else if (hasTag(tags, 'Noun', 'ProperNoun', 'Singular', 'Plural', 'Uncountable', 'Possessive')) {
      role = 'Noun';
      color = GRAMMAR_COLORS.Subject;
      label = 'N';
    }
    else if (hasTag(tags, 'Pronoun', 'PersonalPronoun', 'ReflexivePronoun', 'Possessive')) {
      role = 'Pronoun';
      color = GRAMMAR_COLORS.Subject;
      label = 'Pron';
    }
    else if (hasTag(tags, 'Adjective', 'Comparable', 'Superlative')) {
      role = 'Adjective';
      color = GRAMMAR_COLORS.Adjective;
      label = 'Adj';
    }
    else if (hasTag(tags, 'Adverb')) {
      role = 'Adverb';
      color = GRAMMAR_COLORS.Adverb;
      label = 'Adv';
    }
    else if (hasTag(tags, 'Preposition')) {
      role = 'Preposition';
      color = GRAMMAR_COLORS.Preposition;
      label = 'Prep';
    }
    else if (hasTag(tags, 'Conjunction')) {
      role = 'Conjunction';
      color = GRAMMAR_COLORS.Conjunction;
      label = 'Conj';
    }
    else if (hasTag(tags, 'Determiner', 'Article')) {
      role = 'Determiner';
      color = GRAMMAR_COLORS.Determiner;
      label = 'Det';
    }

    return {
      text: term.text,
      index,
      role,
      color,
      label,
      tags,
    };
  });

  const connections = [];
  let subjectIndex = -1;
  let verbIndex = -1;
  let objectIndex = -1;

  for (let i = 0; i < words.length; i++) {
    if (words[i].role === 'Verb') {
      verbIndex = i;
      break;
    }
  }

  // Only overlay S/V/O roles for simple active declarative sentences.
  if (!isComplex) {
    if (verbIndex > 0) {
      for (let i = verbIndex - 1; i >= 0; i--) {
        if (words[i].role === 'Noun' || words[i].role === 'Pronoun') {
          subjectIndex = i;
          words[i].label = 'S';
          words[i].color = GRAMMAR_COLORS.Subject;
          break;
        }
      }
    }

    if (verbIndex === -1) {
      for (let i = 0; i < words.length; i++) {
        if (words[i].role === 'Noun' || words[i].role === 'Pronoun') {
          subjectIndex = i;
          words[i].label = 'S';
          words[i].color = GRAMMAR_COLORS.Subject;
          break;
        }
      }
    }

    if (verbIndex !== -1) {
      let sawPreposition = false;
      for (let i = verbIndex + 1; i < words.length; i++) {
        if (words[i].role === 'Preposition') sawPreposition = true;
        if (words[i].role === 'Noun' || words[i].role === 'Pronoun') {
          // A noun that follows a preposition is a prepositional object, not the
          // verb's direct object — don't mislabel it as 'O'.
          if (sawPreposition) break;
          objectIndex = i;
          words[i].label = 'O';
          words[i].color = GRAMMAR_COLORS.Object;
          break;
        }
      }
    }

    if (subjectIndex !== -1 && verbIndex !== -1) {
      connections.push({
        from: subjectIndex,
        to: verbIndex,
        label: 'S → V',
        color: '#60a5fa',
      });
    }

    if (verbIndex !== -1 && objectIndex !== -1) {
      connections.push({
        from: verbIndex,
        to: objectIndex,
        label: 'V → O',
        color: '#4ade80',
      });
    }
  }

  return {
    text,
    words,
    connections,
    sentence: sentences[0] || null,
    // This is a client-side heuristic; S/V/O guesses can be wrong. Callers
    // should surface uncertainty (and skip role lines when `complex` is true).
    approximate: true,
    complex: isComplex,
  };
}

/**
 * AI-based grammar pattern analysis (Gemini API)
 */
export async function analyzeGrammarPatterns(text) {
  const level = getSetting(SETTINGS_KEYS.ENGLISH_LEVEL, 'intermediate');

  const levelInstruction = {
    beginner: 'Target A1-A2 level. Extract only basic, high-frequency expressions that beginners should know first. Skip advanced idioms and complex collocations.',
    intermediate: 'Target B1-B2 level. Extract useful everyday expressions including common idioms, phrasal verbs, and collocations.',
    advanced: 'Target C1-C2 level. Extract advanced, sophisticated expressions including nuanced idioms, literary collocations, and complex patterns.',
  }[level] || '';

  const prompt = `You are an English tutor making a study card for a Korean learner. Analyze this sentence.

Sentence: "${text}"

LEVEL: ${levelInstruction}

Produce two things:
1. "translation": a natural Korean translation of the WHOLE sentence.
2. "patterns": the most useful things to learn from this sentence. This includes BOTH:
   - Expressions worth memorizing: idioms, phrasal verbs, collocations (use A, B, C for variable parts).
   - Notable grammar structures: relative clauses, participial phrases, conditionals, passive voice, key verb tenses/modals, comparatives, "to-infinitive"/gerund usage, etc.
   For each, put a short form in "words", a concise Korean explanation, and "spans".
   "spans": copy the EXACT word(s) FROM THE SENTENCE ABOVE that this pattern actually occupies,
   verbatim — preserving the sentence's original spelling, conjugation, and capitalization.
   Do NOT use placeholders (A/B/C, ~, V/Ving/Ved) in "spans"; those belong only in "words".
   If the pattern is split across the sentence (e.g. "not A but B"), return each contiguous
   piece as its own array element (e.g. ["not", "but"]). Every string in "spans" MUST appear
   character-for-character somewhere in the sentence.

RULES:
- ALWAYS fill "translation".
- Give 1-4 patterns, prioritizing what a learner at the level above would find genuinely useful or tricky.
- For a grammar structure, "words" can hold the pattern form (e.g. ["who + 동사"], ["as long as"], ["have been Ving"], ["not A but B"]).
- Only include a pattern if you can fill "spans" with real substrings copied verbatim from the sentence.
- Only return an empty "patterns" list if the text is NOT a real sentence (e.g. a lone interjection). A normal sentence must yield at least one pattern.

Return ONLY valid JSON, no markdown:
{
  "translation": "문장 전체의 자연스러운 한국어 번역",
  "patterns": [
    { "words": ["regardless of A"], "spans": ["regardless of"], "explanation": "A에 상관없이 (전치사구)" },
    { "words": ["who + 동사"], "spans": ["who runs"], "explanation": "관계대명사 who: 앞의 사람 명사를 꾸며주는 절을 이끔" }
  ]
}`;

  // Gemini gives translation + idioms + grammar structures. If that call fails
  // or comes back empty/unparseable, we DON'T hard-fail — long-press would then
  // show a bare "분석 실패" with nothing to learn. Instead we degrade to a
  // translation-only card (still a useful review card) flagged `degraded:true`
  // so the UI shows a Retry affordance. Only if the reliable translate path
  // ALSO fails do we surface a genuine "analysis failed" error (caller catches).
  try {
    const data = await fetchGemini({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    });

    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsed = null;
    try {
      parsed = parseGeminiJSON(responseText);
    } catch {
      // Last resort: extract the first {...last } block.
      const start = responseText.indexOf('{');
      const end = responseText.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try { parsed = JSON.parse(responseText.slice(start, end + 1)); } catch { parsed = null; }
      }
    }

    if (parsed && (parsed.translation || parsed.patterns?.length > 0)) {
      return { translation: parsed.translation || '', patterns: parsed.patterns || [] };
    }
    // Response arrived but was empty/unusable → fall through to translate-only.
  } catch (err) {
    // Gemini unreachable (key/quota/region/network). Degrade, don't fail.
    logError('analyzeGrammarPatterns.gemini', err);
  }

  // Fallback: at least translate the sentence so the card is still useful.
  // Uses the same gtx path word lookup relies on. If this throws too, the
  // caller (useGrammarAnalysis) shows a real "analysis failed" retry state.
  const translationLang = getSetting(SETTINGS_KEYS.TRANSLATION_LANGUAGE, 'Korean');
  const langCode = LANG_CODES[translationLang] || 'ko';
  const translation = await googleTranslate(text, langCode);
  return { translation, patterns: [], degraded: true, reason: '' };
}
