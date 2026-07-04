import { useState, useCallback, useRef } from 'react';
import { speakText, stopSpeaking as stopTTS } from '../../utils/tts';
import { lookupWord } from '../../services/ai';
import { createAnnotation } from '../../services/annotation';
import { logError } from '../../utils/errors';

// Coerce any value into a safe display/storage string. Legacy rows sometimes
// stored the whole lookup result object under `definition`, which crashes React
// when rendered — never let a non-string escape into state or the DB.
function toDefinitionString(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Hook for vocabulary word lookup, TTS, and save logic
 */
export function useWordLookup({ word, wordBbox, sourceId, currentPage, onSaved, onClose, sourceType, segmentIndex, wordIndex, timestamp, sceneStart, sceneEnd, sentence }) {
  const isYouTube = sourceType === 'youtube';
  const isChat = sourceType === 'chat';
  // Whether this word can be persisted at all (needs a location or a chat/YT context).
  const canSave = isYouTube || isChat || !!wordBbox;
  const [definition, setDefinition] = useState('');
  const [phonetic, setPhonetic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState(false);

  // In-flight lookup token: a stale lookup that resolves after the menu was
  // closed/re-opened must not overwrite the current word's definition.
  const lookupSeqRef = useRef(0);

  const reset = useCallback(() => {
    lookupSeqRef.current += 1; // invalidate any in-flight lookup
    setDefinition('');
    setPhonetic('');
    setLoading(false);
    setError('');
    setSpeaking(false);
  }, []);

  const loadExisting = useCallback((data) => {
    // Defensive: guard against legacy corrupted rows where definition is an object.
    setDefinition(toDefinitionString(data.definition));
    setPhonetic(typeof data.phonetic === 'string' ? data.phonetic : '');
  }, []);

  async function handleLookup() {
    if (!word) return;
    const seq = ++lookupSeqRef.current; // supersedes any earlier in-flight lookup
    setDefinition(''); // clear stale so nothing old flashes while loading
    setPhonetic('');
    setLoading(true);
    setError('');
    try {
      const result = await lookupWord(word);
      if (seq !== lookupSeqRef.current) return; // superseded (closed/re-opened) → discard
      // Only ever store the string definition; surface lookup errors instead of
      // persisting garbage.
      if (result?.error) {
        setError('lookupFailed');
        setDefinition('');
        setPhonetic('');
        return;
      }
      setDefinition(toDefinitionString(result?.definition));
      setPhonetic(typeof result?.phonetic === 'string' ? result.phonetic : '');
    } catch (err) {
      if (seq !== lookupSeqRef.current) return; // discard a stale failure too
      logError('useWordLookup.lookup', err);
      setError('lookupFailed');
      setDefinition('');
    } finally {
      if (seq === lookupSeqRef.current) setLoading(false);
    }
  }

  async function handleSave() {
    if (!word || loading) return;
    // Non-silent guard: if the word cannot be located/persisted, do nothing
    // (the Save button is hidden via `canSave` in this case).
    if (!canSave) return;

    setLoading(true);
    setError('');

    try {
      // Reuse the definition already on screen; only look it up if we don't
      // have one yet (avoids a second external API call on every Save).
      let def = toDefinitionString(definition);
      let ph = typeof phonetic === 'string' ? phonetic : '';

      if (!def) {
        const result = await lookupWord(word);
        if (result?.error) {
          setError('lookupFailed');
          setLoading(false);
          return;
        }
        def = toDefinitionString(result?.definition);
        ph = typeof result?.phonetic === 'string' ? result.phonetic : ph;
        setDefinition(def);
        setPhonetic(ph);
      }

      // Never persist an empty/garbage definition — tell the user instead.
      if (!def) {
        setError('lookupFailed');
        setLoading(false);
        return;
      }

      const selectionRect = isYouTube
        ? JSON.stringify({
            type: 'youtube_word',
            segmentIndex, // STORED-segment index (translated from the display row)
            wordIndex,
            timestamp,
            // Authoritative scene bounds captured from the tapped row (a pause
            // chunk is a better scene than a cue). Scene playback prefers these.
            ...(typeof sceneStart === 'number' ? { sceneStart } : {}),
            ...(typeof sceneEnd === 'number' ? { sceneEnd } : {}),
          })
        : isChat
        ? JSON.stringify({ type: 'chat_word' })
        : JSON.stringify({ bounds: wordBbox, page: currentPage });

      const analysis = {
        isVocabulary: true,
        word,
        definition: def,
        phonetic: ph,
      };
      // Keep the source sentence for later context/recall when available.
      if (typeof sentence === 'string' && sentence.trim()) {
        analysis.sentence = sentence.trim();
      }

      const annotationData = {
        source_id: sourceId,
        type: 'highlight',
        selected_text: word,
        selection_rect: selectionRect,
        ai_analysis_json: JSON.stringify(analysis),
      };

      // Await persistence so we can (a) hand the real row (real id) to the
      // optimistic list and (b) surface failures instead of silently losing data.
      const saved = await createAnnotation(annotationData);
      onSaved?.(saved);
      onClose(true);
    } catch (err) {
      logError('useWordLookup.save', err);
      // Nothing was optimistically added yet, so there is nothing to roll back;
      // keep the menu open, show the error and alert the user so they can retry.
      setError('saveFailed');
      setLoading(false);
      alert('저장에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
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
    definition, phonetic, loading, error, speaking, canSave,
    reset, loadExisting, handleLookup, handleSave,
    speak, stopSpeaking,
  };
}
