// Vercel Serverless Function — PDF byte proxy.
//
// Discovered PDFs live on arbitrary hosts that send no CORS header, so the browser
// can't fetch them for client-side pdf.js rendering. This proxies the bytes for
// signed-in users. Guards: the URL must resolve to a public host (safeFetch blocks
// internal/metadata addresses on every redirect hop), the body must actually start
// like a PDF, and the size is capped (honors "prefer small PDFs" + stays under
// Vercel's buffered-response limit). Rendering/OCR happen in the browser.

import { handleCors, requireUser, consumeQuota, QUOTAS } from './_lib/security.js';
import { safeFetch, UnsafeUrlError, TooLargeError } from './_lib/safeFetch.js';

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const { url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  if (!(await consumeQuota(res, user, 'pdf_proxy', 1, QUOTAS.pdf_proxy))) return;

  try {
    const r = await safeFetch(url, {
      maxBytes: MAX_BYTES,
      timeoutMs: 8000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/pdf,*/*',
      },
    });
    if (r.status < 200 || r.status >= 300) return res.status(502).json({ error: `fetch ${r.status}` });

    // Judge by the bytes, not the URL or content-type: only real PDFs go back out.
    if (!r.body.subarray(0, 1024).includes('%PDF-')) {
      return res.status(415).json({ error: 'not a pdf' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(r.body.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(r.body);
  } catch (err) {
    if (err instanceof UnsafeUrlError) return res.status(400).json({ error: 'url not allowed' });
    if (err instanceof TooLargeError) return res.status(413).json({ error: 'pdf too large', size: err.size });
    console.error('[pdf-proxy]', err.message);
    return res.status(502).json({ error: 'pdf proxy failed' });
  }
}
