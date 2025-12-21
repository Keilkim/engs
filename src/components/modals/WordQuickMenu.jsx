import { useState, useEffect } from 'react';
import { lookupWord, analyzeGrammarPatterns } from '../../services/ai';
import { createAnnotation } from '../../services/annotation';

export default function WordQuickMenu({
  isOpen,
  position,
  placement = 'below', // 'below' or 'above' - 마킹 기준 위치
  word,
  wordBbox,
  sentenceWords, // 문장의 개별 단어들 (줄별 렌더링용)
  sourceId,
  currentPage,
  existingAnnotation,
  isGrammarMode,
  containerBounds, // screenshot-main의 bounds
  zoomScale = 1, // 현재 줌 스케일
  onClose,
  onSaved,
  onDeleted,
}) {
  const [loading, setLoading] = useState(false);
  const [definition, setDefinition] = useState('');
  const [grammarData, setGrammarData] = useState(null);
  const [checkedPatterns, setCheckedPatterns] = useState([]);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setDefinition('');
      setGrammarData(null);
      setCheckedPatterns([]);
      setLoading(false);
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
        // ignore
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
  }, [isOpen, word, existingAnnotation, isGrammarMode]);

  // Look up word definition (preview, not save)
  async function handleLookupDefinition() {
    if (!word) return;
    setLoading(true);
    try {
      const result = await lookupWord(word);
      setDefinition(result.definition || result || '');
    } catch (err) {
      console.error('Failed to lookup word:', err);
      setDefinition('');
    } finally {
      setLoading(false);
    }
  }

  // TTS speak function - 자연스러운 원어민 발음
  function speak(text) {
    if (!text || speaking) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
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

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }

  // Stop speaking
  function stopSpeaking() {
    window.speechSynthesis.cancel();
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
      createAnnotation(annotationData).catch(err => {
        console.error('Failed to save vocabulary:', err);
      });
    } catch (err) {
      console.error('Failed to save vocabulary:', err);
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
    } catch (err) {
      console.error('Grammar analysis failed:', err);
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
      createAnnotation(annotationData).catch(err => {
        console.error('Failed to save grammar:', err);
      });
    } catch (err) {
      console.error('Failed to save grammar:', err);
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  // Clamp position to container bounds (screenshot-main) or viewport
  // 줌 스케일에 따라 동적으로 메뉴 크기 계산 (줌인하면 모달도 커짐)
  const vw = typeof window !== 'undefined' ? window.innerWidth : 375;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 667;
  const scaleFactor = Math.max(1, zoomScale * 0.8); // 줌에 따라 크기 증가 (80% 비율)
  const baseMenuWidth = isGrammarMode
    ? Math.min(Math.max(280, vw * 0.92), 420)
    : Math.min(Math.max(200, vw * 0.88), 340);
  const menuWidth = Math.min(baseMenuWidth * scaleFactor, vw * 0.94);
  const menuHeight = Math.min(vh * 0.75 * scaleFactor, vh * 0.85);
  const MARGIN = 12; // 최소 여백

  // 컨테이너 bounds 또는 viewport 사용
  const bounds = containerBounds || {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };

  // 위치 계산 - 메뉴를 선택된 텍스트의 가로 중앙에 배치
  const halfWidth = menuWidth / 2;
  let left = position.x - halfWidth; // 중앙 정렬
  let top = position.y;

  // 좌우 경계 체크 (containerBounds 기준)
  if (left < bounds.left + MARGIN) {
    left = bounds.left + MARGIN;
  }
  if (left + menuWidth > bounds.right - MARGIN) {
    left = bounds.right - menuWidth - MARGIN;
  }

  // 상하 경계 체크 (containerBounds 기준)
  if (top < bounds.top + MARGIN) {
    top = bounds.top + MARGIN;
  }
  if (top + menuHeight > bounds.bottom - MARGIN) {
    top = bounds.bottom - menuHeight - MARGIN;
  }

  const menuStyle = {
    position: 'fixed',
    left,
    top,
    zIndex: 1000,
    width: menuWidth,
    maxHeight: menuHeight,
    transform: `scale(${scaleFactor})`,
    transformOrigin: placement === 'above' ? 'bottom center' : 'top center',
  };

  // 화살표 방향에 따른 클래스
  const arrowClass = placement === 'above' ? 'arrow-below' : 'arrow-above';

  // Existing vocabulary annotation view
  if (existingAnnotation && !isGrammarMode) {
    return (
      <>
        <div className="word-menu-overlay" />
        <div className={`word-quick-menu existing ${arrowClass}`} style={menuStyle}>
          <div className="word-menu-header">
            <span className="word-text">{existingAnnotation.selected_text}</span>
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
        <div className="word-menu-overlay" />
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
        <div className="word-menu-overlay" />
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
            <div className="error-state">분석 실패</div>
          )}
        </div>
      </>
    );
  }

  // New word - quick save menu
  return (
    <>
      <div className="word-menu-overlay" />
      <div className={`word-quick-menu ${arrowClass}`} style={menuStyle}>
        <div className="word-menu-header">
          <span className="word-text">{word}</span>
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
