import { useState } from 'react';
import { speakText } from '../../services/ai';

export default function Flashcard({ item, onShowAnswer }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const annotation = item.annotation;
  const analysisData = annotation?.ai_analysis_json
    ? JSON.parse(annotation.ai_analysis_json)
    : null;

  function handleFlip() {
    setIsFlipped(!isFlipped);
    if (!isFlipped) {
      onShowAnswer?.();
    }
  }

  async function handleSpeak(e) {
    e.stopPropagation();
    if (speaking) return;

    setSpeaking(true);
    try {
      await speakText(annotation.selected_text);
    } catch (err) {
      console.error('TTS 실패:', err);
    } finally {
      setSpeaking(false);
    }
  }

  return (
    <div
      className={`flashcard ${isFlipped ? 'flipped' : ''}`}
      onClick={handleFlip}
    >
      <div className="flashcard-inner">
        {/* 앞면 - 문제 */}
        <div className="flashcard-front">
          <div className="card-label">탭하여 정답 확인</div>
          <div className="card-content">
            <p className="question-text">{annotation.selected_text}</p>
          </div>
          <button
            className="speak-button"
            onClick={handleSpeak}
            disabled={speaking}
          >
            {speaking ? '🔊...' : '🔊'}
          </button>
        </div>

        {/* 뒷면 - 정답 */}
        <div className="flashcard-back">
          <div className="card-label">정답</div>
          <div className="card-content">
            {analysisData ? (
              <div className="analysis-content">
                <pre>{analysisData.content}</pre>
              </div>
            ) : (
              <div className="no-analysis">
                <p className="answer-text">{annotation.selected_text}</p>
                {annotation.memo_content && (
                  <p className="memo-text">📝 {annotation.memo_content}</p>
                )}
              </div>
            )}
          </div>
          <div className="source-info">
            📚 {annotation.source?.title || '소스'}
          </div>
        </div>
      </div>
    </div>
  );
}
