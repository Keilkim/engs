// Interest-discovery feed — client orchestration (Phase 1, all localStorage).
//
// Mirrors src/services/shelf.js patterns: readJson/writeJson, TTL cache, 90-day
// dismissed map, single-flight + manual throttle, deterministic ranking, self-hiding.
// The pure logic (keyword extraction, ranking) lives in src/lib/discover-core so the
// Phase-2 cron can reuse it unchanged. Candidates come from external SEARCH
// (api/discover-*), NOT the channel-RSS decode shelf — the two shelves are independent.
import { getSources, getSavedExternalKeys } from './source';
import { getVocabulary } from './annotation';
import { getSetting, SETTINGS_KEYS } from './settings';
import { buildInterestProfile } from '../lib/discover-core/keywords';
import { buildQueries } from '../lib/discover-core/query';
import { rankPool, candidateId, canonicalUrl } from '../lib/discover-core/rank';
import {
  KINDS,
  PICKS_PER_TYPE,
  TYPE_WEIGHT_STEP,
  TYPE_WEIGHT_MIN,
  TYPE_WEIGHT_MAX,
  PREF_STEP,
  PREF_MIN,
  PREF_MAX,
  NEW_TERM_SEED_BASE,
} from '../lib/discover-core/constants';

const INTERESTS_KEY = 'discovery_interests_v1';
const CACHE_KEY = 'discovery_cache_v1';
const DISMISSED_KEY = 'discovery_dismissed_v1';
const PREFS_KEY = 'discovery_prefs_v1';
const QUERY_CACHE_KEY = 'discovery_query_cache_v1';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const INTEREST_TTL_MS = 24 * 60 * 60 * 1000;
const QUERY_TTL_MS = 6 * 60 * 60 * 1000;
const DISMISS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MANUAL_THROTTLE_MS = 10 * 60 * 1000;

// --- localStorage helpers (private-mode / quota safe; duplicated from shelf.js) ---
function readJson(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private-mode */
  }
}

// --- dismissed map (90-day resurface, pruned on read) ---
function readDismissed() {
  const raw = readJson(DISMISSED_KEY, {});
  const now = Date.now();
  let changed = false;
  const kept = {};
  for (const [id, ts] of Object.entries(raw)) {
    if (now - new Date(ts).getTime() < DISMISS_TTL_MS) kept[id] = ts;
    else changed = true;
  }
  if (changed) writeJson(DISMISSED_KEY, kept);
  return kept;
}

export function dismissDiscoverItem(id) {
  const map = readJson(DISMISSED_KEY, {});
  map[id] = new Date().toISOString();
  writeJson(DISMISSED_KEY, map);

  const cache = readDiscoverCache();
  if (cache?.pools) {
    for (const k of KINDS) {
      cache.pools[k] = (cache.pools[k] || []).filter((it) => it.id !== id);
    }
    writeJson(CACHE_KEY, cache);
  }
}

// --- preferences (keyword pref + per-type weight) ---
export function readPrefs() {
  return readJson(PREFS_KEY, { typeWeight: { youtube: 1, pdf: 1, web: 1 } });
}
export function typeWeight(kind) {
  const w = readPrefs().typeWeight?.[kind];
  return typeof w === 'number' ? w : 1;
}

// User chose (+1 = added) or skipped (−1 = dismissed) a candidate → nudge weights.
export function recordChoice(item, sign) {
  if (!item) return;
  // (a) per-keyword preference on the matched terms
  const profile = readInterestProfile();
  if (profile?.keywords) {
    for (const term of item.matchedTerms || []) {
      const k = profile.keywords[term];
      if (k) k.pref = clamp((k.pref || 0) + sign * PREF_STEP, PREF_MIN, PREF_MAX);
    }
    // choosing content teaches its unseen terms as new small interests
    if (sign > 0) {
      for (const term of item.matchedTerms || []) {
        if (!profile.keywords[term]) {
          profile.keywords[term] = { base: NEW_TERM_SEED_BASE, pref: 0, pos: 'noun', lastSeen: new Date().toISOString() };
        }
      }
    }
    writeJson(INTERESTS_KEY, profile);
  }
  // (b) per-type weight
  const prefs = readPrefs();
  prefs.typeWeight = prefs.typeWeight || { youtube: 1, pdf: 1, web: 1 };
  const cur = typeof prefs.typeWeight[item.kind] === 'number' ? prefs.typeWeight[item.kind] : 1;
  prefs.typeWeight[item.kind] = clamp(cur + sign * TYPE_WEIGHT_STEP, TYPE_WEIGHT_MIN, TYPE_WEIGHT_MAX);
  writeJson(PREFS_KEY, prefs);
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// --- interest profile ---
export function readInterestProfile() {
  return readJson(INTERESTS_KEY, null);
}

// Rebuild from the user's own titles + saved vocab when stale or when the library
// changed (cheap sig check). 100% client-side, no cost. Preserves learned `pref`.
async function ensureInterestProfile() {
  const cached = readInterestProfile();
  const [sources, vocab] = await Promise.all([
    getSources().catch(() => []),
    getVocabulary().catch(() => []),
  ]);
  const sig = `${sources.length}:${vocab.length}:${sources[0]?.created_at || ''}:${vocab[0]?.created_at || ''}`;
  const fresh =
    cached && cached.builtAt && cached.sig === sig &&
    Date.now() - new Date(cached.builtAt).getTime() < INTEREST_TTL_MS;
  if (fresh) return cached;

  const built = buildInterestProfile(
    sources.map((s) => ({ title: s.title, created_at: s.created_at })),
    vocab.map((v) => ({ word: v.selected_text, created_at: v.created_at })),
    Date.now(),
    cached // preserve pref
  );
  const profile = { builtAt: new Date().toISOString(), sig, keywords: built.keywords };
  writeJson(INTERESTS_KEY, profile);
  return profile;
}

// --- query-response cache (shared quota lever: re-rank spends ZERO quota) ---
function readRawForQuery(kind, q) {
  const all = readJson(QUERY_CACHE_KEY, {});
  const entry = all[`${kind}:${q}`];
  if (entry && Date.now() - new Date(entry.fetchedAt).getTime() < QUERY_TTL_MS) {
    return entry.items;
  }
  return null;
}
function writeRawForQuery(kind, q, items) {
  const all = readJson(QUERY_CACHE_KEY, {});
  all[`${kind}:${q}`] = { fetchedAt: new Date().toISOString(), items };
  writeJson(QUERY_CACHE_KEY, all);
}

const ROUTE = { youtube: '/api/discover-youtube', web: '/api/discover-web', pdf: '/api/discover-pdf' };

async function fetchPoolRaw(kind, q) {
  const cached = readRawForQuery(kind, q);
  if (cached) return cached;
  const res = await fetch(ROUTE[kind], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q }),
  });
  if (!res.ok) throw new Error(`${kind} discovery ${res.status}`);
  const data = await res.json();
  const items = data.items || [];
  writeRawForQuery(kind, q, items);
  return items;
}

