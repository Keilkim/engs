import { callGeminiVision } from './gemini';

/**
 * Detect main content area in webpage screenshot using Gemini Vision
 */
export async function detectMainContent(base64Image) {
  const prompt = `Analyze this webpage screenshot and find the main content area.

IMPORTANT: Be GENEROUS with the selection. Include ALL meaningful content:
- Include ALL text, images, galleries, videos, cards, and visual elements
- Include sidebars if they contain useful content (not just ads)
- ONLY exclude: fixed navigation bars at top, cookie banners, sticky footers, and popup overlays

Return ONLY a JSON object (no other text):
{"x": startX(0-100%), "y": startY(0-100%), "width": width(0-100%), "height": height(0-100%)}

For most pages, the result should be close to: {"x": 0, "y": 5, "width": 100, "height": 90}
Only crop more aggressively if there are obvious ads or empty margins.`;

  try {
    const text = await callGeminiVision(prompt, base64Image);

    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Failed to parse AI response:', e);
  }

  return { x: 0, y: 0, width: 100, height: 100 };
}

/**
 * Crop image using Canvas (percentage-based region)
 */
export async function cropImage(base64Image, region) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const x = (region.x / 100) * img.width;
      const y = (region.y / 100) * img.height;
      const width = (region.width / 100) * img.width;
      const height = (region.height / 100) * img.height;

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = base64Image;
  });
}

/**
 * Crop specific region from image pages
 */
export async function cropImageRegion(pages, page, region) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const x = Math.max(0, region.x);
      const y = Math.max(0, region.y);
      const width = Math.min(100 - x, region.width);
      const height = Math.min(100 - y, region.height);

      const px = (x / 100) * img.width;
      const py = (y / 100) * img.height;
      const pwidth = (width / 100) * img.width;
      const pheight = (height / 100) * img.height;

      canvas.width = pwidth;
      canvas.height = pheight;

      ctx.drawImage(img, px, py, pwidth, pheight, 0, 0, pwidth, pheight);

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = pages[page];
  });
}
