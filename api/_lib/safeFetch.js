// SSRF-safe outbound fetch for user-supplied URLs.
//
// Only http(s) on ports 80/443, no credentials in the URL, and the destination IP
// must be public. The IP check runs inside the socket's DNS lookup, so it applies
// to the address actually connected to (no DNS-rebinding gap), and every redirect
// hop is re-validated. The body is read with a hard byte cap.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) BLOCKED.addSubnet(addr, prefix, 'ipv6');
// IPv4-mapped IPv6 (::ffff:a.b.c.d) is matched against the IPv4 rules by BlockList.

export class UnsafeUrlError extends Error {}
export class TooLargeError extends Error {
  constructor(size) {
    super('response too large');
    this.size = size;
  }
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (!family) return true;
  return BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** Returns a URL object if `raw` is an acceptable public http(s) URL, else null. */
export function parsePublicUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return null;
  // IP literals never go through DNS lookup, so check them here.
  if (net.isIP(host) && isBlockedAddress(host)) return null;
  return u;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(new UnsafeUrlError(`blocked destination: ${hostname}`));
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function requestOnce(url, { method, headers, maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      { method, headers: { 'Accept-Encoding': 'identity', ...headers }, lookup: safeLookup },
      (res) => {
        const { statusCode: status, headers: resHeaders } = res;
        if ((status >= 300 && status < 400) || method === 'HEAD') {
          res.resume();
          return resolve({ status, headers: resHeaders, body: Buffer.alloc(0) });
        }
        const declared = Number(resHeaders['content-length'] || 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new TooLargeError(declared));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new TooLargeError(size));
          } else {
            chunks.push(chunk);
          }
        });
        res.on('end', () => resolve({ status, headers: resHeaders, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );
    const timer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetches a user-supplied URL with SSRF protection. Resolves to
 * { status, headers, body: Buffer, url } for the final hop.
 */
export async function safeFetch(
  rawUrl,
  { method = 'GET', headers = {}, maxBytes = 1024 * 1024, maxRedirects = 3, timeoutMs = 10000 } = {}
) {
  let url = parsePublicUrl(rawUrl);
  if (!url) throw new UnsafeUrlError('url not allowed');

  for (let hop = 0; ; hop++) {
    const resp = await requestOnce(url, { method, headers, maxBytes, timeoutMs });
    const location = resp.headers.location;
    if (resp.status >= 300 && resp.status < 400 && location) {
      if (hop >= maxRedirects) throw new Error('too many redirects');
      url = parsePublicUrl(new URL(location, url).href);
      if (!url) throw new UnsafeUrlError('redirect not allowed');
      continue;
    }
    return { ...resp, url: url.href };
  }
}
