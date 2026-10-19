import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useOcrWords } from './useOcrWords.js';

function readFirstRender(source, page, point = [5, 5]) {
  let result;
  function Probe() {
    const { ocrWords, findWordAtPoint } = useOcrWords(source, page);
    result = { words: ocrWords, hit: findWordAtPoint(...point) };
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return result;
}

test('the first render already contains only the current page words and hitboxes', () => {
  const first = { text: 'first', bbox: { x: 0, y: 0, width: 10, height: 10 } };
  const second = { text: 'second', bbox: { x: 20, y: 20, width: 10, height: 10 } };
  const source = { ocr_data: { pages: [{ pageIndex: 0, words: [first] }, { pageIndex: 1, words: [second] }] } };
  assert.deepEqual(readFirstRender(source, 0), { words: [first], hit: first });
  assert.deepEqual(readFirstRender(source, 1), { words: [second], hit: null });
  assert.deepEqual(readFirstRender(source, 1, [25, 25]), { words: [second], hit: second });
});

test('missing pages, legacy JSON data, and malformed word records remain safe', () => {
  assert.deepEqual(readFirstRender(null, 0), { words: [], hit: null });
  for (const data of ['null', '{"pages":{}}', '{"pages":[{"pageIndex":0,"words":{}}]}']) {
    assert.deepEqual(readFirstRender({ ocr_data: data }, 0), { words: [], hit: null });
  }
  const words = [null, { text: 'missing bounds' }];
  assert.deepEqual(readFirstRender({ ocr_data: JSON.stringify({ pages: [{ pageIndex: 0, words }] }) }, 0), { words, hit: null });
});
