import { supabase, uploadStorageObject } from './supabase';
import type { Source, SourceListItem, OcrData, YouTubeData, CaptionsData, CaptionSegment } from '../types';
import { candidateId } from '../lib/discover-core/rank';
import { apiFetch } from './apiFetch';
import { readBlobAsDataURL } from '../utils/abort';
import { createCaptionCache } from './captionCache';
import { captureSessionScope, assertSessionScope, subscribeSessionScope } from './sessionScope';

const STORAGE_BUCKET = 'sources';
type SessionScope = Awaited<ReturnType<typeof captureSessionScope>>;

/**
 * Resolve the current user's id from the locally cached session (no network round-trip).
 * Throws a user-facing auth error when the session is missing/expired so callers can
 * surface a "please sign in again" message instead of a raw TypeError.
 */
export async function requireUserId(): Promise<string> {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error('로그인이 만료되었습니다. 다시 로그인한 후 시도해 주세요.');
  }
  return userId;
}

/**
 * Extract the storage object path from a public URL so it can be removed later.
 * Returns null when the URL is not a Supabase public-object URL for this bucket
 * (e.g. YouTube thumbnails or raw web URLs stored in file_path for other source types).
 */
export function storagePathFromPublicUrl(
  fileUrl: string | null | undefined,
  bucket = STORAGE_BUCKET
): string | null {
  if (!fileUrl) return null;
  try {
    const url = new URL(fileUrl);
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl('');
    const root = new URL(publicUrl);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return null;
    const path = decodeURIComponent(url.pathname.slice(root.pathname.length));
    if (!path || path.split('/').some(part => !part || part === '.' || part === '..')) return null;
    return path;
  } catch {
    return null;
  }
}

export async function getSources(): Promise<SourceListItem[]> {
  const { data, error } = await supabase
    .from('sources')
    .select('id, title, type, pinned, created_at, last_accessed, thumbnail, screenshot')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data as SourceListItem[];
}

