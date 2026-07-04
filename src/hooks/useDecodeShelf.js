import { useState, useEffect, useCallback, useRef } from 'react';
import {
  readShelfCache,
  isCacheFresh,
  refreshShelf,
  dismissShelfItem,
} from '../services/shelf';

/**
 * Home "next to decode" shelf. Stale-while-revalidate over localStorage:
 *  - fresh cache  → render it, zero network.
 *  - stale cache  → keep showing it THIS session, refresh silently for the next
 *    mount (so cards never reshuffle under the user's finger).
 *  - no cache     → fetch and show.
 *
 * Fails soft: any fetch error leaves items empty and the caller hides the section
 * (so it also degrades cleanly under `npm run dev`, which has no /api proxy).
 */
export default function useDecodeShelf() {
  const [items, setItems] = useState(() => readShelfCache()?.items || []);
  // Start in loading only when there's no cache to show yet — avoids a synchronous
  // setState inside the effect (which triggers a cascading render).
  const [loading, setLoading] = useState(() => !readShelfCache());
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const cache = readShelfCache();
    if (cache && isCacheFresh(cache)) return; // already rendering the fresh cache

    if (cache) {
      // Stale: keep this session's cards; refresh silently, applied next mount.
      refreshShelf().catch(() => {});
      return;
    }

    // Absent: loading already started true from init; fetch and show.
    refreshShelf()
      .then((fresh) => setItems(fresh))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // User-initiated → apply immediately (10-min throttle lives in refreshShelf).
  const refresh = useCallback(() => {
    setLoading(true);
    refreshShelf({ force: true })
      .then((fresh) => setItems(fresh))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const dismiss = useCallback((videoId) => {
    dismissShelfItem(videoId);
    setItems((prev) => prev.filter((it) => it.videoId !== videoId));
  }, []);

  return { items, loading, refresh, dismiss };
}
