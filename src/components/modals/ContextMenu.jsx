import { useState, useEffect, useRef } from 'react';
import { analyzeText, analyzeGrammarPatterns } from '../../services/ai';
import { createAnnotation, createVocabularyItem } from '../../services/annotation';
import GrammarDiagram from '../GrammarDiagram';

// TTS 함수 - 자연스러운 원어민 영어 발음
function speakText(text) {
  if (!text || !window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 1.0; // 자연스러운 속도
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // 고품질 영어 음성 선택 (우선순위: Premium > Enhanced > 기본)
  const voices = window.speechSynthesis.getVoices();
  const preferredVoices = [
    'Samantha', 'Karen', 'Daniel', 'Moira', // macOS 고품질
    'Google US English', 'Google UK English Female', // Chrome
    'Microsoft Zira', 'Microsoft David', // Windows
  ];

  let selectedVoice = null;
  for (const name of preferredVoices) {
    selectedVoice = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
    if (selectedVoice) break;
  }

  // 폴백: 아무 영어 음성
  if (!selectedVoice) {
    selectedVoice = voices.find(v => v.lang.startsWith('en-US')) ||
                    voices.find(v => v.lang.startsWith('en'));
  }

  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  window.speechSynthesis.speak(utterance);
}

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
  const menuRef = useRef(null);

  // Get text from selectedWords (OCR-based) or fallback to selectedText
  const hasOcrWords = selectedWords && selectedWords.length > 0;
  const displayText = hasOcrWords
    ? selectedWords.map(w => w.text).join(' ')
    : selectedText;

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
    setWordSaved(false);
    setSavingWord(false);
  }, [selectedText, selectionRect, selectedWords]);

  // 메뉴 열릴 때 자동 분석 시작
  useEffect(() => {
    if (!isOpen || !displayText) return;
    if (loading || analysisResult || grammarData) return;

    runAnalysis(displayText);
  }, [isOpen, displayText]);

  // 화면 경계 내에서 메뉴 위치 계산
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const padding = 16; // 화면 가장자리 여백

    let x = position.x;
    let y = position.y;

    // 오른쪽 경계 체크
    const rightEdge = x + rect.width / 2;
    if (rightEdge > window.innerWidth - padding) {
      x = window.innerWidth - padding - rect.width / 2;
    }

    // 왼쪽 경계 체크
    const leftEdge = x - rect.width / 2;
    if (leftEdge < padding) {
      x = padding + rect.width / 2;
    }

    // 아래쪽 경계 체크
    if (y + rect.height > window.innerHeight - padding) {
      y = window.innerHeight - padding - rect.height;
    }

    // 위쪽 경계 체크
    if (y < padding) {
      y = padding;
    }

    setMenuPosition({ x, y });
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
        sourceId,
        selectionRect // 위치 정보도 함께 저장
      );
      setWordSaved(true);
      onAnnotationCreated?.();
      handleClose(); // 저장 후 메뉴 닫기
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
    setWordSaved(false);
    setSavingWord(false);
    onClose();
  }

  // 줌 스케일에 따라 동적으로 메뉴 크기 계산
  const vw = typeof window !== 'undefined' ? window.innerWidth : 375;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 667;
  const scaleFactor = Math.max(1, zoomScale * 0.8);
  const menuWidth = Math.min(Math.max(220, vw * 0.88) * scaleFactor, vw * 0.94);
  const menuMaxHeight = Math.min(vh * 0.7 * scaleFactor, vh * 0.85);

  return (
    <div className="context-menu-overlay">
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
              <span className="selected-word">{displayText}</span>
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
