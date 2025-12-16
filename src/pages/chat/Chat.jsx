import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { chat } from '../../services/ai';
import { saveChatMessage, getChatLogs } from '../../services/chat';
import { getSource } from '../../services/source';
import ChatLog from '../../containers/chat-log/ChatLog';

export default function Chat() {
  const navigate = useNavigate();
  const location = useLocation();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sourceContext, setSourceContext] = useState(null);

  // 학습 뷰어에서 넘어온 경우
  const initialMessage = location.state?.initialMessage;
  const sourceId = location.state?.sourceId;

  useEffect(() => {
    loadChatHistory();
    if (sourceId) {
      loadSourceContext();
    }
  }, [sourceId]);

  useEffect(() => {
    // 초기 메시지가 있으면 자동 전송
    if (initialMessage && messages.length === 0) {
      handleSend(initialMessage);
    }
  }, [initialMessage, messages.length]);

  async function loadChatHistory() {
    try {
      const logs = await getChatLogs(sourceId);
      setMessages(logs || []);
    } catch (err) {
      console.error('채팅 기록 로드 실패:', err);
    }
  }

  async function loadSourceContext() {
    try {
      const source = await getSource(sourceId);
      setSourceContext(source?.content || '');
    } catch (err) {
      console.error('소스 컨텍스트 로드 실패:', err);
    }
  }

  async function handleSend(messageText = input) {
    const text = messageText.trim();
    if (!text || loading) return;

    setInput('');
    setLoading(true);

    // 사용자 메시지 추가
    const userMessage = {
      tempId: Date.now(),
      role: 'user',
      message: text,
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      // 메시지 저장
      const savedUserMsg = await saveChatMessage(text, 'user', sourceId);
      setMessages((prev) =>
        prev.map((m) =>
          m.tempId === userMessage.tempId ? savedUserMsg : m
        )
      );

      // AI 응답 생성
      const aiResponse = await chat(text, sourceContext);

      // AI 응답 저장
      const savedAiMsg = await saveChatMessage(aiResponse, 'assistant', sourceId);
      setMessages((prev) => [...prev, savedAiMsg]);
    } catch (err) {
      console.error('메시지 전송 실패:', err);
      // 에러 메시지 표시
      setMessages((prev) => [
        ...prev,
        {
          tempId: Date.now(),
          role: 'assistant',
          message: 'AI 응답에 실패했습니다. 다시 시도해주세요.',
        },
      ]);
    } finally {
      setLoading(false);
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
          ← 뒤로
        </button>
        <h1>AI 대화</h1>
        {sourceContext && (
          <span className="context-badge" title="학습 소스 연결됨">
            📚
          </span>
        )}
      </header>

      <main className="chat-content">
        <ChatLog
          messages={messages}
          onScrapToggle={loadChatHistory}
        />

        {loading && (
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
          placeholder="메시지를 입력하세요..."
          rows={1}
          disabled={loading}
        />
        <button
          className="send-button"
          onClick={() => handleSend()}
          disabled={!input.trim() || loading}
        >
          {loading ? '...' : '전송'}
        </button>
      </footer>
    </div>
  );
}
