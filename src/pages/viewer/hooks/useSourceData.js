import { useState, useCallback } from 'react';
import { getSource, deleteSource } from '../../../services/source';
import { getAnnotations, getVocabulary } from '../../../services/annotation';

/**
 * Hook for managing source data, annotations, and vocabulary
 */
export function useSourceData(sourceId) {
  const [source, setSource] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [vocabulary, setVocabulary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sourceData, annotationsData, vocabData] = await Promise.all([
        getSource(sourceId),
        getAnnotations(sourceId),
        getVocabulary(),
      ]);
      setSource(sourceData);
      setAnnotations(annotationsData || []);
      setVocabulary(vocabData || []);
      return { source: sourceData, annotations: annotationsData, vocabulary: vocabData };
    } catch (err) {
      setError('Unable to load source');
      console.error(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  // Refresh annotations only (without resetting page position)
  const refreshAnnotations = useCallback(async () => {
    try {
      const [annotationsData, vocabData] = await Promise.all([
        getAnnotations(sourceId),
        getVocabulary(),
      ]);
      setAnnotations(annotationsData || []);
      setVocabulary(vocabData || []);
    } catch (err) {
      console.error('Failed to refresh annotations:', err);
    }
  }, [sourceId]);

  // Parse pages from source
  const getPages = useCallback(() => {
    if (source?.pages) {
      try {
        return JSON.parse(source.pages);
      } catch {
        return null;
      }
    }
    return null;
  }, [source]);

  // Check if annotation is a vocabulary item
  const isVocabularyAnnotation = useCallback((annotation) => {
    if (!annotation.ai_analysis_json) return false;
    try {
      const data = JSON.parse(annotation.ai_analysis_json);
      return data.isVocabulary === true;
    } catch {
      return false;
    }
  }, []);

  // Check if annotation is a grammar pattern
  const isGrammarAnnotation = useCallback((annotation) => {
    if (!annotation.ai_analysis_json) return false;
    try {
      const data = JSON.parse(annotation.ai_analysis_json);
      return data.type === 'grammar';
    } catch {
      return false;
    }
  }, []);

  // Get vocabulary annotations for a specific page
  const getVocabularyAnnotations = useCallback((pageNum = null) => {
    return annotations.filter(a => {
      if (!a.selection_rect || !isVocabularyAnnotation(a)) return false;
      if (pageNum !== null) {
        try {
          const rect = JSON.parse(a.selection_rect);
          return rect.page === pageNum;
        } catch {
          return false;
        }
      }
      return true;
    });
  }, [annotations, isVocabularyAnnotation]);

  // Get grammar annotations for a specific page
  const getGrammarAnnotations = useCallback((pageNum = null) => {
    return annotations.filter(a => {
      if (!a.selection_rect || !isGrammarAnnotation(a)) return false;
      if (pageNum !== null) {
        try {
          const rect = JSON.parse(a.selection_rect);
          return rect.page === pageNum;
        } catch {
          return false;
        }
      }
      return true;
    });
  }, [annotations, isGrammarAnnotation]);

  return {
    // State
    source,
    annotations,
    vocabulary,
    loading,
    error,

    // Actions
    loadData,
    refreshAnnotations,
    setSource,
    setAnnotations,
    setVocabulary,

    // Helpers
    getPages,
    isVocabularyAnnotation,
    isGrammarAnnotation,
    getVocabularyAnnotations,
    getGrammarAnnotations,
  };
}
