import { DustPuffs } from '../../components/BuddyLoader';

export default function TapToContinueHint({ busy }) {
  return <div className={`practice-tap-hint ${busy ? 'is-saving' : ''}`} aria-hidden="true">
    {busy && <DustPuffs />}
    <span>{busy ? '기억을 담고 있어요' : '확인하고 터치!'}</span>
  </div>;
}
