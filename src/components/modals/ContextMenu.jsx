import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { analyzeText, speakText } from '../../services/ai';
import { createAnnotation } from '../../services/annotation';

export default function ContextMenu({
  isOpen,
  position,
  selectedText,
  sourceId,
  onClose,
  onAnnotationCreated,
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [showMemo, setShowMemo] = useState(false);
  const [memoText, setMemoText] = useState('');

  if (!isOpen || !selectedText) return null;

  async function handleWordAnalysis() {
    setLoading(true);
    try {
      const result = await analyzeText(selectedText, 'word');
      setAnalysisResult({ type: 'word', content: result });
    } catch (err) {
      console.error('단어 분석 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleGrammarAnalysis() {
    setLoading(true);
    try {
      const result = await analyzeText(selectedText, 'grammar');
      setAnalysisResult({ type: 'grammar', content: result });
    } catch (err) {
      console.error('문법 분석 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSpeak() {
    try {
      await speakText(selectedText);
    } catch (err) {
      console.error('TTS 실패:', err);
    }
  }

  async function handleSaveHighlight() {
    try {
      await createAnnotation({
        source_id: sourceId,
        type: 'highlight',
        selected_text: selectedText,
        ai_analysis_json: analysisResult
          ? JSON.stringify(analysisResult)
          : null,
        coordinates: JSON.stringify(position),
      });
      onAnnotationCreated?.();
      handleClose();
    } catch (err) {
      console.error('저장 실패:', err);
    }
  }

  async function handleSaveMemo() {
    try {
      await createAnnotation({
        source_id: sourceId,
        type: 'memo',
        selected_text: selectedText,
        memo_content: memoText,
        coordinates: JSON.stringify(position),
      });
      onAnnotationCreated?.();
      handleClose();
    } catch (err) {
      console.error('메모 저장 실패:', err);
    }
  }

  function handleAskAI() {
    navigate('/chat', {
      state: {
        initialMessage: selectedText,
        sourceId: sourceId,
      },
    });
  }

  function handleClose() {
    setAnalysisResult(null);
    setShowMemo(false);
    setMemoText('');
    onClose();
  }

  return (
    <div
      className="context-menu-overlay"
      onClick={handleClose}
    >
      <div
        className="context-menu"
        style={{
          top: position.y,
          left: position.x,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!analysisResult && !showMemo ? (
          <>
            <div className="context-menu-header">
              <span className="selected-preview">
                "{selectedText.slice(0, 30)}{selectedText.length > 30 ? '...' : ''}"
              </span>
            </div>
            <div className="context-menu-buttons">
              <button onClick={handleWordAnalysis} disabled={loading}>
                📖 단어찾기
              </button>
              <button onClick={handleGrammarAnalysis} disabled={loading}>
                📝 문법분석
              </button>
              <button onClick={() => setShowMemo(true)}>
                ✏️ 메모하기
              </button>
              <button onClick={handleSpeak}>
                🔊 읽기
              </button>
              <button onClick={handleAskAI} className="ask-ai-button">
                🤖 AI 질문하기
              </button>
            </div>
            {loading && <div className="loading-indicator">분석 중...</div>}
          </>
        ) : showMemo ? (
          <div className="memo-input">
            <textarea
              value={memoText}
              onChange={(e) => setMemoText(e.target.value)}
              placeholder="메모를 입력하세요..."
              autoFocus
            />
            <div className="memo-buttons">
              <button onClick={() => setShowMemo(false)}>취소</button>
              <button onClick={handleSaveMemo} disabled={!memoText.trim()}>
                저장
              </button>
            </div>
          </div>
        ) : (
          <div className="analysis-result">
            <div className="result-header">
              <span>{analysisResult.type === 'word' ? '📖 단어 분석' : '📝 문법 분석'}</span>
              <button onClick={() => setAnalysisResult(null)}>←</button>
            </div>
            <div className="result-content">
              <pre>{analysisResult.content}</pre>
            </div>
            <div className="result-actions">
              <button onClick={handleSaveHighlight}>
                💾 복습 목록에 저장
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
