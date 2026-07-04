// Vercel Serverless Function — PDF byte proxy.
//
// Discovered PDFs live on arbitrary hosts that send no CORS header, so the browser
// can't fetch them for client-side pdf.js rendering. This proxies the bytes with
// Access-Control-Allow-Origin:*. Guards: content-type must look like a PDF, and the
// size is capped (honors "prefer small PDFs" + stays under Vercel's buffered-response
// limit). Rendering/OCR happen in the browser, so the ~10s function budget is fine.

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/pdf,*/*',
      },
    });
    if (!r.ok) return res.status(502).json({ error: `fetch ${r.status}` });

    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const looksPdf = ct.includes('application/pdf') || /\.pdf($|\?)/i.test(url);
    if (!looksPdf) return res.status(415).json({ error: 'not a pdf' });

    const declared = Number(r.headers.get('content-length') || 0);
    if (declared && declared > MAX_BYTES) {
      return res.status(413).json({ error: 'pdf too large', size: declared });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: 'pdf too large', size: buf.length });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buf.length));
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'pdf proxy failed' });
  }
}
