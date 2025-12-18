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

// Helper function to check if tags contains any of the target tags
// Handles both array and object format from compromise.js
function hasTag(tags, ...targetTags) {
  if (!tags) return false;

  // If tags is an array
  if (Array.isArray(tags)) {
    return targetTags.some(target => tags.includes(target));
  }

  // If tags is an object (older compromise.js format)
  if (typeof tags === 'object') {
    return targetTags.some(target => tags[target] === true || tags.hasOwnProperty(target));
  }

  return false;
}

// Compromise.js로 문법 분석 (API 없이 클라이언트에서 처리)
export function analyzeGrammar(text) {
  const doc = nlp(text);

  // 모든 단어와 태그 추출
  const terms = doc.terms().json();

  // 문장 구조 분석
  const sentences = doc.sentences().json();


  // 각 단어에 역할 부여
  const words = terms.map((term, index) => {
    // compromise.js returns nested structure: term.terms[0].tags
    const innerTerm = term.terms?.[0] || term;
    const tags = innerTerm.tags || term.tags || [];
    let role = null;
    let color = null;
    let label = null;

    // 동사 찾기 (Verb 또는 관련 시제 태그 체크)
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
    // 명사 (주어/목적어 후보)
    else if (hasTag(tags, 'Noun', 'ProperNoun', 'Singular', 'Plural', 'Uncountable', 'Possessive')) {
      role = 'Noun';
      color = GRAMMAR_COLORS.Subject; // 기본은 주어색
      label = 'N';
    }
    // 대명사
    else if (hasTag(tags, 'Pronoun', 'PersonalPronoun', 'ReflexivePronoun', 'Possessive')) {
      role = 'Pronoun';
      color = GRAMMAR_COLORS.Subject;
      label = 'Pron';
    }
    // 형용사
    else if (hasTag(tags, 'Adjective', 'Comparable', 'Superlative')) {
      role = 'Adjective';
      color = GRAMMAR_COLORS.Adjective;
      label = 'Adj';
    }
    // 부사
    else if (hasTag(tags, 'Adverb')) {
      role = 'Adverb';
      color = GRAMMAR_COLORS.Adverb;
      label = 'Adv';
    }
    // 전치사
    else if (hasTag(tags, 'Preposition')) {
      role = 'Preposition';
      color = GRAMMAR_COLORS.Preposition;
      label = 'Prep';
    }
    // 접속사
    else if (hasTag(tags, 'Conjunction')) {
      role = 'Conjunction';
      color = GRAMMAR_COLORS.Conjunction;
      label = 'Conj';
    }
    // 관사/한정사
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

  // Subject-Verb-Object 관계 찾기
  const connections = [];
  let subjectIndex = -1;
  let verbIndex = -1;
  let objectIndex = -1;

  // 동사 먼저 찾기 (문장 구조 파악의 핵심)
  for (let i = 0; i < words.length; i++) {
    if (words[i].role === 'Verb') {
      verbIndex = i;
      break;
    }
  }


  // 동사 앞의 명사/대명사를 주어로 (동사가 있는 경우)
  if (verbIndex > 0) {
    // 동사 바로 앞에서 거꾸로 찾기 (가장 가까운 명사가 주어)
    for (let i = verbIndex - 1; i >= 0; i--) {
      if (words[i].role === 'Noun' || words[i].role === 'Pronoun') {
        subjectIndex = i;
        words[i].label = 'S'; // Subject
        words[i].color = GRAMMAR_COLORS.Subject;
        break;
      }
    }
  }

  // 동사가 없으면 첫 번째 명사를 주어로 마킹만
  if (verbIndex === -1) {
    for (let i = 0; i < words.length; i++) {
      if (words[i].role === 'Noun' || words[i].role === 'Pronoun') {
        subjectIndex = i;
        words[i].label = 'S'; // Subject
        words[i].color = GRAMMAR_COLORS.Subject;
        break;
      }
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
            text: `Analyze this webpage screenshot and find the main content area.

IMPORTANT: Be GENEROUS with the selection. Include ALL meaningful content:
- Include ALL text, images, galleries, videos, cards, and visual elements
- Include sidebars if they contain useful content (not just ads)
- ONLY exclude: fixed navigation bars at top, cookie banners, sticky footers, and popup overlays

Return ONLY a JSON object (no other text):
{"x": startX(0-100%), "y": startY(0-100%), "width": width(0-100%), "height": height(0-100%)}

For most pages, the result should be close to: {"x": 0, "y": 5, "width": 100, "height": 90}
Only crop more aggressively if there are obvious ads or empty margins.`
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

// 이미지 전처리 (OCR 인식률 향상) - 형광펜 제거 포함
function preprocessImageForOCR(base64Image, scale = 2) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 이미지 확대 (scale 배)
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      // 이미지 스무딩 비활성화 (선명하게)
      ctx.imageSmoothingEnabled = false;

      // 흰색 배경
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 확대된 이미지 그리기
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // 이미지 데이터 가져오기
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // 형광펜(노란색/밝은색) 제거 + 이진화
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // 노란색/형광펜 색상 감지 (R과 G가 높고, B가 낮음)
        // 또는 전체적으로 밝은 색상 (배경/형광펜)
        const isYellowHighlight = (r > 180 && g > 150 && b < 150);
        const isBrightBackground = (r > 200 && g > 200 && b > 180);

        if (isYellowHighlight || isBrightBackground) {
          // 형광펜/배경은 흰색으로
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
        } else {
          // 그레이스케일 변환
          const gray = r * 0.299 + g * 0.587 + b * 0.114;

          // 대비 강화
          const contrast = 1.8;
          const adjusted = ((gray - 128) * contrast) + 128;

          // 이진화 (어두운 부분 = 텍스트)
          const threshold = 120;
          const binary = adjusted < threshold ? 0 : 255;

          data[i] = binary;
          data[i + 1] = binary;
          data[i + 2] = binary;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = base64Image;
  });
}

// 이미지에서 텍스트 추출 (OCR) - Tesseract.js
export async function extractTextFromImage(base64Image) {
  try {
    // 이미지 전처리 (확대 + 이진화)
    const processedImage = await preprocessImageForOCR(base64Image, 3);

    const result = await Tesseract.recognize(processedImage, 'eng', {
      logger: (m) => console.log(m),
    });

    // 이미지 높이 가져오기 (전처리에서 3배 확대됨)
    const imgHeight = result.data.lines?.[0]?.words?.[0]?.bbox
      ? Math.max(...result.data.words.map(w => w.bbox.y1))
      : 100;

    // 경계에 잘린 단어 제외 (상단/하단 5% 이내에 닿는 단어)
    const edgeThreshold = imgHeight * 0.05;
    const filteredWords = result.data.words?.filter(word => {
      // 상단 경계에 닿는지 체크
      const touchesTop = word.bbox.y0 < edgeThreshold;
      // 하단 경계에 닿는지 체크
      const touchesBottom = word.bbox.y1 > (imgHeight - edgeThreshold);
      // 둘 다 아니면 포함
      return !touchesTop && !touchesBottom;
    }) || [];

    // 필터링된 단어들로 텍스트 재구성
    const filteredText = filteredWords.map(w => w.text).join(' ').trim();

    console.log('Tesseract result:', result.data.text?.trim());
    console.log('Filtered result:', filteredText, 'words:', filteredWords.length);

    if (filteredText && filteredWords.length > 0) {
      return filteredText;
    }

    // 필터링 후 텍스트가 없으면 원본 반환 (단, confidence 체크)
    const originalText = result.data.text?.trim();
    if (originalText && result.data.confidence > 50) {
      return originalText;
    }

    return null;
  } catch (err) {
    console.error('OCR failed:', err);
    return null;
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
