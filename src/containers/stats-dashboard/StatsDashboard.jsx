import { useState, useEffect } from 'react';
import { getUserStats, getWeeklyStats } from '../../services/stats';

export default function StatsDashboard() {
  const [stats, setStats] = useState(null);
  const [weeklyStats, setWeeklyStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    setLoading(true);
    try {
      const [statsData, weeklyData] = await Promise.all([
        getUserStats(),
        getWeeklyStats(),
      ]);
      setStats(statsData);
      setWeeklyStats(weeklyData);
    } catch (err) {
      console.error('통계 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }

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
          <span className="stat-icon">📚</span>
          <div className="stat-info">
            <span className="stat-value">{stats?.sourceCount || 0}</span>
            <span className="stat-label">학습 소스</span>
          </div>
        </div>

        <div className="stat-card">
          <span className="stat-icon">📝</span>
          <div className="stat-info">
            <span className="stat-value">{stats?.annotationCount || 0}</span>
            <span className="stat-label">암기 카드</span>
          </div>
        </div>

        <div className="stat-card">
          <span className="stat-icon">✅</span>
          <div className="stat-info">
            <span className="stat-value">{stats?.reviewedCount || 0}</span>
            <span className="stat-label">복습 완료</span>
          </div>
        </div>

        <div className="stat-card">
          <span className="stat-icon">📊</span>
          <div className="stat-info">
            <span className="stat-value">{stats?.reviewRate || 0}%</span>
            <span className="stat-label">달성률</span>
          </div>
        </div>
      </div>

      <div className="weekly-chart">
        <h3>주간 복습 현황</h3>
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
