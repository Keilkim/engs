// Grammar
export { analyzeGrammar, analyzeGrammarPatterns } from './grammar';

// Vocabulary
export { lookupWord } from './vocabulary';

// OCR
export {
  extractTextFromImage,
  extractWordBagFromImages,
  extractTextWithWordPositions,
  findWordPositions,
} from './ocr';

// Image Processing
export { detectMainContent, cropImage, cropImageRegion } from './image';

// Chat
export { analyzeText, chat, chatStream, extractOcrText } from './chat';

// Constants (for components that need them directly)
export { GRAMMAR_COLORS, LANGUAGE_NAMES, LANG_CODES } from './config';

// Legacy TTS exports (deprecated - use src/utils/tts.js instead)
export { speakText, stopSpeaking } from '../../utils/tts';
