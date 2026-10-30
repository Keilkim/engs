const POSES = {
  idle: '/images/orange-dust-buddy.png',
  loading: '/images/orange-dust-buddy-loading.webp',
  correct: '/images/orange-dust-buddy-correct.webp',
  surprised: '/images/orange-dust-buddy-surprised.webp',
};

export default function Buddy({ className = '', animated = true, pose = 'idle' }) {
  return (
    <div className={`buddy ${animated ? 'buddy-animated' : ''} ${className}`} aria-hidden="true">
      <img src={POSES[pose] || POSES.idle} alt="" width="1280" height="1280" draggable="false" />
    </div>
  );
}
