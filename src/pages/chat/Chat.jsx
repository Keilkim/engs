import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { chatStream, extractOcrText } from '../../services/ai';
import { saveChatMessage, getChatLogs, clearChatLogs } from '../../services/chat';
import { getSource } from '../../services/source';
import ChatLog from '../../containers/chat-log/ChatLog';
import { TranslatableText } from '../../components/translatable';

export default function Chat() {
  const navigate = useNavigate();
  const location = useLocation();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState(''); // 실시간 타이핑 텍스트
  const [sourceContext, setSourceContext] = useState(null);
  const [vocabContext, setVocabContext] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const initialMessage = location.state?.initialMessage;
  const sourceId = location.state?.sourceId;
  const sourceTitle = location.state?.sourceTitle;
  const topicRestricted = location.state?.topicRestricted ?? false;
  const vocabItems = location.state?.vocabContext;
  const contextType = location.state?.contextType;

  useEffect(() => {
    loadChatHistory();
    if (sourceId) {
      loadSourceContext();
    }
  }, [sourceId]);

  useEffect(() => {
    if (vocabItems && vocabItems.length > 0) {
      const context = buildVocabContext(vocabItems, contextType);
      setVocabContext(context);
    }
  }, [vocabItems, contextType]);

  function buildVocabContext(items, type) {
    if (type === 'words') {
      const words = items.map(item => {
        try {
          const json = JSON.parse(item.ai_analysis_json || '{}');
          return `- ${item.selected_text}: ${json.definition || 'No definition'}`;
        } catch {
          return `- ${item.selected_text}`;
        }
      });
      return `User's saved vocabulary words:\n${words.join('\n')}`;
    } else if (type === 'grammar') {
      const patterns = items.map(item => {
        try {
          const json = JSON.parse(item.ai_analysis_json || '{}');
          const patternNames = json.patterns?.map(p => p.typeKr || p.type).join(', ') || '';
          return `- "${json.originalText}": ${patternNames}`;
        } catch {
          return `- ${item.selected_text}`;
        }
      });
      return `User's saved grammar patterns:\n${patterns.join('\n')}`;
    }
    return null;
  }

  useEffect(() => {
    if (initialMessage && messages.length === 0) {
      handleSend(initialMessage);
    }
  }, [initialMessage, messages.length]);

  async function loadChatHistory() {
    try {
      const logs = await getChatLogs(sourceId);
      setMessages(logs || []);
    } catch {
      // ignore
    }
  }

  async function loadSourceContext() {
    try {
      const source = await getSource(sourceId);
      // OCR 데이터 포함하여 텍스트 추출 (소스명, 페이지 정보 포함)
      const contextText = extractOcrText(source);
      setSourceContext(contextText);
    } catch {
      // ignore
    }
  }

  async function handleSend(messageText = input) {
    const text = messageText.trim();
    if (!text || loading) return;

    setInput('');
    setLoading(true);
    setStreamingText('');

    const userMessage = {
      tempId: Date.now(),
      role: 'user',
      message: text,
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const savedUserMsg = await saveChatMessage(text, 'user', sourceId);
      setMessages((prev) =>
        prev.map((m) =>
          m.tempId === userMessage.tempId ? savedUserMsg : m
        )
      );

      // 주제 제한 모드일 때 컨텍스트에 제한 지시 추가
      let combinedContext = [sourceContext, vocabContext].filter(Boolean).join('\n\n');

      if (topicRestricted && sourceTitle) {
        const topicInstruction = `[IMPORTANT TOPIC RESTRICTION]
You must ONLY discuss topics related to the learning material: "${sourceTitle}".
If the user asks about unrelated topics, politely guide them back to the learning material.
Say something like: "That's interesting, but let's focus on the learning material we're studying. Is there anything about '${sourceTitle}' you'd like to discuss?"
Do NOT answer questions that are completely unrelated to the material.`;
        combinedContext = topicInstruction + (combinedContext ? '\n\n' + combinedContext : '');
      }

      // 대화 히스토리를 포함하여 스트리밍 요청
      const currentMessages = [...messages, savedUserMsg];
      const aiResponse = await chatStream(
        text,
        combinedContext || null,
        currentMessages,
        (chunk, fullText) => {
          // 실시간으로 타이핑 효과 표시
          setStreamingText(fullText);
        },
        topicRestricted
      );

      setStreamingText('');
      const savedAiMsg = await saveChatMessage(aiResponse, 'assistant', sourceId);
      setMessages((prev) => [...prev, savedAiMsg]);
    } catch {
      setStreamingText('');
      setMessages((prev) => [
        ...prev,
        {
          tempId: Date.now(),
          role: 'assistant',
          message: '응답에 실패했습니다. 다시 시도해주세요.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleClearChat() {
    try {
      await clearChatLogs(sourceId);
      setMessages([]);
      setShowClearConfirm(false);
    } catch {
      // ignore
    }
  }

  function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-screen">
      <header className="chat-header">
        <button className="back-button" onClick={() => navigate('/')}>
          <TranslatableText textKey="nav.back">Back</TranslatableText>
        </button>
        <h1>
          {topicRestricted && sourceTitle ? (
            <span className="chat-topic-title">{sourceTitle}</span>
          ) : (
            <TranslatableText textKey="chat.aiChat">AI Chat</TranslatableText>
          )}
        </h1>
        <div className="chat-header-actions">
          {sourceContext && (
            <span className="context-badge" title="Learning source connected">
              S
            </span>
          )}
          {vocabContext && (
            <span className="context-badge vocab-badge" title="Vocabulary context loaded">
              V
            </span>
          )}
          {messages.length > 0 && (
            <button
              className="clear-chat-btn"
              onClick={() => setShowClearConfirm(true)}
              title="Clear chat"
            >
              <TranslatableText textKey="chat.clear">Clear</TranslatableText>
            </button>
          )}
        </div>
      </header>

      <main className="chat-content">
        <ChatLog
          messages={messages}
          onScrapToggle={loadChatHistory}
          streamingText={streamingText}
        />

        {loading && !streamingText && (
          <div className="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        )}
      </main>

      <footer className="chat-input-area">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
          rows={1}
          disabled={loading}
        />
        <button
          className="send-button"
          onClick={() => handleSend()}
          disabled={!input.trim() || loading}
        >
          {loading ? '...' : <TranslatableText textKey="chat.send">Send</TranslatableText>}
        </button>
      </footer>

      {/* Clear chat confirmation modal */}
      {showClearConfirm && (
        <div className="modal-overlay" onClick={() => setShowClearConfirm(false)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3><TranslatableText textKey="chat.clearTitle">Clear Chat</TranslatableText></h3>
            <p><TranslatableText textKey="chat.clearMessage">대화 기록을 삭제하시겠습니까? 스크랩된 메시지도 함께 삭제됩니다.</TranslatableText></p>
            <div className="delete-modal-actions">
              <button
                className="cancel-btn"
                onClick={() => setShowClearConfirm(false)}
              >
                <TranslatableText textKey="common.cancel">Cancel</TranslatableText>
              </button>
              <button
                className="confirm-delete-btn"
                onClick={handleClearChat}
              >
                <TranslatableText textKey="common.delete">Delete</TranslatableText>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
