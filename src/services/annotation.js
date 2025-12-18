import { supabase } from './supabase';

// 소스의 어노테이션 목록 조회
export async function getAnnotations(sourceId) {
  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('source_id', sourceId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

// 어노테이션 추가 (하이라이트/메모)
export async function createAnnotation(annotation) {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .insert({
      ...annotation,
      user_id: user.id,
    })
    .select()
    .single();

  if (error) throw error;

  // 복습 아이템으로 자동 등록
  if (annotation.type === 'highlight') {
    await createReviewItem(data.id);
  }

  return data;
}

// 어노테이션 삭제
export async function deleteAnnotation(id) {
  const { error } = await supabase
    .from('annotations')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// 어노테이션 업데이트
export async function updateAnnotation(id, updates) {
  const { data, error } = await supabase
    .from('annotations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// 복습 아이템 생성
async function createReviewItem(annotationId) {
  const { data: { user } } = await supabase.auth.getUser();
  const today = new Date().toISOString().split('T')[0];

  const { error } = await supabase
    .from('review_items')
    .insert({
      user_id: user.id,
      annotation_id: annotationId,
      next_review_date: today,
      interval_days: 1,
      ease_factor: 2.5,
      repetitions: 0,
      status: 'active',
    });

  if (error) throw error;
}

// 모든 저장된 단어 조회 (vocabulary 타입)
export async function getVocabulary() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'vocabulary')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// 단어 저장 (vocabulary 타입으로)
export async function createVocabularyItem(word, definition, sourceId = null) {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .insert({
      user_id: user.id,
      source_id: sourceId,
      type: 'vocabulary',
      selected_text: word,
      ai_analysis_json: JSON.stringify({ definition }),
    })
    .select()
    .single();

  if (error) throw error;

  // 복습 아이템으로도 등록
  await createReviewItem(data.id);

  return data;
}

// 단어가 이미 저장되어 있는지 확인
export async function isWordSaved(word) {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('id')
    .eq('user_id', user.id)
    .eq('type', 'vocabulary')
    .ilike('selected_text', word)
    .limit(1);

  if (error) throw error;
  return data && data.length > 0;
}

// 단어 조회 (소스 정보 포함)
export async function getVocabularyWithSource() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('*, sources(title)')
    .eq('user_id', user.id)
    .eq('type', 'vocabulary')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// 문법 패턴 조회 (소스 정보 포함)
export async function getGrammarPatterns() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('*, sources(title)')
    .eq('user_id', user.id)
    .eq('type', 'highlight')
    .not('ai_analysis_json', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  // grammar 타입만 필터링
  return (data || []).filter(item => {
    try {
      const json = JSON.parse(item.ai_analysis_json || '{}');
      return json.type === 'grammar';
    } catch {
      return false;
    }
  });
}

// 수동 단어 추가
export async function addManualVocabulary(word, definition) {
  return createVocabularyItem(word, definition, null);
}
