import { useState, useCallback } from 'react';
import { speakText, stopSpeaking as stopTTS } from '../../utils/tts';
import { lookupWord } from '../../services/ai';
import { createAnnotation } from '../../services/annotation';

/**
 * Hook for vocabulary word lookup, TTS, and save logic
 */
export function useWordLookup({ word, wordBbox, sourceId, currentPage, onSaved, onClose, sourceType, segmentIndex, wordIndex, timestamp }) {
  const isYouTube = sourceType === 'youtube';
  const [definition, setDefinition] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState(false);

  const reset = useCallback(() => {
    setDefinition('');
    setLoading(false);
    setError('');
    setSpeaking(false);
  }, []);

  const loadExisting = useCallback((data) => {
    setDefinition(data.definition || '');
  }, []);

  async function handleLookup() {
    if (!word) return;
    setLoading(true);
    try {
      const result = await lookupWord(word);
      setDefinition(result.definition || result || '');
    } catch {
      setError('lookupFailed');
      setDefinition('');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!word || loading) return;
    if (!isYouTube && !wordBbox) return;
    setLoading(true);

    try {
      const result = await lookupWord(word);
      const selectionRect = isYouTube
        ? JSON.stringify({ type: 'youtube_word', segmentIndex, wordIndex, timestamp })
        : JSON.stringify({ bounds: wordBbox, page: currentPage });

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

  function speak(text) {
    if (!text || speaking) return;
    speakText(text, {
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }

  function stopSpeaking() {
    stopTTS();
    setSpeaking(false);
  }

  return {
    definition, loading, error, speaking,
    reset, loadExisting, handleLookup, handleSave,
    speak, stopSpeaking,
  };
}
