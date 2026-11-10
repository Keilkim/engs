import nlp from 'compromise';

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

const isWordChar = char => !!char && /[\p{L}\p{N}]/u.test(char);
// One spelling for matching: lower case, straight apostrophes (same length,
// so offsets into the sentence stay valid).
const fold = text => text.toLowerCase().replace(/[’‘]/g, "'");
const normalize = text => fold(text).replace(/\s+/g, ' ').trim();
const strings = list => (Array.isArray(list) ? list : []).filter(item => typeof item === 'string' && item.trim());
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const contains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Every whole-word occurrence of `piece` in the sentence text.
function occurrences(text, piece) {
  const needle = normalize(piece);
  const out = [];
  if (!needle) return out;
  for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + 1)) {
    const end = start + needle.length;
    if (!(isWordChar(needle[0]) && isWordChar(text[start - 1]))
      && !(isWordChar(needle.at(-1)) && isWordChar(text[end]))) out.push({ start, end });
  }
  return out;
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

// A pattern's pieces belong together ("to" + "leave"), so each piece is placed
// once, on the occurrences that keep the pattern most compact (counted in
// words; in sentence order when the order is known). Returns every equally
// compact placement: when saved data cannot tell occurrences apart, neither
// is preferred here.
function placements(text, words, pieces, ordered) {
  const found = pieces.map(piece => ({ ...piece, options: occurrences(text, piece.text) }))
    .filter(piece => piece.options.length);
  if (!found.length) return [];
  const span = chosen => {
    const start = Math.min(...chosen.map(r => r.start)), end = Math.max(...chosen.map(r => r.end));
    return words.filter(word => word.start >= start && word.end <= end).length;
  };
  // A slot saved inside a fixed span ("take this risk into account" + "this
  // risk") is carved out of it; any other overlap is a contradictory save.
  const fits = (range, role, chosen) => chosen.every(other => !other || !overlaps(other, range)
    || (role === 'slot' && other.role === 'fixed' && contains(other, range))
    || (role === 'fixed' && other.role === 'slot' && contains(range, other)));
  const results = new Map();
  let bestCount = 0, bestSpan = Infinity;
  found.forEach((anchorPiece, pivot) => {
    for (const anchor of anchorPiece.options) {
      const chosen = [];
      chosen[pivot] = { ...anchor, role: anchorPiece.role };
      let ok = true;
      if (ordered) {
        for (let k = pivot + 1; ok && k < found.length; k++) {
          const range = found[k].options.find(r => r.start >= chosen[k - 1].end);
          chosen[k] = range && { ...range, role: found[k].role };
          ok = !!range;
        }
        for (let k = pivot - 1; ok && k >= 0; k--) {
          const range = found[k].options.findLast(r => r.end <= chosen[k + 1].start);
          chosen[k] = range && { ...range, role: found[k].role };
          ok = !!range;
        }
      } else {
        for (let k = 0; k < found.length; k++) {
          if (k === pivot) continue;
          const free = found[k].options.filter(range => fits(range, found[k].role, chosen));
          const near = range => Math.max(0, range.start - anchor.end, anchor.start - range.end);
          const range = free.reduce((a, b) => (near(b) < near(a) ? b : a), free[0]);
          chosen[k] = range && { ...range, role: found[k].role };
        }
      }
      if (!ok) continue;
      const kept = chosen.filter(Boolean);
      const size = span(kept);
      if (kept.length < bestCount || (kept.length === bestCount && size > bestSpan)) continue;
      if (kept.length > bestCount || size < bestSpan) results.clear();
      bestCount = kept.length;
      bestSpan = size;
      const sorted = [...kept].sort((a, b) => a.start - b.start || a.end - b.end);
      results.set(sorted.map(r => `${r.start}-${r.end}-${r.role}`).join(','), sorted);
    }
  });
  if (!results.size && ordered) return placements(text, words, pieces, false);
  const all = [...results.values()];
  return ordered ? all.slice(0, 1) : all;
}

// Fixed ranges minus the slots carved out of them.
function carve(pieces) {
  const slots = pieces.filter(p => p.role === 'slot');
  return pieces.flatMap(piece => {
    if (piece.role === 'slot') return [piece];
    let parts = [piece];
    for (const slot of slots) {
      parts = parts.flatMap(part => (!contains(part, slot) ? [part] : [
        ...(slot.start > part.start ? [{ ...part, end: slot.start }] : []),
        ...(slot.end < part.end ? [{ ...part, start: slot.end }] : []),
      ]));
    }
    return parts.filter(part => part.end > part.start);
  });
}

// ---- Word identity -------------------------------------------------------
// Template words are compared with sentence words by every spelling they can
// take (am/is/was ↔ be, took ↔ take, didn't ↔ did + not, She's ↔ she + has).

