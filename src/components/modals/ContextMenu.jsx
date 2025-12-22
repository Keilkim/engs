import { useState, useEffect, useRef, useCallback } from 'react';
import { useTapToClose } from '../../hooks/useTapToClose';
import { speakText } from '../../utils/tts';
import { cleanDisplayText, isWordOrPhrase } from '../../utils/textUtils';
import { adjustPositionToViewport, calculateMenuDimensions } from '../../utils/positioning';
import { analyzeText, analyzeGrammarPatterns } from '../../services/ai';
import { createAnnotation, createVocabularyItem } from '../../services/annotation';
import GrammarDiagram from '../GrammarDiagram';

export default function ContextMenu({
  isOpen,
  position,
  selectedText,
  selectionRect,
  selectedWords = [],
  sourceId,
  pages,
  zoomScale = 1,
  onClose,
  onAnnotationCreated,
}) {
  const [loading, setLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [grammarData, setGrammarData] = useState(null);
  const [aiPatterns, setAiPatterns] = useState(null);
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [memoText, setMemoText] = useState('');
  const [wordSaved, setWordSaved] = useState(false);
  const [savingWord, setSavingWord] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const menuRef = useRef(null);

  // 모달 상태 리셋 함수 (중복 제거)
  const resetModalState = useCallback(() => {
    setAnalysisResult(null);
    setGrammarData(null);
    setAiPatterns(null);
    setGrammarLoading(false);
    setShowMemo(false);
    setMemoText('');
    setLoading(false);
    setWordSaved(false);
    setSavingWord(false);
    setError('');
  }, []);

  // 탭으로 닫기 핸들러
  const { handleTouchStart, handleTouchEnd, handleClick } = useTapToClose(onClose);

  // Get text from selectedWords (OCR-based) or fallback to selectedText
  const hasOcrWords = selectedWords && selectedWords.length > 0;
  const displayText = hasOcrWords
    ? selectedWords.map(w => w.text).join(' ')
    : selectedText;

  // Reset state when selection changes
  useEffect(() => {
    resetModalState();
  }, [selectedText, selectionRect, selectedWords, resetModalState]);

  // 메뉴 열릴 때 자동 분석 시작
  useEffect(() => {
    if (!isOpen || !displayText) return;
    if (loading || analysisResult || grammarData) return;

    runAnalysis(displayText);
  }, [isOpen, displayText]);

  // 화면 경계 내에서 메뉴 위치 계산
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const adjusted = adjustPositionToViewport({
      element: menuRef.current,
      position,
      padding: 16,
    });

    setMenuPosition(adjusted);
  }, [isOpen, position, analysisResult, loading, showMemo]);

  // 텍스트가 표시되면 자동으로 읽기
  useEffect(() => {
    if (isOpen && displayText && !loading) {
      // 음성 목록 로드 대기 후 발음
      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => speakText(displayText);
      } else {
        speakText(displayText);
      }
    }
  }, [isOpen, displayText, loading]);

  if (!isOpen || !displayText) return null;

  // 텍스트 분석 실행
  async function runAnalysis(text) {
    if (!text || text.startsWith('(') || text.startsWith('[Image Selection')) return;

    const isWord = isWordOrPhrase(text);
    setLoading(true);

    // 타임아웃 설정 (10초)
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), 10000)
    );

    try {
      if (isWord) {
        // 단어/구 → 번역
        const result = await Promise.race([analyzeText(text, 'word'), timeout]);
        setAnalysisResult({ type: 'word', content: result });
      } else {
        // 문장 → 문법 분석 (모달 바로 표시)
        setLoading(false);
        setGrammarData({ originalText: text });
        setGrammarLoading(true);

        try {
          const patterns = await Promise.race([analyzeGrammarPatterns(text), timeout]);
          setAiPatterns(patterns);
        } catch {
          setError('문법 분석 실패');
          setAiPatterns({ patterns: [] });
        } finally {
          setGrammarLoading(false);
        }
        return; // 문장은 여기서 종료
      }
    } catch {
      setError('분석 실패. 다시 시도해주세요.');
      setAnalysisResult({ type: 'word', content: '' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveVocabulary() {
    if (!displayText || wordSaved || savingWord) return;

    setSavingWord(true);
    try {
      await createVocabularyItem(
        displayText,
        analysisResult?.content || '',
        sourceId,
        selectionRect // 위치 정보도 함께 저장
      );
      setWordSaved(true);
      onAnnotationCreated?.();
      handleClose(); // 저장 후 메뉴 닫기
    } catch {
      setError('단어 저장 실패');
    } finally {
      setSavingWord(false);
    }
  }

  async function handleSaveMemo() {
    try {
      await createAnnotation({
        source_id: sourceId,
        type: 'memo',
        selected_text: displayText,
        memo_content: memoText,
        coordinates: JSON.stringify(position),
        selection_rect: selectionRect ? JSON.stringify(selectionRect) : null,
      });
      onAnnotationCreated?.();
      handleClose();
    } catch {
      setError('메모 저장 실패');
    }
  }

  function handleClose() {
    resetModalState();
    onClose();
  }

  // 줌 스케일에 따라 동적으로 메뉴 크기 계산
  const { width: menuWidth, maxHeight: menuMaxHeight } = calculateMenuDimensions({
    baseWidth: Math.max(220, (typeof window !== 'undefined' ? window.innerWidth : 375) * 0.88),
    zoomScale,
  });

  return (
    <div
      className="context-menu-overlay"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
    >
      <div
        ref={menuRef}
        className="context-menu"
        style={{
          top: menuPosition.y || position.y,
          left: menuPosition.x || position.x,
          width: menuWidth,
          maxHeight: menuMaxHeight,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {error && <div className="modal-error">{error}</div>}
        {showMemo ? (
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
        ) : loading ? (
          <div className="context-menu-loading">
            <span className="loading-text">분석 중...</span>
          </div>
        ) : analysisResult ? (
          <div className="analysis-result">
            <div className="result-header">
              <span className="selected-word">{cleanDisplayText(displayText)}</span>
              <button
                className="speak-btn"
                onClick={() => speakText(displayText)}
                title="다시 듣기"
              >
                🔊
              </button>
            </div>
            <div className="result-content">
              <pre>{analysisResult.content}</pre>
            </div>
            <div className="result-actions">
              <button onClick={() => setShowMemo(true)} className="memo-btn">
                Memo
              </button>
              <button onClick={handleClose} className="close-btn">
                Close
              </button>
              <button
                onClick={handleSaveVocabulary}
                disabled={wordSaved || savingWord}
                className={`add-vocab-btn ${wordSaved ? 'saved' : ''}`}
              >
                {savingWord ? '...' : wordSaved ? 'Added' : 'Add'}
              </button>
            </div>
          </div>
        ) : (
          <div className="context-menu-loading">
            <span className="loading-text">분석 중...</span>
          </div>
        )}
      </div>

      {/* Grammar Diagram Modal */}
      {grammarData && (
        <GrammarDiagram
          grammarData={grammarData}
          aiPatterns={aiPatterns}
          loading={grammarLoading}
          zoomScale={zoomScale}
          onClose={() => {
            setGrammarData(null);
            setAiPatterns(null);
            setGrammarLoading(false);
            handleClose();
          }}
          onSave={async (data) => {
            await createAnnotation({
              source_id: sourceId,
              type: 'highlight',
              selected_text: data.originalText,
              ai_analysis_json: JSON.stringify({
                type: 'grammar',
                patterns: data.patterns,
                originalText: data.originalText,
              }),
              coordinates: JSON.stringify(position),
              selection_rect: selectionRect ? JSON.stringify(selectionRect) : null,
            });
            onAnnotationCreated?.();
          }}
        />
      )}
    </div>
  );
}
