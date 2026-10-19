import { supabase } from './supabase';
import { apiFetch } from './apiFetch';
import { captureSessionScope, assertSessionScope } from './sessionScope';

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

/** The server removes storage objects, application data, and the Auth identity. */
export async function deleteAccount(expectedUserId?: string): Promise<void> {
  const scope = await captureSessionScope();
  if (expectedUserId && scope.userId !== expectedUserId) {
    throw new Error('로그인 계정이 변경됐어요. 삭제할 계정을 다시 확인해 주세요.');
  }
  const response = await apiFetch('/api/delete-account', { method: 'POST', sessionScope: scope });
  const result = await response.json().catch(() => null);
  assertSessionScope(scope);
  if (!response.ok || result?.deleted !== true) {
    throw new Error(result?.error || '계정 삭제를 완료하지 못했어요. 다시 시도해 주세요.');
  }

  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw new Error('계정은 삭제됐지만 로그아웃하지 못했어요. 페이지를 새로고침해 주세요.');
}
