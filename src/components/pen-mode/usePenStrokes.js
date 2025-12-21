import { useState, useEffect, useCallback } from 'react';
import {
  getPenStrokes,
  createPenStroke,
  deletePenStrokes,
} from '../../services/annotation';

export function usePenStrokes(sourceId) {
  const [strokes, setStrokes] = useState([]);
  const [loading, setLoading] = useState(false);

  // 스트로크 불러오기
  const loadStrokes = useCallback(async () => {
    if (!sourceId) return;

    setLoading(true);
    try {
      const data = await getPenStrokes(sourceId);
      setStrokes(data);
    } catch (error) {
      console.error('Failed to load pen strokes:', error);
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  // 초기 로드
  useEffect(() => {
    loadStrokes();
  }, [loadStrokes]);

  // 스트로크 추가
  const addStroke = useCallback(
    async (strokeData) => {
      if (!sourceId) return null;

      try {
        const newStroke = await createPenStroke(sourceId, strokeData);
        setStrokes((prev) => [...prev, newStroke]);
        return newStroke;
      } catch (error) {
        console.error('Failed to save pen stroke:', error);
        return null;
      }
    },
    [sourceId]
  );

  // 스트로크 삭제
  const removeStrokes = useCallback(async (strokeIds) => {
    if (!strokeIds || strokeIds.length === 0) return;

    try {
      await deletePenStrokes(strokeIds);
      setStrokes((prev) => prev.filter((s) => !strokeIds.includes(s.id)));
    } catch (error) {
      console.error('Failed to delete pen strokes:', error);
    }
  }, []);

  return {
    strokes,
    loading,
    addStroke,
    removeStrokes,
    loadStrokes,
  };
}
