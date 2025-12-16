import { useState, useEffect } from 'react';
import { analyzeText, extractTextFromImage, cropImageRegion } from '../../services/ai';
import { createAnnotation } from '../../services/annotation';

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
  const [showMemo, setShowMemo] = useState(false);
  const [memoText, setMemoText] = useState('');

  const isImageSelection = selectionRect && selectedText?.startsWith('[Image Selection');
  const displayText = extractedText || selectedText;

  // Reset state when selection changes
  useEffect(() => {
    setAnalysisResult(null);
    setShowMemo(false);
    setMemoText('');
    setLoading(false);
    setExtractedText(null);
    setOcrLoading(false);
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
      // Crop the selected region
      const croppedImage = await cropImageRegion(pages, selectionRect.page, selectionRect);
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

    setLoading(true);
    try {
      const result = await analyzeText(displayText, 'grammar');
      setAnalysisResult({ type: 'grammar', content: result });
    } catch (err) {
      console.error('문법 분석 실패:', err);
      setAnalysisResult({ type: 'grammar', content: '분석에 실패했습니다. API 키를 확인해주세요.' });
    } finally {
      setLoading(false);
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
    setShowMemo(false);
    setMemoText('');
    setExtractedText(null);
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
              <button onClick={handleSaveHighlight}>
                Save to Review
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
