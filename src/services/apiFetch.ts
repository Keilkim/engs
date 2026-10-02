import { supabase } from './supabase';

/**
 * fetch() for our own backend (Vercel /api routes and the Railway audio server).
 * Attaches the current Supabase access token so the server can verify the caller;
 * every backend route now rejects requests without it.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(input, { ...init, headers });
}
