// Vercel Serverless Function - Whisper Transcription
// Extracts audio from YouTube and transcribes with OpenAI Whisper

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  const { videoId, language = 'en' } = req.body;
  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  const RAILWAY_AUDIO_SERVER = process.env.RAILWAY_AUDIO_URL || 'https://youtube-audio-server-production-711c.up.railway.app';

  try {
    // Step 1: Extract audio from Railway server
    const audioResponse = await fetch(`${RAILWAY_AUDIO_SERVER}/api/extract-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });

    if (!audioResponse.ok) {
      const err = await audioResponse.json().catch(() => ({}));
      return res.status(500).json({ error: err.error || 'Audio extraction failed' });
    }

    const audioData = await audioResponse.json();
    if (!audioData.audioBase64) {
      return res.status(500).json({ error: 'No audio data returned' });
    }

    // Step 2: Convert base64 to Buffer and create FormData
    const audioBuffer = Buffer.from(audioData.audioBase64, 'base64');

    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: audioData.mimeType || 'audio/mp3' }), 'audio.mp3');
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'segment');
    formData.append('timestamp_granularities[]', 'word');

    // Step 3: Send to Whisper
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    });

    if (!whisperResponse.ok) {
      const err = await whisperResponse.json().catch(() => ({}));
      return res.status(500).json({ error: err.error?.message || 'Whisper transcription failed' });
    }

    const data = await whisperResponse.json();

    // Step 4: Parse segments
    const segments = (data.segments || []).map((seg, index) => {
      const segmentWords = (data.words || []).filter(
        w => w.start >= seg.start && w.end <= seg.end
      );
      return {
        id: index,
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
        words: segmentWords.map(w => ({ word: w.word, start: w.start, end: w.end })),
      };
    });

    res.status(200).json({
      segments,
      language: data.language || language,
      source: 'whisper',
      duration: data.duration,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
