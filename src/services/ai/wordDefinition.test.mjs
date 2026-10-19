import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWordLookupPrompt, formatWordDefinition } from './wordDefinition.js';

test('prompt asks for the in-sentence meaning when a sentence is given', () => {
  const prompt = buildWordLookupPrompt('take', 'We should take it into account.', 'Korean (한국어)');
  assert.match(prompt, /Sentence: "We should take it into account\."/);
  assert.match(prompt, /AS USED IN THE SENTENCE/);
  assert.match(prompt, /take A into account/);
});

test('prompt without a sentence asks for the common meaning and no expression', () => {
  const prompt = buildWordLookupPrompt('account', undefined, 'Korean (한국어)');
  assert.doesNotMatch(prompt, /Sentence:/);
  assert.match(prompt, /most common meaning/);
  assert.match(prompt, /"expression": null\./);
});

test('prompt caps a paragraph-long OCR sentence', () => {
  const prompt = buildWordLookupPrompt('word', 'x'.repeat(2000), 'English');
  assert.ok(!prompt.includes('x'.repeat(501)));
});

test('formats meaning, expression and other meanings into one string', () => {
  const result = formatWordDefinition({
    phonetic: '/teɪk/',
    partOfSpeech: '동사',
    meaning: '고려하다',
    expression: { phrase: 'take A into account', meaning: 'A를 고려하다' },
    otherMeanings: ['가져가다', '고려하다', '데려가다', '받다'],
  }, 'Korean');
  assert.deepEqual(result, {
    phonetic: '/teɪk/',
    definition: '[동사] 고려하다\n▸ take A into account: A를 고려하다\n다른 뜻: 가져가다, 데려가다',
  });
});

test('skips missing parts and labels other meanings per language', () => {
  const result = formatWordDefinition({ meaning: 'consider', expression: null, otherMeanings: ['bank account'] }, 'German');
  assert.deepEqual(result, { phonetic: '', definition: 'consider\nWeitere Bedeutungen: bank account' });
});

test('returns null for an unusable reply so the caller can fall back', () => {
  assert.equal(formatWordDefinition({ meaning: '  ' }), null);
  assert.equal(formatWordDefinition(null), null);
  assert.equal(formatWordDefinition({ meaning: { text: 'x' } }), null);
});
