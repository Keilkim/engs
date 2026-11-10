import useLongPress from '../../hooks/useLongPress';
import { formatTime } from '../../services/ai/youtube';

export default function PlaybackBookmarkControl({ currentTime, duration, onSeek, reading }) {
  const bookmark = reading.bookmark?.kind === 'video' ? reading.bookmark : null;
  const atBookmark = bookmark && Math.abs(bookmark.time - currentTime) < 1;
  const timePress = useLongPress({
    disabled: !reading.ready,
    onLongPress: () => atBookmark ? reading.remove() : reading.save({ kind: 'video', time: currentTime }),
  });
  const bookmarkPress = useLongPress({ onLongPress: reading.remove, onClick: () => onSeek(bookmark.time) });
  return (
    <div className="playback-bookmark-control">
      <div className="playback-time-row">
        <button type="button" className={`playback-time${atBookmark ? ' bookmarked' : ''}`} {...timePress}
          disabled={!reading.ready} title="길게 눌러 현재 재생 위치 북마크"
          aria-label={`재생 시간 ${formatTime(currentTime)} / ${formatTime(duration)}. 길게 누르거나 Enter로 북마크 ${atBookmark ? '삭제' : '저장'}`}>
          {formatTime(currentTime)} <span>/ {formatTime(duration)}</span>
        </button>
        {bookmark ? (
          <button type="button" className="playback-saved-bookmark" {...bookmarkPress}
            title="눌러서 이동 · 길게 눌러 삭제" aria-label={`${formatTime(bookmark.time)} 북마크. 눌러서 이동, 길게 눌러 삭제`}
            onKeyDown={event => {
              if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                reading.remove();
              }
            }}>
            <svg width="10" height="14" viewBox="0 0 12 16" aria-hidden="true"><path d="M1 1h10v14l-5-3-5 3z" fill="currentColor" /></svg>
            {formatTime(bookmark.time)}
          </button>
        ) : <span className="playback-bookmark-hint">시간을 길게 눌러 북마크</span>}
      </div>
      <div className="playback-bookmark-track">
        <input type="range" aria-label="재생 위치" min="0" max={duration || 1} step="0.1"
          value={Math.min(currentTime, duration || 1)} disabled={!duration}
          onChange={event => onSeek(Number(event.target.value))} />
        {bookmark && duration > 0 && <span className="playback-bookmark-tick" aria-hidden="true"
          style={{ left: `${Math.min(100, bookmark.time / duration * 100)}%` }} />}
      </div>
      {reading.message && <p className="playback-bookmark-message" role="status">{reading.message}</p>}
    </div>
  );
}
