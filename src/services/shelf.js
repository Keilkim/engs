// "Next to decode" shelf — candidate sourcing + ranking, all client-side.
//
// Candidates are the newest uploads from channels the user ALREADY added
// (revealed preference), fetched via the keyless /api/youtube-feed RSS proxy and
// ranked by channel affinity + freshness. State lives in localStorage (no table);
// the shelf never spends money — adding a card routes through AddSourceModal.
//
// North star = "reduce friction to the next thing worth decoding", NOT clicks.

import { getYouTubeSourceMeta, backfillYoutubeChannelId } from './source';
import { getSetting, SETTINGS_KEYS } from './settings';

const CACHE_KEY = 'decode_shelf_cache_v1';
const DISMISSED_KEY = 'decode_shelf_dismissed_v1';
const RESOLVED_KEY = 'decode_shelf_resolved_v1';

const TTL_MS = 12 * 60 * 60 * 1000;          // cache freshness
const DISMISS_TTL_MS = 90 * 24 * 60 * 60 * 1000; // dismissed videos resurface after 90 days
const MANUAL_THROTTLE_MS = 10 * 60 * 1000;   // manual refresh can't become a slot-machine lever

const MAX_CARDS = 3;          // v1; converges to 1 once difficulty ranking (Phase 4) is trustworthy
const MAX_PER_CHANNEL = 2;
const FRESHNESS_WINDOW_DAYS = 30;
const AFFINITY_WEIGHT = 2.0;
const FRESHNESS_WEIGHT = 1.0;

// --- localStorage helpers (private-mode / quota safe) ---
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
    /* ignore quota / private-mode failures */
  }
}

function includeShorts() {
  return getSetting(SETTINGS_KEYS.SHELF_INCLUDE_SHORTS, 'false') === 'true';
}

// --- cache ---
export function readShelfCache() {
  return readJson(CACHE_KEY, null);
}
export function isCacheFresh(cache) {
  return !!(cache && cache.fetchedAt && Date.now() - new Date(cache.fetchedAt).getTime() < TTL_MS);
}

// --- dismissed map (pruned to 90 days on read) ---
function readDismissed() {
  const raw = readJson(DISMISSED_KEY, {});
  const now = Date.now();
  let changed = false;
  const kept = {};
  for (const [vid, ts] of Object.entries(raw)) {
    if (now - new Date(ts).getTime() < DISMISS_TTL_MS) kept[vid] = ts;
    else changed = true;
  }
  if (changed) writeJson(DISMISSED_KEY, kept);
  return kept;
}

// One silent tap: hidden for 90 days, and pruned from the cache so it doesn't
// reappear on the next mount before a refresh runs.
export function dismissShelfItem(videoId) {
  const map = readJson(DISMISSED_KEY, {});
  map[videoId] = new Date().toISOString();
  writeJson(DISMISSED_KEY, map);

  const cache = readShelfCache();
  if (cache?.items) {
    cache.items = cache.items.filter((it) => it.videoId !== videoId);
    writeJson(CACHE_KEY, cache);
  }
}

// --- feed / resolve API ---
async function fetchFeeds(channelIds) {
  const res = await fetch('/api/youtube-feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelIds }),
  });
  if (!res.ok) throw new Error('shelf feed failed');
  const data = await res.json();
  return data.channels || {};
}
async function resolveVideoMeta(videoId) {
  const res = await fetch('/api/youtube-feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolveVideoId: videoId }),
  });
  if (!res.ok) throw new Error('resolve failed');
  return res.json(); // { channelId, duration, ok }
}

