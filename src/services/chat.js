import { supabase } from './supabase';

// 채팅 로그 저장
export async function saveChatMessage(message, role, sourceId = null) {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('chat_logs')
    .insert({
      user_id: user.id,
      source_id: sourceId,
      role,
      message,
      is_scrapped: false,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// 채팅 로그 조회
export async function getChatLogs(sourceId = null, limit = 50) {
  const { data: { user } } = await supabase.auth.getUser();

  let query = supabase
    .from('chat_logs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (sourceId) {
    query = query.eq('source_id', sourceId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
}

// 메시지 스크랩
export async function scrapMessage(id) {
  const { data, error } = await supabase
    .from('chat_logs')
    .update({ is_scrapped: true })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// 스크랩 해제
export async function unscrapMessage(id) {
  const { data, error } = await supabase
    .from('chat_logs')
    .update({ is_scrapped: false })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// 스크랩된 메시지 조회
export async function getScrappedMessages() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('chat_logs')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_scrapped', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// 채팅 로그 삭제 (전체 또는 특정 소스)
export async function clearChatLogs(sourceId = null) {
  const { data: { user } } = await supabase.auth.getUser();

  let query = supabase
    .from('chat_logs')
    .delete()
    .eq('user_id', user.id);

  if (sourceId) {
    query = query.eq('source_id', sourceId);
  } else {
    query = query.is('source_id', null);
  }

  const { error } = await query;

  if (error) throw error;
  return true;
}
