import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLineTranslationPrompt, readLineTranslations } from './lineTranslation.js';

test('prompt carries the lines as JSON and the expected count', () => {
  const prompt = buildLineTranslationPrompt(['so we "take" it', 'into account'], 'Korean (한국어)');
  assert.match(prompt, /into Korean \(한국어\)/);
  assert.ok(prompt.includes(JSON.stringify(['so we "take" it', 'into account'])));
  assert.match(prompt, /exactly 2 strings/);
});

test('accepts {translations} or a bare array of matching length', () => {
  assert.deepEqual(readLineTranslations({ translations: [' 안녕 ', '세상'] }, 2), ['안녕', '세상']);
  assert.deepEqual(readLineTranslations(['하나'], 1), ['하나']);
});

test('rejects replies that would misalign lines', () => {
  assert.equal(readLineTranslations({ translations: ['하나'] }, 2), null);
  assert.equal(readLineTranslations({ translations: ['하나', 2] }, 2), null);
  assert.equal(readLineTranslations({ translations: ['', ' '] }, 2), null);
  assert.equal(readLineTranslations(null, 1), null);
});
