import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";
import { Readability } from "https://esm.sh/@mozilla/readability@0.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

// Gateway JWT verification also accepts the public anon key, so check that the
// caller is an actual signed-in user.
async function isSignedInUser(req: Request): Promise<boolean> {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
      headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: authorization },
    });
    if (!r.ok) return false;
    const user = await r.json();
    return Boolean(user?.id) && !user.is_anonymous;
  } catch {
    return false;
  }
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || /\.(localhost|local|internal)$/.test(h)) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) {
    return h === "::" || h === "::1" || h.startsWith("::ffff:") ||
      h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  }
  return false;
}

// Only public http(s) URLs on default ports. (The URL parser normalizes numeric
// hosts like 2130706433 to dotted IPv4 before this check.)
function parsePublicUrl(raw: unknown): URL | null {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  if (isPrivateHost(u.hostname)) return null;
  return u;
}

// Follows redirects by hand so every hop is re-validated.
async function fetchPublicHtml(start: URL): Promise<Response | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = parsePublicUrl(new URL(location, url).href);
      if (!next) return null;
      url = next;
      continue;
    }
    return response;
  }
  return null;
}

async function readTextCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(all);
}

// 상대 URL을 절대 URL로 변환
function toAbsoluteUrl(src: string, baseUrl: string): string {
  if (!src) return "";
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  }
  if (src.startsWith("//")) {
    return `https:${src}`;
  }
  try {
    const base = new URL(baseUrl);
    if (src.startsWith("/")) {
      return `${base.origin}${src}`;
    }
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    return `${base.origin}${basePath}${src}`;
  } catch {
    return src;
  }
}

// HTML 내 이미지 URL을 절대 경로로 변환
function fixImageUrls(html: string, baseUrl: string): string {
  return html.replace(
    /<img([^>]*)\ssrc=["']([^"']+)["']/gi,
    (match, attrs, src) => {
      const absoluteSrc = toAbsoluteUrl(src, baseUrl);
      return `<img${attrs} src="${absoluteSrc}"`;
    }
  );
}

// HTML에서 메타 태그 추출
function extractMetaContent(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!(await isSignedInUser(req))) {
    return new Response(
      JSON.stringify({ error: "Sign-in required" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { url, type } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const target = parsePublicUrl(url);
    if (!target) {
      return new Response(
        JSON.stringify({ error: "A public http(s) URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (type === "pdf") {
      return new Response(
        JSON.stringify({ screenshot: null, title: null, content: null, message: "PDF handled client-side" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let screenshot: string | null = null;
    let title: string | null = null;
    let content: string | null = null;

    try {
      // URL의 HTML 가져오기 (리다이렉트마다 공개 주소인지 재검증, 크기 제한)
      const response = await fetchPublicHtml(target);
      const html = response?.ok ? await readTextCapped(response, MAX_HTML_BYTES) : null;

      if (html !== null) {

        // OG Image 추출
        const imageUrl = extractMetaContent(html, [
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
          /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
        ]);

        if (imageUrl) {
          screenshot = toAbsoluteUrl(imageUrl, url);
        } else {
          // Favicon fallback
          try {
            const domain = new URL(url).hostname;
            screenshot = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
          } catch {
            screenshot = null;
          }
        }

        // Readability로 본문 추출
        try {
          const doc = new DOMParser().parseFromString(html, "text/html");

          if (doc) {
            const reader = new Readability(doc, { charThreshold: 100 });
            const article = reader.parse();

            if (article) {
              title = article.title || null;

              // 이미지 URL 절대경로로 변환
              if (article.content) {
                content = fixImageUrls(article.content, url);
              }
            }
          }
        } catch (readabilityErr) {
          console.error("Readability error:", readabilityErr);
        }

        // Readability 실패 시 title만이라도 추출
        if (!title) {
          title = extractMetaContent(html, [
            /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
            /<title[^>]*>([^<]+)<\/title>/i,
          ]);
        }
      }
    } catch (fetchError) {
      console.error("Fetch error:", fetchError);
      try {
        const domain = new URL(url).hostname;
        screenshot = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
      } catch {
        screenshot = null;
      }
    }

    return new Response(
      JSON.stringify({ screenshot, title, content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        screenshot: null,
        title: null,
        content: null,
        error: "Request failed",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
