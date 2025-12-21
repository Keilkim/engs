import { supabase } from './supabase';

// 소스 목록 조회 (홈 그리드용 - 필요한 컬럼만)
export async function getSources() {
  const { data, error } = await supabase
    .from('sources')
    .select('id, title, type, pinned, created_at, last_accessed, thumbnail, screenshot')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// 소스 상세 조회
export async function getSource(id) {
  const { data, error } = await supabase
    .from('sources')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;

  console.log('[DB] getSource returned ocr_data:', data.ocr_data ?
    `${data.ocr_data.pages?.length} pages, first page: ${data.ocr_data.pages?.[0]?.words?.length || 0} words` :
    'null or undefined');

  return data;
}

// 소스 추가
export async function createSource(source) {
  const { data: { user } } = await supabase.auth.getUser();

  console.log('[DB] Creating source with ocr_data:', source.ocr_data ?
    `${source.ocr_data.pages?.length} pages, first page words: ${source.ocr_data.pages?.[0]?.words?.length || 0}` :
    'null');

  const { data, error } = await supabase
    .from('sources')
    .insert({
      ...source,
      user_id: user.id,
    })
    .select()
    .single();

  if (error) {
    console.error('[DB] Error creating source:', error);
    throw error;
  }

  console.log('[DB] Source created, returned ocr_data:', data.ocr_data ?
    `${data.ocr_data.pages?.length} pages` : 'null');

  return data;
}

// 소스 삭제
export async function deleteSource(id) {
  const { error } = await supabase
    .from('sources')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// 소스 업데이트 (pinned, to_read 등)
export async function updateSource(id, updates) {
  const { data, error } = await supabase
    .from('sources')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// 파일 업로드 (PDF, 이미지)
export async function uploadFile(file, bucket = 'sources') {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `${fileName}`;

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file);

  if (error) throw error;

  // Public URL 가져오기
  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return { path: data.path, url: publicUrl };
}

// URL에서 콘텐츠 가져오기 (서버리스 함수 호출)
export async function fetchUrlContent(url) {
  const { data, error } = await supabase.functions.invoke('fetch-url', {
    body: { url },
  });

  if (error) throw error;
  return data;
}

// URL/PDF 스크린샷 캡처 (서버리스 함수 호출)
export async function captureScreenshot(url, type = 'url') {
  const { data, error } = await supabase.functions.invoke('capture-screenshot', {
    body: { url, type },
  });

  if (error) throw error;
  return data; // { screenshot: base64 or url }
}

// 소스에 스크린샷 업데이트
export async function updateSourceScreenshot(id, screenshot) {
  const { data, error } = await supabase
    .from('sources')
    .update({ screenshot })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Blob을 base64로 변환
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// 웹페이지 Full Page 스크린샷 캡처 (ApiFlash API)
export async function captureWebpageScreenshot(url) {
  // ApiFlash API 호출 - 전체 페이지 캡처
  const params = new URLSearchParams({
    access_key: import.meta.env.VITE_APIFLASH_KEY,
    url: url,
    full_page: 'true',
    width: '1920',
    format: 'png',
    response_type: 'json',
    fresh: 'true',
    scroll_delay: '500',
    delay: '3',
    scale_factor: '2',
  });

  const apiUrl = `https://api.apiflash.com/v1/urltoimage?${params.toString()}`;
  const response = await fetch(apiUrl);
  const data = await response.json();

  if (!data.url) {
    console.error('ApiFlash response:', data);
    throw new Error('스크린샷 캡처 실패');
  }

  // 스크린샷 이미지를 base64로 변환
  const imgResponse = await fetch(data.url);
  const blob = await imgResponse.blob();
  const base64 = await blobToBase64(blob);

  // 전체 페이지 그대로 반환
  return {
    image: base64,
    title: url,
  };
}
