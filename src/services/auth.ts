import { supabase } from './supabase';

export async function signUp(email: string, password: string, nickname: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { nickname } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
  if (error) throw error;
  return data;
}

export async function signInWithKakao() {
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'kakao' });
  if (error) throw error;
  return data;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function resetPassword(email: string) {
  // The recovery link lands back on /forgot-password, which detects the
  // PASSWORD_RECOVERY session and shows the "set new password" form.
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/forgot-password`,
  });
  if (error) throw error;
  return data;
}

export async function updatePassword(newPassword: string) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

export async function updateProfile(updates: Record<string, unknown>) {
  const { data, error } = await supabase.auth.updateUser({ data: updates });
  if (error) throw error;
  return data;
}

/**
 * Deletes the current user's data and signs them out.
 *
 * Removes every row owned by the user across the app's tables, in
 * foreign-key-safe order (children before parents), then ends the session.
 *
 * NOTE: The `auth.users` record itself CANNOT be deleted from the client with
 * the anon key — that requires the service-role key (`auth.admin.deleteUser`),
 * which must never be exposed in the browser. For this personal-use app,
 * purging all owned data + signing out is sufficient; wiring up a server-side
 * endpoint to remove the auth record is a possible future enhancement.
 */
export async function deleteAccount(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const uid = user.id;

  // Children first, then parents, to respect FK constraints.
  // review_items -> annotations -> chat_logs -> sources -> user_stats
  const orderedTables = [
    'review_items',
    'annotations',
    'chat_logs',
    'sources',
    'user_stats',
  ];

  for (const table of orderedTables) {
    const { error } = await supabase.from(table).delete().eq('user_id', uid);
    if (error) throw error;
  }

  // user_settings is not used in every environment; best-effort so a missing
  // table doesn't abort the whole deletion.
  await supabase.from('user_settings').delete().eq('user_id', uid);

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) throw signOutError;
}
