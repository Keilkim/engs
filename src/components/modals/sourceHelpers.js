import { extractTextWithWordPositions, terminateOcrWorker } from '../../services/ai/ocr';

// Crop image to 3:4 thumbnail (matching card aspect-ratio)
export function cropThumbnailFromImage(img) {
  const thumbWidth = 400;
  const scale = thumbWidth / img.width;
  const scaledHeight = img.height * scale;
  const maxHeight = thumbWidth * (4 / 3);
  const canvasHeight = Math.min(scaledHeight, maxHeight);

  const canvas = document.createElement('canvas');
  canvas.width = thumbWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, thumbWidth, scaledHeight);
  return canvas.toDataURL('image/jpeg', 0.7);
}

// Generate thumbnail from image file.
// Resolves null on load/decode failure so callers can proceed without a thumbnail
// instead of hanging forever on an unresolved promise.
export async function generateImageThumbnail(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(cropThumbnailFromImage(img));
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// Generate thumbnail from base64 page image.
// Resolves null on load/decode failure (see note above).
export function generateThumbnailFromPage(pageImage) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(cropThumbnailFromImage(img));
    img.onerror = () => resolve(null);
    img.src = pageImage;
  });
}

// OCR all pages and extract word positions
export async function ocrAllPages(pages, onProgress) {
  const ocrData = { pages: [] };

  try {
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(`OCR ${i + 1}/${pages.length}...`);

      try {
        const result = await extractTextWithWordPositions(pages[i]);
        if (result && result.words) {
          ocrData.pages.push({
            pageIndex: i,
            words: result.words.map(w => ({
              text: w.text,
              bbox: {
                x: w.bbox.x,
                y: w.bbox.y,
                width: w.bbox.width,
                height: w.bbox.height,
              },
            })),
          });
        } else {
          ocrData.pages.push({ pageIndex: i, words: [] });
        }
      } catch {
        ocrData.pages.push({ pageIndex: i, words: [] });
      }
    }

    return ocrData;
  } finally {
    // Terminate the shared OCR worker once, after all pages are done or on failure,
    // so the Web Worker + traineddata WASM memory is always released.
    await terminateOcrWorker();
  }
}
