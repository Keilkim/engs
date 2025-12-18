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
  const [grammarData, setGrammarData] = useState(null);
  const [aiPatterns, setAiPatterns] = useState(null);
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [memoText, setMemoText] = useState('');
  const [wordSaved, setWordSaved] = useState(false);
  const [savingWord, setSavingWord] = useState(false);
  const [analysisType, setAnalysisType] = useState(null); // 'word' or 'grammar'

  const isImageSelection = selectionRect && selectedText?.startsWith('[Image Selection');
  const displayText = extractedText || selectedText;

  // 단어인지 문장인지 판별
  function isWordOrPhrase(text) {
    if (!text) return false;
    const trimmed = text.trim();
    const wordCount = trimmed.split(/\s+/).length;
    // 2단어 이하이고 문장 끝 부호가 없으면 단어로 판단
    return wordCount <= 2 && !/[.!?]$/.test(trimmed);
  }

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
    setAnalysisType(null);
  }, [selectedText, selectionRect]);

  // Auto-OCR when image selection is made
  useEffect(() => {
    if (isOpen && isImageSelection && pages && !extractedText && !ocrLoading) {
      handleOCR();
    }
  }, [isOpen, isImageSelection, pages]);

  // 텍스트가 준비되면 자동 분석
  useEffect(() => {
    if (displayText && !displayText.startsWith('(') && !loading && !analysisResult && !grammarData && !ocrLoading) {
      autoAnalyze(displayText);
    }
  }, [displayText, ocrLoading]);

  if (!isOpen || !selectedText) return null;

  async function handleOCR() {
    if (!pages || selectionRect?.page === undefined) return;

    setOcrLoading(true);
    try {
      const bounds = selectionRect.bounds || selectionRect;
      const croppedImage = await cropImageRegion(pages, selectionRect.page, bounds);
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

  // 자동 분석 - 단어면 번역, 문장이면 문법 분석
  async function autoAnalyze(text) {
    if (!text || text.startsWith('(')) return;

    setLoading(true);

    if (isWordOrPhrase(text)) {
      // 단어/구 → 번역
      setAnalysisType('word');
      try {
        const result = await analyzeText(text, 'word');
        setAnalysisResult({ type: 'word', content: result });
      } catch (err) {
        console.error('단어 분석 실패:', err);
        setAnalysisResult({ type: 'word', content: '분석에 실패했습니다.' });
      }
    } else {
      // 문장 → 문법 분석
      setAnalysisType('grammar');
      const result = analyzeGrammar(text);
      setGrammarData(result);

      setGrammarLoading(true);
      try {
        const patterns = await analyzeGrammarPatterns(text);
        setAiPatterns(patterns);
      } catch (err) {
        console.error('AI 문법 패턴 분석 실패:', err);
      } finally {
        setGrammarLoading(false);
      }
    }

    setLoading(false);
  }

  async function handleSaveVocabulary() {
    if (!displayText || wordSaved || savingWord) return;

    setSavingWord(true);
    try {
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
    setAnalysisType(null);
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
        ) : (loading || ocrLoading) ? (
          <div className="context-menu-loading">
            <span className="loading-text">
              {ocrLoading ? '텍스트 추출 중...' : '분석 중...'}
            </span>
          </div>
        ) : analysisResult ? (
          <div className="analysis-result">
            <div className="result-header">
              <span className="selected-word">{displayText}</span>
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
