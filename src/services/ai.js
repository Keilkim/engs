import nlp from 'compromise';
import Tesseract from 'tesseract.js';
import { getSetting, SETTINGS_KEYS } from './settings';
import { getVocabulary, getGrammarPatterns } from './annotation';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
// Use Gemini 2.0 Flash (available in current API)
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Language name mapping for prompts
const LANGUAGE_NAMES = {
  Korean: 'Korean (한국어)',
  Chinese: 'Chinese (中文)',
  German: 'German (Deutsch)',
  English: 'English',
};

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

// AI 기반 문법 패턴 분석 (Gemini API)
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
    const response = await fetch(`${API_URL}?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt,
          }],
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

    // JSON 파싱 (마크다운 코드 블록 제거)
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```/g, '');
    }

    const result = JSON.parse(jsonText);
    return result;
  } catch (err) {
    console.error('Grammar pattern analysis failed:', err);
    // 빈 결과 반환
    return {
      patterns: [],
      sentence_structure: null,
    };
  }
}

// NLP 분석 (단어/문법)
export async function analyzeText(text, type = 'word') {
  // Get user's translation language preference
  const translationLang = getSetting(SETTINGS_KEYS.TRANSLATION_LANGUAGE, 'Korean');
  const langName = LANGUAGE_NAMES[translationLang] || translationLang;

  const prompts = {
    word: `Translate this English word/phrase to ${langName}:
"${text}"

Rules:
- Provide ONLY the translations in ${langName}, nothing else
- Maximum 3 different meanings if the word has multiple meanings
- Format: one meaning per line, numbered
- Keep it extremely simple and concise

Example for "table":
1. 책상, 테이블
2. 표, 도표

Example for "run":
1. 달리다
2. 운영하다
3. 작동하다`,

    grammar: `Analyze the grammar of this English sentence:
"${text}"

IMPORTANT: Provide ALL explanations in ${langName}.

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

// 이미지에서 텍스트 추출 (OCR) - Tesseract.js (무료, 클라이언트)
export async function extractTextFromImage(base64Image, wordBag = null) {
  try {
    const result = await Tesseract.recognize(base64Image, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log('Tesseract:', Math.round(m.progress * 100) + '%');
        }
      },
    });

    let text = result.data.text?.trim();
    console.log('Tesseract OCR result:', text);

    // 단어 주머니가 있으면 오타 보정
    if (text && wordBag && wordBag.size > 0) {
      text = correctTextWithWordBag(text, wordBag);
      console.log('Corrected text:', text);
    }

    return text || null;
  } catch (err) {
    console.error('Tesseract OCR failed:', err);
    return null;
  }
}

// 전체 문서에서 단어 주머니 추출 (한번만 실행)
export async function extractWordBagFromImages(images) {
  const wordSet = new Set();

  for (let i = 0; i < images.length; i++) {
    try {
      console.log(`OCR processing page ${i + 1}/${images.length}...`);
      const result = await Tesseract.recognize(images[i], 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && m.progress === 1) {
            console.log(`Page ${i + 1} OCR complete`);
          }
        },
      });

      // 단어 추출 (소문자로 정규화)
      const words = result.data.text
        .split(/\s+/)
        .map(w => w.replace(/[^a-zA-Z'-]/g, '').toLowerCase())
        .filter(w => w.length >= 2);

      words.forEach(w => wordSet.add(w));
    } catch (err) {
      console.error(`Page ${i + 1} OCR failed:`, err);
    }
  }

  console.log(`Word bag extracted: ${wordSet.size} unique words`);
  return wordSet;
}

// 레벤슈타인 거리 계산
function levenshteinDistance(a, b) {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

// 단어 주머니로 OCR 오타 보정
function correctTextWithWordBag(text, wordBag) {
  const words = text.split(/\s+/);

  const corrected = words.map(word => {
    // 특수문자 제거한 순수 단어
    const cleanWord = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (cleanWord.length < 2) return word;

    // 이미 단어 주머니에 있으면 그대로
    if (wordBag.has(cleanWord)) return word;

    // 가장 유사한 단어 찾기
    let bestMatch = null;
    let bestDistance = Infinity;

    for (const bagWord of wordBag) {
      // 길이 차이가 너무 크면 스킵
      if (Math.abs(bagWord.length - cleanWord.length) > 2) continue;

      const dist = levenshteinDistance(cleanWord, bagWord);

      // 거리가 2 이하이고 더 가까우면 교체 후보
      if (dist <= 2 && dist < bestDistance) {
        bestDistance = dist;
        bestMatch = bagWord;
      }
    }

    if (bestMatch) {
      // 원래 대소문자 패턴 유지
      const isCapitalized = word[0] === word[0].toUpperCase();
      const isAllCaps = word === word.toUpperCase();

      if (isAllCaps) return bestMatch.toUpperCase();
      if (isCapitalized) return bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1);
      return bestMatch;
    }

    return word;
  });

  return corrected.join(' ');
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

// OCR로 텍스트와 단어 위치 추출 (Tesseract.js v7)
export async function extractTextWithWordPositions(base64Image) {
  try {
    // Get image dimensions first
    const img = new Image();
    const imgLoadPromise = new Promise((resolve) => {
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => resolve({ width: 1, height: 1 });
      img.src = base64Image;
    });
    const { width: imageWidth, height: imageHeight } = await imgLoadPromise;
    console.log('[OCR-Extract] Image dimensions:', imageWidth, 'x', imageHeight);

    // Create worker (no progress logging)
    const worker = await Tesseract.createWorker('eng', 1);

    // v7: MUST explicitly request 'blocks' output to get word-level bbox data
    // Default only returns 'text'
    const result = await worker.recognize(base64Image, {}, {
      text: true,
      blocks: true,  // This is required for word-level bounding boxes
    });

    console.log('[OCR-Extract] result.data keys:', Object.keys(result.data || {}));
    console.log('[OCR-Extract] text length:', result.data.text?.length);

    const data = result.data;
    const allWords = [];

    // v7: blocks contains the hierarchical structure: blocks > paragraphs > lines > words
    if (data.blocks) {
      console.log('[OCR-Extract] blocks type:', typeof data.blocks);
      console.log('[OCR-Extract] blocks is array:', Array.isArray(data.blocks));

      // If blocks is an object, log its structure
      if (typeof data.blocks === 'object' && !Array.isArray(data.blocks)) {
        console.log('[OCR-Extract] blocks keys:', Object.keys(data.blocks));
        console.log('[OCR-Extract] blocks sample:', JSON.stringify(data.blocks).substring(0, 500));
      }

      // Parse blocks hierarchy
      const blocksArray = Array.isArray(data.blocks) ? data.blocks : [data.blocks];
      for (const block of blocksArray) {
        if (!block) continue;

        // Try direct words on block
        if (block.words && Array.isArray(block.words)) {
          for (const word of block.words) {
            if (word.text && word.bbox) {
              allWords.push({ text: word.text.trim(), confidence: word.confidence || 90, bbox: word.bbox });
            }
          }
        }

        // Try paragraphs > lines > words
        for (const para of (block.paragraphs || [])) {
          for (const line of (para.lines || [])) {
            for (const word of (line.words || [])) {
              if (word.text && word.bbox) {
                allWords.push({ text: word.text.trim(), confidence: word.confidence || 90, bbox: word.bbox });
              }
            }
          }
        }
      }
      console.log('[OCR-Extract] Extracted from blocks:', allWords.length, 'words');
    }

    // Alternative: try data.words directly (some versions)
    if (allWords.length === 0 && data.words && Array.isArray(data.words)) {
      console.log('[OCR-Extract] Trying data.words:', data.words.length);
      for (const word of data.words) {
        if (word.text && word.bbox) {
          allWords.push({ text: word.text.trim(), confidence: word.confidence || 90, bbox: word.bbox });
        }
      }
    }

    // Terminate worker
    await worker.terminate();

    // Debug: If no words found, show what we have
    if (allWords.length === 0) {
      console.log('[OCR-Extract] NO WORDS FOUND!');
      console.log('[OCR-Extract] data.blocks:', data.blocks);
      console.log('[OCR-Extract] data.words:', data.words);

      return {
        text: data.text || '',
        words: [],
        imageSize: { width: imageWidth, height: imageHeight },
      };
    }

    // 단어별 위치를 퍼센트로 변환
    const wordPositions = allWords.map((word) => ({
      text: word.text,
      confidence: word.confidence,
      bbox: {
        x: (word.bbox.x0 / imageWidth) * 100,
        y: (word.bbox.y0 / imageHeight) * 100,
        width: ((word.bbox.x1 - word.bbox.x0) / imageWidth) * 100,
        height: ((word.bbox.y1 - word.bbox.y0) / imageHeight) * 100,
      },
    }));

    console.log('[OCR-Extract] SUCCESS:', wordPositions.length, 'words');
    console.log('[OCR-Extract] Sample:', wordPositions.slice(0, 3).map(w => ({
      text: w.text,
      bbox: `x:${w.bbox.x.toFixed(1)}% y:${w.bbox.y.toFixed(1)}%`
    })));

    return {
      text: data.text,
      words: wordPositions,
      imageSize: { width: imageWidth, height: imageHeight },
    };
  } catch (err) {
    console.error('Tesseract OCR failed:', err);
    return null;
  }
}

// 특정 단어들의 위치 찾기 (OCR 결과에서)
export function findWordPositions(ocrResult, targetWords) {
  if (!ocrResult || !ocrResult.words) return [];

  const positions = [];

  targetWords.forEach((target) => {
    const targetLower = target.word.toLowerCase();

    // OCR 결과에서 해당 단어 찾기
    const found = ocrResult.words.find((w) =>
      w.text.toLowerCase().includes(targetLower) ||
      targetLower.includes(w.text.toLowerCase())
    );

    if (found) {
      positions.push({
        word: target.word,
        index: target.index,
        bbox: found.bbox,
        confidence: found.confidence,
      });
    }
  });

  return positions;
}

// Google Translate 언어 코드 매핑
const LANG_CODES = {
  Korean: 'ko',
  Chinese: 'zh-CN',
  German: 'de',
  English: 'en',
};

// Google Translate 비공식 API (빠름)
async function googleTranslate(text, targetLang = 'ko') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Translation failed');
  const data = await response.json();
  // 결과는 [[["번역문","원문",...],...],...]  형태
  return data[0]?.map(item => item[0]).join('') || text;
}

// 단어 뜻 빠른 검색 (Free Dictionary API + Google Translate)
export async function lookupWord(word) {
  const cleanWord = word.replace(/[.,;:!?"'()[\]{}]/g, '').trim();
  if (!cleanWord) {
    return { word, phonetic: '', definition: '단어를 인식할 수 없습니다' };
  }

  const translationLang = getSetting(SETTINGS_KEYS.TRANSLATION_LANGUAGE, 'Korean');
  const langCode = LANG_CODES[translationLang] || 'ko';

  try {
    // Free Dictionary API로 영어 정의 가져오기
    const dictResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);

    if (dictResponse.ok) {
      const dictData = await dictResponse.json();
      const entry = dictData[0];
      const phonetic = entry.phonetic || entry.phonetics?.[0]?.text || '';

      // 정의 추출 (최대 3개)
      const definitions = [];
      for (const meaning of entry.meanings || []) {
        for (const def of meaning.definitions || []) {
          if (definitions.length < 3) {
            definitions.push(`[${meaning.partOfSpeech}] ${def.definition}`);
          }
        }
      }

      // Google Translate로 빠르게 번역
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

  // Fallback: 단어만 직접 번역
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

// 마이 딕셔너리에서 대화 주제와 관련된 단어/문법 컨텍스트 빌드
async function buildMyDictionaryContext(chatLang) {
  try {
    const [vocabItems, grammarItems] = await Promise.all([
      getVocabulary(),
      getGrammarPatterns(),
    ]);

    if (vocabItems.length === 0 && grammarItems.length === 0) {
      return '';
    }

    // 단어 목록 빌드
    const vocabList = vocabItems.slice(0, 30).map(item => {
      try {
        const json = JSON.parse(item.ai_analysis_json || '{}');
        return `${item.selected_text}: ${json.definition || ''}`;
      } catch {
        return item.selected_text;
      }
    });

    // 문법 패턴 목록 빌드
    const grammarList = grammarItems.slice(0, 15).map(item => {
      try {
        const json = JSON.parse(item.ai_analysis_json || '{}');
        const patternNames = json.patterns?.map(p => p.typeKr || p.type).join(', ') || '';
        return `"${json.originalText}": ${patternNames}`;
      } catch {
        return '';
      }
    }).filter(Boolean);

    const contextByLang = {
      Korean: `\n\n[사용자의 마이 딕셔너리]
다음은 사용자가 학습 중인 단어와 문법 패턴입니다. 대화 주제와 관련이 있다면 이 단어와 문법을 우선적으로 활용하여 설명하거나 예문을 만들어주세요.

저장된 단어: ${vocabList.join(', ') || '없음'}

저장된 문법 패턴: ${grammarList.join(' / ') || '없음'}
`,
      Chinese: `\n\n[用户的我的词典]
以下是用户正在学习的单词和语法模式。如果与对话主题相关，请优先使用这些单词和语法进行解释或造句。

保存的单词: ${vocabList.join(', ') || '无'}

保存的语法模式: ${grammarList.join(' / ') || '无'}
`,
      German: `\n\n[Mein Wörterbuch des Benutzers]
Dies sind die Wörter und Grammatikmuster, die der Benutzer lernt. Wenn sie zum Gesprächsthema passen, verwenden Sie diese Wörter und Grammatik bevorzugt für Erklärungen oder Beispielsätze.

Gespeicherte Wörter: ${vocabList.join(', ') || 'Keine'}

Gespeicherte Grammatikmuster: ${grammarList.join(' / ') || 'Keine'}
`,
      English: `\n\n[User's My Dictionary]
These are the words and grammar patterns the user is learning. If relevant to the conversation topic, prioritize using these words and grammar for explanations or example sentences.

Saved words: ${vocabList.join(', ') || 'None'}

Saved grammar patterns: ${grammarList.join(' / ') || 'None'}
`,
    };

    return contextByLang[chatLang] || contextByLang.Korean;
  } catch (err) {
    console.error('Failed to load My Dictionary context:', err);
    return '';
  }
}

// Build conversation history for multi-turn chat
function buildConversationHistory(messages, maxTurns = 6) {
  if (!messages || messages.length === 0) return [];

  // 최근 N개 턴만 사용 (메모리/토큰 절약)
  const recentMessages = messages.slice(-maxTurns * 2);

  return recentMessages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.message }],
  }));
}

// AI 대화 (대화 히스토리 지원)
export async function chat(message, context = '', conversationHistory = []) {
  // Get user's AI chat language preference
  const chatLang = getSetting(SETTINGS_KEYS.AI_CHAT_LANGUAGE, 'Korean');

  // 마이 딕셔너리 컨텍스트 로드
  const myDictContext = await buildMyDictionaryContext(chatLang);

  const systemPrompts = {
    Korean: `당신은 친근하고 도움이 되는 영어 학습 AI 튜터입니다.
- 반드시 한국어로만 답변해주세요
- 자연스럽고 대화체로 답변하세요
- 필요한 경우 이전 대화 내용을 참고하세요
- 답변은 간결하고 핵심적으로 해주세요${context ? `\n\n[학습 자료]\n${context}` : ''}`,
    Chinese: `你是一位友好且乐于助人的英语学习AI导师。
- 必须用中文回答
- 用自然的对话方式回答
- 必要时参考之前的对话内容
- 回答要简洁明了${context ? `\n\n[学习材料]\n${context}` : ''}`,
    German: `Sie sind ein freundlicher und hilfreicher KI-Tutor für das Englischlernen.
- Antworten Sie ausschließlich auf Deutsch
- Antworten Sie in natürlicher Konversationsweise
- Beziehen Sie sich bei Bedarf auf frühere Gespräche
- Halten Sie Ihre Antworten kurz und prägnant${context ? `\n\n[Lernmaterial]\n${context}` : ''}`,
    English: `You are a friendly and helpful English learning AI tutor.
- You must respond only in English
- Answer in a natural conversational tone
- Refer to previous conversation when relevant
- Keep your answers concise and focused${context ? `\n\n[Learning Material]\n${context}` : ''}`,
  };

  const systemPrompt = (systemPrompts[chatLang] || systemPrompts.Korean) + myDictContext;

  // 대화 히스토리 빌드
  const history = buildConversationHistory(conversationHistory);

  // 첫 메시지에 시스템 프롬프트 포함
  const contents = history.length > 0
    ? [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n---\n\n' + history[0]?.parts?.[0]?.text || '' }] },
        ...history.slice(1),
        { role: 'user', parts: [{ text: message }] },
      ]
    : [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + message }] }];

  const response = await fetch(`${API_URL}?key=${GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!response.ok) {
    throw new Error('AI 응답에 실패했습니다');
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// 스트리밍 AI 대화 (실시간 타이핑 효과)
export async function chatStream(message, context = '', conversationHistory = [], onChunk) {
  const chatLang = getSetting(SETTINGS_KEYS.AI_CHAT_LANGUAGE, 'Korean');
  const myDictContext = await buildMyDictionaryContext(chatLang);

  const systemPrompts = {
    Korean: `당신은 친근하고 도움이 되는 영어 학습 AI 튜터입니다.
- 반드시 한국어로만 답변해주세요
- 자연스럽고 대화체로 답변하세요
- 필요한 경우 이전 대화 내용을 참고하세요
- 답변은 간결하고 핵심적으로 해주세요${context ? `\n\n[학습 자료]\n${context}` : ''}`,
    Chinese: `你是一位友好且乐于助人的英语学习AI导师。
- 必须用中文回答
- 用自然的对话方式回答
- 必要时参考之前的对话内容
- 回答要简洁明了${context ? `\n\n[学习材料]\n${context}` : ''}`,
    German: `Sie sind ein freundlicher und hilfreicher KI-Tutor für das Englischlernen.
- Antworten Sie ausschließlich auf Deutsch
- Antworten Sie in natürlicher Konversationsweise
- Beziehen Sie sich bei Bedarf auf frühere Gespräche
- Halten Sie Ihre Antworten kurz und prägnant${context ? `\n\n[Lernmaterial]\n${context}` : ''}`,
    English: `You are a friendly and helpful English learning AI tutor.
- You must respond only in English
- Answer in a natural conversational tone
- Refer to previous conversation when relevant
- Keep your answers concise and focused${context ? `\n\n[Learning Material]\n${context}` : ''}`,
  };

  const systemPrompt = (systemPrompts[chatLang] || systemPrompts.Korean) + myDictContext;

  const history = buildConversationHistory(conversationHistory);

  const contents = history.length > 0
    ? [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n---\n\n' + history[0]?.parts?.[0]?.text || '' }] },
        ...history.slice(1),
        { role: 'user', parts: [{ text: message }] },
      ]
    : [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + message }] }];

  // 스트리밍 API 엔드포인트
  const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${GOOGLE_API_KEY}`;

  const response = await fetch(streamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!response.ok) {
    throw new Error('AI 응답에 실패했습니다');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6);
            if (jsonStr.trim() === '[DONE]') continue;

            const data = JSON.parse(jsonStr);
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            if (text) {
              fullText += text;
              onChunk?.(text, fullText);
            }
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}