// Normalize a raw route item into a ranked-candidate shape with a stable id.
function normalize(raw) {
  const id = candidateId({ kind: raw.kind, url: raw.url, videoId: raw.extra?.videoId });
  return { ...raw, id, url: raw.url, canonical: canonicalUrl(raw.url) };
}

// --- cache ---
export function readDiscoverCache() {
  return readJson(CACHE_KEY, null);
}
export function isCacheFresh(cache) {
  return !!(cache && cache.fetchedAt && Date.now() - new Date(cache.fetchedAt).getTime() < CACHE_TTL_MS);
}

let refreshInFlight = null;
let lastManualRefresh = 0;

// Fetch → rank → cache. Single-flight; force=manual refresh (10-min throttled).
export async function refreshDiscover({ force = false } = {}) {
  if (force) {
    if (Date.now() - lastManualRefresh < MANUAL_THROTTLE_MS) {
      return readDiscoverCache()?.pools || emptyPools();
    }
    lastManualRefresh = Date.now();
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      if (getSetting(SETTINGS_KEYS.DISCOVER_ENABLED, 'true') === 'false') {
        const empty = emptyPools();
        writeJson(CACHE_KEY, { fetchedAt: new Date().toISOString(), pools: empty });
        return empty;
      }
      const profile = await ensureInterestProfile();
      const queries = buildQueries(profile);
      if (!queries.youtube && !queries.web && !queries.pdf) {
        const empty = emptyPools();
        writeJson(CACHE_KEY, { fetchedAt: new Date().toISOString(), pools: empty });
        return empty;
      }

      const dismissed = readDismissed();
      const savedKeys = await getSavedExternalKeys().catch(() => new Set());

      const rawResults = await Promise.allSettled(
        KINDS.map((k) => fetchPoolRaw(k, queries[k]))
      );

      const pools = emptyPools();
      KINDS.forEach((k, i) => {
        const r = rawResults[i];
        const raw = r.status === 'fulfilled' ? r.value : [];
        // dedup within pool by id
        const seen = new Set();
        const normd = [];
        for (const item of raw.map(normalize)) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          normd.push(item);
        }
        pools[k] = rankPool(normd, profile, { dismissed, savedKeys });
      });

      writeJson(CACHE_KEY, { fetchedAt: new Date().toISOString(), pools });
      return pools;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function emptyPools() {
  return { youtube: [], web: [], pdf: [] };
}

// The shelf view: top PICKS_PER_TYPE per type, ordered so types the user keeps
// ignoring (low typeWeight) sink to the right. Self-hiding: empty types contribute
// no cards; if everything is empty the whole section vanishes (caller checks length).
export function selectShelfItems(pools) {
  const prefs = readPrefs();
  const picks = [];
  for (const k of KINDS) {
    const top = (pools?.[k] || []).slice(0, PICKS_PER_TYPE);
    for (const it of top) {
      const tw = prefs.typeWeight?.[k];
      picks.push({ item: it, order: (it.score || 0) * (typeof tw === 'number' ? tw : 1) });
    }
  }
  picks.sort((a, b) => b.order - a.order || (a.item.id < b.item.id ? -1 : 1));
  return picks.map((p) => p.item);
}

// Neutral relative time (reuses the shelf's calm-tech framing — a bare fact).
export function discoverRelativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
