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

test('defaults to gemini-3.8-flash and forwards thinkingLevel as-is', (t) => {
  withModel(t, undefined);
  const request = buildGeminiRequest({ contents, generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } }, 'generateContent');
  assert.match(request.url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.deepEqual(sent(request).generationConfig.thinkingConfig, { thinkingLevel: 'low' });
});

test('rolling back to a 2.x model maps a low thinkingLevel to thinkingBudget 0', (t) => {
  withModel(t, 'gemini-2.5-flash');
  const request = buildGeminiRequest({ contents, generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } }, 'streamGenerateContent');
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
