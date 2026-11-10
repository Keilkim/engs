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
  const boxes = Array.isArray(selection.lines) && selection.lines.length ? selection.lines : [selection.bounds || selection];
  return ocrWords.filter(word => typeof word?.text === 'string' && validBox(word.bbox) && boxes.some(box => {
    if (!validBox(box)) return false;
    const x = word.bbox.x + word.bbox.width / 2;
    const y = word.bbox.y + word.bbox.height / 2;
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  })).sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y;
    return Math.abs(dy) > Math.min(a.bbox.height, b.bbox.height) * 0.5 ? dy : a.bbox.x - b.bbox.x;
  });
}

const isWordChar = char => !!char && /[\p{L}\p{N}]/u.test(char);
const normalize = text => text.toLowerCase().replace(/\s+/g, ' ').trim();

function findRanges(text, spans) {
  const ranges = [];
  for (const span of Array.isArray(spans) ? spans : []) {
    if (typeof span !== 'string') continue;
    const needle = normalize(span);
    if (!needle) continue;
    let from = 0;
    while (from < text.length) {
      const start = text.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      if (!(isWordChar(needle[0]) && isWordChar(text[start - 1]))
        && !(isWordChar(needle.at(-1)) && isWordChar(text[end]))) ranges.push({ start, end });
      from = end;
    }
  }
  return ranges;
}

function mergeRanges(ranges) {
  const out = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = out.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

function splitTemplateSpan(pattern, span) {
  const templates = Array.isArray(pattern.words) ? [...pattern.words, pattern.words.join(' ')] : [];
  for (const template of templates) {
    if (typeof template !== 'string') continue;
    const parts = template.replace(/\s*\+\s*/g, ' ').split(/(\b(?:[A-C]|Ving|Ved|V)\b|동사|명사|형용사|~|…|\.{3})/);
    if (parts.length < 3) continue;
    const regex = parts.map((part, index) => index % 2
      ? '([^.!?;]+?)'
      : `(${normalize(part).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')})`);
    const match = normalize(span).match(new RegExp(`^${regex.join('\\s*')}[.!?]?$`, 'i'));
    if (!match) continue;
    const fixed = [], variable = [];
    match.slice(1).forEach((piece, index) => {
      if (piece?.trim()) (index % 2 ? variable : fixed).push(piece.trim());
    });
    return { fixed, variable };
  }
  return null;
}

export function buildGrammarMarkers(annotation, ocrWords = []) {
  let selection, analysis;
  try {
    selection = JSON.parse(annotation.selection_rect);
    analysis = JSON.parse(annotation.ai_analysis_json);
  } catch { return []; }
  if (!selection || !Array.isArray(analysis?.patterns)) return [];
  const words = sentenceWords(selection, ocrWords);
  let text = '';
  const tokens = words.map(word => {
    if (text) text += ' ';
    const start = text.length;
    text += normalize(word.text);
    return { ...word, start, end: text.length };
  });
  const fixed = [], variable = [];
  for (const pattern of analysis.patterns) {
    if (!pattern) continue;
    const fixedSpans = [], variableSpans = [];
    for (const span of Array.isArray(pattern.spans) ? pattern.spans : []) {
      if (typeof span !== 'string') continue;
      const split = splitTemplateSpan(pattern, span);
      if (split) { fixedSpans.push(...split.fixed); variableSpans.push(...split.variable); }
      else fixedSpans.push(span);
    }
    const spans = findRanges(text, fixedSpans);
    fixed.push(...spans);
    variable.push(...findRanges(text, variableSpans));
    variable.push(...findRanges(text, pattern.variableSpans));
    // Only infer legacy A/B slots bounded by known fixed pieces. Open-ended
    // guesses would underline unrelated clauses at the ends of a sentence.
    if (!pattern.variableSpans?.length && Array.isArray(pattern.words)
      && pattern.words.some(word => typeof word === 'string' && /\b[A-C]\b/.test(word))) {
      const pieces = mergeRanges(spans);
      for (let i = 1; i < pieces.length; i++) {
        const gap = text.slice(pieces[i - 1].end, pieces[i].start);
        if (gap.trim() && !/[.!?;]/.test(gap)) variable.push({ start: pieces[i - 1].end, end: pieces[i].start });
      }
    }
  }
  const strong = mergeRanges(fixed);
  // Fixed expressions take precedence where saved patterns overlap.
  const weak = mergeRanges(variable).flatMap(range => {
    let pieces = [range];
    for (const fixedRange of strong) {
      pieces = pieces.flatMap(piece => {
        if (fixedRange.end <= piece.start || fixedRange.start >= piece.end) return [piece];
        return [
          ...(fixedRange.start > piece.start ? [{ start: piece.start, end: fixedRange.start }] : []),
          ...(fixedRange.end < piece.end ? [{ start: fixedRange.end, end: piece.end }] : []),
        ];
      });
    }
    return pieces;
  });
  const markers = [];
  for (const [role, ranges] of [['fixed', strong], ['variable', weak]]) {
    for (const range of ranges) {
      const selected = tokens.filter(token => token.end > range.start && token.start < range.end && token.end > token.start)
        .map(token => {
          const start = Math.max(range.start, token.start) - token.start;
          const end = Math.min(range.end, token.end) - token.start;
          const length = token.end - token.start;
          return { bbox: { ...token.bbox, x: token.bbox.x + token.bbox.width * start / length,
            width: token.bbox.width * (end - start) / length } };
        });
      markers.push(...groupWordBoxes(selected).map(box => ({ ...box, role })));
    }
  }
  return markers;
}
