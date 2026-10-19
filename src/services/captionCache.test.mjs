import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptionCache } from './captionCache.js';

test('caption cache evicts the least recently used source at the entry limit', () => {
  const cache = createCaptionCache({ maxEntries: 2 });
  cache.set('a', { segments: ['a'] });
  cache.set('b', { segments: ['b'] });
  assert.deepEqual(cache.get('a'), { segments: ['a'] });
  cache.set('c', { segments: ['c'] });
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a'));
  assert.ok(cache.get('c'));
});

test('large transcripts cannot exceed the total retained size', () => {
  const cache = createCaptionCache({ maxCharacters: 20 });
  cache.set('a', '1234567890');
  cache.set('b', '1234567890');
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), '1234567890');
  cache.set('oversized', 'x'.repeat(100));
  assert.equal(cache.get('oversized'), undefined);
  assert.equal(cache.get('b'), '1234567890');
});

test('captions expire even if they were recently read', () => {
  let now = 0;
  const cache = createCaptionCache({ ttl: 100, now: () => now });
  cache.set('a', { segments: [] });
  now = 99;
  assert.ok(cache.get('a'));
  now = 100;
  assert.equal(cache.get('a'), undefined);
});

test('null captions are cached and account/source invalidation removes them', () => {
  const cache = createCaptionCache();
  cache.set('empty', null);
  assert.equal(cache.get('empty'), null);
  cache.delete('empty');
  assert.equal(cache.get('empty'), undefined);
  cache.set('old', { segments: [] });
  cache.clear();
  assert.equal(cache.get('old'), undefined);
});

test('replacement and expiration release retained size before admitting another source', () => {
  let now = 0;
  const cache = createCaptionCache({ maxCharacters: 15, ttl: 10, now: () => now });
  cache.set('a', '1234567890');
  cache.set('a', null);
  cache.set('b', '12345');
  assert.equal(cache.get('a'), null);
  now = 10;
  cache.set('c', '1234567890');
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('c'), '1234567890');
});
