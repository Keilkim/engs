// Vercel Serverless Function - Gemini API Proxy (non-streaming)
/* global process */

import { handleCors, requireUser, consumeQuota, QUOTAS } from './_lib/security.js';
import { buildGeminiRequest } from './_lib/gemini.js';

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Google API key not configured' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const request = buildGeminiRequest(req.body, 'generateContent');
  if (!request) return res.status(400).json({ error: 'contents required' });

  if (!(await consumeQuota(res, user, 'gemini', 1, QUOTAS.gemini))) return;

  try {
    const response = await fetch(request.url, request.init);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[gemini]', err.message);
    res.status(502).json({ error: 'Gemini request failed' });
  }
}