const formCache = new Map();
function wordForms(word) {
  if (formCache.has(word)) return formCache.get(word);
  const forms = new Set([word]);
  try {
    const doc = nlp(word);
    doc.compute('root');
    for (const term of doc.json()[0]?.terms || []) {
      for (const form of [term.normal, term.root]) if (form) forms.add(fold(form));
    }
    for (const verb of doc.verbs().conjugate()) {
      for (const form of Object.values(verb)) if (typeof form === 'string') forms.add(fold(form));
    }
  } catch { /* unknown word: its own spelling is its only form */ }
  formCache.set(word, forms);
  return forms;
}

// Sentence words read in context: a contraction is split into the words it
// stands for (She's been → she + has), each with its own forms.
function sentenceWordList(text, raw) {
  const words = [...text.matchAll(WORD)].map(match => ({
    start: match.index, end: match.index + match[0].length, text: match[0],
    raw: raw.slice(match.index, match.index + match[0].length), parts: [],
  }));
  try {
    let host = null;
    for (const sentence of nlp(raw).json({ offset: true })) {
      for (const term of sentence.terms) {
        const start = term.offset?.start ?? -1;
        const word = term.text ? words.find(w => w.start <= start && start < w.end) : host;
        if (term.text) host = word;
        if (!word) continue;
        const spelled = fold(term.implicit || term.normal || term.text || '');
        if (spelled) word.parts.push({ text: spelled, forms: new Set(wordForms(spelled)) });
      }
    }
  } catch { /* fall back to the bare spelling below */ }
  for (const word of words) {
    if (!word.parts.length) word.parts.push({ text: word.text, forms: wordForms(word.text) });
    word.forms = new Set(word.parts.flatMap(part => [...part.forms]));
    if (word.parts.length === 1) for (const form of wordForms(word.text)) word.forms.add(form);
  }
  return words;
}

// Upper-case template words (A, B, V, SB) are notation unless the sentence
// spells them the same way ("I", "TV").
function tokenScore(token, forms, text, raw) {
  if (token === token.toUpperCase() && token !== token.toLowerCase()) return raw === token ? 1 : 0;
  const lower = fold(token);
  if (lower === text) return 1;
  return [...wordForms(lower)].some(form => forms.has(form)) ? 0.9 : 0;
}

// Template notation is never interpreted. Contractions are spelled out, then
// its words are matched in order to the sentence words; a template word may
// stay unmatched (placeholders, "look/watch", optional "(the)").
function templateTokens(template) {
  let spelled = template;
  try {
    const doc = nlp(template);
    doc.contractions().expand();
    spelled = doc.text() || template;
  } catch { /* keep the template as written */ }
  return (spelled.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|[^\s\p{L}\p{M}\p{N}+\-/,()]+/gu) || [])
    .flatMap(token => token.split(/(?<=\p{Script=Latin})(?=\p{Script=Hangul})|(?<=\p{Script=Hangul})(?=\p{Script=Latin})/u));
}

// Weighted in-order matching of template tokens to words[from..]. A word that
// is a contraction may take the two template words it stands for.
function alignFrom(tokens, words, from, single, double) {
  const m = tokens.length, n = words.length - from;
  const dp = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      let best = Math.max(dp[i - 1][j], dp[i][j - 1]);
      const s = single[i - 1][from + j - 1];
      if (s) best = Math.max(best, dp[i - 1][j - 1] + s);
      const d = i > 1 ? double[i - 2][from + j - 1] : 0;
      if (d) best = Math.max(best, dp[i - 2][j - 1] + d);
      dp[i][j] = best;
    }
  }
  return dp;
}

function backtrack(dp, m, end, from, single, double) {
  const matched = new Set();
  // Skip sentence words first so each template word takes the occurrence
  // nearest the one before it ("regardless of the cost of living").
  for (let i = m, j = end - from; i && j;) {
    const s = single[i - 1][from + j - 1], d = i > 1 ? double[i - 2][from + j - 1] : 0;
    if (dp[i][j] === dp[i][j - 1]) j--;
    else if (d && Math.abs(dp[i][j] - dp[i - 2][j - 1] - d) < 1e-9) { matched.add(from + j - 1); i -= 2; j--; }
    else if (s && Math.abs(dp[i][j] - dp[i - 1][j - 1] - s) < 1e-9) { matched.add(from + j - 1); i--; j--; }
    else i--;
  }
  return matched;
}

