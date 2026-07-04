import { useState, useRef, useCallback, useEffect } from 'react';
import { googleTranslate } from '../services/ai/vocabulary';
import { logError } from '../utils/errors';

// Keep concurrent calls to the unofficial Google Translate endpoint low: it is
// shared with word-lookup, and bursting it risks a temporary IP block.
const CONCURRENCY = 4;
// A line that keeps failing is re-queued this many times before we give up
// (a later re-scroll can still start it over).
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;
// A stalled fetch would otherwise hold its concurrency slot forever; abort it
// so the slot is released and the line can be retried.
const TRANSLATE_TIMEOUT_MS = 8000;

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

  const cacheRef = useRef(new Map());       // text -> translated (dedupes repeats)
  const inFlightRef = useRef(new Map());    // text -> in-flight promise (dedupes concurrent identical lines)
  const requestedRef = useRef(new Set());   // segment indices queued/running/done
  const attemptsRef = useRef(new Map());    // index -> failed attempts so far
  const queueRef = useRef([]);              // pending segment indices
  const runningRef = useRef(0);
  const controllersRef = useRef(new Set()); // in-flight AbortControllers (for unmount)
  // Latest `pump`, so async callbacks can re-pump without pump referencing
  // itself (forbidden by the lint rules and prone to capturing a stale closure).
  const pumpRef = useRef(null);
  // Guards against writing state / retrying after unmount.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      aliveRef.current = false;
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
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

      // Share one network call across identical lines requested close together,
      // and time out a stalled request so its slot is always released.
      let shared = inFlightRef.current.get(text);
      if (!shared) {
        const controller = new AbortController();
        controllersRef.current.add(controller);
        const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
        shared = googleTranslate(text, targetLang, { signal: controller.signal })
          .finally(() => {
            clearTimeout(timer);
            controllersRef.current.delete(controller);
            inFlightRef.current.delete(text);
          });
        inFlightRef.current.set(text, shared);
      }

      shared
        .then(translated => {
          cacheRef.current.set(text, translated);
          attemptsRef.current.delete(index);
          if (aliveRef.current) setTranslations(prev => ({ ...prev, [index]: translated }));
        })
        .catch(err => {
          logError('useCaptionTranslations', err);
          // Bounded retry: nothing re-requests a line that stays on screen, so
          // re-queue it ourselves after a short backoff instead of leaving it
          // permanently blank on a transient failure.
          const attempts = (attemptsRef.current.get(index) || 0) + 1;
          if (aliveRef.current && attempts < MAX_ATTEMPTS) {
            attemptsRef.current.set(index, attempts);
            setTimeout(() => {
              if (!aliveRef.current) return;
              queueRef.current.push(index);
              pumpRef.current?.();
            }, RETRY_BASE_MS * attempts);
          } else {
            // Give up for now; a later genuine re-request (re-scroll) starts over.
            attemptsRef.current.delete(index);
            requestedRef.current.delete(index);
          }
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

    if (requestedRef.current.has(index)) {
      // Already known. If this is a priority (active-line) request and the line
      // is still waiting in the queue, jump it to the front so the line being
      // read is translated before earlier already-scrolled-past lines.
      if (priority) {
        const qi = queueRef.current.indexOf(index);
        if (qi > 0) {
          queueRef.current.splice(qi, 1);
          queueRef.current.unshift(index);
          pump();
        }
      }
      return;
    }

    requestedRef.current.add(index);
    if (priority) queueRef.current.unshift(index);
    else queueRef.current.push(index);
    pump();
  }, [enabled, pump]);

  return { translations, requestTranslation };
}
