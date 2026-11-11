import { fold, median, mergeRanges, sentenceWordList, resolvePatternPieces } from './grammarRoles.js';

const validBox = box => box && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key]))
  && box.width > 0 && box.height > 0;

export function groupWordBoxes(words) {
  const lines = [];
  for (const word of words) {
    if (!validBox(word?.bbox)) continue;
    const box = word.bbox;
    let line = lines.find(item => Math.abs(item.y - box.y) <= Math.min(item.height, box.height) * 0.5);
    if (!line) {
      line = { ...box };
      lines.push(line);
    } else {
      const right = Math.max(line.x + line.width, box.x + box.width);
      const bottom = Math.max(line.y + line.height, box.y + box.height);
      line.x = Math.min(line.x, box.x);
      line.y = Math.min(line.y, box.y);
      line.width = right - line.x;
      line.height = bottom - line.y;
    }
  }
  return lines.sort((a, b) => a.y - b.y);
}

function sentenceWords(selection, ocrWords) {
  if (Array.isArray(selection.words) && selection.words.length) {
    return selection.words.filter(word => typeof word?.text === 'string' && validBox(word.bbox));
  }
  // Legacy saves have sentence lines but no individual words. Recover their
  // OCR geometry; never fall back to underlining the whole sentence bounds.
  // A word belongs to the saved line holding most of its box, and words are
  // read line by line, so neighbouring sentences and tilted rows stay out.
  const boxes = (Array.isArray(selection.lines) && selection.lines.length ? selection.lines : [selection.bounds || selection])
    .filter(validBox);
  const area = box => box.width * box.height;
  const inside = (word, box) => Math.max(0, Math.min(word.x + word.width, box.x + box.width) - Math.max(word.x, box.x))
    * Math.max(0, Math.min(word.y + word.height, box.y + box.height) - Math.max(word.y, box.y));
  return ocrWords.flatMap(word => {
    if (typeof word?.text !== 'string' || !validBox(word.bbox)) return [];
    let line = -1, most = 0;
    boxes.forEach((box, index) => {
      const share = inside(word.bbox, box) / area(word.bbox);
      if (share > most) { most = share; line = index; }
    });
    return most >= 0.6 ? [{ word, line }] : [];
  }).sort((a, b) => a.line - b.line || a.word.bbox.x - b.word.bbox.x).map(item => item.word);
}

// ---- Geometry --------------------------------------------------------------

// Glyphs whose ink drops below the baseline.
const DESCENDS = /[gjpqyQ,;()[\]{}|/@$_]/;
const hasLetters = word => /[\p{L}\p{N}]/u.test(word.text);
const overlapY = (a, b) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

// Robust slope: the median of pairwise slopes of points that are far enough apart.
function theilSen(groups, minDx) {
  const slopes = [];
  for (const points of groups) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[j][0] - points[i][0];
        if (Math.abs(dx) >= minDx) slopes.push((points[j][1] - points[i][1]) / dx);
      }
    }
  }
  return slopes.length ? median(slopes) : 0;
}

// OCR boxes hug the ink, so "going" ends lower than "acts". Each visual row is
// underlined along the baseline of its descender-free words, following the
// row's tilt; g/p/y tails simply cross the line.
function visualLines(tokens, ocrWords) {
  const lines = [];
  let line = null, lastLettered = null;
  for (const token of tokens) {
    const box = token.bbox;
    if (!hasLetters(token)) {
      // Dashes, quotes and other marks belong to the row they sit in.
      if (!line) { line = { members: [] }; lines.push(line); }
    } else {
      // Rows follow reading order: a new row starts when the text wraps back
      // left or stops overlapping the previous word vertically.
      if (!line || (lastLettered && (box.x < lastLettered.bbox.x || overlapY(lastLettered.bbox, box) <= 0))) {
        line = { members: [] };
        lines.push(line);
      }
      lastLettered = token;
    }
    line.members.push(token);
    token.line = line;
  }
  const page = ocrWords.filter(word => typeof word?.text === 'string' && validBox(word.bbox));
  for (const row of lines) {
    const lettered = row.members.filter(hasLetters);
    const sample = lettered.length ? lettered : row.members;
    const size = median(sample.map(word => word.bbox.height));
    const width = median(sample.map(word => word.bbox.width));
    // Superscripts and stray marks are too small to sit on the baseline.
    const onBaseline = word => hasLetters(word) && !DESCENDS.test(word.text) && word.bbox.height >= size * 0.6;
    let flat = row.members.filter(onBaseline);
    if (!flat.length) {
      // Every saved word dips ("going by"): borrow baseline words of the same
      // row, walking outwards only across ordinary word spacing so the next
      // column is never reached.
      const sameRow = page.filter(word => sample.some(member =>
        overlapY(member.bbox, word.bbox) >= Math.min(member.bbox.height, word.bbox.height) * 0.5))
        .sort((a, b) => a.bbox.x - b.bbox.x);
      let left = Math.min(...sample.map(w => w.bbox.x)), right = Math.max(...sample.map(w => w.bbox.x + w.bbox.width));
      const gap = width * 0.6;
      for (const word of sameRow) {
        if (word.bbox.x <= right + gap && word.bbox.x + word.bbox.width >= left) right = Math.max(right, word.bbox.x + word.bbox.width);
      }
      for (const word of [...sameRow].reverse()) {
        if (word.bbox.x + word.bbox.width >= left - gap && word.bbox.x <= right) left = Math.min(left, word.bbox.x);
      }
      flat = sameRow.filter(word => onBaseline(word) && word.bbox.x >= left && word.bbox.x + word.bbox.width <= right);
    }
    const center = word => word.bbox.x + word.bbox.width / 2;
    const bottoms = flat.map(word => [center(word), word.bbox.y + word.bbox.height]);
    const middles = sample.map(word => [center(word), word.bbox.y + word.bbox.height / 2]);
    // Tilt from the baseline words, plus the row's word centres when they are too few.
    const slope = theilSen(bottoms.length >= 3 ? [bottoms] : [bottoms, middles], width);
    const points = bottoms.length ? bottoms : sample.map(word => [center(word), word.bbox.y + word.bbox.height * 0.75]);
    const intercept = median(points.map(([x, y]) => y - slope * x));
    row.underlineAt = x => intercept + slope * x + size * 0.08;
    row.size = size;
  }
  return lines;
}

