import { useCallback, useEffect, useRef, useState } from 'react';
import { speakText, stopSpeaking } from '../utils/tts';

// Audio only starts in response to a visible user action. Never grade silence/errors.
export default function usePracticeAudio(onTranscript) {
  const recognition = useRef(null);
  const generation = useRef(0);
  const callback = useRef(onTranscript);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const supported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  useEffect(() => { callback.current = onTranscript; }, [onTranscript]);

  const stop = useCallback(() => {
    generation.current += 1;
    recognition.current?.abort();
    recognition.current = null;
    stopSpeaking();
    setListening(false);
    setSpeaking(false);
  }, []);

  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [stop]);

  const play = useCallback(text => {
    stop();
    setError('');
    if (!window.speechSynthesis) { setError('이 기기에서는 소리 재생이 어려워요. 글자로 계속할 수 있어요.'); return; }
    const token = generation.current;
    setSpeaking(true);
    speakText(text, {
      onEnd: () => { if (token === generation.current) setSpeaking(false); },
      onError: () => {
        if (token !== generation.current) return;
        setSpeaking(false);
        setError('재생하지 못했어요. 다시 듣거나 글자로 계속해 주세요.');
      },
    });
  }, [stop]);

  const listen = useCallback(() => {
    stop();
    setError('');
    setTranscript('');
    if (!supported) { setError('이 브라우저는 음성 입력을 지원하지 않아요. 조용히 모드로 계속해 주세요.'); return; }
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const instance = new Constructor();
    const token = generation.current;
    instance.lang = 'en-US';
    instance.interimResults = true;
    instance.continuous = false;
    let received = false;
    instance.onstart = () => { if (token === generation.current) setListening(true); };
    instance.onresult = event => {
      if (token !== generation.current) return;
      const results = Array.from(event.results);
      const text = results.map(result => result[0].transcript).join(' ').trim();
      setTranscript(text);
      if (results.every(result => result.isFinal) && text && !received) {
        received = true;
        callback.current(text);
      }
    };
    instance.onerror = event => {
      if (token !== generation.current || event.error === 'aborted') return;
      setListening(false);
      setError(event.error === 'not-allowed' ? '마이크를 사용할 수 없어요. 조용히 모드로 계속할 수 있어요.' :
        '잘 듣지 못했어요. 오답으로 기록하지 않았어요. 다시 말하거나 답을 확인해 주세요.');
    };
    instance.onend = () => { if (token === generation.current) setListening(false); };
    recognition.current = instance;
    try { instance.start(); } catch { setError('음성 입력을 시작하지 못했어요. 터치로 계속해 주세요.'); }
  }, [stop, supported]);

  const reset = useCallback(() => { stop(); setError(''); setTranscript(''); }, [stop]);
  return { play, listen, stop, reset, listening, speaking, error, transcript, supported };
}
