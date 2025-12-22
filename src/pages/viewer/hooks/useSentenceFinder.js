import { useCallback } from 'react';

/**
 * Hook for finding sentences from OCR words
 */
export function useSentenceFinder(ocrWords) {
  // Find the full sentence containing a word
  const findSentenceFromWord = useCallback((targetWord) => {
    if (!ocrWords || ocrWords.length === 0 || !targetWord) return null;

    const targetY = targetWord.bbox.y;
    const targetHeight = targetWord.bbox.height;
    const targetX = targetWord.bbox.x;
    const targetRight = targetX + targetWord.bbox.width;
    const targetBottom = targetY + targetHeight;

    // Calculate min gaps in each direction
    let minLeftGap = Infinity;
    let minRightGap = Infinity;
    let minTopGap = Infinity;
    let minBottomGap = Infinity;

    for (const w of ocrWords) {
      if (w === targetWord) continue;
      const wRight = w.bbox.x + w.bbox.width;
      const wBottom = w.bbox.y + w.bbox.height;

      const yOverlap = Math.min(targetBottom, wBottom) - Math.max(targetY, w.bbox.y);
      if (yOverlap > targetHeight * 0.3) {
        if (wRight <= targetX) {
          const gap = targetX - wRight;
          if (gap < minLeftGap) minLeftGap = gap;
        } else if (w.bbox.x >= targetRight) {
          const gap = w.bbox.x - targetRight;
          if (gap < minRightGap) minRightGap = gap;
        }
      }

      const xOverlap = Math.min(targetRight, wRight) - Math.max(targetX, w.bbox.x);
      if (xOverlap > targetWord.bbox.width * 0.3) {
        if (wBottom <= targetY) {
          const gap = targetY - wBottom;
          if (gap < minTopGap) minTopGap = gap;
        } else if (w.bbox.y >= targetBottom) {
          const gap = w.bbox.y - targetBottom;
          if (gap < minBottomGap) minBottomGap = gap;
        }
      }
    }

    const horizontalGap = Math.min(minLeftGap, minRightGap);
    const verticalGap = Math.min(minTopGap, minBottomGap);
    const H_THRESHOLD = horizontalGap === Infinity ? 5 : horizontalGap * 1.5;
    const V_THRESHOLD = verticalGap === Infinity ? targetHeight * 1.5 : verticalGap * 1.5;

    // Flood-fill to find connected words
    const blockWords = new Set([targetWord]);
    const queue = [targetWord];

    while (queue.length > 0) {
      const current = queue.shift();
      const curX = current.bbox.x;
      const curRight = curX + current.bbox.width;
      const curY = current.bbox.y;
      const curBottom = curY + current.bbox.height;

      for (const w of ocrWords) {
        if (blockWords.has(w)) continue;

        const wRight = w.bbox.x + w.bbox.width;
        const wBottom = w.bbox.y + w.bbox.height;

        const yOverlap = Math.min(curBottom, wBottom) - Math.max(curY, w.bbox.y);
        if (yOverlap > current.bbox.height * 0.3) {
          let hGap = Infinity;
          if (wRight <= curX) hGap = curX - wRight;
          else if (w.bbox.x >= curRight) hGap = w.bbox.x - curRight;
          else hGap = 0;

          if (hGap <= H_THRESHOLD) {
            blockWords.add(w);
            queue.push(w);
            continue;
          }
        }

        const xOverlap = Math.min(curRight, wRight) - Math.max(curX, w.bbox.x);
        if (xOverlap > current.bbox.width * 0.3) {
          let vGap = Infinity;
          if (wBottom <= curY) vGap = curY - wBottom;
          else if (w.bbox.y >= curBottom) vGap = w.bbox.y - curBottom;
          else vGap = 0;

          if (vGap <= V_THRESHOLD) {
            blockWords.add(w);
            queue.push(w);
          }
        }
      }
    }

    // Group into lines
    const blockWordsArray = Array.from(blockWords);
    const lineGroups = [];
    const sortedWords = [...blockWordsArray].sort((a, b) => {
      const yDiff = a.bbox.y - b.bbox.y;
      const avgHeight = (a.bbox.height + b.bbox.height) / 2;
      if (Math.abs(yDiff) > avgHeight * 0.5) return yDiff;
      return a.bbox.x - b.bbox.x;
    });

    let currentLine = [];
    let lastY = null;
    let lastHeight = null;

    for (const word of sortedWords) {
      const lineGap = lastY !== null ? Math.abs(word.bbox.y - lastY) : 0;
      const avgHeight = lastHeight !== null ? (word.bbox.height + lastHeight) / 2 : word.bbox.height;

      if (lastY === null || lineGap <= avgHeight * 0.5) {
        currentLine.push(word);
      } else {
        if (currentLine.length > 0) lineGroups.push(currentLine);
        currentLine = [word];
      }
      lastY = word.bbox.y;
      lastHeight = word.bbox.height;
    }
    if (currentLine.length > 0) lineGroups.push(currentLine);

    lineGroups.forEach(line => line.sort((a, b) => a.bbox.x - b.bbox.x));

    // Calculate line heights and gaps
    const lineHeights = lineGroups.map(line => {
      const heights = line.map(w => w.bbox.height);
      return heights.reduce((a, b) => a + b, 0) / heights.length;
    });

    const lineGaps = [];
    for (let i = 1; i < lineGroups.length; i++) {
      const prevLineBottom = Math.max(...lineGroups[i - 1].map(w => w.bbox.y + w.bbox.height));
      const currLineTop = Math.min(...lineGroups[i].map(w => w.bbox.y));
      lineGaps.push(currLineTop - prevLineBottom);
    }

    // Find target line
    let targetLineIdx = -1;
    let targetWordIdx = -1;
    for (let i = 0; i < lineGroups.length; i++) {
      const idx = lineGroups[i].findIndex(w => w === targetWord);
      if (idx !== -1) {
        targetLineIdx = i;
        targetWordIdx = idx;
        break;
      }
    }

    if (targetLineIdx === -1) return null;

    const isSentenceEnd = (text) => /[.!?。！？]$/.test(text) || /^[.!?。！？]+$/.test(text);

    const isHeightBreak = (lineIdx) => {
      if (lineIdx < 0 || lineIdx >= lineGroups.length) return true;
      const currentHeight = lineHeights[targetLineIdx];
      const otherHeight = lineHeights[lineIdx];
      return Math.abs(currentHeight - otherHeight) > currentHeight * 0.4;
    };

    const isParagraphBreak = (gapIdx) => {
      if (gapIdx < 0 || gapIdx >= lineGaps.length) return false;
      const gap = lineGaps[gapIdx];
      const avgHeight = lineHeights[targetLineIdx];
      return gap > avgHeight * 1.3;
    };

    let startLineIdx = targetLineIdx;
    let startWordIdx = 0;
    let endLineIdx = targetLineIdx;
    let endWordIdx = lineGroups[targetLineIdx].length - 1;

    // Search backwards
    outerBack: for (let li = targetLineIdx; li >= 0; li--) {
      if (li < targetLineIdx && isParagraphBreak(li)) {
        startLineIdx = li + 1;
        startWordIdx = 0;
        break outerBack;
      }
      if (li < targetLineIdx && isHeightBreak(li)) {
        startLineIdx = li + 1;
        startWordIdx = 0;
        break outerBack;
      }

      const line = lineGroups[li];
      const searchStart = li === targetLineIdx ? targetWordIdx - 1 : line.length - 1;

      for (let wi = searchStart; wi >= 0; wi--) {
        if (isSentenceEnd(line[wi].text)) {
          startLineIdx = li;
          startWordIdx = wi + 1;
          if (startWordIdx >= line.length && li + 1 < lineGroups.length) {
            startLineIdx = li + 1;
            startWordIdx = 0;
          }
          break outerBack;
        }
      }
      startLineIdx = li;
      startWordIdx = 0;
    }

    // Search forwards
    outerForward: for (let li = targetLineIdx; li < lineGroups.length; li++) {
      if (li > targetLineIdx && isParagraphBreak(li - 1)) {
        endLineIdx = li - 1;
        endWordIdx = lineGroups[li - 1].length - 1;
        break outerForward;
      }
      if (li > targetLineIdx && isHeightBreak(li)) {
        endLineIdx = li - 1;
        endWordIdx = lineGroups[li - 1].length - 1;
        break outerForward;
      }

      const line = lineGroups[li];
      const searchStart = li === targetLineIdx ? targetWordIdx : 0;

      for (let wi = searchStart; wi < line.length; wi++) {
        if (isSentenceEnd(line[wi].text)) {
          endLineIdx = li;
          endWordIdx = wi;
          break outerForward;
        }
      }
      endLineIdx = li;
      endWordIdx = line.length - 1;
    }

    // Collect sentence words
    const sentenceWords = [];
    for (let li = startLineIdx; li <= endLineIdx; li++) {
      const line = lineGroups[li];
      const start = li === startLineIdx ? startWordIdx : 0;
      const end = li === endLineIdx ? endWordIdx : line.length - 1;

      for (let wi = start; wi <= end; wi++) {
        if (line[wi]) sentenceWords.push(line[wi]);
      }
    }

    if (sentenceWords.length === 0) return null;

    const minX = Math.min(...sentenceWords.map(w => w.bbox.x));
    const minY = Math.min(...sentenceWords.map(w => w.bbox.y));
    const maxX = Math.max(...sentenceWords.map(w => w.bbox.x + w.bbox.width));
    const maxY = Math.max(...sentenceWords.map(w => w.bbox.y + w.bbox.height));

    return {
      text: sentenceWords.map(w => w.text).join(' '),
      bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      words: sentenceWords,
    };
  }, [ocrWords]);

  return { findSentenceFromWord };
}
