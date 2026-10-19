import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiRequest } from '../../../api/_lib/gemini.js';

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

test('defaults to gemini-3.8-flash', (t) => {
  withModel(t, undefined);
  const request = buildGeminiRequest({ contents }, 'generateContent');
  assert.match(request.url, /models\/gemini-3\.8-flash:generateContent$/);
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
