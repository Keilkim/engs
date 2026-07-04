// Discover-core: candidate identity, keyword-similarity ranking, per-type quality.
//
// Environment-free ESM (browser + Node). No embeddings — a weighted token overlap
// against the interest set, integrated into a signal-registry score mirroring
// src/services/shelf.js (the `parts` object + Σ wᵢ·sᵢ + deterministic sort).
import {
  WEIGHTS,
  FRESHNESS_WINDOW_DAYS,
  TOP_INTEREST_TERMS,
  PDF_SIZE,
  YT_DURATION,
} from './constants.js';
import { extractTerms, topInterestTerms } from './keywords.js';

// --- URL canonicalization + stable candidate id -------------------------------
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$|si$|spm$)/i;

export function canonicalUrl(url) {
  try {
    const u = new URL(String(url).trim());
    const protocol = u.protocol === 'http:' ? 'https:' : u.protocol;
    const host = u.host.toLowerCase().replace(/^www\./, '');
    const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
    keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const query = new URLSearchParams(keep).toString();
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1); // drop trailing slash (not bare origin)
    return `${protocol}//${host}${path}${query ? `?${query}` : ''}`;
  } catch {
    return String(url || '').trim();
  }
}

// FNV-1a 32-bit → 8-char hex. Sync + dependency-free, so ids are identical in the
// browser and in Node (a real sha1 would force async crypto.subtle in the browser).
export function hashStr(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const KIND_PREFIX = { youtube: 'yt', web: 'web', pdf: 'pdf' };

/** Stable id: youtube keys on videoId, others on the canonical URL hash. */
export function candidateId({ kind, url, videoId } = {}) {
  const prefix = KIND_PREFIX[kind] || kind || 'x';
  if (kind === 'youtube' && videoId) return `${prefix}:${videoId}`;
  return `${prefix}:${hashStr(canonicalUrl(url))}`;
}

// --- signals ------------------------------------------------------------------
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/** freshness: linear decay to 0 across FRESHNESS_WINDOW_DAYS; unknown date → mildly stale. */
export function freshnessScore(publishedIso, nowMs = Date.now()) {
  if (!publishedIso) return 0.3;
  const t = new Date(publishedIso).getTime();
  if (!Number.isFinite(t)) return 0.3;
  const ageDays = (nowMs - t) / 86400000;
  return clamp01(1 - ageDays / FRESHNESS_WINDOW_DAYS);
}

/** per-type quality (PDF size-fit / YouTube watchable-band / web has-image). */
export function qualityScore(candidate) {
  if (candidate.kind === 'pdf') {
    const b = candidate?.extra?.fileSizeBytes;
    if (!b || b <= 0) return PDF_SIZE.UNKNOWN_SCORE;
    if (b < PDF_SIZE.FLOOR) return 0.1;
    if (b <= PDF_SIZE.IDEAL_LO) return 0.6 + 0.4 * ((b - PDF_SIZE.FLOOR) / (PDF_SIZE.IDEAL_LO - PDF_SIZE.FLOOR));
    if (b <= PDF_SIZE.IDEAL_HI) return 1;
    if (b <= PDF_SIZE.CEIL) return clamp01(1 - 0.8 * ((b - PDF_SIZE.IDEAL_HI) / (PDF_SIZE.CEIL - PDF_SIZE.IDEAL_HI)));
    return 0.2;
  }
  if (candidate.kind === 'youtube') {
    const d = candidate?.extra?.durationSec || 0;
    if (!d) return 0.6; // unknown → neutral-ish
    if (d < 60) return 0.3; // too short for decoding practice
    if (d >= YT_DURATION.LO_SEC && d <= YT_DURATION.HI_SEC) return 1;
    if (d < YT_DURATION.LO_SEC) return 0.7;
    return clamp01(1 - (d - YT_DURATION.HI_SEC) / (3 * YT_DURATION.HI_SEC)); // taper for very long
  }
  // web
  const hasImage = candidate.thumbnail ? 0.5 : 0;
  const snippetLen = (candidate.snippet || '').length;
  const meaty = snippetLen > 80 ? 0.5 : snippetLen / 160;
  return clamp01(0.4 + hasImage * 0.4 + meaty * 0.6 * 0.4);
}

/**
 * Score one candidate against the interest profile.
 * Fills candidate.matchedTerms (for explainable UI) and returns { parts, score }.
 * @param affinitySet  Set of channelIds/domains already in the library (revealed preference)
 */
export function scoreCandidate(candidate, profile, { affinitySet, nowMs = Date.now() } = {}) {
  const top = topInterestTerms(profile, TOP_INTEREST_TERMS);
  const topSet = new Map(top.map((t) => [t.term, t.weight]));
  const totalMass = top.reduce((a, t) => a + t.weight, 0) || 1;

  const candTerms = new Set(
    extractTerms(`${candidate.title || ''} ${candidate.snippet || ''}`).map((t) => t.term)
  );
  let matchMass = 0;
  const matched = [];
  for (const term of candTerms) {
    if (topSet.has(term)) {
      matchMass += topSet.get(term);
      matched.push(term);
    }
  }
  const keywordMatch = clamp01(matchMass / totalMass);

  const freshness = freshnessScore(candidate.published, nowMs);
  const quality = qualityScore(candidate);

  let affinity = 0;
  if (affinitySet && affinitySet.size) {
    const src = (candidate.source || '').toLowerCase();
    const chan = (candidate?.extra?.channelId || '').toLowerCase();
    if ((src && affinitySet.has(src)) || (chan && affinitySet.has(chan))) affinity = 1;
  }

  const parts = { keywordMatch, freshness, quality, affinity };
  const score =
    WEIGHTS.keywordMatch * keywordMatch +
    WEIGHTS.freshness * freshness +
    WEIGHTS.quality * quality +
    WEIGHTS.affinity * affinity;

  // sort matched terms by their interest weight so the UI can show the strongest first
  matched.sort((a, b) => (topSet.get(b) || 0) - (topSet.get(a) || 0));
  return { parts, score, matchedTerms: matched };
}

/**
 * Rank one candidate pool (a single kind stays a separate pool).
 * Filters already-saved (savedKeys), dismissed, and excluded ids; scores; sorts
 * deterministically (score↓ → published↓ → id↑) so cards never reshuffle for novelty.
 */
export function rankPool(candidates, profile, opts = {}) {
  const { dismissed = {}, savedKeys = null, affinitySet = null, nowMs = Date.now() } = opts;
  const scored = [];
  for (const c of candidates || []) {
    if (!c || !c.id) continue;
    if (dismissed[c.id]) continue;
    if (savedKeys && savedKeys.has(c.id)) continue;
    const { parts, score, matchedTerms } = scoreCandidate(c, profile, { affinitySet, nowMs });
    scored.push({ ...c, parts, score, matchedTerms });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      new Date(b.published || 0) - new Date(a.published || 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return scored;
}
