/**
 * Text-to-Speech utility for natural English pronunciation.
 * Uses Web Speech API with preferred high-quality voices.
 */

interface SpeakOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (event: SpeechSynthesisErrorEvent) => void;
}

// Preferred voices list (in priority order)
const PREFERRED_VOICES = [
  'Samantha', 'Karen', 'Daniel', 'Moira', // macOS high-quality
  'Google US English', 'Google UK English Female', // Chrome
  'Microsoft Zira', 'Microsoft David', // Windows
];

/**
 * Find the best available English voice.
 */
function findBestVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();

  // Try preferred voices first
  for (const name of PREFERRED_VOICES) {
    const voice = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
    if (voice) return voice;
  }

  // Fallback: any English voice
  return voices.find(v => v.lang.startsWith('en-US')) ||
         voices.find(v => v.lang.startsWith('en')) ||
         null;
}

/**
 * Speak text using Web Speech API with natural English pronunciation.
 */
export function speakText(text: string, options: SpeakOptions = {}): void {
  if (!text || !window.speechSynthesis) return;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const {
    rate = 1.0,
    pitch = 1.0,
    volume = 1.0,
    onStart,
    onEnd,
    onError,
  } = options;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.volume = volume;

  const voice = findBestVoice();
  if (voice) {
    utterance.voice = voice;
  }

  if (onStart) utterance.onstart = onStart;
  if (onEnd) utterance.onend = onEnd;
  if (onError) utterance.onerror = onError;

  window.speechSynthesis.speak(utterance);
}

/**
 * Stop any ongoing speech.
 */
export function stopSpeaking(): void {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Check if speech synthesis is currently speaking.
 */
export function isSpeaking(): boolean {
  return window.speechSynthesis?.speaking || false;
}

/**
 * Preload voices (call early to avoid delays on first speech).
 */
export function preloadVoices(): Promise<void> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis?.getVoices();
    if (voices && voices.length > 0) {
      resolve();
    } else if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => resolve();
    } else {
      resolve();
    }
  });
}
