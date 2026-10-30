import { DustPuffs } from '../../components/BuddyLoader';

export default function TapToContinueHint({ busy }) {
  return <div className={`practice-tap-hint ${busy ? 'is-saving' : ''}`} aria-hidden="true">
    {busy ? <DustPuffs /> : <span className="practice-tap-gesture">
      <img src="/images/orange-dust-tap-hand.webp" alt="" width="64" height="64" draggable="false" />
      <span className="practice-tap-rays">{[-64, -32, 0, 32, 64].map(angle =>
        <i key={angle} style={{ '--ray-angle': `${angle}deg` }} />)}</span>
    </span>}
    <span>{busy ? '기억을 담고 있어요' : '확인하고 터치!'}</span>
  </div>;
}
