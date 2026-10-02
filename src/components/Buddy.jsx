export default function Buddy({ className = '', animated = true }) {
  return (
    <div className={`buddy ${animated ? 'buddy-animated' : ''} ${className}`} aria-hidden="true">
      <img src="/images/orange-dust-buddy.png" alt="" width="1280" height="1280" draggable="false" />
    </div>
  );
}
