import { supabase } from './supabase';
import type { Source, SourceListItem, OcrData, YouTubeData, CaptionsData } from '../types';

export async function getSources(): Promise<SourceListItem[]> {
  const { data, error } = await supabase
    .from('sources')
    .select('id, title, type, pinned, created_at, last_accessed, thumbnail, screenshot')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data as SourceListItem[];
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

interface CreateSourceInput {
  title: string;
  type: string;
  file_path: string;
  screenshot?: string | null;
  pages?: string | null;
  ocr_data?: OcrData | null;
  content?: string | null;
}

export async function createSource(source: CreateSourceInput): Promise<Source> {
  const { data: { user } } = await supabase.auth.getUser();

  console.log('[DB] Creating source with ocr_data:', source.ocr_data ?
    `${source.ocr_data.pages?.length} pages, first page words: ${source.ocr_data.pages?.[0]?.words?.length || 0}` :
    'null');

  const { data, error } = await supabase
    .from('sources')
    .insert({
      ...source,
      user_id: user!.id,
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
  const { error } = await supabase
    .from('sources')
    .delete()
    .eq('id', id);

  if (error) throw error;
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

export async function uploadFile(file: File, bucket = 'sources') {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `${fileName}`;

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
}

export async function createYouTubeSource({ title, youtubeData, captionsData }: CreateYouTubeSourceInput): Promise<Source> {
  const { data: { user } } = await supabase.auth.getUser();

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
      user_id: user!.id,
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
