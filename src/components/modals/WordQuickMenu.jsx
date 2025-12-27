import { useState, useEffect, useCallback, useRef } from 'react';
import { speakText, stopSpeaking as stopTTS } from '../../utils/tts';
import { cleanDisplayText } from '../../utils/textUtils';
import { calculateModalPosition, getArrowClass, getMobileSafeAreaBottom } from '../../utils/positioning';
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
  containerRef,
  zoomScale,
  panOffset,
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
  const [dynamicPosition, setDynamicPosition] = useState(null);
  const [positionReady, setPositionReady] = useState(false); // 위치 계산 완료 전까지 숨김
  const rafRef = useRef(null);
  const modalRef = useRef(null);
  const touchStartRef = useRef({ time: 0, x: 0, y: 0 });

  // 모달 상태 리셋 함수
  const resetModalState = useCallback(() => {
    setDefinition('');
    setGrammarData(null);
    setCheckedPatterns([]);
    setLoading(false);
    setSpeaking(false);
    setError('');
    setPositionReady(false);
  }, []);

  // 위치 업데이트 함수 (wordBbox % 기반으로 뷰포트 좌표 계산)
  const updatePosition = useCallback(() => {
    if (!wordBbox || !containerRef?.current) {
      setDynamicPosition(null);
      // wordBbox 없으면 초기 position 사용 → 바로 ready
      if (position) {
        setPositionReady(true);
      }
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();

    // bbox는 %로 저장됨 (0-100)
    const centerX = wordBbox.x + wordBbox.width / 2;
    const bottomY = wordBbox.y + wordBbox.height;
    const topY = wordBbox.y;

    const newX = containerRect.left + (centerX * containerRect.width / 100);
    const newY = placement === 'below'
      ? containerRect.top + (bottomY * containerRect.height / 100) + 12
      : containerRect.top + (topY * containerRect.height / 100) - 12;

    setDynamicPosition({ x: newX, y: newY });
    setPositionReady(true);
  }, [wordBbox, containerRef, placement, position]);

  // zoomScale/panOffset 변경 시 위치 재계산
  useEffect(() => {
    if (!isOpen) return;
    // wordBbox가 있으면 동적 위치 계산
    if (wordBbox && containerRef?.current) {
      updatePosition();
    } else if (position) {
      // wordBbox 없고 초기 position만 있으면 바로 ready
      setPositionReady(true);
    }
  }, [isOpen, wordBbox, containerRef, updatePosition, zoomScale, panOffset, position]);

  // 스크롤/리사이즈 시 위치 업데이트
  useEffect(() => {
    if (!isOpen || !wordBbox || !containerRef?.current) return;

    const handleUpdate = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePosition);
    };

    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);

    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, wordBbox, containerRef, updatePosition]);

  // 외부 클릭/탭 감지 (overlay 없이 document 레벨에서)
  useEffect(() => {
    if (!isOpen) return;

    const handleTouchStart = (e) => {
      touchStartRef.current = {
        time: Date.now(),
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    };

    const handleTouchEnd = (e) => {
      // 모달 내부 터치면 무시
      if (modalRef.current?.contains(e.target)) return;

      const { time, x, y } = touchStartRef.current;
      const duration = Date.now() - time;
      const dx = Math.abs(e.changedTouches[0].clientX - x);
      const dy = Math.abs(e.changedTouches[0].clientY - y);
      const distance = Math.sqrt(dx * dx + dy * dy);

      // < 200ms + < 10px = 탭 (스크롤/줌 아님)
      if (duration < 200 && distance < 10) {
        onClose();
      }
    };

    const handleClick = (e) => {
      // 모달 내부 클릭이면 무시
      if (modalRef.current?.contains(e.target)) return;
      onClose();
    };

    // 충분한 딜레이 후 리스너 등록 (synthetic click 이벤트 회피)
    const timeoutId = setTimeout(() => {
      document.addEventListener('touchstart', handleTouchStart, { passive: true });
      document.addEventListener('touchend', handleTouchEnd, { passive: true });
      document.addEventListener('click', handleClick); // mousedown 대신 click 사용
    }, 350); // 300ms double-tap delay + 50ms 버퍼

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('click', handleClick);
    };
  }, [isOpen, onClose]);

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

  // 위치 계산 (dynamicPosition 우선, 없으면 초기 position 사용)
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safeAreaBottom = getMobileSafeAreaBottom();
  const menuWidth = isGrammarMode ? Math.min(340, vw - 24) : Math.min(300, vw - 24);
  const effectivePosition = dynamicPosition || position;

  const { left, top, transform, arrowLeft } = calculateModalPosition({
    position: effectivePosition,
    menuWidth,
    margin: 12,
    placement,
  });

  // 모바일에서 하단 주소창을 고려한 최대 높이 계산
  const maxHeight = Math.min(vh * 0.6, vh - safeAreaBottom - 100);

  const menuStyle = {
    position: 'fixed',
    left,
    top,
    transform,
    zIndex: 1000,
    width: menuWidth,
    maxHeight,
    '--arrow-left': `${arrowLeft}%`,
    opacity: positionReady ? 1 : 0,
    visibility: positionReady ? 'visible' : 'hidden',
  };

  const arrowClass = getArrowClass(placement);

  // Existing vocabulary annotation view
  if (existingAnnotation && !isGrammarMode) {
    return (
      <div ref={modalRef} className={`word-quick-menu existing ${arrowClass}`} style={menuStyle}>
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
            Delete
          </button>
          <button className="close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  // Existing grammar annotation view
  if (existingAnnotation && isGrammarMode && grammarData) {
    return (
      <div ref={modalRef} className={`word-quick-menu grammar existing ${arrowClass}`} style={menuStyle}>
        <div className="grammar-patterns">
          {grammarData.patterns?.map((pattern, i) => (
            <div key={i} className="pattern-item">
              <div className="pattern-content">
                <span className="pattern-words">{pattern.words?.join(' ')}</span>
                <span className="pattern-explanation">{pattern.explanation}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="word-menu-actions">
          <button className="delete-btn" onClick={onDeleted} disabled={loading}>
            Delete
          </button>
          <button className="close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  // Grammar mode - analysis view
  if (isGrammarMode) {
    const hasPatterns = grammarData?.patterns?.length > 0;
    return (
      <div ref={modalRef} className={`word-quick-menu grammar ${arrowClass}`} style={menuStyle}>
        {loading ? (
          <div className="loading-state">분석 중...</div>
        ) : grammarData ? (
          <>
            {hasPatterns ? (
              <div className="grammar-patterns">
                {grammarData.patterns.map((pattern, i) => (
                  <label key={i} className="pattern-checkbox">
                    <input
                      type="checkbox"
                      checked={checkedPatterns.includes(i)}
                      onChange={() => togglePattern(i)}
                    />
                    <div className="pattern-content">
                      <span className="pattern-words">{pattern.words?.join(' ')}</span>
                      <span className="pattern-explanation">{pattern.explanation}</span>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <div className="empty-state">분석된 표현이 없습니다</div>
            )}
            <div className="word-menu-actions">
              <button
                className="save-btn"
                onClick={handleSaveGrammar}
                disabled={!hasPatterns || checkedPatterns.length === 0 || loading}
              >
                Save
              </button>
              <button className="close-btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <div className="modal-error-state">{error || '분석 실패'}</div>
        )}
      </div>
    );
  }

  // New word - quick save menu
  return (
    <div ref={modalRef} className={`word-quick-menu ${arrowClass}`} style={menuStyle}>
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
              Save
            </button>
            <button className="close-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}
