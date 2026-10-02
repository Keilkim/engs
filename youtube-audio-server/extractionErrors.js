// Return stable, safe error codes instead of exposing yt-dlp's stderr.
function extractionFailure(errors) {
  const message = errors.map((error) => error.message || '').join('\n');
  if (/confirm.*not a bot/i.test(message)) {
    return { status: 502, code: 'YOUTUBE_BOT_BLOCKED', error: 'YouTube blocked audio extraction' };
  }
  if (/timeout|timed out/i.test(message)) {
    return { status: 504, code: 'AUDIO_EXTRACTION_TIMEOUT', error: 'Audio extraction timed out' };
  }
  return { status: 502, code: 'AUDIO_EXTRACTION_FAILED', error: 'Failed to extract audio' };
}

module.exports = { extractionFailure };
