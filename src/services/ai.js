const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

// NLP 분석 (단어/문법)
export async function analyzeText(text, type = 'word') {
  const prompts = {
    word: `다음 영어 단어/구문을 분석해주세요:
"${text}"

다음 형식으로 답변해주세요:
1. 발음 (IPA)
2. 품사
3. 뜻 (한국어)
4. 예문 2개 (영어 + 한국어 번역)
5. 동의어/반의어`,

    grammar: `다음 영어 문장의 문법을 분석해주세요:
"${text}"

다음 형식으로 답변해주세요:
1. 문장 구조 분석
2. 주요 문법 포인트
3. 시제/태
4. 핵심 표현 설명
5. 유사한 예문 1개`,
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
