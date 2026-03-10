import { extractTextWithWordPositions } from '../../services/ai';

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

// Generate thumbnail from image file
export async function generateImageThumbnail(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(cropThumbnailFromImage(img));
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Generate thumbnail from base64 page image
export function generateThumbnailFromPage(pageImage) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(cropThumbnailFromImage(img));
    img.src = pageImage;
  });
}

// OCR all pages and extract word positions
export async function ocrAllPages(pages, onProgress) {
  const ocrData = { pages: [] };

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
}
