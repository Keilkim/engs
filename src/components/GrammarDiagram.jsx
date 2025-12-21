import { useState, useEffect } from 'react';

// TTS 함수 - 자연스러운 원어민 영어 발음
function speakText(text) {
  if (!text || !window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95; // 문장은 살짝만 느리게
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // 고품질 영어 음성 선택
  const voices = window.speechSynthesis.getVoices();
  const preferredVoices = [
    'Samantha', 'Karen', 'Daniel', 'Moira',
    'Google US English', 'Google UK English Female',
    'Microsoft Zira', 'Microsoft David',
  ];

  let selectedVoice = null;
  for (const name of preferredVoices) {
    selectedVoice = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
    if (selectedVoice) break;
  }

  if (!selectedVoice) {
    selectedVoice = voices.find(v => v.lang.startsWith('en-US')) ||
                    voices.find(v => v.lang.startsWith('en'));
  }

  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  window.speechSynthesis.speak(utterance);
}

export default function GrammarDiagram({
  grammarData,
  aiPatterns,
  loading,
  ocrWordPositions, // OCR로 추출한 단어 위치
  zoomScale = 1, // 현재 줌 스케일
  onClose,
  onSave,  // 저장 콜백
}) {
  const patterns = aiPatterns?.patterns || [];
  const originalText = grammarData?.originalText || grammarData?.words?.map(w => w.text).join(' ') || '';

  // OCR 단어 위치에서 특정 단어 찾기
  function findKeywordPosition(keyword) {
    if (!ocrWordPositions?.words) return null;

    const keywordLower = keyword.toLowerCase();
    const found = ocrWordPositions.words.find((w) =>
      w.text.toLowerCase() === keywordLower ||
      w.text.toLowerCase().includes(keywordLower) ||
      keywordLower.includes(w.text.toLowerCase())
    );

    return found ? found.bbox : null;
  }

  // 패턴의 모든 키워드 위치 찾기
  function findPatternKeywordPositions(pattern) {
    if (!pattern.keywords || !ocrWordPositions?.words) return [];

    return pattern.keywords.map((kw) => {
      const bbox = findKeywordPosition(kw.word);
      return {
        word: kw.word,
        index: kw.index,
        bbox: bbox || null, // null이면 위치 못찾음
      };
    }).filter(kw => kw.bbox !== null);
  }

  // 선택된 패턴 인덱스
  const [selectedPatterns, setSelectedPatterns] = useState(new Set());
  const [saving, setSaving] = useState(false);

  // 모달 열릴 때 자동으로 읽기
  useEffect(() => {
    if (originalText && !loading) {
      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => speakText(originalText);
      } else {
        speakText(originalText);
      }
    }
  }, [originalText, loading]);

  function togglePattern(idx) {
    setSelectedPatterns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(idx)) {
        newSet.delete(idx);
      } else {
        newSet.add(idx);
      }
      return newSet;
    });
  }

  async function handleSave() {
    if (selectedPatterns.size === 0 || !onSave) return;

    setSaving(true);
    try {
      // 선택된 패턴만 추출하고 OCR 단어 위치 추가
      const selected = patterns
        .filter((_, idx) => selectedPatterns.has(idx))
        .map((pattern) => {
          // 각 패턴의 키워드에 OCR 위치 추가
          const keywordPositions = findPatternKeywordPositions(pattern);
          return {
            ...pattern,
            keywordPositions, // OCR 기반 정확한 위치
          };
        });

      await onSave({
        patterns: selected,
        originalText,
        wordPositions: ocrWordPositions?.words || [], // 전체 OCR 결과도 저장
      });
      onClose();
    } catch (err) {
      console.error('Failed to save patterns:', err);
    } finally {
      setSaving(false);
    }
  }

  // 줌 스케일에 따라 동적으로 모달 크기 계산
  const vw = typeof window !== 'undefined' ? window.innerWidth : 375;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 667;
  const scaleFactor = Math.max(1, zoomScale * 0.8);
  const modalWidth = Math.min(Math.max(300, vw * 0.92) * scaleFactor, vw * 0.94);
  const modalMaxHeight = Math.min(vh * 0.85 * scaleFactor, vh * 0.9);

  return (
    <div className="grammar-diagram-overlay">
      <div
        className="grammar-diagram-modal"
        style={{ width: modalWidth, maxHeight: modalMaxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grammar-diagram-header">
          <h3>Grammar Analysis</h3>
          <button className="grammar-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="grammar-diagram-content">
          {/* 원문 표시 */}
          {originalText && (
            <div className="grammar-original-text">
              <span>"{originalText}"</span>
              <button
                className="speak-btn"
                onClick={() => speakText(originalText)}
                title="다시 듣기"
              >
                🔊
              </button>
            </div>
          )}

          {/* AI Pattern explanations */}
          {patterns.length > 0 && (
            <div className="grammar-patterns-section">
              <div className="grammar-patterns-list">
                {patterns.map((pattern, idx) => (
                  <div
                    key={idx}
                    className={`grammar-pattern-item ${selectedPatterns.has(idx) ? 'selected' : ''}`}
                    onClick={() => togglePattern(idx)}
                  >
                    <input
                      type="checkbox"
                      className="pattern-checkbox"
                      checked={selectedPatterns.has(idx)}
                      onChange={() => togglePattern(idx)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="pattern-content">
                      <div className="pattern-header">
                        <span
                          className="pattern-type"
                          style={{ color: pattern.color }}
                        >
                          {pattern.typeKr || pattern.type}
                        </span>
                        <span className="pattern-words">
                          {pattern.words?.join(' ') || ''}
                        </span>
                      </div>
                      <div className="pattern-explanation">
                        {pattern.explanation}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* 저장 버튼 */}
              {onSave && (
                <button
                  className="grammar-save-btn"
                  onClick={handleSave}
                  disabled={selectedPatterns.size === 0 || saving}
                >
                  {saving ? '저장 중...' : `저장하기 (${selectedPatterns.size})`}
                </button>
              )}
            </div>
          )}

          {/* Loading state for AI analysis */}
          {loading && (
            <div className="grammar-loading">
              <div className="loading-spinner"></div>
              <span>문법 분석 중...</span>
            </div>
          )}

          {/* No patterns message */}
          {patterns.length === 0 && !loading && (
            <div className="grammar-no-connections">
              이 텍스트에서 학습할 문법 패턴을 찾지 못했습니다.
              <br />
              <small>문장 형태의 텍스트를 선택해보세요.</small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
