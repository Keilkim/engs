// Pure practice rules: the session is bounded; retrying never reschedules a card.
export const PRACTICE_VERSION = 1;
export const PRACTICE_MODES = ['quiet', 'listen', 'speak'];

function readAnalysis(item) {
  try { return JSON.parse(item?.annotation?.ai_analysis_json || '{}') || {}; } catch { return {}; /* legacy card */ }
}
const text = value => typeof value === 'string' ? value.trim() : '';

export function cardContent(item) {
  const analysis = readAnalysis(item);
  return {
    word: text(item?.annotation?.selected_text),
    definition: text(analysis.definition || analysis.translation || item?.annotation?.memo_content),
    sentence: text(analysis.sentence),
    phonetic: text(analysis.phonetic),
    vocabulary: analysis.isVocabulary === true,
    source: text(item?.annotation?.source?.title),
  };
}

// A saved sentence is practiced one checked expression at a time; its schedule stays per sentence.
export function practiceParts(item) {
  const card = cardContent(item);
  const analysis = readAnalysis(item);
  if (analysis.type !== 'grammar') return [{ ...card, kind: 'word' }];
  const sentence = text(analysis.originalText) || card.word;
  const translation = text(analysis.translation);
  const list = value => (Array.isArray(value) ? value : []).map(text).filter(Boolean);
  const patterns = (Array.isArray(analysis.patterns) ? analysis.patterns : []).map(pattern => ({
    word: list(pattern?.words).join(' / ') || list(pattern?.spans).join(' … '),
    definition: text(pattern?.explanation),
    spans: list(pattern?.spans),
  })).filter(pattern => pattern.word && pattern.definition);
  if (!patterns.length) return [{ ...card, word: sentence, definition: translation || card.definition, sentence: '', kind: 'sentence' }];
  return patterns.map(pattern => ({ ...card, ...pattern, sentence, translation, vocabulary: false, kind: 'pattern' }));
}

