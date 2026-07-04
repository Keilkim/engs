import { useRef, useState, useLayoutEffect, useCallback } from 'react';

/**
 * Sizes its content to fill the available box without ever scrolling: the whole
 * block is uniformly scaled with transform:scale so text stays proportional.
 * Content that's too big shrinks; content with room to spare grows (up to max),
 * so a short grammar answer isn't left tiny in a big card. Always centered.
 *
 * The content is inline-block/max-width:100% so its measured width is its real
 * used width (never wider than the box). Scaling by min(bw/cw, bh/ch) therefore
 * keeps it inside the box on BOTH axes — no overflow, no scrollbar. Measurement
 * uses layout size (scrollWidth/Height), which the transform doesn't change, so
 * re-measures are idempotent (no ResizeObserver feedback loop).
 */
export default function FitBox({ children, min = 0.4, max = 1.6, className = '' }) {
  const boxRef = useRef(null);
  const contentRef = useRef(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const bw = box.clientWidth;
    const bh = box.clientHeight;
    const cw = content.scrollWidth;
    const ch = content.scrollHeight;
    if (!bw || !bh || !cw || !ch) return;
    // 비율 유지: 폭/높이 중 더 빡빡한 쪽에 맞춤. 남으면 확대, 넘치면 축소.
    const next = Math.min(bw / cw, bh / ch);
    setScale(Math.max(min, Math.min(max, next)));
  }, [min, max]);

  useLayoutEffect(() => {
    measure();
    // 박스 크기 변화(뷰포트/회전) + 내용 리플로우(폰트 늦은 로드 등)에 재측정.
    // transform은 레이아웃 크기를 안 바꾸므로 RO가 스케일로 인해 재발화하지 않음.
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div ref={boxRef} className={`fit-box ${className}`}>
      <div
        ref={contentRef}
        className="fit-content"
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
