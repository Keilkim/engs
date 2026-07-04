import { supabase } from './supabase';
import { safeJsonParse } from '../utils/errors';
import { localDateString } from '../utils/dateUtils';
import type { Annotation, SelectionRect, BBox } from '../types';

// 복습 카드로 만들 수 있는 분석 데이터가 있는지 판단.
// isVocabulary 단어 또는 grammar 분석만 플래시카드로 렌더링되므로,
// ai_analysis_json이 없거나(펜 스트로크 등) 해당 데이터가 없으면 review_item을 만들지 않는다.
// (질문=답이 되는 '분석 없는' 카드가 복습 큐에 들어가는 것을 근절)
function hasReviewableAnalysis(aiAnalysisJson: string | null | undefined): boolean {
  if (!aiAnalysisJson) return false;
  const json = safeJsonParse<Record<string, unknown>>(aiAnalysisJson, {});
  return json.isVocabulary === true || json.type === 'grammar';
}

export async function getAnnotations(sourceId: string): Promise<Annotation[]> {
  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('source_id', sourceId)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) throw error;
  return data as Annotation[];
}

interface CreateAnnotationInput {
  source_id: string;
  type: string;
  selected_text: string | null;
  selection_rect: string | null;
  ai_analysis_json?: string | null;
  memo_content?: string | null;
}

export async function createAnnotation(annotation: CreateAnnotationInput): Promise<Annotation> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .insert({
      ...annotation,
      user_id: user!.id,
    })
    .select()
    .single();

  if (error) throw error;

  // 분석 데이터가 있는 highlight만 복습 카드로 생성 (펜 스트로크/분석 없는 카드 제외)
  if (annotation.type === 'highlight' && hasReviewableAnalysis(annotation.ai_analysis_json)) {
    await createReviewItem(data.id);
  }

  return data as Annotation;
}