// Splits a sentence so the expression being practiced can be emphasized in place.
export function markSpans(sentence, spans = []) {
  const isWordChar = ch => Boolean(ch) && /[\p{L}\p{N}_]/u.test(ch);
  const lower = sentence.toLowerCase();
  const ranges = [];
  for (const span of spans) {
    const needle = span.toLowerCase();
    for (let index = needle ? lower.indexOf(needle) : -1; index !== -1; index = lower.indexOf(needle, index + needle.length)) {
      const end = index + needle.length;
      // "not" must not light up inside "nothing".
      if ((isWordChar(span[0]) && isWordChar(sentence[index - 1])) || (isWordChar(span.at(-1)) && isWordChar(sentence[end]))) continue;
      ranges.push([index, end]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const segments = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    if (start > cursor) segments.push({ text: sentence.slice(cursor, start), strong: false });
    const last = segments.at(-1);
    if (last?.strong && start <= cursor) last.text += sentence.slice(cursor, end);
    else segments.push({ text: sentence.slice(Math.max(start, cursor), end), strong: true });
    cursor = end;
  }
  if (cursor < sentence.length) segments.push({ text: sentence.slice(cursor), strong: false });
  return segments;
}

// "I remember it" is checked against one look-alike meaning from another saved card.
export function choiceOptions(target, pool, random = Math.random) {
  const answer = text(target?.definition);
  if (!answer) return null;
  const normalize = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  const senses = value => new Set(normalize(value).split(/[,;·/]/).map(sense => sense.trim()).filter(Boolean));
  const own = senses(answer);
  const ending = value => normalize(value).split(/[,;·/(]/)[0].trim().at(-1);
  const word = normalize(text(target.word));
  const seen = new Set([normalize(answer)]);
  const candidates = [];
  for (const part of pool) {
    const definition = text(part?.definition);
    if (!definition || seen.has(normalize(definition)) || [...senses(definition)].some(sense => own.has(sense))) continue;
    seen.add(normalize(definition));
    const other = normalize(text(part.word));
    let prefix = 0;
    while (prefix < Math.min(word.length, other.length) && word[prefix] === other[prefix]) prefix += 1;
    candidates.push({ definition, score: (part.kind === target.kind ? 4 : 0) + (ending(definition) === ending(answer) ? 1.5 : 0)
      + Math.min(prefix, 3) * 0.5 - (Math.abs(definition.length - answer.length) / Math.max(definition.length, answer.length)) * 2 });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const distractor = candidates[Math.floor(random() * Math.min(3, candidates.length))].definition;
  const first = random() < 0.5;
  return { options: first ? [answer, distractor] : [distractor, answer], answer: first ? 0 : 1 };
}

export function isReturning(lastReviewed, now = Date.now()) {
  const last = Date.parse(lastReviewed);
  return Number.isFinite(last) && now - last >= 7 * 86400000;
}

export function chooseBatch(items, { size = 5, newLimit = 2, sourceId = '' } = {}) {
  const eligible = items.filter(item => item.status === 'active' && cardContent(item).word &&
    (!sourceId || String(item.annotation?.source?.id) === String(sourceId)));
  const byDate = (a, b) => String(a.next_review_date).localeCompare(String(b.next_review_date)) || Number(a.id) - Number(b.id);
  const familiar = eligible.filter(item => item.last_reviewed && item.repetitions > 0).sort(byDate);
  const difficult = eligible.filter(item => item.last_reviewed && !item.repetitions).sort(byDate);
  const fresh = eligible.filter(item => !item.last_reviewed).sort(byDate);
  // One familiar item offers a gentle start without starving forgotten cards.
  const chosen = [...familiar.slice(0, 1), ...difficult, ...familiar.slice(1)];
  return [...chosen, ...fresh.slice(0, Math.max(0, newLimit))].slice(0, Math.max(1, Math.min(20, size)));
}

export function createPractice(items, kind = 'daily', now = Date.now()) {
  return {
    version: PRACTICE_VERSION,
    startedAt: now,
    kind,
    ids: items.map(item => String(item.id)),
    answers: {},
    revealedId: null,
    hintedIds: [],
  };
}

export function currentPracticeId(session) {
  return session?.ids.find(id => !session.answers[id]) ?? null;
}

export function reconcilePractice(session, items) {
  const available = new Map(items.filter(item => item.status === 'active').map(item => [String(item.id), item]));
  const ids = session.ids.filter(id => session.answers[id] || available.has(id));
  const answers = { ...session.answers };
  // Recover a successful server write whose response/local checkpoint was lost.
  if (session.kind === 'daily') {
    for (const id of ids) {
      const item = available.get(id);
      if (!answers[id] && item && Date.parse(item.last_reviewed) >= session.startedAt) {
        answers[id] = { correct: item.repetitions > 0, type: 'recovered', at: Date.parse(item.last_reviewed) };
      }
    }
  }
  return { ...session, ids, answers };
}

export function gradePractice(session, id, correct, type = 'self', now = Date.now()) {
  if (currentPracticeId(session) !== String(id)) return session;
  const { [id]: parts, ...pending } = session.parts || {};
  return {
    ...session,
    answers: { ...session.answers, [id]: { correct, type, at: now, hinted: session.hintedIds.includes(String(id)), ...(parts ? { parts } : {}) } },
    parts: pending,
    revealedId: null,
    result: null,
  };
}

export function compareSpokenAnswer(transcript, expected) {
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[’']/g, "'").replace(/[^\p{L}\p{N}'\s-]/gu, '').replace(/\s+/g, ' ').trim();
  // A mismatch is deliberately NOT an incorrect answer: ASR and synonyms need review.
  return normalize(transcript) && normalize(transcript) === normalize(expected) ? 'match' : 'unconfirmed';
}

export function nextReviewState(item, correct, now = new Date()) {
  const quality = correct ? 4 : 2;
  const ease = Math.max(1.3, (item.ease_factor || 2.5) + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const repetitions = correct ? (item.repetitions || 0) + 1 : 0;
  const interval = !correct || repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round((item.interval_days || 1) * ease);
  const next = new Date(now);
  next.setDate(next.getDate() + interval);
  const localDay = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  return { repetitions, interval_days: interval, ease_factor: ease, next_review_date: localDay, last_reviewed: now.toISOString() };
}

export function createPracticeStorage(storage, userId) {
  const key = `orange-dust:practice:v1:${userId}`;
  return {
    read() {
      if (!userId) return null;
      try {
        const value = JSON.parse(storage.getItem(key));
        if (value?.version !== PRACTICE_VERSION || !Array.isArray(value.ids) || value.ids.length > 20 ||
          !value.ids.every(id => typeof id === 'string') || !value.answers || Array.isArray(value.answers) ||
          typeof value.answers !== 'object' || !Array.isArray(value.hintedIds) ||
          !['daily', 'retry', 'sample', 'check'].includes(value.kind) || !Number.isFinite(value.startedAt) ||
          (value.parts !== undefined && (!value.parts || typeof value.parts !== 'object' || Array.isArray(value.parts) ||
            !Object.values(value.parts).every(parts => Array.isArray(parts) && parts.every(part => typeof part === 'boolean')))) ||
          (value.result != null && typeof value.result?.correct !== 'boolean') ||
          Date.now() - value.startedAt > 7 * 86400000) return null;
        return value;
      } catch { return null; }
    },
    write(value) {
      if (!userId) return false;
      try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
    clear() { try { storage.removeItem(key); } catch { /* unavailable storage */ } },
  };
}

export const SAMPLE_CARDS = [
  ['postpone', '미루다, 연기하다', 'We had to postpone the meeting.'],
  ['figure out', '알아내다, 이해하다', 'Let’s figure out what happened.'],
  ['reservation', '예약', 'I have a reservation for two.'],
].map(([word, definition, sentence], index) => ({
  id: `sample-${index}`, status: 'active', repetitions: 0,
  annotation: { selected_text: word, ai_analysis_json: JSON.stringify({ isVocabulary: true, word, definition, sentence }) },
}));
