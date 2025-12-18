import { supabase } from './supabase';

// Settings keys
export const SETTINGS_KEYS = {
  AI_CHAT_LANGUAGE: 'ai_chat_language',
  TRANSLATION_LANGUAGE: 'translation_language',
};

// Default values
export const DEFAULTS = {
  [SETTINGS_KEYS.AI_CHAT_LANGUAGE]: 'Korean',
  [SETTINGS_KEYS.TRANSLATION_LANGUAGE]: 'Korean',
};

// Language options
export const LANGUAGE_OPTIONS = {
  AI_CHAT: [
    { value: 'English', label: 'English' },
    { value: 'Korean', label: '한국어' },
    { value: 'Chinese', label: '中文' },
    { value: 'German', label: 'Deutsch' },
  ],
  TRANSLATION: [
    { value: 'Korean', label: '한국어' },
    { value: 'Chinese', label: '中文' },
    { value: 'German', label: 'Deutsch' },
  ],
};

// Get setting from localStorage
export function getSetting(key, defaultValue = null) {
  const stored = localStorage.getItem(key);
  if (stored !== null) {
    return stored;
  }
  return defaultValue ?? DEFAULTS[key] ?? null;
}

// Set setting to localStorage
export function setSetting(key, value) {
  localStorage.setItem(key, value);
}

// Get all settings
export function getAllSettings() {
  return {
    [SETTINGS_KEYS.AI_CHAT_LANGUAGE]: getSetting(SETTINGS_KEYS.AI_CHAT_LANGUAGE),
    [SETTINGS_KEYS.TRANSLATION_LANGUAGE]: getSetting(SETTINGS_KEYS.TRANSLATION_LANGUAGE),
  };
}

// Reset all sources for user
export async function resetAllSources() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  // Delete all annotations first (foreign key constraint)
  const { error: annotationError } = await supabase
    .from('annotations')
    .delete()
    .eq('user_id', user.id);

  if (annotationError) throw annotationError;

  // Delete all review items
  const { error: reviewError } = await supabase
    .from('review_items')
    .delete()
    .eq('user_id', user.id);

  if (reviewError) throw reviewError;

  // Delete all sources
  const { error: sourceError } = await supabase
    .from('sources')
    .delete()
    .eq('user_id', user.id);

  if (sourceError) throw sourceError;

  return true;
}

// Reset vocabulary only (highlight type with isVocabulary marker)
export async function resetVocabulary() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  // Get all highlight annotations first
  const { data: allHighlights, error: fetchError } = await supabase
    .from('annotations')
    .select('id, ai_analysis_json')
    .eq('user_id', user.id)
    .eq('type', 'highlight');

  if (fetchError) throw fetchError;

  // Filter vocabulary items by ai_analysis_json.isVocabulary
  const vocabIds = (allHighlights || [])
    .filter(item => {
      try {
        const json = JSON.parse(item.ai_analysis_json || '{}');
        return json.isVocabulary === true;
      } catch {
        return false;
      }
    })
    .map(item => item.id);

  if (vocabIds.length > 0) {
    // Delete related review items first
    const { error: reviewError } = await supabase
      .from('review_items')
      .delete()
      .in('annotation_id', vocabIds);

    if (reviewError) throw reviewError;

    // Delete vocabulary annotations
    const { error: vocabError } = await supabase
      .from('annotations')
      .delete()
      .in('id', vocabIds);

    if (vocabError) throw vocabError;
  }

  return true;
}

// Clear all local settings
export function clearAllSettings() {
  Object.values(SETTINGS_KEYS).forEach(key => {
    localStorage.removeItem(key);
  });
}