// Older saves did not record roles: "take this risk into account" as one span,
// "as" + "tall" (the repeated "as" dropped), or only the cue "to". Line the
// template up with the words around the saved pieces, within their clause:
// matched words are fixed; unmatched words inside the saved span or between
// matched words fill slots.
function recoverRoles(placed, templates, text, words) {
  const start = Math.min(...placed.map(r => r.start)), end = Math.max(...placed.map(r => r.end));
  const before = text.slice(0, start).search(/[.!?;][^.!?;]*$/);
  const afterStop = text.slice(end).search(/[.!?;]/);
  const clauseStart = before < 0 ? 0 : before + 1, clauseEnd = afterStop < 0 ? text.length : end + afterStop;
  const clause = words.filter(w => w.start >= clauseStart && w.end <= clauseEnd)
    .map(w => ({ ...w, slot: placed.some(r => r.role === 'slot' && overlaps(r, w)) }));
  const first = clause.findIndex(w => w.end > start);
  let last = -1;
  clause.forEach((w, k) => { if (w.start < end) last = k; });
  const fallback = { pieces: placed, score: 0, length: Infinity };
  if (first < 0 || last < first) return fallback;
  let best = null;
  for (const tokens of templates) {
    // A saved slot word stands in for a template placeholder (half weight),
    // so placements that follow the template's order ("to" before its verb) win.
    const score = (token, word, part) => {
      if (word.slot) return part ? 0 : 0.5;
      return part ? tokenScore(token, part.forms, part.text, '') : tokenScore(token, word.forms, word.text, word.raw);
    };
    const single = tokens.map(token => clause.map(word => score(token, word)));
    const double = tokens.slice(0, -1).map((token, i) => clause.map(word => {
      if (word.parts.length < 2) return 0;
      const a = score(token, word, word.parts[0]), b = score(tokens[i + 1], word, word.parts[1]);
      return a && b ? a + b : 0;
    }));
    for (let a = first; a >= 0; a--) {
      const dp = alignFrom(tokens, clause, a, single, double);
      for (let b = last; b < clause.length; b++) {
        const value = dp[tokens.length][b - a + 1], length = b - a + 1;
        if (value && (!best || value > best.score + 1e-9 || (Math.abs(value - best.score) < 1e-9 && length < best.length))) {
          best = { score: value, length, a, b, dp, tokens, single, double };
        }
      }
    }
  }
  if (!best) return fallback; // the template shares no word with the sentence (e.g. "현재완료")
  const matched = backtrack(best.dp, best.tokens.length, best.b + 1, best.a, best.single, best.double);
  const explicitSlots = placed.some(r => r.role === 'slot');
  const firstMatch = Math.min(...matched), lastMatch = Math.max(...matched);
  const pieces = [];
  for (let k = best.a; k <= best.b; k++) {
    const word = clause[k];
    let role = null;
    if (word.slot) role = 'slot';
    else if (matched.has(k)) role = 'fixed';
    else if (explicitSlots) role = placed.some(r => r.role === 'fixed' && overlaps(r, word)) ? 'fixed' : null;
    else if ((word.start >= start && word.end <= end) || (k > firstMatch && k < lastMatch)) role = 'slot';
    if (!role) continue;
    const previous = pieces.at(-1);
    // Neighbouring words with one role form one piece ("into account").
    if (previous?.role === role && !text.slice(previous.end, word.start).trim()) previous.end = word.end;
    else pieces.push({ start: word.start, end: word.end, role });
  }
  return { pieces, score: best.score, length: best.length };
}

function templatesOf(pattern) {
  const templates = strings(pattern.words);
  if (templates.length > 1) templates.push(templates.join(' '));
  return templates.map(templateTokens).filter(tokens => tokens.length);
}

// Fixed words vs slot fillers of one pattern, as character ranges.
function patternPieces(pattern, text, words) {
  const segments = (Array.isArray(pattern.segments) ? pattern.segments : [])
    .filter(segment => typeof segment?.text === 'string' && segment.text.trim())
    .map(segment => ({ text: segment.text, role: segment.role === 'slot' ? 'slot' : 'fixed' }));
  if (segments.length) return placements(text, words, segments, true).flatMap(carve);
  const pieces = [...strings(pattern.spans).map(text => ({ text, role: 'fixed' })),
    ...strings(pattern.variableSpans).map(text => ({ text, role: 'slot' }))];
  const options = placements(text, words, pieces, false).map(carve);
  const templates = templatesOf(pattern);
  if (!templates.length) return options.flat();
  // Keep only the placements the template fits best; ties stay undecided.
  const recovered = options.map(placed => recoverRoles(placed, templates, text, words));
  const top = Math.max(...recovered.map(r => r.score));
  const shortest = Math.min(...recovered.filter(r => r.score === top).map(r => r.length));
  return recovered.filter(r => r.score === top && r.length === shortest).flatMap(r => r.pieces);
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
    if (!pattern) continue;
    for (const piece of patternPieces(pattern, text, words)) (piece.role === 'slot' ? variable : fixed).push(piece);
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
      for (const [line, { left, right }] of rows) {
        markers.push({ x: left, y: line.underlineAt(left), width: right - left, y2: line.underlineAt(right), role });
      }
    }
  }
  return markers.sort((a, b) => a.y - b.y || a.x - b.x);
}
