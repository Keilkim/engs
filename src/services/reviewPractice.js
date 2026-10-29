// Pure practice rules: the session is bounded; retrying never reschedules a card.
export const PRACTICE_VERSION = 1;
export const PRACTICE_MODES = ['quiet', 'listen', 'speak'];

export function cardContent(item) {
  let analysis = {};
  try { analysis = JSON.parse(item?.annotation?.ai_analysis_json || '{}') || {}; } catch { /* legacy card */ }
  const string = value => typeof value === 'string' ? value.trim() : '';
  return {
    word: string(item?.annotation?.selected_text),
    definition: string(analysis.definition || analysis.translation || item?.annotation?.memo_content),
    sentence: string(analysis.sentence),
    phonetic: string(analysis.phonetic),
    vocabulary: analysis.isVocabulary === true,
    source: string(item?.annotation?.source?.title),
  };
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
  return {
    ...session,
    answers: { ...session.answers, [id]: { correct, type, at: now, hinted: session.hintedIds.includes(String(id)) } },
    revealedId: null,
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
