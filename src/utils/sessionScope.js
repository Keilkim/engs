// A session generation changes on sign-out/account changes, including signing
// back into the same account. Token refreshes retain the current generation.
export function createSessionScopeTracker() {
  let controller = new AbortController();
  let snapshot = { userId: null, generation: 0, signal: controller.signal };
  const listeners = new Set();

  function updateUser(userId) {
    if (snapshot.userId === userId) return;
    const previous = controller;
    controller = new AbortController();
    snapshot = { userId, generation: snapshot.generation + 1, signal: controller.signal };
    previous.abort(new DOMException('로그인 계정이 변경되었습니다.', 'AbortError'));
    listeners.forEach(listener => listener());
  }

  function assertCurrent(scope) {
    scope?.signal.throwIfAborted();
    if (!scope?.userId || scope !== snapshot) {
      throw new DOMException('로그인 세션이 변경되었습니다.', 'AbortError');
    }
  }

  return {
    updateUser,
    assertCurrent,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
