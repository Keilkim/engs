import { supabase } from './supabase';
import { localDateString } from '../utils/dateUtils';
import { captureSessionScope, assertSessionScope } from './sessionScope.js';
import { nextReviewState } from './reviewPractice.js';

const CARD_SELECT = `*, annotation:annotations(id, source_id, selected_text, ai_analysis_json, memo_content, selection_rect,
  source:sources(id, title, type, youtube_data))`;

async function scopedResult(query, scope) {
  assertSessionScope(scope);
  const result = await query.abortSignal(scope.signal);
  assertSessionScope(scope);
  if (result.error) throw result.error;
  return result;
}

async function readCards({ due = false, ids } = {}) {
  const scope = await captureSessionScope();
  const items = [];
  // Paginate so a large backlog does not silently turn into "all finished".
  for (let offset = 0; ; offset += 500) {
    let query = supabase.from('review_items').select(CARD_SELECT).eq('user_id', scope.userId).order('id');
    if (due) query = query.eq('status', 'active').lte('next_review_date', localDateString());
    if (ids) query = query.in('id', ids);
    const { data } = await scopedResult(query.range(offset, offset + 499), scope);
    items.push(...(data || []));
    if (!data || data.length < 500) return items;
  }
}

export const getTodayReviewItems = () => readCards({ due: true });
export const getReviewLibrary = () => readCards();
export const getReviewItemsByIds = ids => ids.length ? readCards({ ids }) : Promise.resolve([]);

async function countReviews(due) {
  const scope = await captureSessionScope();
  let query = supabase.from('review_items').select('id', { count: 'exact', head: true }).eq('user_id', scope.userId);
  if (due) query = query.eq('status', 'active').lte('next_review_date', localDateString());
  const { count } = await scopedResult(query, scope);
  return count || 0;
}

export const getTodayReviewCount = () => countReviews(true);
export const getTotalReviewCount = () => countReviews(false);

export async function getReviewOverview() {
  const scope = await captureSessionScope();
  const [due, total, latest] = await Promise.all([
    getTodayReviewCount(), getTotalReviewCount(),
    scopedResult(supabase.from('review_items').select('last_reviewed').eq('user_id', scope.userId)
      .not('last_reviewed', 'is', null).order('last_reviewed', { ascending: false }).limit(1), scope),
  ]);
  assertSessionScope(scope);
  return { due, total, lastReviewed: latest.data?.[0]?.last_reviewed || null };
}

export async function setReviewStatus(id, status) {
  if (!['active', 'suspended'].includes(status)) throw new Error('잘못된 복습 상태입니다.');
  const scope = await captureSessionScope();
  const { data } = await scopedResult(supabase.from('review_items').update({ status })
    .eq('id', id).eq('user_id', scope.userId).select('id, status').single(), scope);
  return data;
}

export async function updateReviewResult(id, isCorrect) {
  const scope = await captureSessionScope();
  const read = () => scopedResult(supabase.from('review_items').select('*')
    .eq('id', id).eq('user_id', scope.userId).single(), scope);
  const { data: item } = await read();
  if (item.status !== 'active') throw new Error('이 항목은 복습에서 빠졌어요. 목록을 새로 불러와 주세요.');
  const today = localDateString();
  // Network retries / another tab / same-session practice must not advance SM-2 twice.
  if (item.next_review_date > today) return { item, alreadyRecorded: true };
  const updates = nextReviewState(item, isCorrect);
  let query = supabase.from('review_items').update(updates).eq('id', id)
    .eq('user_id', scope.userId).eq('status', 'active').eq('next_review_date', item.next_review_date);
  query = item.last_reviewed ? query.eq('last_reviewed', item.last_reviewed) : query.is('last_reviewed', null);
  const { data } = await scopedResult(query.select().maybeSingle(), scope);
  if (data) return { item: data, alreadyRecorded: false };
  const { data: current } = await read();
  if (current.status === 'active' && current.next_review_date > today) return { item: current, alreadyRecorded: true };
  throw new Error('다른 화면에서 항목이 바뀌었어요. 다시 불러와 주세요.');
}
