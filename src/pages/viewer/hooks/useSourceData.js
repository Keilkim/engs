import { useState, useCallback, useMemo } from 'react';
import { getSource } from '../../../services/source';
import { getAnnotations, getVocabulary, getSentencePatterns } from '../../../services/annotation';
import { safeJsonParse } from '../../../utils/errors';

/**
 * Hook for managing source data, annotations, and vocabulary
 */
export function useSourceData(sourceId) {
  const [source, setSource] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [vocabulary, setVocabulary] = useState([]);
  const [sentencePatterns, setSentencePatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Load all data (conditional loading to prevent flicker on reload)
  const loadData = useCallback(async (currentSource = null) => {
    // Only show loading spinner on initial load (flicker prevention)
    if (!currentSource) {
      setLoading(true);
    }

    try {
      const [sourceData, annotationsData, vocabData, patternsData] = await Promise.all([
        getSource(sourceId),
        getAnnotations(sourceId),
        getVocabulary(),
        getSentencePatterns(),
      ]);
      setSource(sourceData);
      setAnnotations(annotationsData || []);
      setVocabulary(vocabData || []);
      setSentencePatterns(patternsData || []);
      return { source: sourceData, annotations: annotationsData, vocabulary: vocabData, sentencePatterns: patternsData };
    } catch (err) {
      setError('Unable to load source');
      console.error('[useSourceData] loadData error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  // Refresh annotations only (without resetting page position).
  // `pendingTemps` are optimistic annotations that may not yet be persisted;
  // any whose real (non-temp) row is still missing on the server is kept so a
  // just-saved word never disappears mid-flight. Returns which temps are still
  // pending so callers can decide whether to poll again.
  const refreshAnnotations = useCallback(async (pendingTemps = []) => {
    try {
      const [annotationsData, vocabData, patternsData] = await Promise.all([
        getAnnotations(sourceId),
        getVocabulary(),
        getSentencePatterns(),
      ]);
      const server = annotationsData || [];
      const stillPending = pendingTemps.filter(temp =>
        !server.some(a =>
          !String(a.id).startsWith('temp-') &&
          a.selected_text === temp.selected_text &&
          a.selection_rect === temp.selection_rect
        )
      );
      setAnnotations(stillPending.length > 0 ? [...server, ...stillPending] : server);
      setVocabulary(vocabData || []);
      setSentencePatterns(patternsData || []);
      return { annotations: server, stillPending };
    } catch (err) {
      console.error('Failed to refresh annotations:', err);
      return null;
    }
  }, [sourceId]);

  // Parse pages from source ONCE (pages JSON can be tens of MB of base64 image
  // data). Everything shares this memoized value instead of re-parsing on every
  // render / keydown / gesture frame.
  const pages = useMemo(
    () => (source?.pages ? safeJsonParse(source.pages, null) : null),
    [source?.pages]
  );

  // Backwards-compatible accessor returning the memoized pages (no re-parse).
  const getPages = useCallback(() => pages, [pages]);

  return {
    source,
    annotations,
    vocabulary,
    sentencePatterns,
    loading,
    error,
    loadData,
    refreshAnnotations,
    setSource,
    setAnnotations,
    setVocabulary,
    pages,
    getPages,
  };
}
