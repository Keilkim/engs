import nlp from 'compromise';
import { getSetting, SETTINGS_KEYS } from './settings';

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
3. If NO meaningful intermediate+ patterns exist, return {"patterns": [], "sentence_structure": null}
4. Quality over quantity - only include patterns that would actually help a learner

Return a JSON object with this structure:
{
  "patterns": [
    {
      "type": "pattern name in English",
      "typeKr": "한국어 패턴명",
      "words": ["word1", "word2"],
      "wordIndices": [0, 2],
      "explanation": "Brief explanation in Korean (1-2 sentences)",
      "color": "#hex"
    }
  ],
  "sentence_structure": {
    "subject": { "text": "subject words", "indices": [0] },
    "verb": { "text": "verb words", "indices": [1] },
    "object": { "text": "object words", "indices": [2, 3] }
  }
}

Color suggestions:
- to-infinitive (advanced usage): #60a5fa (blue)
- gerund as subject/object: #f87171 (red)
- passive voice: #fb923c (orange)
- perfect/perfect continuous: #facc15 (yellow)
- relative clauses (who/which/that): #c084fc (purple)
- conditionals (if clauses, subjunctive): #4ade80 (green)
- participle constructions: #2dd4bf (teal)
- inversion: #ec4899 (pink)
- cleft sentences: #8b5cf6 (violet)

ONLY include these types of patterns:
- to-infinitive (목적/결과/형용사적 용법 - NOT simple "to go" but "in order to", "enough to", "too...to")
- Gerund as subject/object (동명사 주어/목적어)
- Passive voice (수동태: be + p.p)
- Perfect/Perfect continuous (완료시제: have been ~ing)
- Relative clauses (관계대명사절 - especially reduced relatives)
- Conditionals (가정법: if, unless, were to, should)
- Participle constructions (분사구문: -ing/-ed starting phrases)
- Subjunctive mood (가정법 현재/과거)
- Inversion (도치)
- Cleft sentences (강조 구문: It is...that)
- Causative verbs (사역동사: make/have/let + O + V)
- Reported speech patterns

wordIndices should be 0-based indices matching the word positions in the sentence.
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

// 이미지에서 텍스트 추출 (OCR) - Gemini Vision
export async function extractTextFromImage(base64Image) {
  try {
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
              text: `Extract ALL text from this image exactly as it appears.
Return ONLY the extracted text, nothing else.
If there are multiple lines, preserve the line breaks.
If the image contains no readable text, return empty string.`
            },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: imageData,
              },
            },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      console.error('Gemini Vision OCR failed:', await response.text());
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    console.log('Gemini OCR result:', text);
    return text || null;
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
  // Get user's AI chat language preference
  const chatLang = getSetting(SETTINGS_KEYS.AI_CHAT_LANGUAGE, 'Korean');

  const systemPrompts = {
    Korean: context
      ? `당신은 영어 학습을 도와주는 AI 튜터입니다. 한국어로 답변해주세요. 다음 학습 자료를 참고하여 답변해주세요:\n\n${context}\n\n`
      : '당신은 영어 학습을 도와주는 AI 튜터입니다. 한국어로 답변해주세요. ',
    Chinese: context
      ? `你是一位帮助英语学习的AI导师。请用中文回答。请参考以下学习材料回答:\n\n${context}\n\n`
      : '你是一位帮助英语学习的AI导师。请用中文回答。',
    German: context
      ? `Sie sind ein KI-Tutor, der beim Englischlernen hilft. Bitte antworten Sie auf Deutsch. Bitte beziehen Sie sich auf das folgende Lernmaterial:\n\n${context}\n\n`
      : 'Sie sind ein KI-Tutor, der beim Englischlernen hilft. Bitte antworten Sie auf Deutsch. ',
    English: context
      ? `You are an AI tutor helping with English learning. Please respond in English. Please refer to the following learning material:\n\n${context}\n\n`
      : 'You are an AI tutor helping with English learning. Please respond in English. ',
  };

  const systemPrompt = systemPrompts[chatLang] || systemPrompts.Korean;

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
