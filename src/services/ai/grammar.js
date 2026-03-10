import nlp from 'compromise';
import { GRAMMAR_COLORS, fetchGemini } from './config';
import { parseGeminiJSON } from './gemini';
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
    for (let i = verbIndex + 1; i < words.length; i++) {
      if (words[i].role === 'Noun' || words[i].role === 'Pronoun') {
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

  return {
    text,
    words,
    connections,
    sentence: sentences[0] || null,
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

  const prompt = `Extract useful English expressions/idioms from this sentence for Korean learners.

Sentence: "${text}"

LEVEL: ${levelInstruction}

RULES:
1. Extract ONLY expressions worth memorizing (idioms, phrasal verbs, collocations, useful patterns)
2. Use A, B, C as placeholders for variable parts
3. Return simple format for flashcard-style learning
4. Skip basic grammar - focus on expressions/phrases that native speakers actually use
5. If no useful expressions, return {"patterns": []}
6. Match the difficulty of extracted expressions to the learner's level described above

Return JSON:
{
  "patterns": [
    { "words": ["regardless of A"], "explanation": "A에 상관없이" },
    { "words": ["be likely to V"], "explanation": "V할 것 같다" }
  ]
}

GOOD examples:
- regardless of A → A에 상관없이
- be likely to V → V할 것 같다
- end up Ving → 결국 V하게 되다
- be supposed to V → V하기로 되어있다
- not A but B → A가 아니라 B
- as long as → ~하는 한
- in terms of A → A의 관점에서
- at the expense of A → A를 희생하여

BAD (don't include):
- Descriptive grammar like "분사구문", "가정법", "관계대명사"
- Simple verb tenses
- Basic prepositions

Return ONLY valid JSON, no markdown.`;

  try {
    const data = await fetchGemini({
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        temperature: 0.3,
      },
    });

    const responseText = data.candidates[0].content.parts[0].text;

    const result = parseGeminiJSON(responseText);
    return result;
  } catch (err) {
    logError('analyzeGrammarPatterns', err);
    return {
      patterns: [],
      sentence_structure: null,
    };
  }
}
