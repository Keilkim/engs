// Shared guards for the API routes: CORS allowlist, Supabase session check, and
// per-user daily quotas. Files under api/_lib are not exposed as routes by Vercel.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// The app calls these routes same-origin, which needs no CORS header at all. Extra
// origins (e.g. a separate dev host) can be allowed via ALLOWED_ORIGINS=a,b.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Per-user daily limits. Kinds must match the CHECK on api_usage.kind
// (supabase-migration.sql).
export const QUOTAS = {
  gemini: envInt('QUOTA_GEMINI_DAILY', 1000),
  whisper_sec: envInt('QUOTA_WHISPER_SEC_DAILY', 3 * 3600),
  screenshot: envInt('QUOTA_SCREENSHOT_DAILY', 50),
  pdf_proxy: envInt('QUOTA_PDF_PROXY_DAILY', 100),
};

/** Sets CORS headers for allowlisted origins. Returns true if it answered a preflight. */
export function handleCors(req, res, methods) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', `${methods}, OPTIONS`);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

// Verified tokens are cached briefly so a warm instance doesn't hit Supabase Auth
// on every call (chat streams, caption batches).
const USER_CACHE_MS = 60 * 1000;
const USER_CACHE_MAX = 500;
const userCache = new Map(); // access token -> { id, exp }

/**
 * Resolves the Supabase user behind the request's Bearer token, or sends 401 and
 * returns null. Anonymous Supabase sessions are rejected.
 */
export async function requireUser(req, res) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!match) {
    res.status(401).json({ error: '로그인이 필요해요' });
    return null;
  }
  const token = match[1];

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[auth] SUPABASE_URL / SUPABASE_ANON_KEY not configured');
    res.status(500).json({ error: 'Auth not configured' });
    return null;
  }

  const now = Date.now();
  const cached = userCache.get(token);
  if (cached && cached.exp > now) return { id: cached.id, token };

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    const user = r.ok ? await r.json() : null;
    if (!user?.id || user.is_anonymous) {
      res.status(401).json({ error: '로그인이 필요해요' });
      return null;
    }
    if (userCache.size >= USER_CACHE_MAX) userCache.clear();
    userCache.set(token, { id: user.id, exp: now + USER_CACHE_MS });
    return { id: user.id, token };
  } catch (err) {
    console.error('[auth] verification failed:', err.message);
    res.status(503).json({ error: 'Auth service unavailable' });
    return null;
  }
}

/**
 * Atomically adds `amount` to the user's usage of `kind` for today. Sends 429 and
 * returns false when that would exceed `limit`. Fails closed (503) if the check
 * itself can't run, since these routes spend paid API credit.
 */
export async function consumeQuota(res, user, kind, amount, limit) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_api_quota`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${user.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_kind: kind, p_amount: Math.ceil(amount), p_limit: limit }),
    });
    if (!r.ok) throw new Error(`consume_api_quota ${r.status}`);
    if ((await r.json()) === true) return true;
    res.status(429).json({ error: '오늘 사용 한도를 다 썼어요. 내일 다시 시도해 주세요.' });
    return false;
  } catch (err) {
    console.error('[quota]', err.message);
    res.status(503).json({ error: 'Usage check unavailable' });
    return false;
  }
}

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
