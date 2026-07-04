// Discover-core: interest-keyword extraction + profile math.
//
// Environment-free ESM (browser + Node). `compromise` is already a dependency and
// runs in both. The SAME extractTerms() tokenizes both the user's content and every
// candidate — a fair overlap score depends on both sides being tokenized identically.
import nlp from 'compromise';
import {
  INTEREST_HALF_LIFE_DAYS,
  VOCAB_WEIGHT_MULT,
  TOP_INTEREST_TERMS,
  MIN_TERM_LEN,
} from './constants.js';

// A small stop list on top of compromise's POS filtering — high-frequency words that
// slip through as "nouns" but carry no interest signal.
const STOPWORDS = new Set([
  'thing', 'things', 'way', 'ways', 'part', 'parts', 'lot', 'lots', 'kind', 'kinds',
  'type', 'types', 'day', 'days', 'time', 'times', 'year', 'years', 'people', 'person',
  'video', 'videos', 'watch', 'episode', 'part', 'full', 'official', 'new', 'best',
  'top', 'guide', 'tutorial', 'review', 'com', 'www', 'http', 'https',
]);

function normalizeTerm(raw) {
  const t = String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '') // keep letters/numbers/space/hyphen
    .trim();
  if (t.length < MIN_TERM_LEN) return null;
  if (STOPWORDS.has(t)) return null;
  if (/^\d+$/.test(t)) return null; // bare numbers
  return t;
}

/**
 * Tokenize free text into weighted-overlap terms.
 * Returns a de-duplicated array of { term, pos } where pos ∈ 'topic'|'noun'|'adj'.
 * `topic` (proper nouns / named entities) rank above common nouns.
 */
export function extractTerms(text) {
  if (!text || typeof text !== 'string') return [];
  let doc;
  try {
    doc = nlp(text);
  } catch {
    return [];
  }
  const out = new Map(); // term -> pos (strongest pos wins)
  const RANK = { topic: 3, noun: 2, adj: 1 };
  const register = (term, pos) => {
    if (!term) return;
    const prev = out.get(term);
    if (!prev || RANK[pos] > RANK[prev]) out.set(term, pos);
  };
  // compromise returns multi-word noun PHRASES ("algorithm advances"). Index BOTH the
  // whole phrase AND each component word, so a single-word interest ("algorithm") still
  // overlaps a phrase candidate (and vice-versa) — the whole point of keyword matching.
  const add = (arr, pos) => {
    for (const raw of arr || []) {
      const full = normalizeTerm(raw);
      if (full) register(full, pos);
      const words = String(raw).split(/[\s\-/]+/);
      if (words.length > 1) {
        for (const w of words) {
          const nw = normalizeTerm(w);
          if (nw && nw !== full) register(nw, pos === 'topic' ? 'noun' : pos);
        }
      }
    }
  };

  try { add(doc.topics().out('array'), 'topic'); } catch { /* compromise variance */ }
  try { add(doc.nouns().toSingular().out('array'), 'noun'); } catch {
    try { add(doc.nouns().out('array'), 'noun'); } catch { /* ignore */ }
  }
  try { add(doc.match('#Adjective').out('array'), 'adj'); } catch { /* ignore */ }

  const terms = [];
  for (const [term, pos] of out.entries()) terms.push({ term, pos });
  return terms;
}

const POS_MULT = { topic: 1.4, noun: 1.0, adj: 0.6 };

/**
 * Build the interest profile from the user's own content.
 * @param sources  array of { title, created_at }  (any source type)
 * @param vocab    array of { word, created_at }    (saved vocabulary — word IS the interest)
 * @param nowMs    current time in ms (injected — the module must stay deterministic/testable)
 * Returns { keywords: { term: { base, pref, pos, lastSeen } } }.
 */
export function buildInterestProfile(sources = [], vocab = [], nowMs = Date.now(), prevProfile = null) {
  const keywords = {};
  const prevPrefs = prevProfile?.keywords || {};

  const bump = (term, pos, weight, whenIso) => {
    const k = keywords[term] || {
      base: 0,
      pref: prevPrefs[term]?.pref ?? 0, // preserve learned preference across rebuilds
      pos,
      lastSeen: whenIso || null,
    };
    k.base += weight;
    // keep the strongest POS seen
    if ((POS_MULT[pos] || 0) > (POS_MULT[k.pos] || 0)) k.pos = pos;
    if (whenIso && (!k.lastSeen || whenIso > k.lastSeen)) k.lastSeen = whenIso;
    keywords[term] = k;
  };

  const recency = (whenIso) => {
    if (!whenIso) return 0.5;
    const ageDays = Math.max(0, (nowMs - new Date(whenIso).getTime()) / 86400000);
    if (!Number.isFinite(ageDays)) return 0.5;
    return Math.pow(0.5, ageDays / INTEREST_HALF_LIFE_DAYS);
  };

  for (const s of sources || []) {
    const r = recency(s?.created_at);
    for (const { term, pos } of extractTerms(s?.title || '')) {
      bump(term, pos, r * (POS_MULT[pos] || 1), s?.created_at);
    }
  }
  for (const v of vocab || []) {
    const word = v?.word || v?.selected_text || '';
    const r = recency(v?.created_at);
    // A saved word is a first-class interest token; weight it up and treat as a topic-ish noun.
    for (const { term, pos } of extractTerms(word)) {
      bump(term, pos, r * VOCAB_WEIGHT_MULT * (POS_MULT[pos] || 1), v?.created_at);
    }
  }

  return { keywords };
}

/** effectiveWeight = base * (1 + pref). pref (preference learning) starts at 0. */
export function effectiveWeight(profile, term) {
  const k = profile?.keywords?.[term];
  if (!k) return 0;
  return Math.max(0, k.base) * (1 + (k.pref || 0));
}

/** Top-N interest terms by effective weight — the "active interest set". */
export function topInterestTerms(profile, n = TOP_INTEREST_TERMS) {
  const kws = profile?.keywords || {};
  return Object.keys(kws)
    .map((term) => ({ term, weight: effectiveWeight(profile, term), pos: kws[term].pos }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : 1))
    .slice(0, n);
}
