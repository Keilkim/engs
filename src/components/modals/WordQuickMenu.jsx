import { useState, useEffect, useCallback } from 'react';
import { useTapToClose } from '../../hooks/useTapToClose';
import { speakText, stopSpeaking as stopTTS } from '../../utils/tts';
import { cleanDisplayText } from '../../utils/textUtils';
import { calculateModalPosition, getArrowClass } from '../../utils/positioning';
import { lookupWord, analyzeGrammarPatterns } from '../../services/ai';
import { createAnnotation } from '../../services/annotation';

export default function WordQuickMenu({
  isOpen,
  position,
  placement = 'below',
  word,
  wordBbox,
  sentenceWords,
  sourceId,
  currentPage,
  existingAnnotation,
  isGrammarMode,
  onClose,
  onSaved,
  onDeleted,
}) {
  const [loading, setLoading] = useState(false);
  const [definition, setDefinition] = useState('');
  const [grammarData, setGrammarData] = useState(null);
  const [checkedPatterns, setCheckedPatterns] = useState([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');

  // 모달 상태 리셋 함수
  const resetModalState = useCallback(() => {
    setDefinition('');
    setGrammarData(null);
    setCheckedPatterns([]);
    setLoading(false);
    setSpeaking(false);
    setError('');
  }, []);

  // 탭 감지용 훅 (줌/이동과 구분)
  const { handleTouchStart: handleOverlayTouchStart, handleTouchEnd: handleOverlayTouchEnd, handleClick: handleOverlayClick } = useTapToClose(onClose);

  useEffect(() => {
    if (!isOpen) {
      resetModalState();
      return;
    }

    // If existing annotation, load its data
    if (existingAnnotation) {
      try {
        const data = JSON.parse(existingAnnotation.ai_analysis_json || '{}');
        if (data.type === 'grammar') {
          setGrammarData(data);
        } else {
          setDefinition(data.definition || '');
        }
      } catch {
        setError('주석 데이터 로드 실패');
      }
      return;
    }

    // Grammar mode: auto-analyze
    if (isGrammarMode && word) {
      handleGrammarAnalysis();
    } else if (!isGrammarMode && word) {
      // Vocabulary mode: auto-lookup definition
      handleLookupDefinition();
    }
  }, [isOpen, word, existingAnnotation, isGrammarMode, resetModalState]);

  // Look up word definition (preview, not save)
  async function handleLookupDefinition() {
    if (!word) return;
    setLoading(true);
    try {
      const result = await lookupWord(word);
      setDefinition(result.definition || result || '');
    } catch {
      setError('단어 검색 실패');
      setDefinition('');
    } finally {
      setLoading(false);
    }
  }

  // TTS speak function using shared utility
  function speak(text) {
    if (!text || speaking) return;
    speakText(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }

  // Stop speaking
  function stopSpeaking() {
    stopTTS();
    setSpeaking(false);
  }

  // Look up word and save
  async function handleSaveVocabulary() {
    if (!word || !wordBbox || loading) return;
    setLoading(true);

    try {
      // Look up word definition
      const result = await lookupWord(word);

      // Create annotation with bbox coordinates
      const selectionRect = JSON.stringify({
        bounds: wordBbox,
        page: currentPage,
      });

      const annotationData = {
        source_id: sourceId,
        type: 'highlight',
        selected_text: word,
        selection_rect: selectionRect,
        ai_analysis_json: JSON.stringify({
          isVocabulary: true,
          word,
          definition: result.definition || result,
          phonetic: result.phonetic || '',
        }),
      };

      // 낙관적 업데이트: 메뉴 즉시 닫고, 임시 어노테이션으로 바로 표시
      const tempAnnotation = {
        ...annotationData,
        id: `temp-${Date.now()}`,
        created_at: new Date().toISOString(),
      };
      onSaved?.(tempAnnotation);
      onClose(true); // force close

      // 백그라운드에서 실제 저장
      createAnnotation(annotationData).catch(() => {});
    } catch {
      setLoading(false);
    }
  }

  // Grammar analysis (AI-based patterns)
  async function handleGrammarAnalysis() {
    if (!word || loading) return;
    setLoading(true);

    try {
      const result = await analyzeGrammarPatterns(word);
      // Add translation field for display
      setGrammarData({
        originalText: word,
        translation: result.translation || '',
        patterns: result.patterns || [],
      });
      // Auto-check all patterns initially
      setCheckedPatterns(result.patterns?.map((_, i) => i) || []);
    } catch {
      setError('문법 분석 실패');
      setGrammarData({ originalText: word, translation: '', patterns: [] });
    } finally {
      setLoading(false);
    }
  }

  // Toggle pattern check
  function togglePattern(index) {
    setCheckedPatterns(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  }

  // Save checked grammar patterns
  async function handleSaveGrammar() {
    if (!grammarData || checkedPatterns.length === 0 || loading) return;
    setLoading(true);

    try {
      const selectedPatterns = checkedPatterns.map(i => grammarData.patterns[i]);

      // 문장의 개별 단어들을 줄별로 그룹화
      const lineGroups = [];
      if (sentenceWords && sentenceWords.length > 0) {
        // Y 좌표로 정렬
        const sorted = [...sentenceWords].sort((a, b) => {
          const yDiff = a.bbox.y - b.bbox.y;
          const avgHeight = (a.bbox.height + b.bbox.height) / 2;
          if (Math.abs(yDiff) > avgHeight * 0.5) return yDiff;
          return a.bbox.x - b.bbox.x;
        });

        let currentLine = [];
        let lastY = null;
        let lastHeight = null;

        for (const w of sorted) {
          const lineGap = lastY !== null ? Math.abs(w.bbox.y - lastY) : 0;
          const avgHeight = lastHeight !== null ? (w.bbox.height + lastHeight) / 2 : w.bbox.height;

          if (lastY === null || lineGap <= avgHeight * 0.5) {
            currentLine.push(w);
          } else {
            if (currentLine.length > 0) {
              // 줄의 bbox 계산
              const minX = Math.min(...currentLine.map(w => w.bbox.x));
              const maxX = Math.max(...currentLine.map(w => w.bbox.x + w.bbox.width));
              const minY = Math.min(...currentLine.map(w => w.bbox.y));
              const maxY = Math.max(...currentLine.map(w => w.bbox.y + w.bbox.height));
              lineGroups.push({
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
              });
            }
            currentLine = [w];
          }
          lastY = w.bbox.y;
          lastHeight = w.bbox.height;
        }

        // 마지막 줄 추가
        if (currentLine.length > 0) {
          const minX = Math.min(...currentLine.map(w => w.bbox.x));
          const maxX = Math.max(...currentLine.map(w => w.bbox.x + w.bbox.width));
          const minY = Math.min(...currentLine.map(w => w.bbox.y));
          const maxY = Math.max(...currentLine.map(w => w.bbox.y + w.bbox.height));
          lineGroups.push({
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
          });
        }
      }

      const selectionRect = JSON.stringify({
        bounds: wordBbox,
        lines: lineGroups.length > 0 ? lineGroups : null, // 줄별 bbox 저장
        page: currentPage,
      });

      const annotationData = {
        source_id: sourceId,
        type: 'highlight',
        selected_text: word,
        selection_rect: selectionRect,
        ai_analysis_json: JSON.stringify({
          type: 'grammar',
          originalText: word,
          translation: grammarData.translation,
          patterns: selectedPatterns,
        }),
      };

      // 낙관적 업데이트: 메뉴 즉시 닫고, 임시 어노테이션으로 바로 표시
      const tempAnnotation = {
        ...annotationData,
        id: `temp-${Date.now()}`,
        created_at: new Date().toISOString(),
      };
      onSaved?.(tempAnnotation);
      onClose(true); // force close

      // 백그라운드에서 실제 저장
      createAnnotation(annotationData).catch(() => {});
    } catch {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  // 위치 계산
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuWidth = isGrammarMode ? Math.min(340, vw - 24) : Math.min(300, vw - 24);

  const { left, top, transform, arrowLeft } = calculateModalPosition({
    position,
    menuWidth,
    margin: 12,
    placement,
  });

  const menuStyle = {
    position: 'fixed',
    left,
    top,
    transform,
    zIndex: 1000,
    width: menuWidth,
    maxHeight: vh * 0.6,
    '--arrow-left': `${arrowLeft}%`,
  };

  const arrowClass = getArrowClass(placement);

  // Overlay 컴포넌트 (탭으로 닫기)
  const Overlay = () => (
    <div
      className="word-menu-overlay"
      onTouchStart={handleOverlayTouchStart}
      onTouchEnd={handleOverlayTouchEnd}
      onClick={handleOverlayClick}
    />
  );

  // Existing vocabulary annotation view
  if (existingAnnotation && !isGrammarMode) {
    return (
      <>
        <Overlay />
        <div className={`word-quick-menu existing ${arrowClass}`} style={menuStyle}>
          {error && <div className="modal-error">{error}</div>}
          <div className="word-menu-header">
            <span className="word-text">{cleanDisplayText(existingAnnotation.selected_text)}</span>
            <button
              className={`listen-btn ${speaking ? 'speaking' : ''}`}
              onClick={() => speaking ? stopSpeaking() : speak(existingAnnotation.selected_text)}
            >
              {speaking ? '■' : '🔊'}
            </button>
          </div>
          <div className="word-definition">
            {definition || 'No definition'}
          </div>
          <div className="word-menu-actions">
            <button className="delete-btn" onClick={onDeleted} disabled={loading}>
              삭제
            </button>
            <button className="close-btn" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      </>
    );
  }

  // Existing grammar annotation view
  if (existingAnnotation && isGrammarMode && grammarData) {
    return (
      <>
        <Overlay />
        <div className={`word-quick-menu grammar existing ${arrowClass}`} style={menuStyle}>
          <div className="word-menu-header">
            <span className="sentence-text">{grammarData.originalText}</span>
            <button
              className={`listen-btn ${speaking ? 'speaking' : ''}`}
              onClick={() => speaking ? stopSpeaking() : speak(grammarData.originalText)}
            >
              {speaking ? '■' : '🔊'}
            </button>
          </div>
          <div className="grammar-translation">
            {grammarData.translation}
          </div>
          <div className="grammar-patterns">
            {grammarData.patterns?.map((pattern, i) => (
              <div key={i} className="pattern-item saved">
                <span className="pattern-color" style={{ background: pattern.color }} />
                <span className="pattern-name">{pattern.typeKr || pattern.type}</span>
              </div>
            ))}
          </div>
          <div className="word-menu-actions">
            <button className="delete-btn" onClick={onDeleted} disabled={loading}>
              삭제
            </button>
            <button className="close-btn" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      </>
    );
  }

  // Grammar mode - analysis view
  if (isGrammarMode) {
    return (
      <>
        <Overlay />
        <div className={`word-quick-menu grammar ${arrowClass}`} style={menuStyle}>
          {loading ? (
            <div className="loading-state">분석 중...</div>
          ) : grammarData ? (
            <>
              <div className="grammar-patterns">
                {grammarData.patterns?.map((pattern, i) => (
                  <label key={i} className="pattern-checkbox">
                    <input
                      type="checkbox"
                      checked={checkedPatterns.includes(i)}
                      onChange={() => togglePattern(i)}
                    />
                    <span className="pattern-color" style={{ background: pattern.color }} />
                    <span className="pattern-name">{pattern.typeKr || pattern.type}</span>
                  </label>
                ))}
              </div>
              <div className="word-menu-actions">
                <button
                  className="save-btn"
                  onClick={handleSaveGrammar}
                  disabled={checkedPatterns.length === 0 || loading}
                >
                  저장
                </button>
                <button className="close-btn" onClick={onClose}>
                  닫기
                </button>
              </div>
            </>
          ) : (
            <div className="modal-error-state">{error || '분석 실패'}</div>
          )}
        </div>
      </>
    );
  }

  // New word - quick save menu
  return (
    <>
      <Overlay />
      <div className={`word-quick-menu ${arrowClass}`} style={menuStyle}>
        <div className="word-menu-header">
          <span className="word-text">{cleanDisplayText(word)}</span>
          <button
            className={`listen-btn ${speaking ? 'speaking' : ''}`}
            onClick={() => speaking ? stopSpeaking() : speak(word)}
          >
            {speaking ? '■' : '🔊'}
          </button>
        </div>
        {loading ? (
          <div className="loading-state">조회 중...</div>
        ) : (
          <>
            {definition && <div className="word-definition">{definition}</div>}
            <div className="word-menu-actions">
              <button
                className="save-btn"
                onClick={handleSaveVocabulary}
              >
                단어 저장
              </button>
              <button className="close-btn" onClick={onClose}>
                취소
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
