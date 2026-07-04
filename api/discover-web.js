// Vercel Serverless Function — web-article discovery.
//
// KEYLESS BY DEFAULT: scrapes DuckDuckGo's HTML endpoint (direct result URLs, biased to
// the past week for freshness) — no key, no quota, best-effort. If GOOGLE_CSE_KEY +
// GOOGLE_CSE_CX are set it uses the Google Programmable Search JSON API instead (richer:
// thumbnails + publish dates; free 100/day). Returns normalized-but-idless candidates.

const CSE_URL = 'https://www.googleapis.com/customsearch/v1';
const DDG_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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
    const items = key && cx
      ? await cseSearch(key, cx, String(q), { dateRestrict: 'd30', num })
      : await ddgSearch(String(q), { df: 'w', num, kind: 'web' });
    return res.status(200).json({ items, configured: true });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'web discovery failed' });
  }
}

// --- keyless: DuckDuckGo HTML scrape (shared shape with discover-pdf) --------------
// df: 'd'|'w'|'m'|'y' date filter (omit for none). Returns direct URLs (uddg-decoded).
export async function ddgSearch(q, { df, num = 10, kind = 'web' } = {}) {
  const params = new URLSearchParams({ q, kl: 'us-en' });
  if (df) params.set('df', df);
  const r = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
    headers: { 'User-Agent': DDG_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!r.ok) throw new Error(`ddg ${r.status}`);
  const html = await r.text();

  const items = [];
  const seen = new Set();
  // Each result: <a ... class="result__a" href="...">title</a> ... optional snippet.
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && items.length < num) {
    const url = decodeDdgHref(m[1]);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const id = url.replace(/[#?].*$/, '');
    if (seen.has(id)) continue;
    seen.add(id);
    // Snippet is the next result__snippet block after this anchor.
    const rest = html.slice(m.index);
    const sm = rest.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    items.push({
      kind,
      url,
      title: stripTags(m[2]),
      snippet: sm ? stripTags(sm[1]) : '',
      thumbnail: null, // DDG HTML gives no image → card shows a placeholder tile
      source: safeHost(url),
      published: null, // no per-result date; df=w already biases to recent
      extra: {},
    });
  }
  return items.filter((it) => it.title && it.url);
}

function decodeDdgHref(href) {
  // href is //duckduckgo.com/l/?uddg=<encoded real url>&rut=... (sometimes already absolute)
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

// --- optional: Google CSE (used only when key+cx are set) -------------------------
async function cseSearch(key, cx, q, { dateRestrict, num = 10 } = {}) {
  const params = new URLSearchParams({ key, cx, q, num: String(Math.min(10, Math.max(1, num))), safe: 'active' });
  if (dateRestrict) params.set('dateRestrict', dateRestrict);
  const r = await fetch(`${CSE_URL}?${params}`);
  if (!r.ok) throw new Error(`cse ${r.status}`);
  const data = await r.json();
  return (data.items || []).map((it) => {
    const pm = it.pagemap || {};
    const meta = (pm.metatags && pm.metatags[0]) || {};
    return {
      kind: 'web', url: it.link, title: it.title || '', snippet: it.snippet || '',
      thumbnail: (pm.cse_image && pm.cse_image[0]?.src) || meta['og:image'] || null,
      source: it.displayLink || safeHost(it.link),
      published: meta['article:published_time'] || meta['og:updated_time'] || null,
      extra: {},
    };
  }).filter((it) => it.url && it.title);
}
