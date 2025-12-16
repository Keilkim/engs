import Tesseract from 'tesseract.js';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
// Use Gemini 2.0 Flash (available in current API)
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Free Dictionary API for word lookup
const DICTIONARY_API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';

// Free Dictionary API lookup
async function lookupDictionary(word) {
  // Clean the word - get first word if multiple
  const cleanWord = word.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');

  if (!cleanWord || cleanWord.length < 2) {
    return null;
  }

  try {
    const response = await fetch(`${DICTIONARY_API_URL}/${encodeURIComponent(cleanWord)}`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const entry = data[0];

    if (!entry) return null;

    // Format the dictionary result
    let result = '';

    // Word and phonetic
    result += `${entry.word}`;
    if (entry.phonetic) {
      result += ` ${entry.phonetic}`;
    } else if (entry.phonetics?.length > 0) {
      const phonetic = entry.phonetics.find(p => p.text);
      if (phonetic?.text) result += ` ${phonetic.text}`;
    }
    result += '\n\n';

    // Meanings
    entry.meanings?.forEach((meaning, idx) => {
      result += `[${meaning.partOfSpeech}]\n`;

      meaning.definitions?.slice(0, 3).forEach((def, defIdx) => {
        result += `${defIdx + 1}. ${def.definition}\n`;
        if (def.example) {
          result += `   ex) "${def.example}"\n`;
        }
      });

      if (meaning.synonyms?.length > 0) {
        result += `   synonyms: ${meaning.synonyms.slice(0, 5).join(', ')}\n`;
      }
      if (meaning.antonyms?.length > 0) {
        result += `   antonyms: ${meaning.antonyms.slice(0, 3).join(', ')}\n`;
      }
      result += '\n';
    });

    return result.trim();
  } catch (err) {
    console.warn('Dictionary lookup failed:', err);
    return null;
  }
}

// NLP 분석 (단어/문법)
export async function analyzeText(text, type = 'word') {
  // For word analysis, try dictionary first
  if (type === 'word') {
    const dictResult = await lookupDictionary(text);
    if (dictResult) {
      return dictResult;
    }
    // Fall back to AI if dictionary doesn't have the word
  }

  const prompts = {
    word: `Analyze this English word/phrase:
"${text}"

Format your response as:
1. Pronunciation (IPA)
2. Part of speech
3. Definition (in Korean)
4. 2 example sentences (English + Korean translation)
5. Synonyms/Antonyms`,

    grammar: `Analyze the grammar of this English sentence:
"${text}"

Format your response as:
1. Sentence structure analysis
2. Key grammar points
3. Tense/Voice
4. Key expressions explained
5. 1 similar example sentence`,
  };

  const response = await fetch(`${API_URL}?key=${GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompts[type],
        }],
      }],
    }),
  });

  if (!response.ok) {
    throw new Error('AI 분석에 실패했습니다');
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// TTS (Text-to-Speech) - Web Speech API 사용
export function speakText(text, lang = 'en-US') {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('TTS를 지원하지 않는 브라우저입니다'));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.9;
    utterance.pitch = 1;

    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(e);

    window.speechSynthesis.speak(utterance);
  });
}

// TTS 중지
export function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

// 웹페이지 스크린샷에서 본문 영역 감지 (Gemini Vision)
export async function detectMainContent(base64Image) {
  // base64 데이터에서 prefix 제거
  const imageData = base64Image.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(`${VISION_API_URL}?key=${GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            text: `이 웹페이지 스크린샷에서 메인 콘텐츠 영역(본문)의 위치를 분석해주세요.
헤더, 네비게이션, 사이드바, 푸터, 광고를 제외한 실제 본문 콘텐츠 영역만 찾아주세요.

다음 JSON 형식으로만 답변해주세요 (다른 텍스트 없이):
{"x": 시작X좌표(0-100%), "y": 시작Y좌표(0-100%), "width": 너비(0-100%), "height": 높이(0-100%)}

예시: {"x": 20, "y": 15, "width": 60, "height": 70}`
          },
          {
            inline_data: {
              mime_type: 'image/png',
              data: imageData,
            },
          },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Vision API error:', error);
    throw new Error('본문 영역 감지에 실패했습니다');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // JSON 파싱 시도
  try {
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Failed to parse AI response:', text);
  }

  // 기본값 반환 (전체 이미지)
  return { x: 0, y: 0, width: 100, height: 100 };
}

// 이미지 크롭 (Canvas 사용)
export async function cropImage(base64Image, region) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 퍼센트를 픽셀로 변환
      const x = (region.x / 100) * img.width;
      const y = (region.y / 100) * img.height;
      const width = (region.width / 100) * img.width;
      const height = (region.height / 100) * img.height;

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = base64Image;
  });
}

// 이미지에서 텍스트 추출 (OCR) - Tesseract.js 사용
export async function extractTextFromImage(base64Image) {
  try {
    const result = await Tesseract.recognize(
      base64Image,
      'eng', // English
      {
        // logger: m => console.log(m) // Uncomment for debug
      }
    );

    const text = result.data.text?.trim();

    if (!text) {
      return null;
    }

    return text;
  } catch (err) {
    console.error('Tesseract OCR failed:', err);
    throw new Error('OCR 실패');
  }
}

// 이미지 영역 크롭 후 base64 반환
export async function cropImageRegion(pages, page, region) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 퍼센트를 픽셀로 변환
      const x = (region.x / 100) * img.width;
      const y = (region.y / 100) * img.height;
      const width = (region.width / 100) * img.width;
      const height = (region.height / 100) * img.height;

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = pages[page];
  });
}

// AI 대화
export async function chat(message, context = '') {
  const systemPrompt = context
    ? `당신은 영어 학습을 도와주는 AI 튜터입니다. 다음 학습 자료를 참고하여 답변해주세요:\n\n${context}\n\n`
    : '당신은 영어 학습을 도와주는 AI 튜터입니다. ';

  const response = await fetch(`${API_URL}?key=${GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: systemPrompt + message,
        }],
      }],
    }),
  });

  if (!response.ok) {
    throw new Error('AI 응답에 실패했습니다');
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}
