import nlp from 'compromise';
import { GRAMMAR_COLORS, GOOGLE_API_KEY, GEMINI_API_URL } from './config';
import { parseGeminiJSON } from './gemini';

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
  const prompt = `Analyze the following English sentence and identify ONLY intermediate-to-advanced grammar patterns worth studying.

Sentence: "${text}"

IMPORTANT RULES:
1. ONLY return patterns that are genuinely useful for English learners at intermediate level or above
2. DO NOT include basic/trivial patterns like:
   - Compound nouns (e.g., "bus stop", "coffee shop")
   - Simple modal + verb (e.g., "can be", "will go", "should do")
   - Basic subject-verb agreement
   - Simple present/past tense
   - Basic article usage (a, an, the)
   - Simple prepositional phrases
3. If NO meaningful intermediate+ patterns exist, return {"patterns": []}
4. Quality over quantity - only include patterns that would actually help a learner

Return a JSON object with this structure:
{
  "patterns": [
    {
      "type": "pattern name in English",
      "typeKr": "한국어 패턴명",
      "keywords": [
        { "word": "not", "index": 5 },
        { "word": "but", "index": 9 }
      ],
      "parts": [
        { "label": "A", "text": "with a schedule", "startIndex": 6, "endIndex": 8 },
        { "label": "B", "text": "with a question", "startIndex": 10, "endIndex": 12 }
      ],
      "explanation": "Brief explanation in Korean (1-2 sentences)",
      "color": "#hex"
    }
  ]
}

STRUCTURE EXPLANATION:
- "keywords": The key grammatical markers (e.g., "not", "but", "if", "then", "so...that", "too...to")
  - These will be highlighted and connected with a dashed arc
- "parts": The meaningful segments of the pattern (e.g., A/B in "not A but B", condition/result in conditionals)
  - These will be underlined with labels when user clicks the pattern
- "index", "startIndex", "endIndex" are 0-based word positions in the sentence

Color suggestions:
- not A but B / either...or / neither...nor: #60a5fa (blue)
- so...that / such...that: #f87171 (red)
- too...to / enough to: #fb923c (orange)
- the more...the more: #facc15 (yellow)
- not only...but also: #c084fc (purple)
- conditionals (if...then): #4ade80 (green)
- as...as: #2dd4bf (teal)
- whether...or: #ec4899 (pink)
- both...and: #8b5cf6 (violet)

ONLY include these types of correlative/paired patterns:
- not A but B (A가 아니라 B)
- not only A but also B (A뿐만 아니라 B도)
- either A or B (A 또는 B)
- neither A nor B (A도 B도 아닌)
- both A and B (A와 B 둘 다)
- so + adj/adv + that (너무 ~해서 ~하다)
- such + noun + that (너무 ~해서 ~하다)
- too + adj + to V (너무 ~해서 V할 수 없다)
- adj + enough + to V (~하기에 충분히 ~하다)
- the + 비교급, the + 비교급 (~할수록 더 ~하다)
- as + adj + as (~만큼 ~한)
- whether A or B (A이든 B이든)
- if/when conditionals with clear condition-result structure
- Passive voice with clear agent (수동태: be + p.p + by)
- Relative clauses (관계대명사절)

Return ONLY valid JSON, no markdown code blocks or extra text.`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature: 0.3,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('AI 문법 분석에 실패했습니다');
    }

    const data = await response.json();
    const responseText = data.candidates[0].content.parts[0].text;

    const result = parseGeminiJSON(responseText);
    return result;
  } catch (err) {
    console.error('Grammar pattern analysis failed:', err);
    return {
      patterns: [],
      sentence_structure: null,
    };
  }
}
