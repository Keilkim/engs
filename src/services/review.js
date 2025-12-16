import { supabase } from './supabase';

// 오늘의 복습 아이템 조회
export async function getTodayReviewItems() {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('review_items')
    .select(`
      *,
      annotation:annotations(
        *,
        source:sources(*)
      )
    `)
    .lte('next_review_date', today)
    .eq('status', 'active')
    .order('next_review_date', { ascending: true });

  if (error) throw error;
  return data;
}

// 복습 아이템 개수 조회
export async function getTodayReviewCount() {
  const today = new Date().toISOString().split('T')[0];

  const { count, error } = await supabase
    .from('review_items')
    .select('*', { count: 'exact', head: true })
    .lte('next_review_date', today)
    .eq('status', 'active');

  if (error) throw error;
  return count;
}

// 복습 결과 업데이트 (망각 곡선 알고리즘)
export async function updateReviewResult(id, isCorrect) {
  // 현재 아이템 조회
  const { data: item, error: fetchError } = await supabase
    .from('review_items')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) throw fetchError;

  // SM-2 알고리즘 적용
  let { interval_days, ease_factor, repetitions } = item;

  if (isCorrect) {
    repetitions += 1;
    if (repetitions === 1) {
      interval_days = 1;
    } else if (repetitions === 2) {
      interval_days = 6;
    } else {
      interval_days = Math.round(interval_days * ease_factor);
    }
    ease_factor = Math.max(1.3, ease_factor + 0.1);
  } else {
    repetitions = 0;
    interval_days = 1;
    ease_factor = Math.max(1.3, ease_factor - 0.2);
  }

  // 다음 복습 날짜 계산
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval_days);

  const { data, error } = await supabase
    .from('review_items')
    .update({
      interval_days,
      ease_factor,
      repetitions,
      next_review_date: nextDate.toISOString().split('T')[0],
      last_reviewed: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}
