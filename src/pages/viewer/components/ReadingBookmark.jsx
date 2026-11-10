import useLongPress from '../../../hooks/useLongPress';

export default function ReadingBookmark({ bookmark, onRemove }) {
  const pressHandlers = useLongPress({ onLongPress: onRemove });
  if (!bookmark) return null;
  return (
    <div className="reading-bookmark" style={{ top: `${bookmark.y}%` }} data-reading-bookmark>
      <span className="reading-bookmark-line" />
      <button type="button" className="reading-bookmark-label" {...pressHandlers}
        aria-label="북마크 삭제 (길게 누르기 또는 Enter)" title="길게 누르면 북마크 삭제">
        <svg width="13" height="16" viewBox="0 0 12 16" aria-hidden="true">
          <path d="M1 1h10v14l-5-3-5 3z" fill="currentColor" />
        </svg>
        북마크
      </button>
    </div>
  );
}
