import assert from 'node:assert/strict';
import fs from 'node:fs';

// Read-only release probes: no account, customer data, credentials, or paid calls.
const origin = new URL(process.argv[2] || 'https://engs-red.vercel.app');
assert.equal(origin.protocol, 'https:', 'Release checks require HTTPS');
const request = (path, options = {}) => fetch(new URL(path, origin), {
  redirect: 'error', signal: AbortSignal.timeout(20000), ...options,
});
const results = [];
const home = await request('/');
assert.equal(home.status, 200, 'Home must be available');
assert.match(home.headers.get('content-type') || '', /text\/html/);
const html = await home.text();
assert.match(html, /<div id="root"><\/div>/);
assert.match(home.headers.get('strict-transport-security') || '', /max-age=/);
assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
assert.equal(home.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
assert.match(home.headers.get('permissions-policy') || '', /microphone=\(self\)/);
results.push({ check: 'HTTPS, app shell and security headers', passed: true });

for (const path of ['/api/gemini', '/api/delete-account']) {
  for (const invalidToken of [false, true]) {
    const response = await request(path, { method: 'POST', headers: {
      'content-type': 'application/json', ...(invalidToken ? { authorization: 'Bearer release-check-invalid' } : {}),
    }, body: '{}' });
    assert.equal(response.status, 401, `${path}: ${invalidToken ? 'invalid' : 'missing'} session must be denied`);
    results.push({ check: path, auth: invalidToken ? 'invalid' : 'missing', status: response.status, passed: true });
  }
}

for (const path of ['/.env', '/.env.local', '/.git/config', '/supabase-schema.sql', '/personas/01-exam-student.md', '/docs/vocabulary-learning/evidence.md']) {
  const response = await request(path);
  const body = await response.text();
  const blocked = [403, 404].includes(response.status);
  const spaFallback = response.status === 200 && body === html && /text\/html/.test(response.headers.get('content-type') || '');
  assert.ok(blocked || spaFallback, `${path}: expected denied access or the app shell, never a private file`);
  results.push({ check: path, status: response.status, spaFallback, passed: true });
}

const entry = html.match(/<script[^>]+src="([^"]+)"/);
assert.ok(entry, 'Expected a compiled app entry');
const entryResponse = await request(entry[1]);
assert.equal(entryResponse.status, 200);
const bundle = await entryResponse.text();
assert.ok(!bundle.includes('sourceMappingURL='), 'Production app must not publish source maps');
results.push({ check: 'compiled entry available without a source map reference', passed: true });

const report = { checkedAt: new Date().toISOString(), origin: origin.origin, results };
fs.mkdirSync('.vercel', { recursive: true });
fs.writeFileSync('.vercel/release-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
