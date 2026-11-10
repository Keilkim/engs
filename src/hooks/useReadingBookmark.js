import { useCallback, useEffect, useRef, useState } from 'react';
import { readingBookmarks } from '../services/readingBookmark.js';

export default function useReadingBookmark(sourceId) {
  const [state, setState] = useState({ sourceId: null, bookmark: null, ready: false, message: '' });
  const generation = useRef(0);
  const busy = useRef(false);
  const ready = state.sourceId === sourceId && state.ready;
  const bookmark = state.sourceId === sourceId ? state.bookmark : null;

  useEffect(() => {
    const token = ++generation.current;
    busy.current = false;
    let active = true;
    readingBookmarks.load(sourceId).then(value => {
      if (active) setState({ sourceId, bookmark: value, ready: true, message: '' });
    }).catch(() => {
      if (active) setState({ sourceId, bookmark: null, ready: false, message: '북마크를 불러오지 못했어요. 자료를 다시 열어 주세요.' });
    });
    return () => { active = false; if (generation.current === token) generation.current += 1; };
  }, [sourceId]);

  const mutate = useCallback(async (position) => {
    if (!ready || busy.current) return;
    busy.current = true;
    const token = generation.current;
    try {
      const next = position
        ? await readingBookmarks.save(sourceId, position, bookmark?.id)
        : await readingBookmarks.remove(sourceId).then(() => null);
      if (generation.current === token) {
        setState({ sourceId, bookmark: next, ready: true,
          message: position ? '북마크를 저장했어요. 다음에 여기서 이어 볼게요.' : '북마크를 삭제했어요.' });
      }
    } catch {
      if (generation.current === token) setState(prev => ({ ...prev, message: '북마크를 변경하지 못했어요. 다시 시도해 주세요.' }));
    } finally {
      if (generation.current === token) busy.current = false;
    }
  }, [ready, sourceId, bookmark?.id]);

  useEffect(() => {
    if (!state.message || !state.ready) return;
    const timer = setTimeout(() => setState(prev => ({ ...prev, message: '' })), 4000);
    return () => clearTimeout(timer);
  }, [state.message, state.ready]);

  return { bookmark, ready, message: state.sourceId === sourceId ? state.message : '',
    save: mutate, remove: useCallback(() => mutate(null), [mutate]) };
}
