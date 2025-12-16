import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";
import { Readability } from "https://esm.sh/@mozilla/readability@0.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  try {
    const { url, type } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
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
      // URL의 HTML 가져오기
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        redirect: "follow",
      });

      if (response.ok) {
        const html = await response.text();

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
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
