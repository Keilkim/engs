// Vercel Serverless Function — PDF-material discovery.
//
// KEYLESS BY DEFAULT: DuckDuckGo HTML scrape with `filetype:pdf` (direct URLs, no key/
// quota, best-effort). If GOOGLE_CSE_KEY + GOOGLE_CSE_CX are set, uses Google CSE with
// filetype:pdf instead. Either way, after getting links we issue parallel HEAD requests
// for Content-Length only → powers the "용량 적당한 것 우선" size-fit ranking. The PDF
// body is NEVER downloaded here; matching is on title+snippet (the "개요"). Full download
// happens only at add time (api/pdf-proxy).

const CSE_URL = 'https://www.googleapis.com/customsearch/v1';
const DDG_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const HEAD_TIMEOUT_MS = 3000;
const MAX_PROBES = 8;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { q, num = 10 } = req.body || {};
  if (!q || !String(q).trim()) return res.status(400).json({ error: 'q required' });

  try {
    const key = process.env.GOOGLE_CSE_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    let items = key && cx
      ? await csePdf(key, cx, String(q), num)
      : await ddgPdf(String(q), num);

    // Parallel HEAD size probes (best-effort; failure → size 0 = neutral quality).
    await Promise.allSettled(
      items.slice(0, MAX_PROBES).map(async (it) => {
        const size = await probeSize(it.url);
        if (size) it.extra.fileSizeBytes = size;
      })
    );

    return res.status(200).json({ items, configured: true });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'pdf discovery failed' });
  }
}

// --- keyless: DuckDuckGo HTML with filetype:pdf ------------------------------------
async function ddgPdf(q, num) {
  const params = new URLSearchParams({ q: `${q} filetype:pdf`, kl: 'us-en' });
  const r = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
    headers: { 'User-Agent': DDG_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!r.ok) throw new Error(`ddg ${r.status}`);
  const html = await r.text();

  const items = [];
  const seen = new Set();
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && items.length < num) {
    const url = decodeDdgHref(m[1]);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (!/\.pdf($|\?)/i.test(url)) continue; // keep only real PDF links
    if (seen.has(url)) continue;
    seen.add(url);
    const rest = html.slice(m.index);
    const sm = rest.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    items.push({
      kind: 'pdf', url,
      title: stripTags(m[2]).replace(/\s*\.pdf\s*$/i, ''),
      snippet: sm ? stripTags(sm[1]) : '',
      thumbnail: null,
      source: safeHost(url),
      published: null,
      extra: { fileSizeBytes: 0 },
    });
  }
  return items;
}

// --- optional: Google CSE with filetype:pdf ---------------------------------------
async function csePdf(key, cx, q, num) {
  const params = new URLSearchParams({
    key, cx, safe: 'active', q: `${q} filetype:pdf`, num: String(Math.min(10, Math.max(1, num))),
  });
  const r = await fetch(`${CSE_URL}?${params}`);
  if (!r.ok) throw new Error(`cse ${r.status}`);
  const data = await r.json();
  return (data.items || [])
    .map((it) => ({
      kind: 'pdf', url: it.link,
      title: (it.title || '').replace(/\s*\.pdf\s*$/i, ''),
      snippet: it.snippet || '',
      thumbnail: (it.pagemap?.cse_image && it.pagemap.cse_image[0]?.src) || null,
      source: it.displayLink || safeHost(it.link),
      published: null,
      extra: { fileSizeBytes: 0 },
    }))
    .filter((it) => it.url && it.title);
}

async function probeSize(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal });
    const len = r.headers.get('content-length');
    return len ? Number(len) : 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(t);
  }
}

function decodeDdgHref(href) {
  const um = href.match(/[?&]uddg=([^&]+)/);
  if (um) {
    try { return decodeURIComponent(um[1]); } catch { return null; }
  }
  if (href.startsWith('//')) return `https:${href}`;
  return /^https?:\/\//i.test(href) ? href : null;
}

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
