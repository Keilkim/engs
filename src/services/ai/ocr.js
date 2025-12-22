import Tesseract from 'tesseract.js';

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
    const result = await Tesseract.recognize(base64Image, 'eng', {
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
    console.error('Tesseract OCR failed:', err);
    return null;
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
      const result = await Tesseract.recognize(images[i], 'eng', {
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
      console.error(`Page ${i + 1} OCR failed:`, err);
    }
  }

  console.log(`Word bag extracted: ${wordSet.size} unique words`);
  return wordSet;
}

/**
 * Extract text with word-level bounding boxes (Tesseract.js v7)
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

    const worker = await Tesseract.createWorker('eng', 1);

    const result = await worker.recognize(base64Image, {}, {
      text: true,
      blocks: true,
    });

    console.log('[OCR-Extract] result.data keys:', Object.keys(result.data || {}));
    console.log('[OCR-Extract] text length:', result.data.text?.length);

    const data = result.data;
    const allWords = [];

    if (data.blocks) {
      console.log('[OCR-Extract] blocks type:', typeof data.blocks);
      console.log('[OCR-Extract] blocks is array:', Array.isArray(data.blocks));

      if (typeof data.blocks === 'object' && !Array.isArray(data.blocks)) {
        console.log('[OCR-Extract] blocks keys:', Object.keys(data.blocks));
        console.log('[OCR-Extract] blocks sample:', JSON.stringify(data.blocks).substring(0, 500));
      }

      const blocksArray = Array.isArray(data.blocks) ? data.blocks : [data.blocks];
      for (const block of blocksArray) {
        if (!block) continue;

        if (block.words && Array.isArray(block.words)) {
          for (const word of block.words) {
            if (word.text && word.bbox) {
              allWords.push({ text: word.text.trim(), confidence: word.confidence || 90, bbox: word.bbox });
            }
          }
        }

        for (const para of (block.paragraphs || [])) {
          for (const line of (para.lines || [])) {
            for (const word of (line.words || [])) {
              if (word.text && word.bbox) {
                allWords.push({ text: word.text.trim(), confidence: word.confidence || 90, bbox: word.bbox });
              }
            }
          }
        }
      }
      console.log('[OCR-Extract] Extracted from blocks:', allWords.length, 'words');
    }

    if (allWords.length === 0 && data.words && Array.isArray(data.words)) {
      console.log('[OCR-Extract] Trying data.words:', data.words.length);
      for (const word of data.words) {
        if (word.text && word.bbox) {
          allWords.push({ text: word.text.trim(), confidence: word.confidence || 90, bbox: word.bbox });
        }
      }
    }

    await worker.terminate();

    if (allWords.length === 0) {
      console.log('[OCR-Extract] NO WORDS FOUND!');
      console.log('[OCR-Extract] data.blocks:', data.blocks);
      console.log('[OCR-Extract] data.words:', data.words);

      return {
        text: data.text || '',
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
      text: data.text,
      words: wordPositions,
      imageSize: { width: imageWidth, height: imageHeight },
    };
  } catch (err) {
    console.error('Tesseract OCR failed:', err);
    return null;
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
