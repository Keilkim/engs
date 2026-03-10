import { useState, useCallback } from 'react';
import { analyzeGrammarPatterns } from '../../services/ai';
import { createAnnotation } from '../../services/annotation';

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
export function useGrammarAnalysis({ word, wordBbox, sentenceWords, sourceId, currentPage, onSaved, onClose }) {
  const [grammarData, setGrammarData] = useState(null);
  const [checkedPatterns, setCheckedPatterns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setGrammarData(null);
    setCheckedPatterns([]);
    setLoading(false);
    setError('');
  }, []);

  const loadExisting = useCallback((data) => {
    setGrammarData(data);
  }, []);

  async function handleAnalyze() {
    if (!word || loading) return;
    setLoading(true);

    try {
      const result = await analyzeGrammarPatterns(word);
      setGrammarData({
        originalText: word,
        translation: result.translation || '',
        patterns: result.patterns || [],
      });
      setCheckedPatterns(result.patterns?.map((_, i) => i) || []);
    } catch {
      setError('grammarFailed');
      setGrammarData({ originalText: word, translation: '', patterns: [] });
    } finally {
      setLoading(false);
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
    if (!grammarData || checkedPatterns.length === 0 || loading) return;
    setLoading(true);

    try {
      const selectedPatterns = checkedPatterns.map(i => grammarData.patterns[i]);
      const lineGroups = buildLineGroups(sentenceWords);

      const selectionRect = JSON.stringify({
        bounds: wordBbox,
        lines: lineGroups.length > 0 ? lineGroups : null,
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

      const tempAnnotation = {
        ...annotationData,
        id: `temp-${Date.now()}`,
        created_at: new Date().toISOString(),
      };
      onSaved?.(tempAnnotation);
      onClose(true);

      createAnnotation(annotationData).catch(() => {});
    } catch {
      setLoading(false);
    }
  }

  return {
    grammarData, checkedPatterns, loading, error,
    reset, loadExisting, handleAnalyze, handleSave, togglePattern,
  };
}
