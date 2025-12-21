import { supabase } from './supabase';

// 가중치 기반 랜덤 셔플 (stack이 높을수록 자주 등장)
function weightedShuffle(items) {
  if (!items || items.length === 0) return [];

  // 각 아이템의 가중치 계산: stack + 11 (stack이 -10~무한이므로 최소 1)
  const weighted = items.map((item) => ({
    item,
    weight: Math.max(1, (item.stack || 0) + 11),
  }));

  const result = [];
  const remaining = [...weighted];

  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, w) => sum + w.weight, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < remaining.length; i++) {
      random -= remaining[i].weight;
      if (random <= 0) {
        result.push(remaining[i].item);
        remaining.splice(i, 1);
        break;
      }
    }
  }

  return result;
}

// 오늘의 복습 아이템 조회 (stack이 -10인 항목 제외, 가중치 기반 랜덤 정렬)
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
    .gt('stack', -10); // stack이 -10 이하면 완전히 외운 것으로 제외

  if (error) throw error;

  // 가중치 기반 랜덤 정렬
  return weightedShuffle(data);
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

// 복습 결과 업데이트 (stack 기반 시스템)
// isCorrect: true = "I know" (stack -1), false = "I don't know" (stack +1)
export async function updateReviewResult(id, isCorrect) {
  // 현재 아이템 조회
  const { data: item, error: fetchError } = await supabase
    .from('review_items')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) throw fetchError;

  // Stack 업데이트: 알면 -1, 모르면 +1
  let newStack = (item.stack || 0) + (isCorrect ? -1 : 1);

  // 다음 복습 날짜 계산 (stack이 낮을수록 간격 늘림)
  let intervalDays = 1;
  if (newStack <= -5) {
    intervalDays = 7; // 거의 외운 상태면 일주일 후
  } else if (newStack <= -3) {
    intervalDays = 3;
  } else if (newStack <= 0) {
    intervalDays = 2;
  } else {
    intervalDays = 1; // 모르는 상태면 내일 다시
  }

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + intervalDays);

  const { data, error } = await supabase
    .from('review_items')
    .update({
      stack: newStack,
      interval_days: intervalDays,
      next_review_date: nextDate.toISOString().split('T')[0],
      last_reviewed: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}