export async function deleteAnnotation(id: string): Promise<void> {
  const { error } = await supabase
    .from('annotations')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function updateAnnotation(id: string, updates: Partial<Annotation>) {
  const { data, error } = await supabase
    .from('annotations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Annotation;
}

async function createReviewItem(annotationId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();

  // 중복 방지: 동일 annotation에 대한 review_item이 이미 있으면 생성하지 않는다
  // (재시도/중복 저장 로직으로 인한 같은 카드의 중복 출제 방지)
  const { data: existing } = await supabase
    .from('review_items')
    .select('id')
    .eq('annotation_id', annotationId)
    .limit(1)
    .maybeSingle();

  if (existing) return;

  const today = localDateString();

  const { error } = await supabase
    .from('review_items')
    .insert({
      user_id: user!.id,
      annotation_id: annotationId,
      next_review_date: today,
      interval_days: 1,
      ease_factor: 2.5,
      repetitions: 0,
      status: 'active',
    });

  if (error) throw error;
}

export async function getVocabulary(): Promise<Annotation[]> {
  const { data: { user } } = await supabase.auth.getUser();

  // 서버측에서 vocabulary만 필터: 펜 스트로크(ai_analysis_json=null) 등이
  // limit 창을 잠식해 저장 단어가 사전에서 사라지는 것을 방지한다.
  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('user_id', user!.id)
    .eq('type', 'highlight')
    .ilike('ai_analysis_json', '%"isVocabulary":true%')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  return (data || []).filter(item => {
    const json = safeJsonParse(item.ai_analysis_json, {});
    return json.isVocabulary === true;
  }) as Annotation[];
}

export async function createVocabularyItem(
  word: string,
  definition: string,
  sourceId: string | null = null,
  selectionRect: SelectionRect | null = null
) {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .insert({
      user_id: user!.id,
      source_id: sourceId,
      type: 'highlight',
      selected_text: word,
      ai_analysis_json: JSON.stringify({ isVocabulary: true, definition }),
      selection_rect: selectionRect ? JSON.stringify(selectionRect) : null,
    })
    .select()
    .single();

  if (error) throw error;
  await createReviewItem(data.id);
  return data as Annotation;
}

export async function getVocabularyWithSource() {
  const { data: { user } } = await supabase.auth.getUser();

  // 서버측에서 vocabulary만 필터 (getVocabulary와 동일한 이유)
  const { data, error } = await supabase
    .from('annotations')
    .select('*, sources(title)')
    .eq('user_id', user!.id)
    .eq('type', 'highlight')
    .ilike('ai_analysis_json', '%"isVocabulary":true%')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  return (data || []).filter(item => {
    const json = safeJsonParse(item.ai_analysis_json, {});
    return json.isVocabulary === true;
  });
}

export async function getGrammarPatterns() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('*, sources(title)')
    .eq('user_id', user!.id)
    .eq('type', 'highlight')
    .not('ai_analysis_json', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  return (data || []).filter(item => {
    const json = safeJsonParse(item.ai_analysis_json, {});
    return json.type === 'grammar';
  });
}

export async function addManualVocabulary(word: string, definition: string) {
  return createVocabularyItem(word, definition, null);
}

// Sentence pattern functions

export async function getSentencePatterns(): Promise<Annotation[]> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('user_id', user!.id)
    .eq('type', 'highlight')
    .is('source_id', null)
    .not('ai_analysis_json', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return (data || []).filter(item => {
    const json = safeJsonParse(item.ai_analysis_json, {});
    return json.type === 'sentence_pattern';
  }) as Annotation[];
}

export async function createSentencePattern(
  pattern: string,
  parts: string[],
  explanation: string,
  example: string,
): Promise<Annotation> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .insert({
      user_id: user!.id,
      source_id: null,
      type: 'highlight',
      selected_text: pattern,
      selection_rect: null,
      ai_analysis_json: JSON.stringify({
        type: 'sentence_pattern',
        pattern,
        parts,
        explanation,
        example,
      }),
    })
    .select()
    .single();

  if (error) throw error;
  return data as Annotation;
}

export async function deleteSentencePattern(id: string): Promise<void> {
  return deleteAnnotation(id);
}

// Pen stroke types

interface PenStrokeData {
  points: Array<{ x: number; y: number }>;
  color: string;
  strokeWidth: number;
  bounds: BBox;
  page: number;
}

interface PenStroke extends PenStrokeData {
  id: string;
  createdAt: string;
}

export async function getPenStrokes(sourceId: string): Promise<PenStroke[]> {
  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('source_id', sourceId)
    .eq('type', 'highlight')
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data || []).reduce<PenStroke[]>((acc, item) => {
    const rect = safeJsonParse(item.selection_rect, {} as SelectionRect);
    if (rect.type === 'pen_stroke') {
      acc.push({
        id: item.id,
        points: rect.points!,
        color: rect.color!,
        strokeWidth: rect.strokeWidth!,
        bounds: rect.bounds as unknown as BBox,
        page: rect.page!,
        createdAt: item.created_at,
      });
    }
    return acc;
  }, []);
}

export async function createPenStroke(sourceId: string, strokeData: PenStrokeData): Promise<PenStroke> {
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
      user_id: user!.id,
      source_id: sourceId,
      type: 'highlight',
      selected_text: null,
      ai_analysis_json: null,
      selection_rect: selectionRect,
    })
    .select()
    .single();

  if (error) throw error;

  const rect = safeJsonParse(data.selection_rect, {} as SelectionRect);
  return {
    id: data.id,
    points: rect.points!,
    color: rect.color!,
    strokeWidth: rect.strokeWidth!,
    bounds: rect.bounds as unknown as BBox,
    page: rect.page!,
    createdAt: data.created_at,
  };
}

export async function deletePenStrokes(strokeIds: string[]): Promise<void> {
  if (!strokeIds || strokeIds.length === 0) return;

  const { error } = await supabase
    .from('annotations')
    .delete()
    .in('id', strokeIds);

  if (error) throw error;
}
