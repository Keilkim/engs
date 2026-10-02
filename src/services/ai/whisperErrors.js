/** Shared by adding a video and upgrading an existing video's word timings. */
export function mapWhisperError(err) {
  const msg = (err?.message || '').toLowerCase();
  if (err?.code === 'YOUTUBE_BOT_BLOCKED') {
    return '유튜브가 음성 가져오기를 차단했어요. 잠시 후 다시 시도해 주세요.';
  }
  if (err?.code === 'AUDIO_EXTRACTION_TIMEOUT') {
    return '음성을 가져오는 데 시간이 너무 오래 걸렸어요. 잠시 후 다시 시도해 주세요.';
  }
  if (err?.status === 401) return '로그인이 만료됐어요. 다시 로그인한 뒤 시도해 주세요.';
  if (err?.status === 429) return err.message;
  if (msg.includes('영상이 너무 길어요')) return err.message;
  if (err?.status === 413 || msg.includes('413') || msg.includes('content size') || msg.includes('maximum') || msg.includes('too large')) {
    return '음성 파일이 처리 한도를 넘었어요. 더 짧은 영상으로 다시 시도해 주세요.';
  }
  if (msg.includes('extract') || msg.includes('audio') || msg.includes('추출')) {
    return '이 영상의 음성을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  return `음성 인식에 실패했어요: ${err?.message || err}`;
}