// Turn the user's youtube sources into { channelId -> {count, pinned} }, resolving
// (and caching + writing back) the UC... id for any source that lacks one.
// retryFailed re-attempts channels previously cached as null (manual refresh only).
async function buildChannelProfile(sources, retryFailed) {
  const resolved = readJson(RESOLVED_KEY, {});
  let resolvedChanged = false;

  const perChannel = new Map();
  const addedVideoIds = new Set();

  for (const s of sources) {
    if (s?.youtube_data?.video_id) addedVideoIds.add(s.youtube_data.video_id);
  }

  for (const s of sources) {
    const yd = s?.youtube_data || {};
    const vid = yd.video_id;
    let cid = yd.channel_id || null;

    if (!cid && vid) {
      const cachedKnown = vid in resolved;
      const shouldResolve = !cachedKnown || (retryFailed && resolved[vid] === null);
      if (cachedKnown && !shouldResolve) {
        cid = resolved[vid]; // may be null (known-failed)
      } else {
        try {
          const meta = await resolveVideoMeta(vid);
          resolved[vid] = meta.channelId; // may be null
          resolvedChanged = true;
          cid = meta.channelId;
          if (meta.channelId) {
            // Converge server-side so we never scrape this video again.
            backfillYoutubeChannelId(s.id, yd, meta.channelId, meta.duration).catch(() => {});
          }
        } catch {
          /* leave unresolved; manual refresh can retry */
        }
      }
    }

    if (cid) {
      const entry = perChannel.get(cid) || { count: 0, pinned: false };
      entry.count += 1;
      if (s.pinned) entry.pinned = true;
      perChannel.set(cid, entry);
    }
  }

  if (resolvedChanged) writeJson(RESOLVED_KEY, resolved);
  return { perChannel, addedVideoIds };
}

// Pure-ish ranking: hard filters, affinity+freshness score, per-channel diversity,
// deterministic order so cards never reshuffle to manufacture novelty.
function rankShelf(channels, perChannel, addedVideoIds) {
  const dismissed = readDismissed();
  const allowShorts = includeShorts();
  const now = Date.now();

  let maxAffinityRaw = 0;
  const affinityRaw = new Map();
  for (const [cid, info] of perChannel.entries()) {
    const raw = Math.log2(1 + info.count) + (info.pinned ? 1 : 0);
    affinityRaw.set(cid, raw);
    if (raw > maxAffinityRaw) maxAffinityRaw = raw;
  }

  const candidates = [];
  for (const [cid, ch] of Object.entries(channels)) {
    if (!ch?.items) continue;
    const affinity = maxAffinityRaw > 0 ? (affinityRaw.get(cid) || 0) / maxAffinityRaw : 0;
    for (const it of ch.items) {
      if (!it.videoId) continue;
      if (addedVideoIds.has(it.videoId)) continue;
      if (dismissed[it.videoId]) continue;
      if (it.isShort && !allowShorts) continue;

      const ageDays = it.published ? (now - new Date(it.published).getTime()) / 86400000 : 999;
      const freshness = Math.max(0, Math.min(1, 1 - ageDays / FRESHNESS_WINDOW_DAYS));
      candidates.push({
        videoId: it.videoId,
        title: it.title,
        channelId: cid,
        channelName: ch.channelName || '',
        published: it.published,
        thumbnail: it.thumbnail,
        // score_breakdown shape — later difficulty/keyword stages become purely additive.
        parts: { channelAffinity: affinity, freshness, keywordMatch: null, difficultyFit: null },
        score: AFFINITY_WEIGHT * affinity + FRESHNESS_WEIGHT * freshness,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      new Date(b.published || 0) - new Date(a.published || 0) ||
      (a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0)
  );

  const perCount = {};
  const out = [];
  for (const c of candidates) {
    const n = perCount[c.channelId] || 0;
    if (n >= MAX_PER_CHANNEL) continue;
    perCount[c.channelId] = n + 1;
    out.push(c);
    if (out.length >= MAX_CARDS) break;
  }
  return out;
}

let refreshInFlight = null;
let lastManualRefresh = 0;

// Fetch → rank → cache. Single-flight; force=manual refresh (10-min throttled).
export async function refreshShelf({ force = false } = {}) {
  if (force) {
    if (Date.now() - lastManualRefresh < MANUAL_THROTTLE_MS) {
      return readShelfCache()?.items || []; // throttled: silent no-op
    }
    lastManualRefresh = Date.now();
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const sources = await getYouTubeSourceMeta();
      const { perChannel, addedVideoIds } = await buildChannelProfile(sources, force);
      const channelIds = [...perChannel.keys()];

      let items = [];
      if (channelIds.length > 0) {
        const channels = await fetchFeeds(channelIds);
        items = rankShelf(channels, perChannel, addedVideoIds);
      }
      writeJson(CACHE_KEY, { fetchedAt: new Date().toISOString(), items });
      return items;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Neutral relative time for card meta — a bare fact, never "missed"/urgency framing.
export function shelfRelativeTime(iso) {
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
