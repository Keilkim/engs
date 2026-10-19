import { extractTextWithWordPositions, createOcrSession } from '../../services/ai/ocr';
import { captureWebpageScreenshot } from '../../services/source';
import { loadImage, readBlobAsDataURL } from '../../utils/abort';

// Build the same learning material for new links and legacy article recovery.
// Prepare everything before writing, so a failed capture/OCR leaves saved data intact.
export async function prepareWebCapture(url, onProgress, signal) {
  signal?.throwIfAborted();
  onProgress?.('Capturing screenshot...');
  const { image } = await captureWebpageScreenshot(url.trim(), signal);
  signal?.throwIfAborted();
  const pages = [image];

  onProgress?.('Generating thumbnail...');
  const screenshot = await generateThumbnailFromPage(image, signal);
  if (!screenshot) throw new Error('웹페이지 이미지를 읽지 못했어요. 다시 시도해 주세요.');

  const ocrData = await ocrAllPages(pages, onProgress, signal);
  if (!ocrData.pages.some(page => page.words.length > 0)) {
    throw new Error('웹페이지에서 글자를 인식하지 못했어요. 다시 시도해 주세요.');
  }

  return {
    type: 'screenshot',
    pages: JSON.stringify(pages),
    screenshot,
    ocr_data: ocrData,
  };
}

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
export async function generateImageThumbnail(file, signal) {
  const image = await readBlobAsDataURL(file, signal);
  return generateThumbnailFromPage(image, signal);
}

// Generate thumbnail from base64 page image.
// Resolves null on load/decode failure (see note above).
export async function generateThumbnailFromPage(pageImage, signal) {
  try {
    const img = await loadImage(pageImage, signal);
    signal?.throwIfAborted();
    return cropThumbnailFromImage(img);
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

// OCR all pages and extract word positions
export async function ocrAllPages(pages, onProgress, signal) {
  signal?.throwIfAborted();
  const ocrData = { pages: [] };
  const session = createOcrSession(signal);

  try {
    for (let i = 0; i < pages.length; i++) {
      signal?.throwIfAborted();
      onProgress?.(`OCR ${i + 1}/${pages.length}...`);

      try {
        const result = await extractTextWithWordPositions(pages[i], session, signal);
        signal?.throwIfAborted();
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
        signal?.throwIfAborted();
        ocrData.pages.push({ pageIndex: i, words: [] });
      }
    }

    return ocrData;
  } finally {
    await session.terminate();
  }
}
