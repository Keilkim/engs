// Vercel Serverless Function - Returns Gemini Live WebSocket URL
// Keeps the API key server-side (not baked into client bundle)

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Google API key not configured' });
  }

  res.status(200).json({
    url: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_API_KEY}`,
  });
}