// Build the set of discovery candidate-ids the user ALREADY has in their library,
// so the discovery shelf never recommends something already saved. Keys match the
// discover-core candidateId() format: yt:<video_id>, web:<hash>, pdf:<hash>.
export async function getSavedExternalKeys(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('sources')
    .select('type, file_path, youtube_data');
  if (error) throw error;

  const keys = new Set<string>();
  for (const row of (data || []) as Array<{ type: string; file_path: string | null; youtube_data: YouTubeData | null }>) {
    if (row.type === 'youtube') {
      const vid = row.youtube_data?.video_id;
      if (vid) keys.add(candidateId({ kind: 'youtube', videoId: vid }));
      continue;
    }
    const fp = row.file_path;
    if (!fp || !/^https?:\/\//i.test(fp)) continue; // only external URLs can collide with candidates
    if (row.type === 'pdf') keys.add(candidateId({ kind: 'pdf', url: fp }));
    else keys.add(candidateId({ kind: 'web', url: fp })); // url / screenshot
  }
  return keys;
}

export async function getSource(id: string): Promise<Source> {
  const { data, error } = await supabase
    .from('sources')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;

  console.log('[DB] getSource returned ocr_data:', data.ocr_data ?
    `${data.ocr_data.pages?.length} pages, first page: ${data.ocr_data.pages?.[0]?.words?.length || 0} words` :
    'null or undefined');

  return data as Source;
}

// Captions can be large (word-level Whisper timings for the whole video), so the
// review list query deliberately omits them. When a review card needs the exact
// sentence boundaries for scene playback we fetch just this one column, once per
// source, with bounded retention within the current authenticated session.
const captionsCache = createCaptionCache();
const captionLoads = new Map<string, { promise: Promise<CaptionsData | null> | null }>();

export function clearSourceCaptionsCache() {
  captionsCache.clear();
  captionLoads.clear();
}

function invalidateSourceCaptions(id: string | number) {
  captionsCache.delete(String(id));
  captionLoads.delete(String(id));
}

subscribeSessionScope(clearSourceCaptionsCache);

export async function getSourceCaptions(id: string | number): Promise<CaptionsData | null> {
  const scope = await captureSessionScope();
  assertSessionScope(scope);
  const key = String(id);
  const cached = captionsCache.get(key);
  if (cached !== undefined) return cached;
  const pending = captionLoads.get(key);
  if (pending) return pending.promise!;
  const request = { promise: null as Promise<CaptionsData | null> | null };
  captionLoads.set(key, request);
  request.promise = (async () => {
    try {
      const { data, error } = await supabase
        .from('sources')
        .select('captions_data')
        .eq('id', id)
        .eq('user_id', scope.userId)
        .abortSignal(scope.signal)
        .single();
      assertSessionScope(scope);
      if (captionLoads.get(key) !== request) throw new DOMException('Captions changed', 'AbortError');
      if (error) throw error;
      const captions = (data?.captions_data ?? null) as CaptionsData | null;
      captionsCache.set(key, captions);
      return captions;
    } finally {
      if (captionLoads.get(key) === request) captionLoads.delete(key);
    }
  })();
  return request.promise;
}

/**
 * Attach Whisper word-level timings to a source NON-destructively: the original
 * `captions_data.segments` array is left byte-identical (so legacy annotations
 * that index it stay valid), and the word data lands in an additive `whisper`
 * block. Also invalidates the session `captionsCache` so review scene-playback,
 * which reads the stored column via getSourceCaptions(), stays coherent.
 */
export async function attachWhisperTimings(
  id: string | number,
  current: CaptionsData | null,
  result: { segments: CaptionSegment[]; language: string; duration?: number }
): Promise<Source> {
  const base: CaptionsData = current || { segments: [], language: result.language, source: 'youtube' };
  const merged: CaptionsData = {
    ...base,
    whisper: {
      version: 1,
      createdAt: new Date().toISOString(),
      model: 'whisper-1',
      language: result.language,
      duration: result.duration ?? null,
      segments: result.segments,
    },
  };
  const row = await updateSource(String(id), { captions_data: merged });
  return row;
}

interface CreateSourceInput {
  title: string;
  type: string;
  file_path: string;
  screenshot?: string | null;
  pages?: string | null;
  ocr_data?: OcrData | null;
  content?: string | null;
  // When added from the discovery shelf, mark provenance so we can later measure
  // (privately, via DB) whether discovery actually feeds the decode loop.
  to_read?: boolean;
}

export async function createSource(source: CreateSourceInput, sessionScope?: SessionScope): Promise<Source> {
  const scope = sessionScope || await captureSessionScope();
  assertSessionScope(scope);
  const userId = scope.userId;

  console.log('[DB] Creating source with ocr_data:', source.ocr_data ?
    `${source.ocr_data.pages?.length} pages, first page words: ${source.ocr_data.pages?.[0]?.words?.length || 0}` :
    'null');

  const { data, error } = await supabase
    .from('sources')
    .insert({
      ...source,
      user_id: userId,
    })
    .select()
    .single();

  if (error) {
    console.error('[DB] Error creating source:', error);
    throw error;
  }

  console.log('[DB] Source created, returned ocr_data:', data.ocr_data ?
    `${data.ocr_data.pages?.length} pages` : 'null');

  return data as Source;
}

export async function deleteSource(id: string, sessionScope?: SessionScope): Promise<void> {
  const scope = sessionScope || await captureSessionScope();
  assertSessionScope(scope);
  invalidateSourceCaptions(id);
  const { data: row, error: lookupError } = await supabase
    .from('sources')
    .select('type, file_path')
    .eq('id', id)
    .eq('user_id', scope.userId)
    .maybeSingle();
  assertSessionScope(scope);
  if (lookupError) throw lookupError;
  if (!row) return;

  // Keep the row/path available for a retry if Storage fails. Once removed, the
  // inline pages/preview remain usable until the database deletion completes.
  if (row.type === 'pdf' || row.type === 'image') {
    const path = storagePathFromPublicUrl(row.file_path);
    if (path) await removeUploadedFile(path, STORAGE_BUCKET, scope);
  }
  assertSessionScope(scope);

  // Remove chat logs tied to this source. chat_logs.source_id is ON DELETE SET NULL,
  // so without this they would linger as orphaned rows in the general chat history.
  const { error: chatError } = await supabase.from('chat_logs').delete()
    .eq('source_id', id).eq('user_id', scope.userId);
  assertSessionScope(scope);
  if (chatError) throw chatError;

  const { error } = await supabase
    .from('sources')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.userId);

  assertSessionScope(scope);
  if (error) throw error;
  invalidateSourceCaptions(id);
}

export async function updateSource(id: string, updates: Partial<Source>, signal?: AbortSignal) {
  const scope = await captureSessionScope();
  signal?.throwIfAborted();
  assertSessionScope(scope);
  invalidateSourceCaptions(id);
  const { data, error } = await supabase
    .from('sources')
    .update(updates)
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select()
    .abortSignal(signal ? AbortSignal.any([signal, scope.signal]) : scope.signal)
    .single();

  signal?.throwIfAborted();
  assertSessionScope(scope);
  if (error) throw error;
  invalidateSourceCaptions(id);
  return data as Source;
}

export async function removeUploadedFile(path: string, bucket = STORAGE_BUCKET, sessionScope?: SessionScope) {
  const scope = sessionScope || await captureSessionScope();
  assertSessionScope(scope);
  const { error } = await supabase.storage.from(bucket).remove([path]);
  assertSessionScope(scope);
  if (error) throw error;
}

