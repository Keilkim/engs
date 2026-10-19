import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { abortable, readBlobAsDataURL } from './abort.js';

test('cancellation settles even if a terminated worker never resolves its promise', async () => {
  const controller = new AbortController();
  const pending = abortable(new Promise(() => {}), controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('completed and failed work release their abort listeners', async () => {
  const controller = new AbortController();
  assert.equal(await abortable(Promise.resolve(3), controller.signal), 3);
  await assert.rejects(abortable(Promise.reject(new Error('failed')), controller.signal), /failed/);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('already cancelled signals still consume a late rejection', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(abortable(Promise.reject(new Error('worker failed')), controller.signal), { name: 'AbortError' });
});

test('file reading is aborted and its listener is released', async t => {
  let reader;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'FileReader', original);
    else delete globalThis.FileReader;
  });
  globalThis.FileReader = class {
    constructor() { reader = this; }
    readAsDataURL() {}
    abort() { this.aborted = true; this.onabort(); }
  };
  const controller = new AbortController();
  const rejected = assert.rejects(readBlobAsDataURL(new Blob(['image']), controller.signal), { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(reader.aborted, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
