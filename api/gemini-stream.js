// Vercel Serverless Function - Gemini API Streaming Proxy
/* global process */

import { handleCors, requireUser, consumeQuota, QUOTAS } from './_lib/security.js';
import { buildGeminiRequest } from './_lib/gemini.js';

export const config = {
  supportsResponseStreaming: true,
};

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'Google API key not configured' });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const request = buildGeminiRequest(req.body, 'streamGenerateContent');
  if (!request) return res.status(400).json({ error: 'contents required' });

  if (!(await consumeQuota(res, user, 'gemini', 1, QUOTAS.gemini))) return;

  try {
    const response = await fetch(request.url, request.init);

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).end(error);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
  } catch (err) {
    console.error('[gemini-stream]', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Gemini request failed' });
  }
}