export async function uploadFile(file: File, bucket = STORAGE_BUCKET, signal?: AbortSignal, sessionScope?: SessionScope) {
  const scope = sessionScope || await captureSessionScope();
  assertSessionScope(scope);
  const userId = scope.userId;
  signal = signal ? AbortSignal.any([signal, scope.signal]) : scope.signal;
  signal?.throwIfAborted();
  const fileExt = file.name.split('.').pop();
  // Per-user folder + timestamp + random suffix: avoids enumeration and collisions
  // when two uploads land in the same millisecond. Bucket stays public (getPublicUrl works).
  const filePath = `${userId}/${Date.now()}-${crypto.randomUUID()}.${fileExt}`;

  try {
    await uploadStorageObject(bucket, filePath, file, signal, userId);
    signal?.throwIfAborted();
  } catch (error) {
    // The server may have accepted the object just before the connection closed.
    // Cleanup uses a fresh request, never the cancelled upload signal.
    try {
      assertSessionScope(scope);
      await removeUploadedFile(filePath, bucket, scope);
    } catch {
      throw new Error('업로드를 중단했지만 남은 파일을 정리하지 못했어요. 연결을 확인해 주세요.');
    }
    throw error;
  }

  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return { path: filePath, url: publicUrl };
}

export async function fetchUrlContent(url: string) {
  const { data, error } = await supabase.functions.invoke('fetch-url', {
    body: { url },
  });

  if (error) throw error;
  return data;
}

export async function captureScreenshot(url: string, type = 'url') {
  const { data, error } = await supabase.functions.invoke('capture-screenshot', {
    body: { url, type },
  });

  if (error) throw error;
  return data;
}

export async function updateSourceScreenshot(id: string, screenshot: string) {
  const { data, error } = await supabase
    .from('sources')
    .update({ screenshot })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

interface CreateYouTubeSourceInput {
  title: string;
  youtubeData: YouTubeData;
  captionsData: CaptionsData | null;
  // When the add originated from the Home "next to decode" shelf, mark the source
  // so we can later tell (privately, via DB) whether the shelf actually feeds the
  // decode loop — the real success metric, not clicks.
  toRead?: boolean;
}

export async function createYouTubeSource({ title, youtubeData, captionsData, toRead = false }: CreateYouTubeSourceInput, sessionScope?: SessionScope): Promise<Source> {
  const scope = sessionScope || await captureSessionScope();
  assertSessionScope(scope);
  const userId = scope.userId;

  console.log('[DB] Creating YouTube source:', {
    videoId: youtubeData.video_id,
    segmentsCount: captionsData?.segments?.length || 0,
    captionSource: youtubeData.caption_source,
  });

  const { data, error } = await supabase
    .from('sources')
    .insert({
      title: title || 'YouTube Video',
      type: 'youtube',
      screenshot: youtubeData.thumbnail_url,
      youtube_data: youtubeData,
      captions_data: captionsData,
      source_language: 'en',
      to_read: toRead,
      user_id: userId,
    })
    .select()
    .single();

  if (error) {
    console.error('[DB] Error creating YouTube source:', error);
    throw error;
  }

  console.log('[DB] YouTube source created:', data.id);
  return data as Source;
}

export interface YouTubeSourceMeta {
  id: number;
  youtube_data: YouTubeData | null;
  pinned: boolean;
}

// Light query for the Home shelf: the main getSources() list deliberately omits
// youtube_data, but the shelf needs each source's channel + video_id + pin state.
export async function getYouTubeSourceMeta(): Promise<YouTubeSourceMeta[]> {
  const { data, error } = await supabase
    .from('sources')
    .select('id, youtube_data, pinned')
    .eq('type', 'youtube');

  if (error) throw error;
  return (data || []) as YouTubeSourceMeta[];
}

// Merge a resolved channel_id (and duration) into a source's youtube_data WITHOUT
// clobbering the rest of the JSONB object — spread the existing object, never
// replace it blind. Best-effort backfill so the shelf stops re-resolving this video.
export async function backfillYoutubeChannelId(
  id: number,
  currentYoutubeData: YouTubeData | null,
  channelId: string,
  duration?: number | null
): Promise<void> {
  const merged = { ...(currentYoutubeData || {}), channel_id: channelId } as YouTubeData;
  if (duration && !merged.duration) merged.duration = duration;
  await updateSource(String(id), { youtube_data: merged });
}

export async function captureWebpageScreenshot(url: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  // Call server-side API route (keeps APIFlash key secure)
  const response = await apiFetch('/api/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });

  if (!response.ok) {
    throw new Error('Screenshot capture failed');
  }

  const data = await response.json();

  // Download the screenshot image and convert to base64
  const imgResponse = await fetch(data.imageUrl, { signal });
  if (!imgResponse.ok) {
    throw new Error('웹페이지 이미지를 내려받지 못했어요. 다시 시도해 주세요.');
  }
  const blob = await imgResponse.blob();
  if (!blob.type.startsWith('image/') || blob.size === 0) {
    throw new Error('웹페이지 캡처 결과가 올바른 이미지가 아니에요. 다시 시도해 주세요.');
  }
  const base64 = await readBlobAsDataURL(blob, signal);

  return { image: base64, title: url };
}
