import { supabase } from './supabase';
import { safeJsonParse } from '../utils/errors';
import type { Annotation, SelectionRect, BBox } from '../types';

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

  if (annotation.type === 'highlight') {
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
  const today = new Date().toISOString().split('T')[0];

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

  const { data, error } = await supabase
    .from('annotations')
    .select('*')
    .eq('user_id', user!.id)
    .eq('type', 'highlight')
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

export async function isWordSaved(word: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('id, ai_analysis_json')
    .eq('user_id', user!.id)
    .eq('type', 'highlight')
    .ilike('selected_text', word);

  if (error) throw error;

  return (data || []).some(item => {
    const json = safeJsonParse(item.ai_analysis_json, {});
    return json.isVocabulary === true;
  });
}

export async function getVocabularyWithSource() {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('annotations')
    .select('*, sources(title)')
    .eq('user_id', user!.id)
    .eq('type', 'highlight')
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
