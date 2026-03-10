import { useEffect, useRef } from 'react';
import CaptionLine from './CaptionLine';
import useCaptionSync from '../../hooks/useCaptionSync';

export default function CaptionDisplay({
  segments,
  currentTime,
  isPlaying,
  onSeek,
  onWordLongPress,
  savedWords,
}) {
  const scrollContainerRef = useRef(null);
  const { currentSegmentIndex, isActiveIndex } = useCaptionSync(segments, currentTime);

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

  if (!segments || segments.length === 0) {
    return (
      <div className="caption-display empty">
        <p>자막이 없습니다</p>
      </div>
    );
  }

  return (
    <div className="caption-display" ref={scrollContainerRef}>
      {segments.map((segment, index) => (
        <CaptionLine
          key={segment.id ?? index}
          segment={segment}
          index={index}
          isActive={isActiveIndex(index)}
          isPlaying={isPlaying}
          currentTime={currentTime}
          onSeek={onSeek}
          onWordLongPress={onWordLongPress}
          savedWords={savedWords}
        />
      ))}
    </div>
  );
}
