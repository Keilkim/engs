import { logError } from '../../utils/errors';

// Dynamically import tesseract.js to avoid bundling in main chunk
let Tesseract = null;
async function loadTesseract() {
  if (!Tesseract) {
    const mod = await import('tesseract.js');
    Tesseract = mod.default;
  }
  return Tesseract;
}

/**
 * Levenshtein distance calculation for string similarity
 */
function levenshteinDistance(a, b) {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Correct OCR errors using word bag similarity
 */
function correctTextWithWordBag(text, wordBag) {
  const words = text.split(/\s+/);

  const corrected = words.map(word => {
    const cleanWord = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (cleanWord.length < 2) return word;

    if (wordBag.has(cleanWord)) return word;

    let bestMatch = null;
    let bestDistance = Infinity;

    for (const bagWord of wordBag) {
      if (Math.abs(bagWord.length - cleanWord.length) > 2) continue;

      const dist = levenshteinDistance(cleanWord, bagWord);

      if (dist <= 2 && dist < bestDistance) {
        bestDistance = dist;
        bestMatch = bagWord;
      }
    }

    if (bestMatch) {
      const isCapitalized = word[0] === word[0].toUpperCase();
      const isAllCaps = word === word.toUpperCase();

      if (isAllCaps) return bestMatch.toUpperCase();
      if (isCapitalized) return bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1);
      return bestMatch;
    }

    return word;
  });

  return corrected.join(' ');
}

/**
 * Extract text from image using Tesseract OCR
 */
export async function extractTextFromImage(base64Image, wordBag = null) {
  try {
    const tess = await loadTesseract();
    const result = await tess.recognize(base64Image, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log('Tesseract:', Math.round(m.progress * 100) + '%');
        }
      },
    });

    let text = result.data.text?.trim();
    console.log('Tesseract OCR result:', text);

    if (text && wordBag && wordBag.size > 0) {
      text = correctTextWithWordBag(text, wordBag);
      console.log('Corrected text:', text);
    }

    return text || null;
  } catch (err) {
    throw new Error(`Tesseract OCR failed: ${err.message}`);
  }
}

/**
 * Extract word bag from multiple images for OCR correction
 */
export async function extractWordBagFromImages(images) {
  const wordSet = new Set();

  for (let i = 0; i < images.length; i++) {
    try {
      console.log(`OCR processing page ${i + 1}/${images.length}...`);
      const tess = await loadTesseract();
      const result = await tess.recognize(images[i], 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && m.progress === 1) {
            console.log(`Page ${i + 1} OCR complete`);
          }
        },
      });

      const words = result.data.text
        .split(/\s+/)
        .map(w => w.replace(/[^a-zA-Z'-]/g, '').toLowerCase())
        .filter(w => w.length >= 2);

      words.forEach(w => wordSet.add(w));
    } catch (err) {
      logError(`extractWordBag.page${i + 1}`, err);
    }
  }

  console.log(`Word bag extracted: ${wordSet.size} unique words`);
  return wordSet;
}

const MAX_SLICE_HEIGHT = 4000;
const SLICE_OVERLAP = 100;

/**
 * Crop a horizontal strip from an image element and return as base64
 */
function cropImageSlice(img, offsetY, sliceHeight, imageWidth) {
  const canvas = document.createElement('canvas');
  canvas.width = imageWidth;
  canvas.height = sliceHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, offsetY, imageWidth, sliceHeight, 0, 0, imageWidth, sliceHeight);
  return canvas.toDataURL('image/png');
}

/**
 * Extract words from a single Tesseract recognize result
 */
function extractWordsFromResult(data) {
  const words = [];

  if (data.blocks) {
    const blocksArray = Array.isArray(data.blocks) ? data.blocks : [data.blocks];
    for (const block of blocksArray) {
      if (!block) continue;

      if (block.words && Array.isArray(block.words)) {
        for (const word of block.words) {
          if (word.text && word.bbox) {
            words.push({ text: word.text.trim(), confidence: word.confidence || 90, bbox: word.bbox });
          }
        }
      }

      for (const para of (block.paragraphs || [])) {
        for (const line of (para.lines || [])) {
          for (const word of (line.words || [])) {
            if (word.text && word.bbox) {
              words.push({ text: word.text.trim(), confidence: word.confidence || 90, bbox: word.bbox });
            }
          }
        }
      }
    }
  }

  if (words.length === 0 && data.words && Array.isArray(data.words)) {
    for (const word of data.words) {
      if (word.text && word.bbox) {
        words.push({ text: word.text.trim(), confidence: word.confidence || 90, bbox: word.bbox });
      }
    }
  }

  return words;
}

/**
 * Remove duplicate words from overlap regions
 */
