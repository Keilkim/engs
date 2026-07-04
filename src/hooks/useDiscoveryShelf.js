import { useState, useEffect, useCallback, useRef } from 'react';
import {
  readDiscoverCache,
  isCacheFresh,
  refreshDiscover,
  dismissDiscoverItem,
  recordChoice,
  selectShelfItems,
} from '../services/discovery';

/**
 * Home interest-discovery shelf. Stale-while-revalidate over localStorage — same
 * contract as useDecodeShelf: fresh cache renders with zero network; a stale cache
 * keeps showing THIS session and refreshes silently for the next mount (cards never
 * reshuffle under the finger); no cache fetches and shows. Fails soft (empty → the
 * caller hides the section), so it also degrades cleanly under `npm run dev` (no /api).
 */
export default function useDiscoveryShelf() {
  const [items, setItems] = useState(() => selectShelfItems(readDiscoverCache()?.pools));
  const [loading, setLoading] = useState(() => !readDiscoverCache());
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const cache = readDiscoverCache();
    if (cache && isCacheFresh(cache)) return; // already rendering the fresh cache

    if (cache) {
      refreshDiscover().catch(() => {}); // stale: silent refresh, applied next mount
      return;
    }

    refreshDiscover()
      .then((pools) => setItems(selectShelfItems(pools)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    refreshDiscover({ force: true })
      .then((pools) => setItems(selectShelfItems(pools)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const dismiss = useCallback((id) => {
    const item = items.find((it) => it.id === id);
    if (item) recordChoice(item, -1); // skipping teaches negative preference
    dismissDiscoverItem(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, [items]);

  // Called on a successful add — teaches positive preference for next time.
  const choose = useCallback((id) => {
    const item = items.find((it) => it.id === id);
    if (item) recordChoice(item, +1);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, [items]);

  return { items, loading, refresh, dismiss, choose };
}
