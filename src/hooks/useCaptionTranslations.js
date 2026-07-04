import { useState, useRef, useCallback, useEffect } from 'react';
import { googleTranslate } from '../services/ai/vocabulary';
import { logError } from '../utils/errors';

// Keep concurrent calls to the unofficial Google Translate endpoint low: it is
// shared with word-lookup, and bursting it risks a temporary IP block.
const CONCURRENCY = 4;

/**
 * Lazily translate YouTube caption segments on demand (visibility/playback
 * driven), with an in-memory cache and a small concurrency pool so we never
 * burst-translate a whole transcript at once.
 *
 * Returns a map of `segmentIndex -> translated string` and a
 * `requestTranslation(index, priority?)` trigger. Callers request a line when
 * it scrolls into view or becomes the active (playing) line.
 *
 * State reset (language / source change) is handled by remounting the owner —
 * `CaptionDisplay` is keyed by the source id and only mounts once its segments
 * have loaded — so this hook never has to clear itself in place.
 *
 * @param {object}  opts
 * @param {Array}   opts.segments   caption segments (each with `.text`)
 * @param {boolean} opts.enabled    feature toggle — no work happens when false
 * @param {string}  opts.targetLang target language code (e.g. 'ko')
 */
export default function useCaptionTranslations({ segments, enabled, targetLang }) {
  const [translations, setTranslations] = useState({});

  const cacheRef = useRef(new Map());      // text -> translated (dedupes repeats)
  const requestedRef = useRef(new Set());  // segment indices already queued/done
  const queueRef = useRef([]);             // pending segment indices
  const runningRef = useRef(0);
  // Latest `pump`, so the async `.finally` can re-pump without pump referencing
  // itself (forbidden by the lint rules and prone to capturing a stale closure).
  const pumpRef = useRef(null);
  // Guards against writing state after unmount (e.g. navigating away mid-fetch).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const pump = useCallback(() => {
    if (!enabled) return;

    while (runningRef.current < CONCURRENCY && queueRef.current.length > 0) {
      const index = queueRef.current.shift();
      const text = segments?.[index]?.text?.trim();
      if (!text) continue;

      // Identical line already translated → reuse without a network call.
      const cached = cacheRef.current.get(text);
      if (cached !== undefined) {
        setTranslations(prev => (prev[index] === cached ? prev : { ...prev, [index]: cached }));
        continue;
      }

      runningRef.current += 1;
      googleTranslate(text, targetLang)
        .then(translated => {
          cacheRef.current.set(text, translated);
          if (aliveRef.current) setTranslations(prev => ({ ...prev, [index]: translated }));
        })
        .catch(err => {
          logError('useCaptionTranslations', err);
          // Let this line be retried later (e.g. on re-scroll into view).
          requestedRef.current.delete(index);
        })
        .finally(() => {
          runningRef.current -= 1;
          if (aliveRef.current) pumpRef.current?.();
        });
    }
  }, [enabled, targetLang, segments]);

  // Keep the ref pointing at the current pump for the async re-pump above.
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const requestTranslation = useCallback((index, priority = false) => {
    if (!enabled || index == null || index < 0) return;
    if (requestedRef.current.has(index)) return;
    requestedRef.current.add(index);
    if (priority) queueRef.current.unshift(index);
    else queueRef.current.push(index);
    pump();
  }, [enabled, pump]);

  return { translations, requestTranslation };
}
