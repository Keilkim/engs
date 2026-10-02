import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mapWhisperError } from './whisperErrors.js';

process.env.SUPABASE_URL = 'https://supabase.whisper.test';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.QUOTA_WHISPER_SEC_DAILY = '10800';
const { default: handler } = await import('../../../api/whisper.js');
const require = createRequire(import.meta.url);
const { extractionFailure } = require('../../../youtube-audio-server/extractionErrors.js');

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function request(t, { durationSec = 30, audioError, failStart = 0, quota = true } = {}) {
  const events = [];
  const token = `test-token-${t.name.replace(/\s/g, '-')}`;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return json({ id: 'test-user' });
    if (url.endsWith('/api/extract-audio')) {
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      const section = JSON.parse(init.body);
      assert.equal(section.videoId, 'jNQXAC9IVRw');
      assert.ok(section.durationSec > 0);
      events.push({ kind: 'audio', section });
      if (audioError && section.startSec === failStart) return json(audioError.body, audioError.status);
      return json({ audioBase64: Buffer.from('test-audio').toString('base64') });
    }
    if (url.endsWith('/rpc/consume_api_quota')) {
      events.push({ kind: 'quota', body: JSON.parse(init.body) });
      return json(quota);
    }
    if (url === 'https://api.openai.com/v1/audio/transcriptions') {
      assert.equal(init.headers.Authorization, 'Bearer test-openai-key');
      assert.equal(init.body.get('model'), 'whisper-1');
      events.push({ kind: 'whisper' });
      return json({
        segments: [{ start: 12, end: 13, text: 'Hello.', no_speech_prob: 0.01 }],
        words: [{ word: 'Hello', start: 12, end: 13 }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: { videoId: 'jNQXAC9IVRw', language: 'en', durationSec },
  }, res);
  return { res, events };
}

test('legacy Railway bot rejection is identified without leaking stderr or charging quota', async (t) => {
  const { res, events } = await request(t, { audioError: {
    status: 500,
    body: { error: 'Failed to extract audio', details: 'ERROR: Sign in to confirm you’re not a bot. --cookies /private/cookies.txt' },
  } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, 'YOUTUBE_BOT_BLOCKED');
  assert.ok(!JSON.stringify(res.body).includes('/private/'));
  assert.deepEqual(events.map((e) => e.kind), ['audio']);
  assert.match(mapWhisperError({ ...res.body, message: res.body.error }), /유튜브.*차단/);
});

test('new Railway errors retain their status and code through the Whisper endpoint', async (t) => {
  const { res, events } = await request(t, { audioError: {
    status: 504,
    body: { error: 'Audio extraction timed out', code: 'AUDIO_EXTRACTION_TIMEOUT' },
  } });
  assert.equal(res.statusCode, 504);
  assert.equal(res.body.code, 'AUDIO_EXTRACTION_TIMEOUT');
  assert.deepEqual(events.map((e) => e.kind), ['audio']);
  assert.match(mapWhisperError({ ...res.body, message: res.body.error }), /시간이 너무 오래/);
});

test('one failed section of a long video starts no paid calls and consumes no quota', async (t) => {
  const { res, events } = await request(t, {
    durationSec: 2405,
    failStart: 1192,
    audioError: { status: 502, body: { error: 'Failed to extract audio', code: 'AUDIO_EXTRACTION_FAILED' } },
  });
  assert.equal(res.statusCode, 502);
  assert.equal(events.filter((e) => e.kind === 'audio').length, 3);
  assert.ok(events.every((e) => e.kind === 'audio'));
});

test('long-video transcription checks quota once after extraction and preserves global word timings', async (t) => {
  const { res, events } = await request(t, { durationSec: 2405 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(events.map((e) => e.kind), ['audio', 'audio', 'audio', 'quota', 'whisper', 'whisper', 'whisper']);
  assert.deepEqual(events[3].body, { p_kind: 'whisper_sec', p_amount: 2405, p_limit: 10800 });
  assert.deepEqual(res.body.segments.map((s) => s.start), [12, 1204, 2404]);
  assert.deepEqual(res.body.segments.map((s) => s.words[0].start), [12, 1204, 2404]);
  assert.deepEqual(res.body.segments.map((s) => s.id), [0, 1, 2]);
});

test('quota rejection still prevents a paid transcription after audio preparation', async (t) => {
  const { res, events } = await request(t, { quota: false });
  assert.equal(res.statusCode, 429);
  assert.deepEqual(events.map((e) => e.kind), ['audio', 'quota']);
  assert.match(res.body.error, /오늘 사용 한도/);
});

test('known video-length errors keep the configured duration limit', () => {
  const message = '영상이 너무 길어요 (최대 180분)';
  assert.equal(mapWhisperError({ message, status: 413 }), message);
});

test('a bot gate survives later client failures and server responses exclude raw diagnostics', () => {
  const failure = extractionFailure([
    new Error('Sign in to confirm you’re not a bot. --cookies /private/cookies.txt'),
    new Error('Requested format is not available'),
  ]);
  assert.equal(failure.code, 'YOUTUBE_BOT_BLOCKED');
  assert.equal(failure.status, 502);
  assert.ok(!JSON.stringify(failure).includes('/private/'));
});
