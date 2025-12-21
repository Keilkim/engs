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

// 모든 저장된 단어 조회 (highlight 타입 중 isVocabulary=true)
export async function getVocabulary() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'highlight')
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Filter vocabulary items by ai_analysis_json.isVocabulary
  return (data || []).filter(item => {
    try {
      const json = JSON.parse(item.ai_analysis_json || '{}');
      return json.isVocabulary === true;
    } catch {
      return false;
    }
  });
}

// 단어 저장 (highlight 타입으로, isVocabulary 마커 추가)
export async function createVocabularyItem(word, definition, sourceId = null, selectionRect = null) {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .insert({
      user_id: user.id,
      source_id: sourceId,
      type: 'highlight',
      selected_text: word,
      ai_analysis_json: JSON.stringify({ isVocabulary: true, definition }),
      selection_rect: selectionRect ? JSON.stringify(selectionRect) : null,
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

  // highlight 타입 중 해당 단어를 가진 것 조회
  const { data, error } = await supabase
    .from('annotations')
    .select('id, ai_analysis_json')
    .eq('user_id', user.id)
    .eq('type', 'highlight')
    .ilike('selected_text', word);

  if (error) throw error;

  // Filter by isVocabulary marker
  return (data || []).some(item => {
    try {
      const json = JSON.parse(item.ai_analysis_json || '{}');
      return json.isVocabulary === true;
    } catch {
      return false;
    }
  });
}

// 단어 조회 (소스 정보 포함)
export async function getVocabularyWithSource() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('*, sources(title)')
    .eq('user_id', user.id)
    .eq('type', 'highlight')
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Filter vocabulary items
  return (data || []).filter(item => {
    try {
      const json = JSON.parse(item.ai_analysis_json || '{}');
      return json.isVocabulary === true;
    } catch {
      return false;
    }
  });
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

// ============ 펜 스트로크 관련 함수 ============

// 펜 스트로크 조회
export async function getPenStrokes(sourceId) {
  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('source_id', sourceId)
    .eq('type', 'highlight')
    .order('created_at', { ascending: true });

  if (error) throw error;

  // pen_stroke 타입만 필터링
  return (data || []).filter((item) => {
    try {
      const rect = JSON.parse(item.selection_rect || '{}');
      return rect.type === 'pen_stroke';
    } catch {
      return false;
    }
  }).map((item) => {
    const rect = JSON.parse(item.selection_rect);
    return {
      id: item.id,
      points: rect.points,
      color: rect.color,
      strokeWidth: rect.strokeWidth,
      bounds: rect.bounds,
      page: rect.page,
      createdAt: item.created_at,
    };
  });
}

// 펜 스트로크 저장
export async function createPenStroke(sourceId, strokeData) {
  const { data: { user } } = await supabase.auth.getUser();

  const selectionRect = JSON.stringify({
    type: 'pen_stroke',
    points: strokeData.points,
    color: strokeData.color,
    strokeWidth: strokeData.strokeWidth,
    bounds: strokeData.bounds,
    page: strokeData.page,
  });

  const { data, error } = await supabase
    .from('annotations')
    .insert({
      user_id: user.id,
      source_id: sourceId,
      type: 'highlight',
      selected_text: null,
      ai_analysis_json: null,
      selection_rect: selectionRect,
    })
    .select()
    .single();

  if (error) throw error;

  const rect = JSON.parse(data.selection_rect);
  return {
    id: data.id,
    points: rect.points,
    color: rect.color,
    strokeWidth: rect.strokeWidth,
    bounds: rect.bounds,
    page: rect.page,
    createdAt: data.created_at,
  };
}

// 여러 펜 스트로크 삭제
export async function deletePenStrokes(strokeIds) {
  if (!strokeIds || strokeIds.length === 0) return;

  const { error } = await supabase
    .from('annotations')
    .delete()
    .in('id', strokeIds);

  if (error) throw error;
}
