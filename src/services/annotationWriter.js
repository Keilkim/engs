const CLEANUP_KEY = 'engs:annotation-cleanup:v1';
const MAX_PENDING_CLEANUPS = 100;

export class AnnotationCleanupError extends Error {
  constructor(annotationId, cause, cleanupError) {
    super('저장이 완료되지 않았고 임시 자료를 정리하지 못했습니다. 연결을 확인한 뒤 다시 저장하면 먼저 정리합니다.');
    this.name = 'AnnotationCleanupError';
    this.code = 'ANNOTATION_CLEANUP_PENDING';
    this.annotationId = annotationId;
    this.cause = cause;
    this.cleanupError = cleanupError;
  }
}

// These are compensating writes, not a database transaction. Keep failed
// cleanup IDs across reloads in this tab; never store annotation text here.
export function createAnnotationWriter({
  captureScope, assertScope, insertAnnotation, insertReview, removeAnnotation,
  getStorage = () => globalThis.sessionStorage,
}) {
  let pending = null;
  const queues = new Map();
  const inFlight = new Map();

  function loadPending() {
    if (pending) return;
    let stored;
    try { stored = getStorage()?.getItem(CLEANUP_KEY); } catch { /* memory fallback */ }
    const entries = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(entries) || entries.length > MAX_PENDING_CLEANUPS || entries.some(entry =>
      !entry || typeof entry.userId !== 'string' ||
      !['string', 'number'].includes(typeof entry.id)
    )) {
      throw new Error('이전 저장 작업의 정리 기록을 읽지 못했습니다. 페이지를 새로고침해 주세요.');
    }
    pending = entries;
  }

  function persist() {
    try {
      if (pending.length) getStorage()?.setItem(CLEANUP_KEY, JSON.stringify(pending));
      else getStorage()?.removeItem(CLEANUP_KEY);
    } catch { /* private mode/quota: retain the retry IDs in memory */ }
  }

  async function cleanup(entry, scope, cause) {
    try {
      assertScope(scope);
      await removeAnnotation(entry.id, scope.userId);
      assertScope(scope);
      pending = pending.filter(item => item !== entry);
      persist();
    } catch (cleanupError) {
      throw new AnnotationCleanupError(entry.id, cause, cleanupError);
    }
  }

  async function save(input, needsReview, scope) {
    assertScope(scope);
    loadPending();
    // Retrying cannot insert another copy while an earlier partial save remains.
    for (const entry of pending.filter(item => item.userId === scope.userId)) {
      await cleanup(entry, scope);
    }
    if (pending.length >= MAX_PENDING_CLEANUPS) {
      throw new Error('정리되지 않은 저장 작업이 있습니다. 해당 계정으로 다시 로그인해 정리해 주세요.');
    }
    assertScope(scope);
    const annotation = await insertAnnotation(input, scope.userId);
    try {
      assertScope(scope);
      if (needsReview) await insertReview(annotation.id, scope.userId);
      assertScope(scope);
      return annotation;
    } catch (error) {
      const entry = { userId: scope.userId, id: annotation.id };
      pending.push(entry);
      persist();
      await cleanup(entry, scope, error);
      throw error;
    }
  }

  return async function writeAnnotation(input, needsReview) {
    const scope = await captureScope();
    const key = JSON.stringify([scope.userId, scope.generation, input, needsReview]);
    if (inFlight.has(key)) return inFlight.get(key);
    const previous = queues.get(scope.userId) || Promise.resolve();
    const saving = previous.catch(() => {}).then(() => save(input, needsReview, scope));
    queues.set(scope.userId, saving);
    inFlight.set(key, saving);
    try {
      return await saving;
    } finally {
      inFlight.delete(key);
      if (queues.get(scope.userId) === saving) queues.delete(scope.userId);
    }
  };
}
