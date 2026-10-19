import { supabase } from './supabase';
import { assertSessionScope } from './sessionScope';

type ScopedRequestInit = RequestInit & {
  sessionScope?: { userId: string; generation: number; signal: AbortSignal };
};

/**
 * fetch() for our own backend (Vercel /api routes and the Railway audio server).
 * Attaches the current Supabase access token so the server can verify the caller;
 * every backend route now rejects requests without it.
 */
export async function apiFetch(input: string, { sessionScope, ...init }: ScopedRequestInit = {}): Promise<Response> {
  const signal = sessionScope
    ? (init.signal ? AbortSignal.any([init.signal, sessionScope.signal]) : sessionScope.signal)
    : init.signal;
  signal?.throwIfAborted();
  if (sessionScope) assertSessionScope(sessionScope);
  const { data: { session } } = await supabase.auth.getSession();
  signal?.throwIfAborted();
  if (sessionScope) {
    assertSessionScope(sessionScope);
    if (session?.user?.id !== sessionScope.userId) {
      throw new DOMException('로그인 계정이 변경되었습니다.', 'AbortError');
    }
  }
  const headers = new Headers(init.headers);
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(input, { ...init, headers, signal });
}
