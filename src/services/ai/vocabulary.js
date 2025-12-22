import { getSetting, SETTINGS_KEYS } from '../settings';
import { LANG_CODES } from './config';

/**
 * Google Translate unofficial API (fast)
 */
async function googleTranslate(text, targetLang = 'ko') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Translation failed');
  const data = await response.json();
  return data[0]?.map(item => item[0]).join('') || text;
}

/**
 * Word lookup using Free Dictionary API + Google Translate
 */
export async function lookupWord(word) {
  const cleanWord = word.replace(/[.,;:!?"'()[\]{}]/g, '').trim();
  if (!cleanWord) {
    return { word, phonetic: '', definition: '단어를 인식할 수 없습니다' };
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
        definition: translated,
      };
    }
  } catch (err) {
    console.log('Dictionary lookup failed:', err);
  }

  try {
    const translated = await googleTranslate(cleanWord, langCode);
    return {
      word: cleanWord,
      phonetic: '',
      definition: translated,
    };
  } catch (err) {
    console.error('Word lookup failed:', err);
  }

  return {
    word: cleanWord,
    phonetic: '',
    definition: '정의를 찾을 수 없습니다',
  };
}
