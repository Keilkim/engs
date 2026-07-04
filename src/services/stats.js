import { supabase } from './supabase';
import { localDateString } from '../utils/dateUtils';

// 사용자 통계 조회
export async function getUserStats() {
  const { data: { user } } = await supabase.auth.getUser();

  // 총 소스 수
  const { count: sourceCount } = await supabase
    .from('sources')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  // 총 어노테이션 수 (학습 카드)
  const { count: annotationCount } = await supabase
    .from('annotations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  // 복습 완료 수
  // 기준을 last_reviewed IS NOT NULL로 사용: SM-2에서 오답 시 repetitions가 0으로
  // 리셋되므로 repetitions>0만 세면 '틀리기만 한 카드'가 누락된다. 한 번이라도
  // 복습한 카드를 세는 last_reviewed 기준이 더 일관적이다.
  const { count: reviewedCount } = await supabase
    .from('review_items')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('last_reviewed', 'is', null);

  // 총 복습 아이템 수
  const { count: totalReviewCount } = await supabase
    .from('review_items')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  // 복습 달성률 계산
  const reviewRate = totalReviewCount > 0
    ? Math.round((reviewedCount / totalReviewCount) * 100)
    : 0;

  return {
    sourceCount: sourceCount || 0,
    annotationCount: annotationCount || 0,
    reviewedCount: reviewedCount || 0,
    totalReviewCount: totalReviewCount || 0,
    reviewRate,
  };
}

// 주간 학습 통계 조회
export async function getWeeklyStats() {
  const { data: { user } } = await supabase.auth.getUser();

  // 최근 7일
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(localDateString(date));
  }

  const { data, error } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', user.id)
    .in('date', days)
    .order('date', { ascending: true });

  if (error) throw error;

  // 날짜별로 정리 (데이터 없으면 0)
  const weeklyData = days.map((date) => {
    const stat = data?.find((d) => d.date === date);
    return {
      date,
      day: new Date(date).toLocaleDateString('ko-KR', { weekday: 'short' }),
      cardsReviewed: stat?.cards_reviewed || 0,
      cardsCorrect: stat?.cards_correct || 0,
    };
  });

  return weeklyData;
}

// 오늘 학습 통계 업데이트
export async function updateTodayStats(field, increment = 1) {
  const { data: { user } } = await supabase.auth.getUser();
  const today = localDateString();

  // 오늘 데이터 조회
  const { data: existing } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .single();

  if (existing) {
    // 업데이트
    const { error } = await supabase
      .from('user_stats')
      .update({
        [field]: (existing[field] || 0) + increment,
      })
      .eq('id', existing.id);

    if (error) throw error;
  } else {
    // 새로 생성
    const { error } = await supabase
      .from('user_stats')
      .insert({
        user_id: user.id,
        date: today,
        [field]: increment,
      });

    if (error) throw error;
  }
}
