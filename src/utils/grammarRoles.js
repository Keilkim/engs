import nlp from 'compromise';

// Which words of a sentence are a saved pattern's fixed expression and which
// fill its replaceable parts. Shared by the page underlines and the popup.

const isWordChar = char => !!char && /[\p{L}\p{N}]/u.test(char);
// One spelling for matching: lower case, straight apostrophes (same length,
// so offsets into the sentence stay valid).
export const fold = text => text.toLowerCase().replace(/[’‘]/g, "'");
const normalize = text => fold(text).replace(/\s+/g, ' ').trim();
const strings = list => (Array.isArray(list) ? list : []).filter(item => typeof item === 'string' && item.trim());
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const contains = (outer, inner) => outer.start <= inner.start && inner.end <= outer.end;
export const median = values => {
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
    // A contraction is two words ("is" + "n't", "it" + "'s"): an apostrophe
    // suffix starts a word of its own, as standard English tokenizers treat it.
    const startsWord = !(isWordChar(needle[0]) && isWordChar(text[start - 1])) || /^n?'/.test(needle);
    const endsWord = !(isWordChar(needle.at(-1)) && isWordChar(text[end])) || /^n?'/.test(text.slice(end));
    if (startsWord && endsWord) out.push({ start, end });
  }
  return out;
}

