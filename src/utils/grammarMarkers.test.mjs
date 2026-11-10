import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrammarMarkers } from './grammarMarkers.js';

function words(text, y = 10) {
  return text.split(' ').map((text, index) => ({ text, bbox: { x: index * 10, y, width: 8, height: 3 } }));
}
function annotation(sentenceWords, patterns, legacy = false) {
  return {
    selection_rect: JSON.stringify({ bounds: { x: 0, y: 10, width: 100, height: 3 },
      ...(legacy ? {} : { words: sentenceWords }) }),
    ai_analysis_json: JSON.stringify({ type: 'grammar', patterns }),
  };
}
const pattern = { words: ['take A into account'], spans: ['take', 'into account'], variableSpans: ['this risk'] };

test('marks fixed expression and variable words without underlining the rest of the sentence', () => {
  const row = words('We take this risk into account today.');
  const markers = buildGrammarMarkers(annotation(row, [pattern]));
  assert.deepEqual(markers.filter(m => m.role === 'fixed').map(m => [m.x, m.width]), [[10, 8], [40, 18]]);
  assert.deepEqual(markers.filter(m => m.role === 'variable').map(m => [m.x, m.width]), [[20, 18]]);
});

test('splits a multiline expression at the line break', () => {
  const row = [...words('Regardless of'), ...words('the result we continued.', 16)];
  const markers = buildGrammarMarkers(annotation(row, [{ spans: ['Regardless of the result'] }]));
  assert.deepEqual(markers.map(m => [m.x, m.y, m.width]), [[0, 10, 18], [0, 16, 18]]);
});

test('overlapping saved patterns produce one strong line and do not double-mark variables', () => {
  const row = words('We take this risk into account today.');
  const markers = buildGrammarMarkers(annotation(row, [pattern, pattern,
    { spans: ['this risk'], variableSpans: ['take this risk'] }]));
  assert.equal(markers.filter(m => m.role === 'variable').length, 0);
  assert.equal(markers.filter(m => m.x === 10).length, 1);
});

test('recovers legacy word geometry from OCR and infers only bounded A/B slots', () => {
  const row = words('We take this risk into account today.');
  const markers = buildGrammarMarkers(annotation(row, [{ ...pattern, variableSpans: undefined }], true), row);
  assert.deepEqual(markers.filter(m => m.role === 'variable').map(m => [m.x, m.width]), [[20, 18]]);
  assert.deepEqual(buildGrammarMarkers(annotation(row, [pattern], true)), []);
});

test('splits legacy phrase-wide spans using their A/B template', () => {
  const row = words('We take this risk into account today.');
  const markers = buildGrammarMarkers(annotation(row, [{ words: ['take A into account'], spans: ['take this risk into account'] }]));
  assert.deepEqual(markers.filter(m => m.role === 'fixed').map(m => [m.x, m.width]), [[10, 8], [40, 18]]);
  assert.deepEqual(markers.filter(m => m.role === 'variable').map(m => [m.x, m.width]), [[20, 18]]);
});

test('does not match cue words inside unrelated words or draw invented spans', () => {
  const row = words('Nothing is inside it.');
  assert.deepEqual(buildGrammarMarkers(annotation(row, [{ spans: ['not', 'in', 'invented'] }])), []);
});

test('translation-only and malformed saves render no sentence-wide fallback', () => {
  for (const item of [{ selection_rect: '{' }, annotation(words('A sentence.'), []),
    annotation(words('A sentence.'), [null, { spans: [null, 42] }])]) {
    assert.deepEqual(buildGrammarMarkers(item), []);
  }
});
