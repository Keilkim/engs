// Vercel Serverless Function - APIFlash Screenshot Proxy

import { handleCors, requireUser, consumeQuota, QUOTAS } from './_lib/security.js';
import { parsePublicUrl } from './_lib/safeFetch.js';

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFLASH_KEY = process.env.APIFLASH_KEY;
  if (!APIFLASH_KEY) {
    return res.status(500).json({ error: 'APIFlash key not configured' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const target = parsePublicUrl(req.body?.url);
  if (!target) {
    return res.status(400).json({ error: 'A public http(s) url is required' });
  }

  if (!(await consumeQuota(res, user, 'screenshot', 1, QUOTAS.screenshot))) return;

  try {
    const params = new URLSearchParams({
      access_key: APIFLASH_KEY,
      url: target.href,
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
    console.error('[screenshot]', err.message);
    res.status(502).json({ error: 'Screenshot capture failed' });
  }
}
