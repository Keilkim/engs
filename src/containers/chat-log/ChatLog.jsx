import { useEffect, useRef } from 'react';
import { scrapMessage, unscrapMessage } from '../../services/chat';

export default function ChatLog({ messages, onScrapToggle, streamingText = '' }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  async function handleScrapToggle(message) {
    try {
      if (message.is_scrapped) {
        await unscrapMessage(message.id);
      } else {
        await scrapMessage(message.id);
      }
      onScrapToggle?.();
    } catch {
      // ignore
    }
  }

  if ((!messages || messages.length === 0) && !streamingText) {
    return (
      <div className="chat-log-empty">
        <p>AI와 대화를 시작해보세요!</p>
        <p>학습한 내용에 대해 질문하거나 영어로 대화해보세요.</p>
      </div>
    );
  }

  return (
    <div className="chat-log">
      {messages.map((message) => (
        <div
          key={message.id || message.tempId}
          className={`chat-message ${message.role}`}
        >
          <div className="message-avatar">
            {message.role === 'user' ? 'U' : 'AI'}
          </div>
          <div className="message-content">
            <div className="message-text">
              {message.message}
            </div>
            {message.role === 'assistant' && message.id && (
              <button
                className={`scrap-button ${message.is_scrapped ? 'scrapped' : ''}`}
                onClick={() => handleScrapToggle(message)}
                title={message.is_scrapped ? '스크랩 해제' : '스크랩'}
              >
                {message.is_scrapped ? 'Saved' : 'Save'}
              </button>
            )}
          </div>
        </div>
      ))}

      {/* 실시간 스트리밍 응답 표시 */}
      {streamingText && (
        <div className="chat-message assistant streaming">
          <div className="message-avatar">AI</div>
          <div className="message-content">
            <div className="message-text">
              {streamingText}
              <span className="typing-cursor">|</span>
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
