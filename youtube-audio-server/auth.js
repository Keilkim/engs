const USER_CACHE_MS = 60 * 1000;
function createRequireUser({ supabaseUrl, anonKey, cache = new Map() }) {
  return async function requireUser(req, res, next) {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: '로그인이 필요해요' });
    if (!supabaseUrl || !anonKey) {
      return res.status(503).json({ error: 'Audio access not configured', code: 'AUDIO_ACCESS_NOT_CONFIGURED' });
    }
    const token = match[1];
    const now = Date.now();
    let user = cache.get(token);
    if (!user || user.exp <= now) {
      try {
        const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        const verified = response.ok ? await response.json() : null;
        if (!verified?.id || verified.is_anonymous) {
          return res.status(401).json({ error: '로그인이 필요해요' });
        }
        user = { id: verified.id, exp: now + USER_CACHE_MS };
      } catch {
        return res.status(503).json({ error: 'Auth service unavailable' });
      }
    }
    if (cache.size >= 1000) cache.clear();
    cache.set(token, user);
    req.userId = user.id;
    return next();
  };
}

module.exports = { createRequireUser, USER_CACHE_MS };
