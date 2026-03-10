import { useState, useEffect } from 'react';
import { useTapToClose } from '../hooks/useTapToClose';
import { speakText } from '../utils/tts';
import { useTranslation } from '../i18n';

export default function GrammarDiagram({
  grammarData,
  aiPatterns,
  loading,
  ocrWordPositions, // OCR로 추출한 단어 위치
  zoomScale = 1, // 현재 줌 스케일
  onClose,
  onSave,  // 저장 콜백
}) {
  const { ko } = useTranslation();
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

  // 탭으로 닫기 핸들러
  const { handleTouchStart, handleTouchEnd, handleClick } = useTapToClose(onClose);

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
    } catch {
      // ignore
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
    <div
      className="grammar-diagram-overlay"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
    >
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
                title={ko('grammar.listenAgain')}
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
                    <span className="pattern-color-dot" style={{ background: pattern.color }} />
                    <div className="pattern-content">
                      <span className="pattern-type" style={{ color: pattern.color }}>
                        {pattern.typeKr || pattern.type}
                      </span>
                      {pattern.explanation && (
                        <p className="pattern-explanation">
                          {pattern.explanation}
                        </p>
                      )}
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
                  {saving ? ko('grammar.saving') : `${ko('grammar.saveCount')} (${selectedPatterns.size})`}
                </button>
              )}
            </div>
          )}

          {/* Loading state for AI analysis */}
          {loading && (
            <div className="grammar-loading">
              <div className="loading-spinner"></div>
              <span>{ko('grammar.analyzing')}</span>
            </div>
          )}

          {/* No patterns message */}
          {patterns.length === 0 && !loading && (
            <div className="grammar-no-connections">
              {ko('grammar.noPatterns')}
              <br />
              <small>{ko('grammar.noPatternsSub')}</small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
