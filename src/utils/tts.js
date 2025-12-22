/**
 * Text-to-Speech utility for natural English pronunciation.
 * Uses Web Speech API with preferred high-quality voices.
 */

// Preferred voices list (in priority order)
const PREFERRED_VOICES = [
  'Samantha', 'Karen', 'Daniel', 'Moira', // macOS high-quality
  'Google US English', 'Google UK English Female', // Chrome
  'Microsoft Zira', 'Microsoft David', // Windows
];

/**
 * Find the best available English voice.
 * @returns {SpeechSynthesisVoice|null}
 */
function findBestVoice() {
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
 * @param {string} text - Text to speak
 * @param {Object} options - Optional settings
 * @param {number} options.rate - Speech rate (default: 1.0, range: 0.1-10)
 * @param {number} options.pitch - Speech pitch (default: 1.0, range: 0-2)
 * @param {number} options.volume - Speech volume (default: 1.0, range: 0-1)
 * @param {Function} options.onStart - Callback when speech starts
 * @param {Function} options.onEnd - Callback when speech ends
 * @param {Function} options.onError - Callback on error
 */
export function speakText(text, options = {}) {
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
export function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Check if speech synthesis is currently speaking.
 * @returns {boolean}
 */
export function isSpeaking() {
  return window.speechSynthesis?.speaking || false;
}

/**
 * Preload voices (call early to avoid delays on first speech).
 * Voices load asynchronously, so this ensures they're ready.
 * @returns {Promise<void>}
 */
export function preloadVoices() {
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

export default speakText;
