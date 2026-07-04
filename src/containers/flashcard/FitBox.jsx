import { useRef, useLayoutEffect, useCallback } from 'react';

/**
 * Sizes its content to fill the card without scrolling. The content spans the
 * full width (no wasted side space); the font size is scaled by a `--fit`
 * multiplier found via binary search — the largest value at which the content
 * still fits both axes. So a sparse card gets big text and a dense one gets
 * small text, and either way the width is used.
 *
 * `--fit` is written straight to the DOM (no React state) so there's no
 * setState-in-effect and no extra render. Only the box is observed for resize
 * (viewport/rotation); the font change never feeds back because the content
 * isn't observed. Content changes arrive via remount (the flashcard is keyed
 * per card). A fonts.ready re-fit covers late web-font loads.
 */
export default function FitBox({ children, min = 0.6, max = 3, className = '' }) {
  const boxRef = useRef(null);
  const contentRef = useRef(null);

  const measure = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    if (!bw || !bh) return;

    // Reading scrollWidth/Height after setting --fit forces a synchronous
    // reflow, so each probe reflects that font scale.
    const fits = (s) => {
      content.style.setProperty('--fit', String(s));
      return content.scrollWidth <= bw + 0.5 && content.scrollHeight <= bh + 0.5;
    };

    let best;
    if (fits(max)) {
      best = max; // sparse content: use the biggest allowed
    } else if (!fits(min)) {
      best = min; // even smallest overflows: clamp (overflow stays hidden)
    } else {
      let lo = min;
      let hi = max;
      best = min;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) { best = mid; lo = mid; }
        else hi = mid;
      }
    }
    content.style.setProperty('--fit', String(best));
  }, [min, max]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    let cancelled = false;
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => { if (!cancelled) measure(); });
    }
    return () => { cancelled = true; ro.disconnect(); };
  }, [measure]);

  return (
    <div ref={boxRef} className={`fit-box ${className}`}>
      <div ref={contentRef} className="fit-content">{children}</div>
    </div>
  );
}
