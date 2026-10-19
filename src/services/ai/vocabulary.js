import { getSetting, SETTINGS_KEYS } from '../settings';
import { LANG_CODES, LANGUAGE_NAMES, fetchGemini } from './config';
import { parseGeminiJSON } from './gemini';
import { buildWordLookupPrompt, formatWordDefinition } from './wordDefinition';
import { buildLineTranslationPrompt, readLineTranslations } from './lineTranslation';
import { logError } from '../../utils/errors';

/**
 * Google Translate unofficial API (fast)
 */
export async function googleTranslate(text, targetLang = 'ko', { signal } = {}) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error('Translation failed');
  const data = await response.json();
  const joined = data[0]?.map(item => item[0]).join('') || text;
  // Contract: always return a plain string.
  return typeof joined === 'string' ? joined : String(joined ?? '');
}

/**
 * Translate several subtitle lines at once (same order, same count).
 * Gemini first — one call for the whole batch — then the unofficial endpoint
 * line by line if that fails (e.g. the daily AI quota is used up).
 */
export async function translateLines(lines, targetLang = 'ko', { signal } = {}) {
  const langKey = Object.keys(LANG_CODES).find((name) => LANG_CODES[name] === targetLang);
  const langName = LANGUAGE_NAMES[langKey] || targetLang;
  try {
    const data = await fetchGemini({
      contents: [{ parts: [{ text: buildLineTranslationPrompt(lines, langName) }] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: 'minimal' },
        responseMimeType: 'application/json',
      },
    }, { signal });
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const translated = readLineTranslations(parseGeminiJSON(responseText), lines.length);
    if (translated) return translated;
  } catch (err) {
    if (signal?.aborted) throw err;
    logError('translateLines.gemini', err);
  }
  return Promise.all(lines.map((line) => googleTranslate(line, targetLang, { signal })));
}

/**
 * Gemini lookup that reads the surrounding sentence, so "run" in "run a
 * company" gets that sense and an idiom around the word is caught.
 * Returns null when the reply is unusable.
 */
async function lookupWordWithGemini(word, sentence, translationLang) {
  const langName = LANGUAGE_NAMES[translationLang] || LANGUAGE_NAMES.Korean;
  const data = await fetchGemini({
    contents: [{ parts: [{ text: buildWordLookupPrompt(word, sentence, langName) }] }],
    generationConfig: {
      // A tap should answer fast; this is a lookup, not a reasoning task.
      thinkingConfig: { thinkingLevel: 'minimal' },
      responseMimeType: 'application/json',
    },
  });
  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return formatWordDefinition(parseGeminiJSON(responseText), translationLang);
}

/**
 * Word lookup: Gemini (in context) first, then Free Dictionary API + Google
 * Translate if the AI call fails.
 *
 * Contract: the returned `definition` is ALWAYS a string. On failure the
 * result carries a non-empty `error` code and an empty `definition` so callers
 * can surface the error instead of persisting an empty/garbage card.
 */
export async function lookupWord(word, { sentence } = {}) {
  const cleanWord = word.replace(/[.,;:!?"'()[\]{}]/g, '').trim();
  if (!cleanWord) {
    return { word, phonetic: '', definition: '', error: 'UNRECOGNIZED_WORD' };
  }

  const translationLang = getSetting(SETTINGS_KEYS.TRANSLATION_LANGUAGE, 'Korean');
  const langCode = LANG_CODES[translationLang] || 'ko';

  try {
    const result = await lookupWordWithGemini(cleanWord, sentence, translationLang);
    if (result) return { word: cleanWord, ...result };
  } catch (err) {
    logError('lookupWord.gemini', err);
  }

  try {
    const dictResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);

    if (dictResponse.ok) {
      const dictData = await dictResponse.json();
      const entry = dictData[0];
      const phonetic = entry.phonetic || entry.phonetics?.[0]?.text || '';

      const definitions = [];
      for (const meaning of entry.meanings || []) {
        for (const def of meaning.definitions || []) {
          if (definitions.length < 3) {
            definitions.push(`[${meaning.partOfSpeech}] ${def.definition}`);
          }
        }
      }

      const translated = await googleTranslate(definitions.join('\n'), langCode);

      return {
        word: cleanWord,
        phonetic,
        definition: typeof translated === 'string' ? translated : '',
      };
    }
  } catch (err) {
    logError('lookupWord.dictionary', err);
  }

  try {
    const translated = await googleTranslate(cleanWord, langCode);
    return {
      word: cleanWord,
      phonetic: '',
      definition: typeof translated === 'string' ? translated : '',
    };
  } catch (err) {
    logError('lookupWord.translate', err);
  }

  // gtx endpoint blocked / network filtered: return an explicit error so the
  // caller can notify the user instead of silently saving an empty definition.
  return {
    word: cleanWord,
    phonetic: '',
    definition: '', error: 'DEFINITION_NOT_FOUND',
  };
}
