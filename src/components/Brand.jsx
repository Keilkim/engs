import { Link } from 'react-router-dom';

export default function Brand({ to = '/', className = '' }) {
  return (
    <Link to={to} className={`brand ${className}`} aria-label="Orange Dust home">
      <img className="brand-buddy" src="/images/orange-dust-buddy.png" width="44" height="44" alt="" />
      <img className="brand-wordmark" src="/images/orange-dust-wordmark.png" width="2172" height="724" alt="Orange Dust" />
    </Link>
  );
}
