import { useState, useCallback, useRef } from 'react';
import { analyzeGrammarPatterns } from '../../services/ai';
import { createAnnotation } from '../../services/annotation';
import { logError } from '../../utils/errors';
import { groupWordBoxes } from '../../utils/grammarMarkers';

// Keep only spans that literally occur in the sentence, canonicalized to the
// sentence's real casing so the flashcard front can bold an exact, verbatim
// substring. Drops anything the model hallucinated or normalized away.
// Lower case with straight apostrophes: OCR text often has ’ where the model
// writes ' (same length, so indexes still point into the sentence).
const fold = text => text.toLowerCase().replace(/[’‘]/g, "'");

function validateSpans(spans, sentence) {
  if (!sentence) return [];
  const low = fold(sentence);
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(spans) ? spans : []) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (!t) continue;
    const idx = low.indexOf(fold(t));
    if (idx === -1) continue; // not actually in the sentence → drop
    const surface = sentence.slice(idx, idx + t.length); // preserve original casing
    const key = surface.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(surface);
  }
  return out;
}

// Same rule for role-labeled segments, but order and repeats are kept: they
// place the pattern in the sentence ("the more …, the more …").
function validateSegments(segments, sentence) {
  if (!sentence) return [];
  const low = fold(sentence);
  return (Array.isArray(segments) ? segments : []).flatMap(segment => {
    const t = typeof segment?.text === 'string' ? segment.text.trim() : '';
    const idx = t ? low.indexOf(fold(t)) : -1;
    if (idx === -1) return [];
    return [{ text: sentence.slice(idx, idx + t.length), role: segment.role === 'slot' ? 'slot' : 'fixed' }];
  });
}

function validatePattern(pattern, sentence) {
  const segments = validateSegments(pattern?.segments, sentence);
  if (segments.length) {
    const fixed = segments.filter(s => s.role === 'fixed').map(s => s.text);
    const slots = segments.filter(s => s.role === 'slot').map(s => s.text);
    // Cards bold "spans"; a pattern made only of slots still needs some.
    return { ...pattern, segments, spans: validateSpans(fixed.length ? fixed : slots, sentence),
      variableSpans: validateSpans(slots, sentence) };
  }
  const { segments: _dropped, ...rest } = pattern || {};
  return { ...rest, spans: validateSpans(pattern?.spans, sentence),
    variableSpans: validateSpans(pattern?.variableSpans, sentence) };
}

/**
 * Hook for grammar pattern analysis, selection, and save logic
 */
export function useGrammarAnalysis({ word, wordBbox, sentenceWords, sourceId, currentPage, onSaved, onClose, sourceType, segmentIndex, wordIndex, timestamp, sceneStart, sceneEnd }) {
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

  const handleAnalyze = useCallback(async () => {
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
  }, [word]);

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
      const selectedPatterns = checkedPatterns
        .map(i => grammarData.patterns[i])
        .filter(Boolean)
        .map(p => validatePattern(p, grammarData.originalText));

      let selectionRect;
      if (isYouTube) {
        selectionRect = JSON.stringify({
          type: 'youtube_grammar',
          segmentIndex, // STORED-segment index (translated from the display row)
          wordIndex,
          timestamp,
          ...(typeof sceneStart === 'number' ? { sceneStart } : {}),
          ...(typeof sceneEnd === 'number' ? { sceneEnd } : {}),
        });
      } else {
        const lineGroups = groupWordBoxes(sentenceWords || []);
        selectionRect = JSON.stringify({
          bounds: wordBbox,
          lines: lineGroups.length > 0 ? lineGroups : null,
          words: sentenceWords?.map(({ text, bbox }) => ({ text, bbox })) || null,
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

      // The service confirms both writes and compensates a failed review insert
      // before this row can enter the displayed annotation list.
      const saved = await createAnnotation(annotationData);
      onSaved?.(saved);
      onClose(true);
    } catch (err) {
      logError('useGrammarAnalysis.save', err);
      // Nothing was optimistically added, so nothing to roll back. Keep the menu
      // open and alert the user so they can retry.
      setError('saveFailed');
      setLoading(false);
      alert(err?.code === 'ANNOTATION_CLEANUP_PENDING'
        ? err.message
        : '저장에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
    }
  }

  return {
    grammarData, checkedPatterns, loading, error,
    reset, loadExisting, handleAnalyze, handleSave, togglePattern,
  };
}
