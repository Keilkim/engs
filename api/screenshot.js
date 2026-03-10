// Vercel Serverless Function - APIFlash Screenshot Proxy

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFLASH_KEY = process.env.APIFLASH_KEY;
  if (!APIFLASH_KEY) {
    return res.status(500).json({ error: 'APIFlash key not configured' });
  }

  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  try {
    const params = new URLSearchParams({
      access_key: APIFLASH_KEY,
      url,
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
      return res.status(500).json({ error: 'Screenshot capture failed' });
    }

    res.status(200).json({ imageUrl: data.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
