import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Auto-login-aware storage adapter.
 *
 * The login screen writes a `autoLogin` flag ('true' | 'false') to localStorage
 * before signing in. When the user explicitly unchecks "자동 로그인"
 * (autoLogin === 'false'), the auth session is persisted to sessionStorage so it
 * is cleared when the browser is closed — protecting accounts on shared devices.
 * Otherwise (default) the session persists in localStorage as before.
 *
 * Reads check sessionStorage first so a session written during a "no auto-login"
 * run is still found within the same tab.
 */
const autoLoginStorage = {
  getItem: (key: string): string | null => {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      const persist = localStorage.getItem('autoLogin') !== 'false';
      if (persist) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    } catch {
      // storage unavailable (private mode) — ignore
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: autoLoginStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});

// storage-js upload() currently drops AbortSignal. Use the same authenticated
// Storage endpoint directly so cancelling an import stops sending file bytes.
export async function uploadStorageObject(bucket: string, path: string, file: File, signal?: AbortSignal, expectedUserId?: string) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  if (expectedUserId && session.user.id !== expectedUserId) {
    throw new DOMException('로그인 계정이 변경되었습니다.', 'AbortError');
  }
  signal?.throwIfAborted();
  const objectPath = [bucket, ...path.split('/')].map(encodeURIComponent).join('/');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${objectPath}`, {
    method: 'POST',
    signal,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': file.type || 'application/octet-stream',
      'Cache-Control': 'max-age=3600',
      'x-upsert': 'false',
    },
    body: file,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.message || detail?.error || `파일 업로드 실패 (${response.status})`);
  }
}
