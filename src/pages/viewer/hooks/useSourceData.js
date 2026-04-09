import { useState, useCallback } from 'react';
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

  // Refresh annotations only (without resetting page position)
  const refreshAnnotations = useCallback(async () => {
    try {
      const [annotationsData, vocabData, patternsData] = await Promise.all([
        getAnnotations(sourceId),
        getVocabulary(),
        getSentencePatterns(),
      ]);
      setAnnotations(annotationsData || []);
      setVocabulary(vocabData || []);
      setSentencePatterns(patternsData || []);
    } catch (err) {
      console.error('Failed to refresh annotations:', err);
    }
  }, [sourceId]);

  // Parse pages from source
  const getPages = useCallback(() => {
    if (source?.pages) {
      return safeJsonParse(source.pages, null);
    }
    return null;
  }, [source]);

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
    getPages,
  };
}
