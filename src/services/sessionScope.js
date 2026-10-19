import { supabase } from './supabase';
import { createSessionScopeTracker } from '../utils/sessionScope.js';

const tracker = createSessionScopeTracker();
let authEvents = 0;
supabase.auth.onAuthStateChange((_event, session) => {
  authEvents += 1;
  tracker.updateUser(session?.user?.id ?? null);
});

// An old initial read must never replace a more recent sign-in/sign-out event.
const initialVersion = authEvents;
const initialized = supabase.auth.getSession().then(({ data: { session } }) => {
  if (authEvents === initialVersion) tracker.updateUser(session?.user?.id ?? null);
}).catch(() => { /* captureSessionScope reports the unavailable login */ });

export const getSessionScopeSnapshot = tracker.getSnapshot;
export const subscribeSessionScope = tracker.subscribe;
export const assertSessionScope = tracker.assertCurrent;

export async function captureSessionScope() {
  // Pin an already-known account before the first async boundary. Otherwise a
  // click under A could resume after a same-tick account change and adopt B.
  const started = tracker.getSnapshot();
  if (started.userId) {
    tracker.assertCurrent(started);
    return started;
  }
  await initialized;
  const scope = tracker.getSnapshot();
  if (!scope.userId) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  tracker.assertCurrent(scope);
  return scope;
}
