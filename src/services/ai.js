import Tesseract from 'tesseract.js';
import nlp from 'compromise';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
// Use Gemini 2.0 Flash (available in current API)
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Free Dictionary API for word lookup
const DICTIONARY_API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';

// 문법 색상 매핑
const GRAMMAR_COLORS = {
  Subject: '#60a5fa',      // 파란색 - 주어
  Verb: '#f87171',         // 빨간색 - 동사
  Object: '#4ade80',       // 초록색 - 목적어
  Adjective: '#c084fc',    // 보라색 - 형용사
  Adverb: '#fb923c',       // 주황색 - 부사
  Preposition: '#facc15',  // 노란색 - 전치사
  Conjunction: '#2dd4bf',  // 청록색 - 접속사
  Determiner: '#94a3b8',   // 회색 - 관사/한정사
};

// Compromise.js로 문법 분석 (API 없이 클라이언트에서 처리)
export function analyzeGrammar(text) {
  const doc = nlp(text);

  // 모든 단어와 태그 추출
  const terms = doc.terms().json();

  // 문장 구조 분석
  const sentences = doc.sentences().json();

  // 각 단어에 역할 부여
  const words = terms.map((term, index) => {
    const tags = term.tags || [];
    let role = null;
    let color = null;
    let label = null;

    // 동사 찾기
    if (tags.includes('Verb')) {
      role = 'Verb';
      color = GRAMMAR_COLORS.Verb;
      if (tags.includes('PastTense')) label = 'V (past)';
      else if (tags.includes('PresentTense')) label = 'V (present)';
      else if (tags.includes('Gerund')) label = 'V-ing';
      else if (tags.includes('Infinitive')) label = 'to V';
      else label = 'V';
    }
    // 명사 (주어/목적어 후보)
    else if (tags.includes('Noun') || tags.includes('ProperNoun')) {
      role = 'Noun';
      color = GRAMMAR_COLORS.Subject; // 기본은 주어색
      label = 'N';
    }
    // 대명사
    else if (tags.includes('Pronoun')) {
      role = 'Pronoun';
      color = GRAMMAR_COLORS.Subject;
      label = 'Pron';
    }
    // 형용사
    else if (tags.includes('Adjective')) {
      role = 'Adjective';
      color = GRAMMAR_COLORS.Adjective;
      label = 'Adj';
    }
    // 부사
    else if (tags.includes('Adverb')) {
      role = 'Adverb';
      color = GRAMMAR_COLORS.Adverb;
      label = 'Adv';
    }
    // 전치사
    else if (tags.includes('Preposition')) {
      role = 'Preposition';
      color = GRAMMAR_COLORS.Preposition;
      label = 'Prep';
    }
    // 접속사
    else if (tags.includes('Conjunction')) {
      role = 'Conjunction';
      color = GRAMMAR_COLORS.Conjunction;
      label = 'Conj';
    }
    // 관사/한정사
    else if (tags.includes('Determiner') || tags.includes('Article')) {
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

  // Subject-Verb-Object 관계 찾기
  const connections = [];
  let subjectIndex = -1;
  let verbIndex = -1;
  let objectIndex = -1;

  // 첫 번째 명사/대명사를 주어로
  for (let i = 0; i < words.length; i++) {
    if (words[i].role === 'Noun' || words[i].role === 'Pronoun') {
      subjectIndex = i;
      words[i].label = 'S'; // Subject
      words[i].color = GRAMMAR_COLORS.Subject;
      break;
    }
  }

  // 동사 찾기
  for (let i = 0; i < words.length; i++) {
    if (words[i].role === 'Verb') {
      verbIndex = i;
      break;
    }
  }

  // 동사 뒤의 명사를 목적어로
  if (verbIndex !== -1) {
    for (let i = verbIndex + 1; i < words.length; i++) {
      if (words[i].role === 'Noun' || words[i].role === 'Pronoun') {
        objectIndex = i;
        words[i].label = 'O'; // Object
        words[i].color = GRAMMAR_COLORS.Object;
        break;
      }
    }
  }

  // 연결 관계 추가
  if (subjectIndex !== -1 && verbIndex !== -1) {
    connections.push({
      from: subjectIndex,
      to: verbIndex,
      label: 'Subject → Verb',
      color: '#60a5fa',
    });
  }

  if (verbIndex !== -1 && objectIndex !== -1) {
    connections.push({
      from: verbIndex,
      to: objectIndex,
      label: 'Verb → Object',
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

  const response = await fetch(`${API_URL}?key=${GOOGLE_API_KEY}`, {
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

// 이미지 전처리 (대비 강화 + 그레이스케일)
function preprocessImage(base64Image) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 이미지가 작으면 2배 확대
      const scale = Math.max(1, Math.min(2, 300 / Math.min(img.width, img.height)));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      // 이미지 그리기
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // 이미지 데이터 가져오기
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // 그레이스케일 + 대비 강화
      for (let i = 0; i < data.length; i += 4) {
        // 그레이스케일
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

        // 대비 강화 (contrast factor 1.5)
        const contrast = 1.5;
        const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
        const enhanced = factor * (gray - 128) + 128;

        const value = Math.max(0, Math.min(255, enhanced));
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = base64Image;
  });
}

// 이미지에서 텍스트 추출 (OCR) - Tesseract.js 사용 (전처리 + 신뢰도 필터링)
export async function extractTextFromImage(base64Image) {
  try {
    // 이미지 전처리
    const processedImage = await preprocessImage(base64Image);

    const result = await Tesseract.recognize(
      processedImage,
      'eng',
      {
        // logger: m => console.log(m) // Uncomment for debug
      }
    );

    // 신뢰도 40% 이상인 단어만 추출 (기존 60%에서 완화)
    const MIN_CONFIDENCE = 40;
    const words = result.data.words || [];

    // 전체 텍스트도 확인 (신뢰도 낮아도 인식된 경우)
    const fullText = result.data.text?.trim();

    const confidentWords = words
      .filter(word => word.confidence >= MIN_CONFIDENCE)
      .map(word => word.text);

    if (confidentWords.length === 0) {
      // 신뢰도 높은 단어가 없으면 전체 텍스트 반환 시도
      return fullText || null;
    }

    // 줄바꿈 유지하며 텍스트 조합
    const lines = result.data.lines || [];
    const confidentText = lines
      .map(line => {
        const lineWords = (line.words || [])
          .filter(word => word.confidence >= MIN_CONFIDENCE)
          .map(word => word.text);
        return lineWords.join(' ');
      })
      .filter(line => line.trim().length > 0)
      .join('\n');

    return confidentText.trim() || fullText || null;
  } catch (err) {
    console.error('Tesseract OCR failed:', err);
    throw new Error('OCR 실패');
  }
}

// 이미지 영역 크롭 후 base64 반환 (마킹 영역만 정확히 크롭)
export async function cropImageRegion(pages, page, region) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 패딩 없이 마킹된 영역만 크롭
      const x = Math.max(0, region.x);
      const y = Math.max(0, region.y);
      const width = Math.min(100 - x, region.width);
      const height = Math.min(100 - y, region.height);

      // 퍼센트를 픽셀로 변환
      const px = (x / 100) * img.width;
      const py = (y / 100) * img.height;
      const pwidth = (width / 100) * img.width;
      const pheight = (height / 100) * img.height;

      canvas.width = pwidth;
      canvas.height = pheight;

      ctx.drawImage(img, px, py, pwidth, pheight, 0, 0, pwidth, pheight);

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
