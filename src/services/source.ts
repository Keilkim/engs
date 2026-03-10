import { supabase } from './supabase';
import type { Source, SourceListItem, OcrData } from '../types';

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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

export async function captureWebpageScreenshot(url: string) {
  const params = new URLSearchParams({
    access_key: import.meta.env.VITE_APIFLASH_KEY,
    url: url,
    full_page: 'true',
    width: '430',
    height: '932',
    format: 'png',
    response_type: 'json',
    fresh: 'true',
    scroll_delay: '3000',
    delay: '5',
    scale_factor: '2',
    user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const apiUrl = `https://api.apiflash.com/v1/urltoimage?${params.toString()}`;
  const response = await fetch(apiUrl);
  const data = await response.json();

  if (!data.url) {
    console.error('ApiFlash response:', data);
    throw new Error('Screenshot capture failed');
  }

  const imgResponse = await fetch(data.url);
  const blob = await imgResponse.blob();
  const base64 = await blobToBase64(blob);

  return { image: base64, title: url };
}
