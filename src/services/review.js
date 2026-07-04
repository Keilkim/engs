import { supabase } from './supabase';
import { localDateString } from '../utils/dateUtils';

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

// 오늘의 복습 아이템 조회 (next_review_date <= 오늘 AND status='active')
// 큐 조건은 getTodayReviewCount와 완전히 일치시켜 카운트/실제 큐 불일치를 방지한다.
export async function getTodayReviewItems() {
  const today = localDateString();

  const { data, error } = await supabase
    .from('review_items')
    .select(`
      *,
      annotation:annotations(
        id, selected_text, ai_analysis_json, memo_content, selection_rect,
        source:sources(id, title, type, youtube_data)
      )
    `)
    .lte('next_review_date', today)
    .eq('status', 'active');

  if (error) throw error;

  // 가중치 기반 랜덤 정렬
  return weightedShuffle(data);
}

// 복습 아이템 개수 조회 (getTodayReviewItems와 동일한 필터)
export async function getTodayReviewCount() {
  const today = localDateString();

  const { count, error } = await supabase
    .from('review_items')
    .select('*', { count: 'exact', head: true })
    .lte('next_review_date', today)
    .eq('status', 'active');

  if (error) throw error;
  return count;
}

// 전체 복습 아이템 개수 (신규 사용자와 '오늘 복습 완료'를 구분하기 위해 사용)
export async function getTotalReviewCount() {
  const { count, error } = await supabase
    .from('review_items')
    .select('*', { count: 'exact', head: true });

  if (error) throw error;
  return count || 0;
}

// 복습 결과 업데이트 (표준 SM-2 알고리즘)
// 2버튼 UI를 SM-2 quality로 매핑: 앎=4, 모름=2
//  - 앎=4: (5-q)=1 이므로 ease 변화량 = 0 → ease_factor 2.5가 유지되어
//    연속 정답 시 간격이 1 → 6 → 15 → 38... 로 2.5배씩 증가(문서화된 기대 시퀀스와 일치).
//  - 모름=2: (5-q)=3 → ease가 0.32 감소(하한 1.3)하여 어려운 카드는 간격이 짧아진다.
// 기존 stack 컬럼은 건드리지 않고 ease_factor/repetitions/interval_days로 스케줄링한다.
export async function updateReviewResult(id, isCorrect) {
  // 현재 아이템 조회
  const { data: item, error: fetchError } = await supabase
    .from('review_items')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) throw fetchError;

  const quality = isCorrect ? 4 : 2;
  const prevEase = item.ease_factor || 2.5;
  const prevReps = item.repetitions || 0;
  const prevInterval = item.interval_days || 1;

  // ease_factor 갱신 (모든 응답에 적용, 하한 1.3)
  let easeFactor = prevEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  let repetitions;
  let intervalDays;

  if (quality >= 3) {
    // 정답: repetitions 증가 및 간격 확장
    repetitions = prevReps + 1;
    if (repetitions <= 1) {
      intervalDays = 1;
    } else if (repetitions === 2) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(prevInterval * easeFactor);
    }
  } else {
    // 오답: repetitions/interval 리셋 (내일 다시)
    repetitions = 0;
    intervalDays = 1;
  }

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + intervalDays);

  const { data, error } = await supabase
    .from('review_items')
    .update({
      repetitions,
      interval_days: intervalDays,
      ease_factor: easeFactor,
      next_review_date: localDateString(nextDate),
      last_reviewed: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}
