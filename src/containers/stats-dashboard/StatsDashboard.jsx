import { useState, useEffect } from 'react';
import { getUserStats, getWeeklyStats } from '../../services/stats';
import { useTranslation } from '../../i18n';

export default function StatsDashboard() {
  const { ko } = useTranslation();
  const [stats, setStats] = useState(null);
  const [weeklyStats, setWeeklyStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // 두 요청을 독립적으로 처리한다. Promise.all로 묶으면 주간 통계(user_stats)
      // 읽기가 한 번 실패하는 것만으로 Sources/Cards/Reviewed/Rate 카드까지 전부
      // 0으로 사라진다(catch가 setStats 자체를 건너뜀). allSettled로 각각 반영.
      const [statsRes, weeklyRes] = await Promise.allSettled([
        getUserStats(),
        getWeeklyStats(),
      ]);
      if (cancelled) return;
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      if (weeklyRes.status === 'fulfilled') setWeeklyStats(weeklyRes.value);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="stats-dashboard stats-skeleton">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-chart" />
      </div>
    );
  }

  const maxCards = Math.max(...weeklyStats.map((d) => d.cardsReviewed), 1);

  return (
    <div className="stats-dashboard">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-value">{stats?.sourceCount || 0}</span>
            <span className="stat-label">Sources</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-value">{stats?.cardCount || 0}</span>
            <span className="stat-label">Cards</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-value">{stats?.reviewedCount || 0}</span>
            <span className="stat-label">Reviewed</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-info">
            <span className="stat-value">{stats?.reviewRate || 0}%</span>
            <span className="stat-label">Rate</span>
          </div>
        </div>
      </div>

      <div className="weekly-chart">
        <h3>{ko('stats.weeklyReview')}</h3>
        <div className="chart-bars">
          {weeklyStats.map((day) => (
            <div key={day.date} className="chart-bar-container">
              <div
                className="chart-bar"
                style={{
                  height: `${(day.cardsReviewed / maxCards) * 100}%`,
                }}
              >
                <span className="bar-value">
                  {day.cardsReviewed > 0 ? day.cardsReviewed : ''}
                </span>
              </div>
              <span className="bar-label">{day.day}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
