// Shared request builder for the Gemini proxy routes.

// Only the fields the app actually sends are forwarded; anything else (tools such
// as paid search grounding, cachedContent, ...) is dropped.
const ALLOWED_FIELDS = ['contents', 'systemInstruction', 'generationConfig', 'safetySettings'];
const MAX_OUTPUT_TOKENS = 8192;

export function buildGeminiRequest(rawBody, method) {
  const body = {};
  for (const field of ALLOWED_FIELDS) {
    if (rawBody?.[field] !== undefined) body[field] = rawBody[field];
  }
  if (!Array.isArray(body.contents) || body.contents.length === 0) return null;

  if (body.generationConfig && typeof body.generationConfig === 'object') {
    const requested = Number(body.generationConfig.maxOutputTokens) || MAX_OUTPUT_TOKENS;
    body.generationConfig = {
      ...body.generationConfig,
      maxOutputTokens: Math.min(requested, MAX_OUTPUT_TOKENS),
    };
  }

  // Override in Vercel env (GEMINI_MODEL) without a code change if needed.
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const query = method === 'streamGenerateContent' ? '?alt=sse' : '';
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}${query}`,
    init: {
      method: 'POST',
      // Header rather than ?key= so the key never lands in URL/proxy logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_API_KEY },
      body: JSON.stringify(body),
    },
  };
}
