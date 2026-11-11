import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { recordReviewStats } from '../../services/stats';
import { getReviewOverview, getTodayReviewItems, getReviewItemsByIds, getReviewLibrary, updateReviewResult, setReviewStatus } from '../../services/review';
import { choiceOptions, chooseBatch, createPractice, createPracticeStorage, currentPracticeId, gradePractice, isReturning, practiceParts,
  reconcilePractice, SAMPLE_CARDS } from '../../services/reviewPractice';

export default function useReviewPractice() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [dueItems, setDueItems] = useState([]);
  const [savedItems, setSavedItems] = useState([]);
  const [overview, setOverview] = useState({ due: 0, total: 0, lastReviewed: null });
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [options, setOptions] = useState({ size: 5, newLimit: 5, sourceId: '' });
  // Review results whose save failed, by item id → the answer to save; kept across batches.
  const [unsaved, setUnsaved] = useState(0);
  const failed = useRef({});
  const inFlight = useRef(false);
  const alive = useRef(true);
  const loadVersion = useRef(0);
  const sessionRef = useRef(null);
  const saving = useRef(new Map());
  const graded = useRef(null);
  const userId = user?.id;
  const storage = useMemo(() => createPracticeStorage({
    getItem: key => (localStorage.getItem('autoLogin') === 'false' ? sessionStorage : localStorage).getItem(key),
    setItem: (key, value) => (localStorage.getItem('autoLogin') === 'false' ? sessionStorage : localStorage).setItem(key, value),
    removeItem: key => { localStorage.removeItem(key); sessionStorage.removeItem(key); },
  }, user?.id), [user?.id]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const checkpoint = useCallback(next => {
    sessionRef.current = next;
    setSession(next);
    if (next && userId && !storage.write(next)) setStorageWarning(true);
  }, [storage, userId]);

  // Saving runs behind the practice: the next card never waits for it, and a lost or failed save
  // stays marked `pending` in the checkpoint so it is retried rather than silently dropped.
  const markFailed = useCallback((id, correct) => {
    const { [id]: _previous, ...rest } = failed.current;
    failed.current = correct === undefined ? rest : { ...rest, [id]: correct };
    if (alive.current) setUnsaved(Object.keys(failed.current).length);
  }, []);

  const persist = useCallback((id, correct) => {
    if (saving.current.has(id)) return saving.current.get(id);
    const startedAt = sessionRef.current?.startedAt;
    markFailed(id);
    const task = updateReviewResult(id, correct).then(saved => {
      if (!saved.alreadyRecorded) {
        // Aggregate counters must not block or fail practice.
        recordReviewStats(userId, correct).catch(() => {});
        if (alive.current) setOverview(previous => ({ ...previous, due: Math.max(0, previous.due - 1) }));
      }
      if (alive.current) setDueItems(previous => previous.filter(item => String(item.id) !== id));
      const live = sessionRef.current;
      const answer = live?.startedAt === startedAt && live.answers[id];
      if (!answer) return;
      const { pending: _pending, ...settled } = answer;
      const next = { ...live, answers: { ...live.answers, [id]: saved.alreadyRecorded
        ? { ...settled, correct: saved.item.repetitions > 0, type: 'recovered' } : settled } };
      if (alive.current) checkpoint(next);
      else { sessionRef.current = next; storage.write(next); }
    }, failure => {
      if (failure.name !== 'AbortError') markFailed(id, correct);
    }).finally(() => saving.current.delete(id));
    saving.current.set(id, task);
    return task;
  }, [checkpoint, markFailed, storage, userId]);

  const retrySaves = useCallback(() => {
    Object.entries(failed.current).forEach(([id, correct]) => persist(id, correct));
  }, [persist]);

  // Finish every outstanding save, e.g. before the server is asked which cards are still due.
  const flushSaves = useCallback(() => {
    retrySaves();
    const live = sessionRef.current;
    if (live?.kind === 'daily') {
      Object.entries(live.answers).forEach(([id, answer]) => { if (answer.pending) persist(id, answer.correct); });
    }
    return Promise.allSettled([...saving.current.values()]);
  }, [persist, retrySaves]);

  const load = useCallback(async (fresh = false, selectedOptions = null) => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError('');
    try {
      await flushSaves();
      if (!alive.current || version !== loadVersion.current) return;
      const [summary, due] = await Promise.all([getReviewOverview(), getTodayReviewItems()]);
      if (!alive.current || version !== loadVersion.current) return;
      setOverview(summary);
      setDueItems(due);
      const nextOptions = selectedOptions || { size: isReturning(summary.lastReviewed) ? 3 : 5, newLimit: 5, sourceId: '' };
      setOptions(nextOptions);
      const saved = !fresh && storage.read();
      if (saved && currentPracticeId(saved)) {
        const restored = saved.kind === 'sample' ? SAMPLE_CARDS : await getReviewItemsByIds(saved.ids);
        if (!alive.current || version !== loadVersion.current) return;
        const reconciled = reconcilePractice(saved, restored);
        if (reconciled.ids.length) {
          setItems(restored);
          checkpoint(reconciled);
          flushSaves(); // answers whose save was cut off when the page closed
          return;
        }
      }
      if (!fresh && summary.total === 0 && new URLSearchParams(window.location.search).get('sample') === '1') {
        setItems(SAMPLE_CARDS);
        checkpoint(createPractice(SAMPLE_CARDS, 'sample'));
        return;
      }
      const batch = chooseBatch(due, nextOptions);
      setItems(batch);
      checkpoint(batch.length ? createPractice(batch) : null);
      if (!batch.length) storage.clear();
    } catch (failure) {
      if (alive.current && version === loadVersion.current && failure.name !== 'AbortError') setError('복습을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
    } finally { if (alive.current && version === loadVersion.current) setLoading(false); }
  }, [checkpoint, flushSaves, storage]);

  useEffect(() => { load(); }, [load]);

  // Every saved card can lend a look-alike meaning; without them the batch itself is the pool.
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    getReviewLibrary().then(rows => { if (live) setSavedItems(rows); }).catch(() => {});
    return () => { live = false; };
  }, [userId]);

  const currentId = currentPracticeId(session);
  const current = items.find(item => String(item.id) === currentId);
  const revealed = Boolean(currentId && session?.revealedId === currentId);
  const parts = useMemo(() => practiceParts(current), [current]);
  const done = session?.parts?.[currentId] || [];
  const partIndex = Math.min(done.length, parts.length - 1);
  const result = revealed ? session.result || null : null;
  const pool = useMemo(() => {
    const unique = new Map([...savedItems, ...dueItems, ...items].map(item => [String(item.id), item]));
    return [...unique.values()].flatMap(item => practiceParts(item).map(part => ({ ...part, itemId: String(item.id) })));
  }, [savedItems, dueItems, items]);
  // Other expressions from the same sentence would leak answers still to come.
  const choices = () => choiceOptions(parts[partIndex], pool.filter(part => part.itemId !== currentId));
  const reveal = (outcome = null) => {
    if (!inFlight.current && session) checkpoint({ ...session, revealedId: currentId, result: outcome });
  };
  const hint = () => {
    if (session && !session.hintedIds.includes(currentId)) checkpoint({ ...session, hintedIds: [...session.hintedIds, currentId] });
  };

  function evaluate(correct, type = 'self') {
    // One answer per rendered card: a tap and the auto-advance timer can both land on the same one.
    if (inFlight.current || !current || !revealed || graded.current === session) return;
    graded.current = session;
    const results = [...done, correct];
    // Earlier expressions only move within the sentence; the sentence is scheduled once, after the last.
    if (results.length < parts.length) {
      checkpoint({ ...session, parts: { ...session.parts, [currentId]: results }, revealedId: null, result: null });
      return;
    }
    const withParts = results.length > 1 ? { ...session, parts: { ...session.parts, [currentId]: results } } : session;
    correct = results.every(Boolean);
    const next = gradePractice(withParts, currentId, correct, type);
    if (session.kind !== 'daily') { checkpoint(next); return; }
    checkpoint({ ...next, answers: { ...next.answers, [currentId]: { ...next.answers[currentId], pending: true } } });
    persist(currentId, correct);
  }

  function practice(selectedItems, kind) {
    if (inFlight.current) return;
    flushSaves(); // the old batch's unsaved answers still reach the server
    setItems(selectedItems);
    checkpoint(createPractice(selectedItems, kind));
    setSaveError('');
  }

  async function suspend() {
    if (!current || inFlight.current || session.kind === 'sample') return;
    inFlight.current = true;
    setBusy(true);
    setSaveError('');
    try {
      await setReviewStatus(current.id, 'suspended');
      if (!alive.current) return;
      checkpoint({ ...session, ids: session.ids.filter(id => id !== currentId), revealedId: null, result: null });
      if (dueItems.some(item => String(item.id) === currentId)) setOverview(previous => ({ ...previous, due: Math.max(0, previous.due - 1) }));
      setDueItems(previous => previous.filter(item => String(item.id) !== currentId));
    } catch (failure) {
      if (alive.current && failure.name !== 'AbortError') setSaveError('변경하지 못했어요. 다시 시도해 주세요.');
    } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }

  const retryItems = items.filter(item => session?.answers[String(item.id)]?.correct === false);
  return { loading, error, saveError, busy, unsaved, retrySaves, storageWarning, overview, session, current, currentId, revealed,
    parts, partIndex, result, choices,
    options, setOptions, load, reveal, hint, evaluate, suspend, dueItems, retryItems,
    startRetry: () => practice(retryItems, 'retry'),
    startSample: () => practice(SAMPLE_CARDS, 'sample'),
    startCheck: selected => practice(selected, 'check'),
  };
}
