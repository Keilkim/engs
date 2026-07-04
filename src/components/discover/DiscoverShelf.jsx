import { TranslatableText } from '../translatable';
import { discoverRelativeTime } from '../../services/discovery';

// Type badge copy keys live in ui.json (home.discoverBadge*).
const BADGE = {
  youtube: { key: 'home.discoverBadgeYoutube', fallback: 'Video' },
  pdf: { key: 'home.discoverBadgePdf', fallback: 'PDF' },
  web: { key: 'home.discoverBadgeArticle', fallback: 'Article' },
};

// The discovery feed: one calm horizontal row of type-badged cards (one per type),
// each recommending fresh EXTERNAL content matched to the user's interests. Tapping a
// card opens the consent AddSourceModal (never auto-adds). Self-hiding: the caller only
// renders this when items.length > 0, so an empty/failed feed leaves no trace.
export default function DiscoverShelf({ items, onOpen, onDismiss, onRefresh }) {
  if (!items || items.length === 0) return null;

  return (
    <section className="shelf-section discover-section">
      <div className="section-header">
        <h2>
          <TranslatableText textKey="home.discoverTitle">For You</TranslatableText>
        </h2>
        <button className="shelf-refresh" onClick={onRefresh}>
          <TranslatableText textKey="home.shelfRefresh">Refresh</TranslatableText>
        </button>
      </div>
      <div className="shelf-row">
        {items.map((item) => {
          const badge = BADGE[item.kind] || BADGE.web;
          return (
            <div key={item.id} className="shelf-card" onClick={() => onOpen(item)}>
              <div className="shelf-thumb">
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt=""
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div className="shelf-thumb-placeholder">{badge.fallback}</div>
                )}
                <span className={`shelf-badge shelf-badge-${item.kind}`}>
                  <TranslatableText textKey={badge.key}>{badge.fallback}</TranslatableText>
                </span>
                <button
                  className="shelf-dismiss"
                  aria-label="Skip this"
                  onClick={(e) => { e.stopPropagation(); onDismiss(item.id); }}
                >
                  ✕
                </button>
              </div>
              <div className="shelf-title">{item.title}</div>
              <div className="shelf-meta">
                {item.source}
                {item.published ? ` · ${discoverRelativeTime(item.published)}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
