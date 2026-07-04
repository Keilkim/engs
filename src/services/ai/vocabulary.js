import { getSetting, SETTINGS_KEYS } from '../settings';
import { LANG_CODES } from './config';
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
 * Word lookup using Free Dictionary API + Google Translate.
 *
 * Contract: the returned `definition` is ALWAYS a string. On failure the
 * result carries a non-empty `error` code and an empty `definition` so callers
 * can surface the error instead of persisting an empty/garbage card.
 */
export async function lookupWord(word) {
  const cleanWord = word.replace(/[.,;:!?"'()[\]{}]/g, '').trim();
  if (!cleanWord) {
    return { word, phonetic: '', definition: '', error: 'UNRECOGNIZED_WORD' };
  }

  const translationLang = getSetting(SETTINGS_KEYS.TRANSLATION_LANGUAGE, 'Korean');
  const langCode = LANG_CODES[translationLang] || 'ko';

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
