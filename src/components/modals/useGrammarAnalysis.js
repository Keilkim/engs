import { useState, useCallback, useRef } from 'react';
import { analyzeGrammarPatterns } from '../../services/ai';
import { createAnnotation } from '../../services/annotation';
import { logError } from '../../utils/errors';

// Build line groups from sentenceWords for selection_rect storage
function buildLineGroups(sentenceWords) {
  if (!sentenceWords || sentenceWords.length === 0) return [];

  const sorted = [...sentenceWords].sort((a, b) => {
    const yDiff = a.bbox.y - b.bbox.y;
    const avgHeight = (a.bbox.height + b.bbox.height) / 2;
    if (Math.abs(yDiff) > avgHeight * 0.5) return yDiff;
    return a.bbox.x - b.bbox.x;
  });

  const lineGroups = [];
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
        const minX = Math.min(...currentLine.map(w => w.bbox.x));
        const maxX = Math.max(...currentLine.map(w => w.bbox.x + w.bbox.width));
        const minY = Math.min(...currentLine.map(w => w.bbox.y));
        const maxY = Math.max(...currentLine.map(w => w.bbox.y + w.bbox.height));
        lineGroups.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
      }
      currentLine = [w];
    }
    lastY = w.bbox.y;
    lastHeight = w.bbox.height;
  }

  if (currentLine.length > 0) {
    const minX = Math.min(...currentLine.map(w => w.bbox.x));
    const maxX = Math.max(...currentLine.map(w => w.bbox.x + w.bbox.width));
    const minY = Math.min(...currentLine.map(w => w.bbox.y));
    const maxY = Math.max(...currentLine.map(w => w.bbox.y + w.bbox.height));
    lineGroups.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  }

  return lineGroups;
}

/**
 * Hook for grammar pattern analysis, selection, and save logic
 */
export function useGrammarAnalysis({ word, wordBbox, sentenceWords, sourceId, currentPage, onSaved, onClose, sourceType, segmentIndex, wordIndex, timestamp }) {
  const isYouTube = sourceType === 'youtube';
  const [grammarData, setGrammarData] = useState(null);
  const [checkedPatterns, setCheckedPatterns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Monotonic token for in-flight analyses. Every reset() or new handleAnalyze()
  // bumps it; a resolved analysis only writes state if its token is still current.
  // Without this, cancelling mid-analysis and immediately re-long-pressing the
  // same sentence let the FIRST (stale) Gemini response arrive after re-open and
  // flash the old result before the new one — the "결과가 2번 뜬다" bug.
  const analyzeSeqRef = useRef(0);

  const reset = useCallback(() => {
    analyzeSeqRef.current += 1; // invalidate any in-flight analysis
    setGrammarData(null);
    setCheckedPatterns([]);
    setLoading(false);
    setError('');
  }, []);

  const loadExisting = useCallback((data) => {
    setGrammarData(data);
  }, []);

  async function handleAnalyze() {
    if (!word) return;
    const seq = ++analyzeSeqRef.current; // supersedes any earlier in-flight analysis
    setError('');
    setGrammarData(null); // clear stale data so nothing old flashes while loading
    setLoading(true);

    try {
      const result = await analyzeGrammarPatterns(word);
      if (seq !== analyzeSeqRef.current) return; // superseded (closed/re-opened) → discard
      setGrammarData({
        originalText: word,
        translation: result.translation || '',
        patterns: result.patterns || [],
        degraded: result.degraded || false,
        reason: result.reason || '',
      });
      setCheckedPatterns(result.patterns?.map((_, i) => i) || []);
    } catch {
      if (seq !== analyzeSeqRef.current) return; // discard a stale failure too
      // Leave grammarData null so the UI shows a real "분석 실패" state
      // (a genuinely empty-but-successful analysis still returns normally).
      setError('grammarFailed');
      setGrammarData(null);
    } finally {
      if (seq === analyzeSeqRef.current) setLoading(false);
    }
  }

  function togglePattern(index) {
    setCheckedPatterns(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  }

  async function handleSave() {
    // Allow saving when there is at least a translation, even with no patterns
    // (a sentence + its translation is still a useful review card).
    if (!grammarData || loading) return;
    if (checkedPatterns.length === 0 && !grammarData.translation) return;
    setLoading(true);

    try {
      const selectedPatterns = checkedPatterns.map(i => grammarData.patterns[i]);

      let selectionRect;
      if (isYouTube) {
        selectionRect = JSON.stringify({
          type: 'youtube_grammar',
          segmentIndex,
          wordIndex,
          timestamp,
        });
      } else {
        const lineGroups = buildLineGroups(sentenceWords);
        selectionRect = JSON.stringify({
          bounds: wordBbox,
          lines: lineGroups.length > 0 ? lineGroups : null,
          page: currentPage,
        });
      }

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

      // Await persistence so createAnnotation + its review_items insert either
      // both succeed (hand the real row to the optimistic list) or the failure
      // is surfaced to the user — no more silent data loss.
      const saved = await createAnnotation(annotationData);
      onSaved?.(saved);
      onClose(true);
    } catch (err) {
      logError('useGrammarAnalysis.save', err);
      // Nothing was optimistically added, so nothing to roll back. Keep the menu
      // open and alert the user so they can retry.
      setError('saveFailed');
      setLoading(false);
      alert('저장에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
    }
  }

  return {
    grammarData, checkedPatterns, loading, error,
    reset, loadExisting, handleAnalyze, handleSave, togglePattern,
  };
}
