import { handleCors } from './security.js';
import { removeUserStorageFiles } from '../../src/lib/storageCleanup.js';

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

/** Dependencies are injected so tests can exercise the real route without account mutations. */
export function makeDeleteAccountHandler({ createClient, env = process.env }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (handleCors(req, res, 'POST')) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: '로그인이 필요해요.' });
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    // This key is only read by the server. Never use a VITE_ environment variable for it.
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return res.status(503).json({ error: '계정 삭제 서버 설정이 필요해요. 아직 계정이나 자료는 삭제되지 않았어요.' });
    }

    let stage = 'auth';
    try {
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) => fetch(input, {
            ...init, signal: init?.signal || AbortSignal.timeout(10_000),
          }),
        },
      });
      // A fresh Auth lookup is required for this destructive operation. The request
      // body is deliberately unused: callers can only delete the verified account.
      const { data, error } = await client.auth.getUser(match[1]);
      const user = data?.user;
      if (error || !user || user.is_anonymous || !USER_ID_RE.test(user.id)) {
        return res.status(401).json({ error: '로그인이 만료됐어요. 다시 로그인해 주세요.' });
      }

      stage = 'storage';
      await removeUserStorageFiles(client, user.id);

      stage = 'data';
      // Legacy installations may have this extra table without an auth.users FK.
      // Ignore only an absent table, never a permission or network failure.
      const { error: settingsError } = await client.from('user_settings').delete().eq('user_id', user.id);
      if (settingsError && !MISSING_TABLE_CODES.has(settingsError.code)) throw settingsError;

      // All tables in supabase-schema.sql reference auth.users ON DELETE CASCADE.
      // Deleting the identity removes those rows in the same database transaction.
      const { error: deleteError } = await client.auth.admin.deleteUser(user.id);
      if (deleteError) throw deleteError;
      return res.status(200).json({ deleted: true });
    } catch {
      const error = stage === 'auth'
        ? '로그인을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'
        : stage === 'storage'
          ? '업로드 파일 정리가 완료되지 않았어요. 계정은 유지되니 다시 삭제를 시도해 주세요.'
          : '파일 정리 후 계정 삭제를 완료하지 못했어요. 다시 삭제를 시도해 주세요.';
      return res.status(503).json({ error });
    }
  };
}
