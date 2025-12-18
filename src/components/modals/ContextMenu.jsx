import { useState, useEffect } from 'react';
import { analyzeText, analyzeGrammar, analyzeGrammarPatterns, extractTextFromImage, cropImageRegion } from '../../services/ai';
import { createAnnotation, createVocabularyItem } from '../../services/annotation';
import GrammarDiagram from '../GrammarDiagram';

export default function ContextMenu({
  isOpen,
  position,
  selectedText,
  selectionRect,
  sourceId,
  pages, // PDF pages for OCR
  onClose,
  onAnnotationCreated,
}) {
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [extractedText, setExtractedText] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [grammarData, setGrammarData] = useState(null); // 문법 다이어그램 데이터 (S-V-O)
  const [aiPatterns, setAiPatterns] = useState(null); // AI 문법 패턴 데이터
  const [grammarLoading, setGrammarLoading] = useState(false); // AI 분석 로딩
  const [showMemo, setShowMemo] = useState(false);
  const [memoText, setMemoText] = useState('');
  const [wordSaved, setWordSaved] = useState(false); // 단어 저장 상태
  const [savingWord, setSavingWord] = useState(false); // 단어 저장 중

  const isImageSelection = selectionRect && selectedText?.startsWith('[Image Selection');
  const displayText = extractedText || selectedText;

  // Reset state when selection changes
  useEffect(() => {
    setAnalysisResult(null);
    setGrammarData(null);
    setAiPatterns(null);
    setGrammarLoading(false);
    setShowMemo(false);
    setMemoText('');
    setLoading(false);
    setExtractedText(null);
    setOcrLoading(false);
    setWordSaved(false);
    setSavingWord(false);
  }, [selectedText, selectionRect]);

  // Auto-OCR when image selection is made
  useEffect(() => {
    if (isOpen && isImageSelection && pages && !extractedText && !ocrLoading) {
      handleOCR();
    }
  }, [isOpen, isImageSelection, pages]);

  if (!isOpen || !selectedText) return null;

  async function handleOCR() {
    if (!pages || selectionRect?.page === undefined) return;

    setOcrLoading(true);
    try {
      // Get bounds from selection (support both old rect format and new path format)
      const bounds = selectionRect.bounds || selectionRect;

      // Crop the selected region
      const croppedImage = await cropImageRegion(pages, selectionRect.page, bounds);
      // Extract text with OCR
      const text = await extractTextFromImage(croppedImage);
      if (text) {
        setExtractedText(text);
      } else {
        setExtractedText('(텍스트를 찾을 수 없습니다)');
      }
    } catch (err) {
      console.error('OCR 실패:', err);
      setExtractedText('(OCR 실패)');
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleWordAnalysis() {
    if (!displayText || displayText.startsWith('(')) return;

    setLoading(true);
    try {
      const result = await analyzeText(displayText, 'word');
      setAnalysisResult({ type: 'word', content: result });
    } catch (err) {
      console.error('단어 분석 실패:', err);
      setAnalysisResult({ type: 'word', content: '분석에 실패했습니다. API 키를 확인해주세요.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleGrammarAnalysis() {
    if (!displayText || displayText.startsWith('(')) return;

    // 1. Client-side grammar analysis using compromise.js (즉시 표시)
    const result = analyzeGrammar(displayText);
    setGrammarData(result);
    setAiPatterns(null);

    // 2. AI grammar pattern analysis (비동기로 추가 로드)
    setGrammarLoading(true);
    try {
      const patterns = await analyzeGrammarPatterns(displayText);
      setAiPatterns(patterns);
    } catch (err) {
      console.error('AI 문법 패턴 분석 실패:', err);
    } finally {
      setGrammarLoading(false);
    }
  }

  async function handleSaveHighlight() {
    try {
      await createAnnotation({
        source_id: sourceId,
        type: 'highlight',
        selected_text: displayText,
        ai_analysis_json: analysisResult
          ? JSON.stringify(analysisResult)
          : null,
        coordinates: JSON.stringify(position),
        selection_rect: selectionRect ? JSON.stringify(selectionRect) : null,
      });
      onAnnotationCreated?.();
      handleClose();
    } catch (err) {
      console.error('저장 실패:', err);
    }
  }

  async function handleSaveVocabulary() {
    if (!displayText || wordSaved || savingWord) return;

    setSavingWord(true);
    try {
      // 단어와 분석 결과를 vocabulary로 저장
      await createVocabularyItem(
        displayText,
        analysisResult?.content || '',
        sourceId
      );
      setWordSaved(true);
      onAnnotationCreated?.();
    } catch (err) {
      console.error('단어 저장 실패:', err);
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
    } catch (err) {
      console.error('메모 저장 실패:', err);
    }
  }

  function handleClose() {
    setAnalysisResult(null);
    setGrammarData(null);
    setAiPatterns(null);
    setGrammarLoading(false);
    setShowMemo(false);
    setMemoText('');
    setExtractedText(null);
    setWordSaved(false);
    setSavingWord(false);
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
              {ocrLoading ? (
                <span className="ocr-loading">텍스트 추출 중...</span>
              ) : (
                <span className="selected-preview">
                  "{displayText?.slice(0, 50)}{displayText?.length > 50 ? '...' : ''}"
                </span>
              )}
            </div>
            <div className="context-menu-buttons">
              <button
                onClick={handleWordAnalysis}
                disabled={loading || ocrLoading || !displayText || displayText.startsWith('(')}
              >
                Word
              </button>
              <button
                onClick={handleGrammarAnalysis}
                disabled={loading || ocrLoading || !displayText || displayText.startsWith('(')}
              >
                Grammar
              </button>
              <button onClick={() => setShowMemo(true)} disabled={ocrLoading}>
                Memo
              </button>
              <button onClick={handleClose} className="delete-selection-btn">
                ✕
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
              <span>{analysisResult.type === 'word' ? 'Word Analysis' : 'Grammar Analysis'}</span>
              <button onClick={() => setAnalysisResult(null)}>Back</button>
            </div>
            <div className="result-content">
              <pre>{analysisResult.content}</pre>
            </div>
            <div className="result-actions">
              {analysisResult.type === 'word' && (
                <button
                  onClick={handleSaveVocabulary}
                  disabled={wordSaved || savingWord}
                  className={`add-vocab-btn ${wordSaved ? 'saved' : ''}`}
                >
                  {savingWord ? '...' : wordSaved ? 'Added' : '+ Add'}
                </button>
              )}
              <button onClick={handleSaveHighlight}>
                Save to Review
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Grammar Diagram Modal */}
      {grammarData && (
        <GrammarDiagram
          grammarData={grammarData}
          aiPatterns={aiPatterns}
          loading={grammarLoading}
          onClose={() => {
            setGrammarData(null);
            setAiPatterns(null);
            setGrammarLoading(false);
          }}
        />
      )}
    </div>
  );
}
