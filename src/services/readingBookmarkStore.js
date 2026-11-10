import { normalizeReadingPosition, parseReadingBookmark, READING_BOOKMARK_TYPE } from '../utils/readingBookmark.js';

// Use an annotation without selection geometry or review data. This works with
// existing databases and cannot create a flashcard or a document highlight.
export function createReadingBookmarkStore({ client, captureScope, assertScope }) {
  const filter = (query, sourceId, userId) => query.eq('source_id', sourceId)
    .eq('user_id', userId).eq('type', 'highlight')
    .ilike('ai_analysis_json', `%"type":"${READING_BOOKMARK_TYPE}"%`);

  return {
    async load(sourceId) {
      const scope = await captureScope();
      const { data, error } = await filter(client.from('annotations').select('*'), sourceId, scope.userId)
        .order('created_at', { ascending: false }).limit(1).abortSignal(scope.signal);
      assertScope(scope);
      if (error) throw error;
      return parseReadingBookmark(data?.[0]);
    },
    async save(sourceId, position, existingId) {
      const normalized = normalizeReadingPosition(position);
      if (!normalized) throw new Error('Invalid bookmark position');
      const scope = await captureScope();
      const input = {
        source_id: sourceId, user_id: scope.userId, type: 'highlight',
        selected_text: null, selection_rect: null,
        ai_analysis_json: JSON.stringify({ type: READING_BOOKMARK_TYPE, ...normalized }),
        created_at: new Date().toISOString(),
      };
      const table = client.from('annotations');
      const query = existingId != null
        ? filter(table.update(input), sourceId, scope.userId).eq('id', existingId)
        : table.insert(input);
      const { data, error } = await query.select('*').single().abortSignal(scope.signal);
      assertScope(scope);
      if (error) throw error;
      const bookmark = parseReadingBookmark(data);
      if (!bookmark) throw new Error('Invalid saved bookmark');
      return bookmark;
    },
    async remove(sourceId) {
      const scope = await captureScope();
      // Also clear any duplicates created by simultaneous saves on two devices.
      const { error } = await filter(client.from('annotations').delete(), sourceId, scope.userId)
        .abortSignal(scope.signal);
      assertScope(scope);
      if (error) throw error;
    },
  };
}
