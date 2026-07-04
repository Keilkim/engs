import { useEffect, useRef } from 'react';
import CaptionLine from './CaptionLine';
import useCaptionSync from '../../hooks/useCaptionSync';
import useCaptionTranslations from '../../hooks/useCaptionTranslations';

export default function CaptionDisplay({
  segments,
  currentTime,
  isPlaying,
  onSeek,
  onWordLongPress,
  onLineLongPress,
  onPressStart,
  onPressEndNoMenu,
  savedWords,
  showTranslation = false,
  translationLang = 'ko',
}) {
  const scrollContainerRef = useRef(null);
  const { currentSegmentIndex, isActiveIndex } = useCaptionSync(segments, currentTime);
  const { translations, requestTranslation } = useCaptionTranslations({
    segments,
    enabled: showTranslation,
    targetLang: translationLang,
  });

  // Auto-scroll to active segment
  useEffect(() => {
    if (currentSegmentIndex < 0 || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const activeElement = container.querySelector(`[data-segment-index="${currentSegmentIndex}"]`);

    if (activeElement) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = activeElement.getBoundingClientRect();
      const offsetTop = elementRect.top - containerRect.top;
      const targetScroll = container.scrollTop + offsetTop - containerRect.height / 2 + elementRect.height / 2;

      container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }, [currentSegmentIndex]);

  // Translate the currently-playing line first so it's ready as it scrolls in.
  useEffect(() => {
    if (showTranslation && currentSegmentIndex >= 0) {
      requestTranslation(currentSegmentIndex, true);
    }
  }, [showTranslation, currentSegmentIndex, requestTranslation]);

  // Translate lines as they scroll into view (covers free scrolling + playback)
  // so we never burst-translate the whole transcript at once.
  useEffect(() => {
    if (!showTranslation) return;
    const container = scrollContainerRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number(entry.target.dataset.segmentIndex);
          if (!Number.isNaN(idx)) requestTranslation(idx);
        }
      },
      { root: container, rootMargin: '200px 0px' }
    );

    container.querySelectorAll('.caption-line').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [showTranslation, segments, requestTranslation]);

  if (!segments || segments.length === 0) {
    return (
      <div className="caption-display empty">
        <p>자막이 없습니다</p>
      </div>
    );
  }

  return (
    <div className="caption-display" ref={scrollContainerRef}>
      {segments.map((segment, index) => {
        const active = isActiveIndex(index);
        return (
        <CaptionLine
          key={segment.id ?? index}
          segment={segment}
          index={index}
          isActive={active}
          isPlaying={isPlaying}
          // Only the active line needs the ticking currentTime; inactive lines
          // get a stable `undefined` so React.memo skips re-rendering them.
          currentTime={active ? currentTime : undefined}
          onSeek={onSeek}
          onWordLongPress={onWordLongPress}
          onLineLongPress={onLineLongPress}
          onPressStart={onPressStart}
          onPressEndNoMenu={onPressEndNoMenu}
          savedWords={savedWords}
          translation={showTranslation ? translations[index] : undefined}
        />
        );
      })}
    </div>
  );
}
