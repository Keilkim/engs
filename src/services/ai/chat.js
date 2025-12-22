import { getSetting, SETTINGS_KEYS } from '../settings';
import { getVocabulary, getGrammarPatterns } from '../annotation';
import { GOOGLE_API_KEY, GEMINI_API_URL, GEMINI_STREAM_URL, LANGUAGE_NAMES } from './config';

/**
 * Extract text from OCR data with page information
 * @param {Object} source - Source object with ocr_data
 * @returns {string} Formatted text with page markers
 */
export function extractOcrText(source) {
  if (!source) return '';

  // URL/article 타입은 content 사용
  if (source.type === 'url' && source.content) {
    return source.content;
  }

  // OCR 데이터가 있는 경우 (PDF, 이미지)
  if (source.ocr_data?.pages && source.ocr_data.pages.length > 0) {
    const sourceTitle = source.title || 'Untitled';
    const totalPages = source.ocr_data.pages.length;

    const pageTexts = source.ocr_data.pages.map((page, idx) => {
      const pageNum = idx + 1;
      const words = page.words?.map(w => w.text).join(' ') || '';
      if (!words.trim()) return null;

      return `[${sourceTitle}, p.${pageNum}/${totalPages}]\n${words}`;
    }).filter(Boolean);

    return pageTexts.join('\n\n');
  }

  // fallback to content
  return source.content || '';
}

/**
 * Build context from user's My Dictionary (vocabulary + grammar patterns)
 */
async function buildMyDictionaryContext(chatLang) {
  try {
    const [vocabItems, grammarItems] = await Promise.all([
      getVocabulary(),
      getGrammarPatterns(),
    ]);

    if (vocabItems.length === 0 && grammarItems.length === 0) {
      return '';
    }

    const vocabList = vocabItems.slice(0, 30).map(item => {
      try {
        const json = JSON.parse(item.ai_analysis_json || '{}');
        return `${item.selected_text}: ${json.definition || ''}`;
      } catch {
        return item.selected_text;
      }
    });

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

/**
 * Build conversation history for multi-turn chat
 */
function buildConversationHistory(messages, maxTurns = 6) {
  if (!messages || messages.length === 0) return [];

  const recentMessages = messages.slice(-maxTurns * 2);

  return recentMessages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.message }],
  }));
}

/**
 * Get system prompts by language
 */
function getSystemPrompts(context = '') {
  const hasSourceContext = context && context.includes('[') && context.includes('p.');

  const citationInstruction = {
    Korean: hasSourceContext ? `
- 학습 자료에서 정보를 인용할 때 반드시 각주를 달아주세요. 예: (소스명, p.2)
- 자료에 없는 내용은 자료에 없다고 명시하고, 일반적인 답변을 해주세요` : '',
    Chinese: hasSourceContext ? `
- 引用学习材料内容时必须添加脚注。例如：(材料名, p.2)
- 如果材料中没有相关内容，请明确说明并给出一般性回答` : '',
    German: hasSourceContext ? `
- Wenn Sie aus dem Lernmaterial zitieren, fügen Sie bitte Quellenangaben hinzu. Beispiel: (Quellenname, S.2)
- Wenn der Inhalt nicht im Material enthalten ist, weisen Sie darauf hin und geben Sie eine allgemeine Antwort` : '',
    English: hasSourceContext ? `
- When citing information from the learning material, always add a footnote. Example: (Source Title, p.2)
- If the content is not in the material, explicitly state so and provide a general answer` : '',
  };

  return {
    Korean: `당신은 친근하고 도움이 되는 영어 학습 AI 튜터입니다.
- 반드시 한국어로만 답변해주세요
- 자연스럽고 대화체로 답변하세요
- 필요한 경우 이전 대화 내용을 참고하세요
- 답변은 간결하고 핵심적으로 해주세요${citationInstruction.Korean}${context ? `\n\n[학습 자료]\n${context}` : ''}`,
    Chinese: `你是一位友好且乐于助人的英语学习AI导师。
- 必须用中文回答
- 用自然的对话方式回答
- 必要时参考之前的对话内容
- 回答要简洁明了${citationInstruction.Chinese}${context ? `\n\n[学习材料]\n${context}` : ''}`,
    German: `Sie sind ein freundlicher und hilfreicher KI-Tutor für das Englischlernen.
- Antworten Sie ausschließlich auf Deutsch
- Antworten Sie in natürlicher Konversationsweise
- Beziehen Sie sich bei Bedarf auf frühere Gespräche
- Halten Sie Ihre Antworten kurz und prägnant${citationInstruction.German}${context ? `\n\n[Lernmaterial]\n${context}` : ''}`,
    English: `You are a friendly and helpful English learning AI tutor.
- You must respond only in English
- Answer in a natural conversational tone
- Refer to previous conversation when relevant
- Keep your answers concise and focused${citationInstruction.English}${context ? `\n\n[Learning Material]\n${context}` : ''}`,
  };
}

/**
 * Text analysis (word translation or grammar)
 */
export async function analyzeText(text, type = 'word') {
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

  const response = await fetch(`${GEMINI_API_URL}?key=${GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompts[type] }],
      }],
    }),
  });

  if (!response.ok) {
    throw new Error('AI 분석에 실패했습니다');
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

/**
 * AI chat (with conversation history support)
 */
export async function chat(message, context = '', conversationHistory = []) {
  const chatLang = getSetting(SETTINGS_KEYS.AI_CHAT_LANGUAGE, 'Korean');
  const myDictContext = await buildMyDictionaryContext(chatLang);

  const systemPrompts = getSystemPrompts(context);
  const systemPrompt = (systemPrompts[chatLang] || systemPrompts.Korean) + myDictContext;

  const history = buildConversationHistory(conversationHistory);

  const contents = history.length > 0
    ? [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n---\n\n' + history[0]?.parts?.[0]?.text || '' }] },
        ...history.slice(1),
        { role: 'user', parts: [{ text: message }] },
      ]
    : [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + message }] }];

  const response = await fetch(`${GEMINI_API_URL}?key=${GOOGLE_API_KEY}`, {
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

/**
 * Streaming AI chat (real-time typing effect)
 */
export async function chatStream(message, context = '', conversationHistory = [], onChunk) {
  const chatLang = getSetting(SETTINGS_KEYS.AI_CHAT_LANGUAGE, 'Korean');
  const myDictContext = await buildMyDictionaryContext(chatLang);

  const systemPrompts = getSystemPrompts(context);
  const systemPrompt = (systemPrompts[chatLang] || systemPrompts.Korean) + myDictContext;

  const history = buildConversationHistory(conversationHistory);

  const contents = history.length > 0
    ? [
        { role: 'user', parts: [{ text: systemPrompt + '\n\n---\n\n' + history[0]?.parts?.[0]?.text || '' }] },
        ...history.slice(1),
        { role: 'user', parts: [{ text: message }] },
      ]
    : [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + message }] }];

  const streamUrl = `${GEMINI_STREAM_URL}?alt=sse&key=${GOOGLE_API_KEY}`;

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
            // JSON parsing failure - ignore
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}