function deduplicateWords(words) {
  const result = [];
  for (const word of words) {
    const isDuplicate = result.some(
      (existing) =>
        existing.text === word.text &&
        Math.abs(existing.bbox.y0 - word.bbox.y0) < 20 &&
        Math.abs(existing.bbox.x0 - word.bbox.x0) < 20
    );
    if (!isDuplicate) {
      result.push(word);
    }
  }
  return result;
}

/**
 * Extract text with word-level bounding boxes (Tesseract.js v7)
 * Automatically splits large images into strips to avoid WASM memory limits
 */
export async function extractTextWithWordPositions(base64Image) {
  try {
    const img = new Image();
    const imgLoadPromise = new Promise((resolve) => {
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => resolve({ width: 1, height: 1 });
      img.src = base64Image;
    });
    const { width: imageWidth, height: imageHeight } = await imgLoadPromise;
    console.log('[OCR-Extract] Image dimensions:', imageWidth, 'x', imageHeight);

    const tess = await loadTesseract();
    const worker = await tess.createWorker('eng', 1);

    let allWords = [];
    let fullText = '';

    if (imageHeight > MAX_SLICE_HEIGHT) {
      // Split tall image into horizontal strips
      const sliceCount = Math.ceil(imageHeight / (MAX_SLICE_HEIGHT - SLICE_OVERLAP));
      console.log(`[OCR-Extract] Image too tall, splitting into ${sliceCount} slices`);

      for (let offsetY = 0; offsetY < imageHeight; offsetY += MAX_SLICE_HEIGHT - SLICE_OVERLAP) {
        const sliceHeight = Math.min(MAX_SLICE_HEIGHT, imageHeight - offsetY);
        const sliceIndex = Math.floor(offsetY / (MAX_SLICE_HEIGHT - SLICE_OVERLAP));
        console.log(`[OCR-Extract] Processing slice ${sliceIndex + 1}/${sliceCount} (y:${offsetY}, h:${sliceHeight})`);

        const sliceBase64 = cropImageSlice(img, offsetY, sliceHeight, imageWidth);
        const result = await worker.recognize(sliceBase64, {}, { text: true, blocks: true });

        const sliceWords = extractWordsFromResult(result.data);
        // Offset word y coordinates back to original image space
        for (const word of sliceWords) {
          word.bbox = {
            x0: word.bbox.x0,
            y0: word.bbox.y0 + offsetY,
            x1: word.bbox.x1,
            y1: word.bbox.y1 + offsetY,
          };
          allWords.push(word);
        }
        fullText += (result.data.text || '') + '\n';
        console.log(`[OCR-Extract] Slice ${sliceIndex + 1}: ${sliceWords.length} words`);
      }

      allWords = deduplicateWords(allWords);
      console.log(`[OCR-Extract] After dedup: ${allWords.length} words`);
    } else {
      // Normal path for images within size limits
      const result = await worker.recognize(base64Image, {}, { text: true, blocks: true });
      allWords = extractWordsFromResult(result.data);
      fullText = result.data.text || '';
    }

    await worker.terminate();

    if (allWords.length === 0) {
      console.log('[OCR-Extract] NO WORDS FOUND!');
      return {
        text: fullText.trim(),
        words: [],
        imageSize: { width: imageWidth, height: imageHeight },
      };
    }

    const wordPositions = allWords.map((word) => ({
      text: word.text,
      confidence: word.confidence,
      bbox: {
        x: (word.bbox.x0 / imageWidth) * 100,
        y: (word.bbox.y0 / imageHeight) * 100,
        width: ((word.bbox.x1 - word.bbox.x0) / imageWidth) * 100,
        height: ((word.bbox.y1 - word.bbox.y0) / imageHeight) * 100,
      },
    }));

    console.log('[OCR-Extract] SUCCESS:', wordPositions.length, 'words');
    console.log('[OCR-Extract] Sample:', wordPositions.slice(0, 3).map(w => ({
      text: w.text,
      bbox: `x:${w.bbox.x.toFixed(1)}% y:${w.bbox.y.toFixed(1)}%`
    })));

    return {
      text: fullText.trim(),
      words: wordPositions,
      imageSize: { width: imageWidth, height: imageHeight },
    };
  } catch (err) {
    throw new Error(`Tesseract OCR failed: ${err.message}`);
  }
}

/**
 * Find specific words in OCR results
 */
export function findWordPositions(ocrResult, targetWords) {
  if (!ocrResult || !ocrResult.words) return [];

  const positions = [];

  targetWords.forEach((target) => {
    const targetLower = target.word.toLowerCase();

    const found = ocrResult.words.find((w) =>
      w.text.toLowerCase().includes(targetLower) ||
      targetLower.includes(w.text.toLowerCase())
    );

    if (found) {
      positions.push({
        word: target.word,
        index: target.index,
        bbox: found.bbox,
        confidence: found.confidence,
      });
    }
  });

  return positions;
}
