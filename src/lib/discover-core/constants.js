// Discover-core: shared constants for the interest-discovery feed.
//
// Environment-free (no window / no localStorage / no fetch) so this module is
// imported UNCHANGED by both the browser bundle (Vite) and the Phase-2 cron
// (`api/discovery-cron.js`). Keeping the tuning here — one file — is what makes
// "the push shows what the shelf shows" a single source of truth.
//
// Bump when the ranking math or candidate shape changes; the client/server sync
// logs a warning on a version mismatch (drift = the shelf and the digest diverge).
export const CORE_VERSION = 1;

// --- ranking signal weights (score = Σ wᵢ·sᵢ, each signal in [0,1]) -----------
// keywordMatch dominates by design: relevance to the user's interests is the point.
export const WEIGHTS = {
  keywordMatch: 3.0,
  freshness: 1.0,
  quality: 0.8,
  affinity: 0.5,
};

export const FRESHNESS_WINDOW_DAYS = 60; // linear decay to 0 over this window

// --- interest-keyword model ---------------------------------------------------
export const INTEREST_HALF_LIFE_DAYS = 45; // recency = 0.5^(ageDays/halfLife)
export const VOCAB_WEIGHT_MULT = 1.5;      // an explicitly saved word > an incidental title noun
export const TOP_INTEREST_TERMS = 12;      // "active interest set" size — drives queries + ranking
export const MIN_TERM_LEN = 2;             // drop 1-char tokens

// --- preference learning ------------------------------------------------------
export const PREF_STEP = 0.15;             // per add(+)/dismiss(−) nudge on a matched keyword
export const PREF_MIN = -0.6;
export const PREF_MAX = 1.5;
export const NEW_TERM_SEED_BASE = 0.5;     // choosing content teaches its terms as new interests
export const TYPE_WEIGHT_STEP = 0.15;      // per-type nudge (loves YouTube, ignores PDF)
export const TYPE_WEIGHT_MIN = 0.3;
export const TYPE_WEIGHT_MAX = 2.0;

// --- display ------------------------------------------------------------------
export const PICKS_PER_TYPE = 1;           // one card per type (youtube/pdf/web) → the calm 3-card shelf
export const KINDS = ['youtube', 'pdf', 'web'];

// --- push (Phase 2, defined here so the shelf and the digest agree on θ) -------
export const PUSH_KEYWORD_THETA = 0.35;    // below this, send NOTHING (self-hiding, applied to push)

// --- PDF size-fit quality ("용량 적당한 것 우선") ------------------------------
// Bytes. Below FLOOR ≈ probably not a real doc; the [IDEAL_LO, IDEAL_HI] band scores 1;
// above CEIL is heavy → clamped-down score.
export const PDF_SIZE = {
  FLOOR: 30 * 1024,
  IDEAL_LO: 200 * 1024,
  IDEAL_HI: 8 * 1024 * 1024,
  CEIL: 20 * 1024 * 1024,
  UNKNOWN_SCORE: 0.5, // HEAD probe failed → neutral, don't over-penalize
};

// --- YouTube "watchable band" quality -----------------------------------------
export const YT_DURATION = { LO_SEC: 180, HI_SEC: 1800 }; // 3–30 min sweet spot