export function buildGrammarMarkers(annotation, ocrWords = []) {
  let selection, analysis;
  try {
    selection = JSON.parse(annotation.selection_rect);
    analysis = JSON.parse(annotation.ai_analysis_json);
  } catch { return []; }
  if (!selection || !Array.isArray(analysis?.patterns)) return [];
  let raw = '';
  const tokens = sentenceWords(selection, ocrWords).map(word => {
    if (raw) raw += ' ';
    const start = raw.length;
    raw += word.text.replace(/\s+/g, ' ').trim();
    return { ...word, start, end: raw.length };
  });
  let text = fold(raw);
  if (text.length !== raw.length) text = raw; // exotic case mapping: keep offsets aligned
  const words = sentenceWordList(text, raw);
  const fixed = [], variable = [];
  for (const pattern of analysis.patterns) {
    for (const piece of resolvePatternPieces(pattern, text, words)) (piece.role === 'slot' ? variable : fixed).push(piece);
  }
  const strong = mergeRanges(fixed);
  // Fixed expressions take precedence where saved patterns overlap.
  // A merged slot keeps the first label; it is shown once, under its first part.
  const weak = mergeRanges(variable).flatMap(range => {
    let pieces = [range];
    for (const fixedRange of strong) {
      pieces = pieces.flatMap(piece => {
        if (fixedRange.end <= piece.start || fixedRange.start >= piece.end) return [piece];
        return [
          ...(fixedRange.start > piece.start ? [{ ...piece, end: fixedRange.start }] : []),
          ...(fixedRange.end < piece.end ? [{ ...piece, start: fixedRange.end }] : []),
        ];
      });
    }
    return pieces.map((piece, i) => (i ? { ...piece, label: undefined } : piece));
  });
  visualLines(tokens, ocrWords); // tags each token with its row
  const markers = [];
  for (const [role, ranges] of [['fixed', strong], ['variable', weak]]) {
    for (const range of ranges) {
      const rows = new Map();
      for (const token of tokens) {
        if (!(token.end > range.start && token.start < range.end && token.end > token.start)) continue;
        const startAt = Math.max(range.start, token.start) - token.start;
        const endAt = Math.min(range.end, token.end) - token.start;
        const length = token.end - token.start;
        const left = token.bbox.x + token.bbox.width * startAt / length;
        const right = token.bbox.x + token.bbox.width * endAt / length;
        const row = rows.get(token.line);
        if (row) { row.left = Math.min(row.left, left); row.right = Math.max(row.right, right); }
        else rows.set(token.line, { left, right });
      }
      let first = true;
      for (const [line, { left, right }] of rows) {
        const marker = { x: left, y: line.underlineAt(left), width: right - left, y2: line.underlineAt(right), role };
        // The slot's label (A, ~, V-ing …) sits under its first row, sized to that row's text.
        if (first && range.label) Object.assign(marker, { label: range.label, size: line.size });
        markers.push(marker);
        first = false;
      }
    }
  }
  return markers.sort((a, b) => a.y - b.y || a.x - b.x);
}

// Page underlines and slot labels render in separate layers from the same
// annotation; build its markers once per annotation and OCR word list.
const markerCache = new WeakMap();
export function grammarMarkersFor(annotation, ocrWords = []) {
  if (!annotation || typeof annotation !== 'object') return [];
  const cached = markerCache.get(annotation);
  if (cached && cached.ocrWords === ocrWords) return cached.markers;
  const markers = buildGrammarMarkers(annotation, ocrWords);
  markerCache.set(annotation, { ocrWords, markers });
  return markers;
}
