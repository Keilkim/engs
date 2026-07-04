import { useState, useCallback, useRef, useEffect } from 'react';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

/**
 * Conversational voice input hook.
 * - Continuous listening mode
 * - Auto-sends after ~2 seconds of silence
 * - Calls onAutoSend callback with final transcript
 */
export function useVoiceInput({ onAutoSend } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const finalTextRef = useRef('');
  const onAutoSendRef = useRef(onAutoSend);
  const unmountedRef = useRef(false);
  const isSupported = !!SpeechRecognition;

  // Keep callback ref fresh
  useEffect(() => {
    onAutoSendRef.current = onAutoSend;
  }, [onAutoSend]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      // Clear the buffered transcript BEFORE aborting so the recognition's
      // onend handler doesn't fire a "ghost" auto-send after unmount.
      finalTextRef.current = '';
      clearTimeout(silenceTimerRef.current);
      recognitionRef.current?.abort();
    };
  }, []);

  // Dispatch the buffered transcript. Only clears it when the consumer actually
  // sent it (returns !== false); otherwise the speech is kept for a later retry.
  const flushAutoSend = useCallback(() => {
    const text = finalTextRef.current.trim();
    if (!text || !onAutoSendRef.current) return;
    const sent = onAutoSendRef.current(text);
    if (sent !== false) {
      finalTextRef.current = '';
      setTranscript('');
      setInterimText('');
    }
  }, []);

  const resetSilenceTimer = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      // 2 seconds of silence → auto-send
      flushAutoSend();
    }, 2000);
  }, [flushAutoSend]);

  const startListening = useCallback(() => {
    if (!isSupported || unmountedRef.current) return;

    // Clean up existing recognition if any (allows restart without waiting for state)
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interim = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalTranscript) {
        finalTextRef.current = finalTranscript;
        setTranscript(finalTranscript);
        setInterimText('');
        resetSilenceTimer();
      } else if (interim) {
        setInterimText(interim);
        // Reset timer on interim results too (user still talking)
        clearTimeout(silenceTimerRef.current);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      clearTimeout(silenceTimerRef.current);
      // Auto-send remaining text when recognition ends naturally.
      // (finalTextRef is cleared on unmount, so this won't ghost-send.)
      flushAutoSend();
    };

    recognition.onerror = (e) => {
      // 'no-speech' is normal, don't stop
      if (e.error === 'no-speech') return;
      setIsListening(false);
      clearTimeout(silenceTimerRef.current);
    };

    recognitionRef.current = recognition;
    finalTextRef.current = '';
    setTranscript('');
    setInterimText('');
    recognition.start();
  }, [isSupported, resetSilenceTimer, flushAutoSend]);

  const stopListening = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    recognitionRef.current?.stop();
  }, []);

  // Stop listening without triggering auto-send (for pause/external stop)
  const stopListeningQuiet = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    finalTextRef.current = ''; // Clear so onend won't auto-send
    setTranscript('');
    setInterimText('');
    recognitionRef.current?.stop();
  }, []);

  const clearTranscript = useCallback(() => {
    finalTextRef.current = '';
    setTranscript('');
    setInterimText('');
  }, []);

  return {
    isListening,
    transcript,
    interimText,
    isSupported,
    startListening,
    stopListening,
    stopListeningQuiet,
    clearTranscript,
  };
}
