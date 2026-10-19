// Shared request builder for the Gemini proxy routes.

// Only the fields the app actually sends are forwarded; anything else (tools such
// as paid search grounding, cachedContent, ...) is dropped.
const ALLOWED_FIELDS = ['contents', 'systemInstruction', 'generationConfig', 'safetySettings'];
const MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_MODEL = 'gemini-3.8-flash';

// Gemini 3 models that reject thinkingLevel 'minimal' (lowest they take: 'low').
const NO_MINIMAL_THINKING = /^gemini-3\.8-flash|-pro/;

// Clients send Gemini 3's `thinkingLevel`, usually 'minimal' (fastest). Adapt
// it to the configured model so switching GEMINI_MODEL needs no client change:
// 2.x models only understand `thinkingBudget` (0 = off), and some Gemini 3
// models start at 'low'.
function adaptThinkingConfig(generationConfig, model) {
  const thinkingConfig = generationConfig.thinkingConfig;
  const level = thinkingConfig?.thinkingLevel;
  if (!level) return generationConfig;

  if (/^gemini-2\./.test(model)) {
    const { thinkingLevel: _level, ...rest } = thinkingConfig;
    const off = level === 'minimal' || level === 'low';
    return { ...generationConfig, thinkingConfig: off ? { ...rest, thinkingBudget: 0 } : rest };
  }
  if (level === 'minimal' && NO_MINIMAL_THINKING.test(model)) {
    return { ...generationConfig, thinkingConfig: { ...thinkingConfig, thinkingLevel: 'low' } };
  }
  return generationConfig;
}

export function buildGeminiRequest(rawBody, method) {
  const body = {};
  for (const field of ALLOWED_FIELDS) {
    if (rawBody?.[field] !== undefined) body[field] = rawBody[field];
  }
  if (!Array.isArray(body.contents) || body.contents.length === 0) return null;

  // Override in Vercel env (GEMINI_MODEL) without a code change if needed.
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  if (body.generationConfig && typeof body.generationConfig === 'object') {
    const requested = Number(body.generationConfig.maxOutputTokens) || MAX_OUTPUT_TOKENS;
    body.generationConfig = adaptThinkingConfig({
      ...body.generationConfig,
      maxOutputTokens: Math.min(requested, MAX_OUTPUT_TOKENS),
    }, model);
  }

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