export function mergeRanges(ranges) {
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
      chosen[pivot] = { ...anchor, role: anchorPiece.role, label: anchorPiece.label };
      let ok = true;
      if (ordered) {
        for (let k = pivot + 1; ok && k < found.length; k++) {
          const range = found[k].options.find(r => r.start >= chosen[k - 1].end);
          chosen[k] = range && { ...range, role: found[k].role, label: found[k].label };
          ok = !!range;
        }
        for (let k = pivot - 1; ok && k >= 0; k--) {
          const range = found[k].options.findLast(r => r.end <= chosen[k + 1].start);
          chosen[k] = range && { ...range, role: found[k].role, label: found[k].label };
          ok = !!range;
        }
      } else {
        for (let k = 0; k < found.length; k++) {
          if (k === pivot) continue;
          const free = found[k].options.filter(range => fits(range, found[k].role, chosen));
          const near = range => Math.max(0, range.start - anchor.end, anchor.start - range.end);
          const range = free.reduce((a, b) => (near(b) < near(a) ? b : a), free[0]);
          chosen[k] = range && { ...range, role: found[k].role, label: found[k].label };
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
export function sentenceWordList(text, raw) {
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
// stay unmatched (placeholders, "look/watch", optional "(the)"). Tokens keep
// their place in the spelled template so a slot can be labeled with the
// template's own text for it ("A", "~", "V-ing", "동사").
function templateTokens(template) {
  let spelled = template;
  try {
    const doc = nlp(template);
    doc.contractions().expand();
    spelled = doc.text() || template;
  } catch { /* keep the template as written */ }
  const tokens = [];
  for (const match of spelled.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|[^\s\p{L}\p{M}\p{N}+\-/,()]+/gu)) {
    let start = match.index;
    for (const part of match[0].split(/(?<=\p{Script=Latin})(?=\p{Script=Hangul})|(?<=\p{Script=Hangul})(?=\p{Script=Latin})/u)) {
      tokens.push({ text: part, start, end: start + part.length });
      start += part.length;
    }
  }
  return { spelled, tokens };
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

// Which template token(s) each matched sentence word took.
function backtrack(dp, m, end, from, single, double, words) {
  const pairs = new Map();
  // Skip sentence words first so each template word takes the occurrence
  // nearest the one before it ("regardless of the cost of living"); a slot
  // word takes the earliest placeholder it can ("spend A V-ing": two hours → A).
  for (let i = m, j = end - from; i && j;) {
    const s = single[i - 1][from + j - 1], d = i > 1 ? double[i - 2][from + j - 1] : 0;
    if (dp[i][j] === dp[i][j - 1]) j--;
    else if (words[from + j - 1].slot && dp[i][j] === dp[i - 1][j]) i--;
    else if (d && Math.abs(dp[i][j] - dp[i - 2][j - 1] - d) < 1e-9) { pairs.set(from + j - 1, [i - 2, i - 1]); i -= 2; j--; }
    else if (s && Math.abs(dp[i][j] - dp[i - 1][j - 1] - s) < 1e-9) { pairs.set(from + j - 1, [i - 1]); i--; j--; }
    else i--;
  }
  return pairs;
}

// Line the template up with the words around the placed pieces, within their
// clause. Saved slot words stand in for template placeholders (half weight),
// so placements that follow the template's order ("to" before its verb) win.
function alignPattern(placed, templates, text, words) {
  const start = Math.min(...placed.map(r => r.start)), end = Math.max(...placed.map(r => r.end));
  const before = text.slice(0, start).search(/[.!?;][^.!?;]*$/);
  const afterStop = text.slice(end).search(/[.!?;]/);
  const clauseStart = before < 0 ? 0 : before + 1, clauseEnd = afterStop < 0 ? text.length : end + afterStop;
  // One slot fills one placeholder: only its first word stands in for a template token.
  const clause = words.filter(w => w.start >= clauseStart && w.end <= clauseEnd).map(w => {
    const slot = placed.find(r => r.role === 'slot' && overlaps(r, w));
    return { ...w, slot: !!slot, slotHead: !!slot && w.start <= slot.start };
  });
  const first = clause.findIndex(w => w.end > start);
  let last = -1;
  clause.forEach((w, k) => { if (w.start < end) last = k; });
  if (first < 0 || last < first) return null;
  let best = null;
  for (const template of templates) {
    const { tokens } = template;
    const score = (token, word, part) => {
      if (word.slot) return part || !word.slotHead ? 0 : 0.5;
      return part ? tokenScore(token.text, part.forms, part.text, '') : tokenScore(token.text, word.forms, word.text, word.raw);
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
          best = { score: value, length, a, b, dp, template, single, double };
        }
      }
    }
  }
  if (!best) return null;
  const pairs = backtrack(best.dp, best.template.tokens.length, best.b + 1, best.a, best.single, best.double, clause);
  // Only real word matches anchor the template; a slot word's half-weight
  // stand-in does not.
  const anchors = [...pairs].filter(([k]) => !clause[k].slot);
  return { clause, a: best.a, b: best.b, score: best.score, length: best.length, template: best.template, pairs, anchors,
    hasAnchor: anchors.length > 0, start, end };
}

const trimJoiners = text => text.replace(/^[\s+,/-]+|[\s+,/-]+$/g, '');

// The template's own text for each slot piece: whatever the template writes
// between the fixed words around it ("take A into account" → "A"). Slots that
// share one stretch of template ("give A B") split it where each slot's own
// words stood in for template tokens during alignment.
function labelSlots(pieces, alignment) {
  if (!alignment?.hasAnchor) return pieces;
  const { clause, template, anchors, pairs } = alignment;
  const { tokens, spelled } = template;
  const usedTokens = new Set(anchors.flatMap(([, list]) => list));
  const textOf = (lo, hi) => (lo <= hi ? trimJoiners(spelled.slice(tokens[lo].start, tokens[hi].end)) : '');
  const groups = new Map();
  pieces.forEach((piece, i) => {
    if (piece.role !== 'slot') return;
    const indexes = clause.flatMap((word, k) => (overlaps(word, piece) ? [k] : []));
    if (!indexes.length) return;
    const firstWord = Math.min(...indexes), lastWord = Math.max(...indexes);
    const lo = Math.max(-1, ...anchors.filter(([k]) => k < firstWord).flatMap(([, list]) => list)) + 1;
    const hi = Math.min(tokens.length, ...anchors.filter(([k]) => k > lastWord).flatMap(([, list]) => list)) - 1;
    const own = indexes.flatMap(k => (clause[k].slot ? pairs.get(k) || [] : []));
    const key = `${lo}:${hi}`;
    if (!groups.has(key)) groups.set(key, { lo, hi, members: [] });
    groups.get(key).members.push({ i, own: own.length ? Math.min(...own) : null });
  });
  const ranges = new Map();
  for (const { lo, hi, members } of groups.values()) {
    if (members.length === 1) { ranges.set(members[0].i, [lo, hi]); continue; }
    const starts = members.map(m => m.own);
    const ordered = starts.every((start, j) => start !== null && start >= lo && start <= hi && (j === 0 || start > starts[j - 1]));
    members.forEach((member, j) => {
      const last = j === members.length - 1;
      ranges.set(member.i, ordered
        ? [j ? starts[j] : lo, last ? hi : starts[j + 1] - 1]
        : [lo + j, last ? hi : lo + j]); // no pairing: one template token each, in order
    });
  }
  const taken = [];
  const unlabeled = [];
  const labeled = pieces.map((piece, i) => {
    if (!ranges.has(i)) return piece;
    const [lo, hi] = ranges.get(i);
    const label = textOf(lo, hi);
    if (label) { taken.push([lo, hi]); return { ...piece, label }; }
    unlabeled.push(piece);
    return piece;
  });
  if (!unlabeled.length) return labeled;
  // A filler moved away from its placeholder ("pick it up" for "pick up A")
  // takes the template's leftover placeholder text, in order.
  const gaps = [];
  for (let i = 0; i < tokens.length; i++) {
    if (usedTokens.has(i)) continue;
    let j = i;
    while (j + 1 < tokens.length && !usedTokens.has(j + 1)) j++;
    if (!taken.some(([lo, hi]) => lo <= j && i <= hi) && textOf(i, j)) gaps.push(textOf(i, j));
    i = j;
  }
  return labeled.map(piece => (unlabeled.includes(piece) && gaps.length ? { ...piece, label: gaps.shift() } : piece));
}

// Older saves did not record roles: "take this risk into account" as one span,
// "as" + "tall" (the repeated "as" dropped), or only the cue "to". Matched
// words are fixed; unmatched words inside the saved span or between matched
// words fill slots.
function recoverRoles(placed, templates, text, words) {
  const fallback = { pieces: placed, score: 0, length: Infinity };
  const alignment = alignPattern(placed, templates, text, words);
  if (!alignment?.hasAnchor) return fallback; // the template shares no word with the sentence (e.g. "현재완료")
  const { clause, a, b, anchors, start, end } = alignment;
  const anchored = new Set(anchors.map(([k]) => k));
  const explicitSlots = placed.some(r => r.role === 'slot');
  const firstMatch = Math.min(...anchored), lastMatch = Math.max(...anchored);
  const pieces = [];
  for (let k = a; k <= b; k++) {
    const word = clause[k];
    let role = null;
    if (word.slot) role = 'slot';
    else if (anchored.has(k)) role = 'fixed';
    else if (explicitSlots) role = placed.some(r => r.role === 'fixed' && overlaps(r, word)) ? 'fixed' : null;
    else if ((word.start >= start && word.end <= end) || (k > firstMatch && k < lastMatch)) role = 'slot';
    if (!role) continue;
    const previous = pieces.at(-1);
    // Neighbouring words with one role form one piece ("into account").
    if (previous?.role === role && !text.slice(previous.end, word.start).trim()) previous.end = word.end;
    else pieces.push({ start: word.start, end: word.end, role });
  }
  return { pieces: labelSlots(pieces, alignment), score: alignment.score, length: alignment.length };
}

function templatesOf(pattern) {
  const templates = strings(pattern.words);
  if (templates.length > 1) templates.push(templates.join(' '));
  return templates.map(templateTokens).filter(template => template.tokens.length);
}

// A label the model gave counts only if the pattern's own form contains it.
function validLabel(label, pattern) {
  if (typeof label !== 'string' || !label.trim() || label.length > 24) return null;
  const wanted = fold(label.trim());
  return strings(pattern.words).some(word => fold(word).includes(wanted)) ? label.trim() : null;
}

// A "slot" that is really the expression's own word in another form is
// fixed: its label is that word ("was" labeled "be", "played" labeled
// "play"), or, with no usable label, the pattern form spells it ("told" in
// "tell sb sth").
function promoteOwnWords(pieces, words, pattern) {
  const formWords = strings(pattern.words).flatMap(form => form.match(WORD) || []);
  const spelled = (word, tokens) => tokens.some(token => tokenScore(token, word.forms, word.text, word.raw) > 0);
  return pieces.map(piece => {
    if (piece.role !== 'slot') return piece;
    const inside = words.filter(word => overlaps(word, piece));
    if (!inside.length) return piece;
    const labelWords = piece.label ? piece.label.match(WORD) || [] : [];
    // A placeholder spelled exactly like the word ("do" in "make A do") stays a slot.
    const own = piece.label
      ? labelWords.length === inside.length && labelWords.every((token, i) => spelled(inside[i], [token]))
        && labelWords.some((token, i) => fold(token) !== inside[i].text)
      : inside.every(word => spelled(word, formWords));
    return own ? { start: piece.start, end: piece.end, role: 'fixed' } : piece;
  });
}

/**
 * Fixed words vs slot fillers of one pattern, as ranges into the folded
 * sentence text, in sentence order. Slot pieces carry `label`: the
 * template's text for the slot they fill, when it can be told.
 */
export function resolvePatternPieces(pattern, text, words) {
  return pattern ? promoteOwnWords(patternPieces(pattern, text, words), words, pattern) : [];
}

function patternPieces(pattern, text, words) {
  const templates = templatesOf(pattern);
  const segments = (Array.isArray(pattern.segments) ? pattern.segments : [])
    .filter(segment => typeof segment?.text === 'string' && segment.text.trim())
    .map(segment => ({ text: segment.text, role: segment.role === 'slot' ? 'slot' : 'fixed',
      label: segment.role === 'slot' ? validLabel(segment.label, pattern) : null }));
  if (segments.length) {
    const [placed] = placements(text, words, segments, true);
    if (!placed) return [];
    // Each placed slot carries the model's label for that very segment.
    const withGiven = carve(placed).map(({ label, ...piece }) => (piece.role === 'slot' && label ? { ...piece, label } : piece));
    if (!templates.length || withGiven.every(p => p.role !== 'slot' || p.label)) return withGiven;
    const bare = withGiven.map(piece => ({ start: piece.start, end: piece.end, role: piece.role }));
    const derived = labelSlots(bare, alignPattern(bare, templates, text, words));
    return withGiven.map((piece, i) => (piece.role === 'slot' && !piece.label && derived[i]?.label
      ? { ...piece, label: derived[i].label } : piece));
  }
  const pieces = [...strings(pattern.spans).map(text => ({ text, role: 'fixed' })),
    ...strings(pattern.variableSpans).map(text => ({ text, role: 'slot' }))];
  const options = placements(text, words, pieces, false).map(carve);
  if (!templates.length) return options.flat();
  // Keep only the placements the template fits best; ties stay undecided.
  const recovered = options.map(placed => recoverRoles(placed, templates, text, words));
  const top = Math.max(...recovered.map(r => r.score));
  const shortest = Math.min(...recovered.filter(r => r.score === top).map(r => r.length));
  return recovered.filter(r => r.score === top && r.length === shortest).flatMap(r => r.pieces);
}

/** Sentence text prepared once for any number of patterns. */
export function prepareSentence(sentence) {
  const raw = typeof sentence === 'string' ? sentence : '';
  let text = fold(raw);
  if (text.length !== raw.length) text = raw; // exotic case mapping: keep offsets aligned
  return { raw, text, words: sentenceWordList(text, raw) };
}

/**
 * The stretch of the sentence a pattern covers, split into display pieces:
 * { text, role: 'fixed' | 'slot' | null, label? } (null = words in between).
 */
export function sentencePieces(pattern, prepared) {
  const { raw, text, words } = prepared;
  const pieces = mergeByRole(resolvePatternPieces(pattern, text, words));
  if (!pieces.length) return [];
  const out = [];
  let at = pieces[0].start;
  for (const piece of pieces) {
    const between = raw.slice(at, piece.start).trim();
    // Words between the pattern's pieces stay visible; bare punctuation does not.
    if (piece.start > at && /[\p{L}\p{N}]/u.test(between)) out.push({ text: between, role: null });
    out.push({ text: raw.slice(piece.start, piece.end), role: piece.role, ...(piece.label ? { label: piece.label } : {}) });
    at = Math.max(at, piece.end);
  }
  return out;
}

// Sorted, non-overlapping pieces; fixed wins where a pattern's pieces overlap.
function mergeByRole(pieces) {
  const fixed = mergeRanges(pieces.filter(p => p.role === 'fixed'));
  const slots = pieces.filter(p => p.role === 'slot').sort((a, b) => a.start - b.start)
    .filter(slot => !fixed.some(f => contains(f, slot)));
  return [...fixed.map(f => ({ ...f, role: 'fixed' })), ...slots].sort((a, b) => a.start - b.start);
}
