import { supabase } from './supabase';
import type { Source, SourceListItem, OcrData, YouTubeData, CaptionsData } from '../types';
import { candidateId } from '../lib/discover-core/rank';

const STORAGE_BUCKET = 'sources';

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
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  const path = fileUrl.slice(idx + marker.length);
  if (!path) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
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
// source, and memoize it for the rest of the session.
const captionsCache = new Map<string, CaptionsData | null>();

export async function getSourceCaptions(id: string | number): Promise<CaptionsData | null> {
  const key = String(id);
  if (captionsCache.has(key)) return captionsCache.get(key) ?? null;

  const { data, error } = await supabase
    .from('sources')
    .select('captions_data')
    .eq('id', id)
    .single();

  if (error) throw error;

  const captions = (data?.captions_data ?? null) as CaptionsData | null;
  captionsCache.set(key, captions);
  return captions;
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

export async function createSource(source: CreateSourceInput): Promise<Source> {
  const userId = await requireUserId();

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

export async function deleteSource(id: string): Promise<void> {
  // Look up the file info first so we can clean up the storage object afterwards.
  const { data: row } = await supabase
    .from('sources')
    .select('type, file_path')
    .eq('id', id)
    .single();

  // Remove chat logs tied to this source. chat_logs.source_id is ON DELETE SET NULL,
  // so without this they would linger as orphaned rows in the general chat history.
  await supabase.from('chat_logs').delete().eq('source_id', id);

  const { error } = await supabase
    .from('sources')
    .delete()
    .eq('id', id);

  if (error) throw error;

  // Best-effort storage cleanup (only pdf/image types store an uploaded object;
  // youtube/screenshot/url keep a raw external URL in file_path).
  if (row && (row.type === 'pdf' || row.type === 'image')) {
    const path = storagePathFromPublicUrl(row.file_path);
    if (path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    }
  }
}

export async function updateSource(id: string, updates: Partial<Source>) {
  const { data, error } = await supabase
    .from('sources')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Source;
}

export async function uploadFile(file: File, bucket = STORAGE_BUCKET) {
  const userId = await requireUserId();
  const fileExt = file.name.split('.').pop();
  // Per-user folder + timestamp + random suffix: avoids enumeration and collisions
  // when two uploads land in the same millisecond. Bucket stays public (getPublicUrl works).
  const filePath = `${userId}/${Date.now()}-${crypto.randomUUID()}.${fileExt}`;

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file);

  if (error) throw error;

  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return { path: data.path, url: publicUrl };
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

export async function createYouTubeSource({ title, youtubeData, captionsData, toRead = false }: CreateYouTubeSourceInput): Promise<Source> {
  const userId = await requireUserId();

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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

export async function captureWebpageScreenshot(url: string) {
  // Call server-side API route (keeps APIFlash key secure)
  const response = await fetch('/api/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error('Screenshot capture failed');
  }

  const data = await response.json();

  // Download the screenshot image and convert to base64
  const imgResponse = await fetch(data.imageUrl);
  const blob = await imgResponse.blob();
  const base64 = await blobToBase64(blob);

  return { image: base64, title: url };
}
