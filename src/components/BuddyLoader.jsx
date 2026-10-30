import Buddy from './Buddy';
import './buddy-loader.css';

const PUFF_IMAGES = [
  '/images/orange-dust-loading-puff-round.webp',
  '/images/orange-dust-loading-puff-soft.webp',
  '/images/orange-dust-loading-puff.webp',
  '/images/orange-dust-loading-puff-burst.webp',
];

export function DustPuffs() {
  return <span className="dust-puffs" aria-hidden="true">
    {PUFF_IMAGES.map(src => <img key={src} src={src} alt="" width="24" height="24" draggable="false" />)}
  </span>;
}

export default function BuddyLoader({ label = '잠깐만요, 준비하고 있어요', fullScreen = false, compact = false, className = '' }) {
  return <div className={`buddy-loader ${fullScreen ? 'buddy-loader--screen' : ''} ${compact ? 'buddy-loader--compact' : ''} ${className}`} role="status" aria-live="polite">
    <div className="buddy-loader-art" aria-hidden="true">
      <Buddy className="buddy-loader-character" pose="loading" animated={false} />
      <DustPuffs />
    </div>
    <span className="buddy-loader-label">{label.replace(/(?:\.{3}|…)$/, '')}</span>
  </div>;
}
