import { useState, useRef, useCallback, useEffect } from 'react';
import { translateLines } from '../services/ai/vocabulary';
import { logError } from '../utils/errors';

// Lines are translated in batches (one Gemini call each) so a transcript costs
// a handful of calls from the daily AI quota instead of one per line.
const BATCH_SIZE = 15;
// Requests arrive one per visible line in the same tick; wait briefly so a
// screenful lands in one batch instead of the first line going alone.
const BATCH_WINDOW_MS = 40;
const CONCURRENCY = 2;
// A line that keeps failing is re-queued this many times before we give up
// (a later re-scroll can still start it over).
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;
// A stalled request would otherwise hold its concurrency slot forever; abort
// it so the slot is released and the lines can be retried.
const TRANSLATE_TIMEOUT_MS = 15000;

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
  const inFlightRef = useRef(new Set());    // texts in a running batch
  const waitersRef = useRef(new Map());     // text -> Set of segment indices waiting for it
  const requestedRef = useRef(new Set());   // segment indices queued/running/done
  const attemptsRef = useRef(new Map());    // index -> failed attempts so far
  const queueRef = useRef([]);              // pending segment indices
  const runningRef = useRef(0);
  const controllersRef = useRef(new Set()); // in-flight AbortControllers (for unmount)
  const batchTimerRef = useRef(null);
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
      clearTimeout(batchTimerRef.current);
      controllers.forEach((c) => c.abort());
      controllers.clear();
    };
  }, []);

  const showTranslation = useCallback((index, translated) => {
    setTranslations(prev => (prev[index] === translated ? prev : { ...prev, [index]: translated }));
  }, []);

  // Bounded retry: nothing re-requests a line that stays on screen, so re-queue
  // it ourselves after a short backoff instead of leaving it permanently blank
  // on a transient failure.
  const retryLater = useCallback((index) => {
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
  }, []);

  const pump = useCallback(() => {
    if (!enabled) return;

    while (runningRef.current < CONCURRENCY && queueRef.current.length > 0) {
      // Collect up to BATCH_SIZE distinct texts that still need translating.
      const texts = [];
      while (texts.length < BATCH_SIZE && queueRef.current.length > 0) {
        const index = queueRef.current.shift();
        const text = segments?.[index]?.text?.trim();
        if (!text) continue;

        // Identical line already translated → reuse without a network call.
        const cached = cacheRef.current.get(text);
        if (cached !== undefined) {
          showTranslation(index, cached);
          continue;
        }

        if (!waitersRef.current.has(text)) waitersRef.current.set(text, new Set());
        waitersRef.current.get(text).add(index);
        // Already being translated (this batch or a running one) → just wait.
        if (inFlightRef.current.has(text)) continue;
        inFlightRef.current.add(text);
        texts.push(text);
      }
      if (texts.length === 0) continue;

      runningRef.current += 1;
      const controller = new AbortController();
      controllersRef.current.add(controller);
      const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);

      const settle = (text) => {
        const indices = waitersRef.current.get(text) || new Set();
        waitersRef.current.delete(text);
        inFlightRef.current.delete(text);
        return indices;
      };

      translateLines(texts, targetLang, { signal: controller.signal })
        .then(results => {
          texts.forEach((text, i) => {
            cacheRef.current.set(text, results[i]);
            settle(text).forEach(index => {
              attemptsRef.current.delete(index);
              if (aliveRef.current) showTranslation(index, results[i]);
            });
          });
        })
        .catch(err => {
          logError('useCaptionTranslations', err);
          texts.forEach(text => settle(text).forEach(retryLater));
        })
        .finally(() => {
          clearTimeout(timer);
          controllersRef.current.delete(controller);
          runningRef.current -= 1;
          if (aliveRef.current) pumpRef.current?.();
        });
    }
  }, [enabled, targetLang, segments, showTranslation, retryLater]);

  const schedulePump = useCallback(() => {
    if (batchTimerRef.current) return;
    batchTimerRef.current = setTimeout(() => {
      batchTimerRef.current = null;
      pumpRef.current?.();
    }, BATCH_WINDOW_MS);
  }, []);

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
          schedulePump();
        }
      }
      return;
    }

    requestedRef.current.add(index);
    if (priority) queueRef.current.unshift(index);
    else queueRef.current.push(index);
    schedulePump();
  }, [enabled, schedulePump]);

  return { translations, requestTranslation };
}
