import { supabase } from './supabase';
import { captureSessionScope, assertSessionScope } from './sessionScope.js';
import { createReadingBookmarkStore } from './readingBookmarkStore.js';

export const readingBookmarks = createReadingBookmarkStore({
  client: supabase, captureScope: captureSessionScope, assertScope: assertSessionScope,
});
