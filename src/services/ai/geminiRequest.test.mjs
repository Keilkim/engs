import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiRequest, defaultModel } from '../../../api/_lib/gemini.js';

const contents = [{ parts: [{ text: 'hi' }] }];

function withModel(t, model) {
  const previous = process.env.GEMINI_MODEL;
  if (model === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = model;
  t.after(() => {
    if (previous === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previous;
  });
}

const sent = (request) => JSON.parse(request.init.body);

test('default model is 3.8 Flash until its price rise, then 3.5 Flash-Lite', () => {
  assert.equal(defaultModel(Date.parse('2026-10-20T12:00:00+09:00')), 'gemini-3.8-flash');
  assert.equal(defaultModel(Date.parse('2026-12-31T23:59:59+09:00')), 'gemini-3.8-flash');
  assert.equal(defaultModel(Date.parse('2027-01-01T00:00:00+09:00')), 'gemini-3.5-flash-lite');
  // Korean midnight comes before the change in UTC and US Pacific time.
  assert.equal(defaultModel(Date.parse('2026-12-31T16:00:00Z')), 'gemini-3.5-flash-lite');
});

test('requests use the default model unless GEMINI_MODEL overrides it', (t) => {
  withModel(t, undefined);
  assert.ok(buildGeminiRequest({ contents }, 'generateContent').url.includes(`/models/${defaultModel()}:`));
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  assert.ok(buildGeminiRequest({ contents }, 'generateContent').url.includes('/models/gemini-2.5-flash:'));
});

test("models that take 'minimal' get thinkingLevel as-is", (t) => {
  withModel(t, 'gemini-3.5-flash-lite');
  const request = buildGeminiRequest({ contents, generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } } }, 'generateContent');
  assert.deepEqual(sent(request).generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
});

test("models without 'minimal' (3.8 Flash, Pro) get 'low' instead", (t) => {
  withModel(t, undefined); // restores GEMINI_MODEL after the loop below
  for (const model of ['gemini-3.8-flash', 'gemini-3.1-pro-preview']) {
    process.env.GEMINI_MODEL = model;
    const request = buildGeminiRequest({ contents, generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } } }, 'generateContent');
    assert.deepEqual(sent(request).generationConfig.thinkingConfig, { thinkingLevel: 'low' }, model);
  }
});

test('rolling back to a 2.x model maps a minimal thinkingLevel to thinkingBudget 0', (t) => {
  withModel(t, 'gemini-2.5-flash');
  const request = buildGeminiRequest({ contents, generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } } }, 'streamGenerateContent');
  assert.match(request.url, /models\/gemini-2\.5-flash:streamGenerateContent\?alt=sse$/);
  assert.deepEqual(sent(request).generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test('a higher thinkingLevel on 2.x falls back to the model default (dynamic)', (t) => {
  withModel(t, 'gemini-2.5-flash');
  const request = buildGeminiRequest({ contents, generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } }, 'generateContent');
  assert.deepEqual(sent(request).generationConfig.thinkingConfig, {});
});

test('still caps maxOutputTokens and drops unknown fields', (t) => {
  withModel(t, undefined);
  const request = buildGeminiRequest({ contents, tools: [{ googleSearch: {} }], generationConfig: { maxOutputTokens: 100000 } }, 'generateContent');
  const body = sent(request);
  assert.equal(body.generationConfig.maxOutputTokens, 8192);
  assert.equal(body.tools, undefined);
});
