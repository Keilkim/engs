import { useState, useEffect, useRef } from 'react';
import { analyzeText, analyzeGrammarPatterns, extractTextFromImage, cropImageRegion } from '../../services/ai';
import { createAnnotation, createVocabularyItem } from '../../services/annotation';
import GrammarDiagram from '../GrammarDiagram';

export default function ContextMenu({
  isOpen,
  position,
  selectedText,
  selectionRect,
  sourceId,
  pages,
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

  const isImageSelection = selectionRect && selectedText?.startsWith('[Image Selection');
  const displayText = extractedText || selectedText;

  // 단어인지 문장인지 판별
  function isWordOrPhrase(text) {
    if (!text) return false;
    const trimmed = text.trim();
    const wordCount = trimmed.split(/\s+/).length;
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
  }, [selectedText, selectionRect]);

  // 메뉴 열릴 때 자동 처리
  useEffect(() => {
    if (!isOpen || !selectedText) return;

    if (isImageSelection) {
      // 이미지 선택 → OCR 시작
      if (pages && !ocrLoading && !extractedText) {
        runOCR();
      }
    } else {
      // 일반 텍스트 → 바로 분석
      if (!loading && !analysisResult && !grammarData) {
        runAnalysis(selectedText);
      }
    }
  }, [isOpen, selectedText, pages]);

  // OCR 완료 후 분석
  useEffect(() => {
    if (extractedText && !extractedText.startsWith('(') && !loading && !analysisResult && !grammarData) {
      runAnalysis(extractedText);
    }
  }, [extractedText]);

  if (!isOpen || !selectedText) return null;

  async function runOCR() {
    if (!pages || selectionRect?.page === undefined) return;

    setOcrLoading(true);
    try {
      const bounds = selectionRect.bounds || selectionRect;
      const croppedImage = await cropImageRegion(pages, selectionRect.page, bounds);
      const text = await extractTextFromImage(croppedImage);
      console.log('OCR 결과:', text);
      if (text && text.trim()) {
        setExtractedText(text.trim());
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

  // 텍스트 분석 실행
  async function runAnalysis(text) {
    if (!text || text.startsWith('(') || text.startsWith('[Image Selection')) return;

    const isWord = isWordOrPhrase(text);
    console.log('분석 시작:', text, '단어여부:', isWord);
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
        } catch (err) {
          console.error('문법 분석 실패:', err);
          setAiPatterns({ patterns: [] });
        } finally {
          setGrammarLoading(false);
        }
        return; // 문장은 여기서 종료
      }
    } catch (err) {
      console.error('분석 실패:', err);
      setAnalysisResult({ type: 'word', content: '분석 실패 (다시 시도해주세요)' });
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
