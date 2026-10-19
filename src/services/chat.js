import { supabase } from './supabase';
import { captureSessionScope, assertSessionScope } from './sessionScope';

async function requestScope(options = {}) {
  const sessionScope = options.sessionScope || await captureSessionScope();
  assertSessionScope(sessionScope);
  const signal = options.signal
    ? AbortSignal.any([options.signal, sessionScope.signal])
    : sessionScope.signal;
  signal.throwIfAborted();
  return { sessionScope, signal };
}

function assertRequest({ sessionScope, signal }) {
  assertSessionScope(sessionScope);
  signal.throwIfAborted();
}

// 채팅 로그 저장
export async function saveChatMessage(message, role, sourceId = null, options = {}) {
  const scope = await requestScope(options);
  assertRequest(scope);

  const { data, error } = await supabase
    .from('chat_logs')
    .insert({
      user_id: scope.sessionScope.userId,
      source_id: sourceId,
      role,
      message,
      is_scrapped: false,
    })
    .select()
    .single()
    .abortSignal(scope.signal);

  assertRequest(scope);
  if (error) throw error;
  return data;
}

// 채팅 로그 조회
export async function getChatLogs(sourceId = null, limit = 50, options = {}) {
  const scope = await requestScope(options);
  assertRequest(scope);

  // Fetch the most recent `limit` rows (descending), then reverse to
  // chronological order. Ordering ascending + limit would return the OLDEST
  // messages and drop the recent context once history exceeds `limit`.
  let query = supabase
    .from('chat_logs')
    .select('*')
    .eq('user_id', scope.sessionScope.userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (sourceId) {
    query = query.eq('source_id', sourceId);
  } else {
    query = query.is('source_id', null);
  }

  const { data, error } = await query.abortSignal(scope.signal);

  assertRequest(scope);
  if (error) throw error;
  return (data || []).reverse();
}

// 메시지 스크랩
export async function scrapMessage(id) {
  const scope = await requestScope();
  assertRequest(scope);
  const { data, error } = await supabase
    .from('chat_logs')
    .update({ is_scrapped: true })
    .eq('id', id)
    .eq('user_id', scope.sessionScope.userId)
    .select()
    .single()
    .abortSignal(scope.signal);

  assertRequest(scope);
  if (error) throw error;
  return data;
}

// 스크랩 해제
export async function unscrapMessage(id) {
  const scope = await requestScope();
  assertRequest(scope);
  const { data, error } = await supabase
    .from('chat_logs')
    .update({ is_scrapped: false })
    .eq('id', id)
    .eq('user_id', scope.sessionScope.userId)
    .select()
    .single()
    .abortSignal(scope.signal);

  assertRequest(scope);
  if (error) throw error;
  return data;
}

// 스크랩된 메시지 조회
export async function getScrappedMessages() {
  const scope = await requestScope();
  assertRequest(scope);

  const { data, error } = await supabase
    .from('chat_logs')
    .select('*')
    .eq('user_id', scope.sessionScope.userId)
    .eq('is_scrapped', true)
    .order('created_at', { ascending: false })
    .abortSignal(scope.signal);

  assertRequest(scope);
  if (error) throw error;
  return data;
}

// 채팅 로그 삭제 (전체 또는 특정 소스)
export async function clearChatLogs(sourceId = null, options = {}) {
  const scope = await requestScope(options);
  assertRequest(scope);

  let query = supabase
    .from('chat_logs')
    .delete()
    .eq('user_id', scope.sessionScope.userId);

  if (sourceId) {
    query = query.eq('source_id', sourceId);
  } else {
    query = query.is('source_id', null);
  }

  const { error } = await query.abortSignal(scope.signal);

  assertRequest(scope);
  if (error) throw error;
  return true;
}
