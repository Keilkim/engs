const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractionFailure } = require('./extractionErrors');
const { createRequireUser, USER_CACHE_MS } = require('./auth');

const app = express();
// Every API route requires a Supabase bearer token, so CORS is not the security
// boundary; ALLOWED_ORIGINS (comma-separated) narrows it further when set.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : {}));
app.use(express.json());

const PORT = process.env.PORT || 3001;
const TEMP_DIR = '/tmp/audio';
const COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || '/tmp/cookies.txt';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_START_SEC = 6 * 3600;
// Whisper's unknown-duration fallback asks for one 5400s section; nothing larger.
const MAX_SECTION_SEC = 5400;

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Supply YouTube cookies via env (YTDLP_COOKIES_TXT = full Netscape cookies.txt
// content) so they survive redeploys. yt-dlp needs valid cookies to get past
// YouTube's "Sign in to confirm you're not a bot" gate on many videos.
if (process.env.YTDLP_COOKIES_TXT && process.env.YTDLP_COOKIES_TXT.trim()) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('App authentication must be configured before supplying YouTube cookies');
  }
  try {
    fs.writeFileSync(COOKIES_PATH, process.env.YTDLP_COOKIES_TXT, { mode: 0o600 });
    fs.chmodSync(COOKIES_PATH, 0o600);
    console.log('[Server] Wrote YouTube cookies from env to', COOKIES_PATH);
  } catch (e) {
    console.warn('[Server] Could not write cookies from env:', e.message);
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'youtube-audio-server' });
});

// Verified tokens are cached briefly so audio-window fetches don't each hit
// Supabase Auth.
const userCache = new Map(); // access token -> { id, exp }

// Requires a valid (non-anonymous) Supabase session: the browser sends its own
// token, and the Vercel Whisper route forwards the caller's. Fails closed when
// SUPABASE_URL / SUPABASE_ANON_KEY aren't configured.
const requireUser = createRequireUser({
  supabaseUrl: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
  cache: userCache,
});

// In-memory per-user rate limit (runs after requireUser, so the key can't be
// spoofed the way a client-supplied X-Forwarded-For can). The virtual-slow
// player fetches roughly one ~2-min audio window per couple minutes of
// playback, and a long Whisper job sends ~10 calls, so a generous window covers
// legitimate use while capping a runaway client that would hammer yt-dlp.
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = Number(process.env.EXTRACT_RATE_MAX || 20); // per user per window
const rateHits = new Map(); // userId -> timestamps[]

function rateLimitPerUser(req, res, next) {
  const now = Date.now();
  const hits = (rateHits.get(req.userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    res.setHeader('Retry-After', Math.ceil(RATE_WINDOW_MS / 1000));
    return res.status(429).json({ error: 'Too many requests — 잠시 후 다시 시도해 주세요.' });
  }
  hits.push(now);
  rateHits.set(req.userId, hits);
  next();
}

// Evict stale buckets so the maps can't grow unbounded.
const rateCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateHits) {
    const fresh = hits.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length) rateHits.set(key, fresh);
    else rateHits.delete(key);
  }
  for (const [token, entry] of userCache) {
    if (entry.exp <= now) userCache.delete(token);
  }
}, RATE_WINDOW_MS);
if (rateCleanup.unref) rateCleanup.unref();

// Global cap on concurrent yt-dlp work across all users. Requests beyond the
// queue limit get 503 instead of piling up processes until the box falls over.
const MAX_CONCURRENT = Number(process.env.YTDLP_MAX_CONCURRENT || 6);
const MAX_QUEUE = Number(process.env.YTDLP_MAX_QUEUE || 16);
let activeJobs = 0;
const waiting = [];

function acquireSlot() {
  if (activeJobs < MAX_CONCURRENT) {
    activeJobs++;
    return Promise.resolve(true);
  }
  if (waiting.length >= MAX_QUEUE) return Promise.resolve(false);
  return new Promise((resolve) => waiting.push(() => resolve(true)));
}

function releaseSlot() {
  const next = waiting.shift();
  if (next) next(); // hand the slot straight to the next waiter
  else activeJobs--;
}

function validVideoId(videoId) {
  return typeof videoId === 'string' && VIDEO_ID_RE.test(videoId);
}

function playerClients() {
  // Mobile clients ignore account cookies; use clients that support the login.
  return fs.existsSync(COOKIES_PATH)
    ? ['default', 'web_safari', 'tv', 'web_embedded']
    : ['android_vr', 'tv', 'default', 'android', 'web_safari', 'ios'];
}

/**
 * Run yt-dlp once with a given YouTube player client.
 * Rotating the client (default -> android -> web_safari -> ios) is the most
 * reliable way around "Requested format is not available" and YouTube's
 * bot/format gating, which change frequently.
 */
function runYtDlp(youtubeUrl, outputPath, playerClient, section) {
  return new Promise((resolve, reject) => {
    const args = [
      '-x',                          // extract audio
      '--audio-format', 'mp3',
      '--audio-quality', '128K',
      // Fallback chain: prefer a standalone audio stream, else best available.
      '-f', 'bestaudio/best',
      '-o', outputPath,
      '--no-playlist',
      '--max-filesize', '25M',
      '--no-warnings',
      '--force-ipv4',                // datacenter IPv6 is often blocked by YouTube
      '--extractor-args', `youtube:player_client=${playerClient}`,
    ];

    // Only download a time range (for chunked transcription of long videos).
    if (section && section.durationSec > 0) {
      const end = section.startSec + section.durationSec;
      args.push('--download-sections', `*${section.startSec}-${end}`, '--force-keyframes-at-cuts');
    }

    // Use cookies if provided (helps with bot-detection / restricted formats).
    if (fs.existsSync(COOKIES_PATH)) {
      args.push('--cookies', COOKIES_PATH);
    }

    args.push(youtubeUrl);

    const ytdlp = spawn('yt-dlp', args);
    let stderr = '';

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      ytdlp.kill('SIGKILL');
      reject(new Error('Timeout: extraction took too long'));
    }, 4 * 60 * 1000);

    ytdlp.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
    });

    ytdlp.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Extract audio for a time section of a YouTube video. Both callers (Whisper
// chunking, virtual-slow audio windows) always send a section; whole-video
// downloads aren't offered.
app.post('/api/extract-audio', requireUser, rateLimitPerUser, async (req, res) => {
  const { videoId, startSec, durationSec } = req.body || {};
  if (!validVideoId(videoId)) {
    return res.status(400).json({ error: 'valid videoId is required' });
  }
  if (
    !Number.isFinite(startSec) || startSec < 0 || startSec > MAX_START_SEC ||
    !Number.isFinite(durationSec) || durationSec <= 0 || durationSec > MAX_SECTION_SEC
  ) {
    return res.status(400).json({ error: 'valid startSec/durationSec are required' });
  }
  const section = { startSec, durationSec };

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const outputId = crypto.randomBytes(8).toString('hex');
  const outputPath = path.join(TEMP_DIR, `${outputId}.mp3`);

  if (!(await acquireSlot())) {
    return res.status(503).json({ error: '서버가 바빠요. 잠시 후 다시 시도해 주세요.' });
  }

  console.log(`[Server] Extracting audio for: ${videoId} [${section.startSec}s +${section.durationSec}s] user=${req.userId}`);

  // Try several player clients in order; YouTube gates formats differently per
  // client. android_vr / tv are the least bot-gated (same trick used for
  // captions), so try them first.
  const clients = playerClients();
  let lastError = null;
  const failures = [];

  try {
    for (const client of clients) {
      try {
        await runYtDlp(youtubeUrl, outputPath, client, section);
        if (fs.existsSync(outputPath)) {
          lastError = null;
          break; // success
        }
        lastError = new Error('yt-dlp reported success but no file was produced');
      } catch (err) {
        lastError = err;
        failures.push(err);
        console.log(`[Server] client="${client}" failed: ${extractionFailure([err]).code}`);
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
        }
      }
    }

    if (!fs.existsSync(outputPath)) {
      throw lastError || new Error('All extraction attempts failed');
    }

    const audioBuffer = fs.readFileSync(outputPath);
    const audioBase64 = audioBuffer.toString('base64');
    fs.unlinkSync(outputPath);

    console.log(`[Server] Successfully extracted audio for: ${videoId} (${audioBuffer.length} bytes)`);

    res.json({
      success: true,
      audioBase64,
      mimeType: 'audio/mp3',
      size: audioBuffer.length,
    });
  } catch (error) {
    console.error(`[Server] Error extracting audio:`, extractionFailure([...failures, error]).code);
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
    // Return and log stable codes only; stderr may contain cookie/session details.
    const failure = extractionFailure([...failures, error]);
    res.status(failure.status).json({ error: failure.error, code: failure.code });
  } finally {
    releaseSlot();
  }
});

// Fast metadata: just the video duration (no download). The Whisper caller uses
// this to chunk long videos even when InnerTube can't report duration (bot-gated).
app.post('/api/info', requireUser, rateLimitPerUser, async (req, res) => {
  const { videoId } = req.body || {};
  if (!validVideoId(videoId)) return res.status(400).json({ error: 'valid videoId is required' });
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const clients = playerClients();

  if (!(await acquireSlot())) {
    return res.status(503).json({ error: '서버가 바빠요. 잠시 후 다시 시도해 주세요.' });
  }
  try {
    const duration = await probeDuration(url, clients);
    if (duration > 0) return res.json({ duration });
    res.status(502).json({ error: 'Could not determine duration' });
  } finally {
    releaseSlot();
  }
});

async function probeDuration(url, clients) {
  for (const client of clients) {
    try {
      const out = await new Promise((resolve, reject) => {
        const args = [
          '--skip-download', '--no-warnings', '--no-playlist',
          '--print', '%(duration)s',
          '--force-ipv4',
          '--extractor-args', `youtube:player_client=${client}`,
        ];
        if (fs.existsSync(COOKIES_PATH)) args.push('--cookies', COOKIES_PATH);
        args.push(url);

        const p = spawn('yt-dlp', args);
        let stdout = '', stderr = '';
        p.stdout.on('data', (d) => { stdout += d.toString(); });
        p.stderr.on('data', (d) => { stderr += d.toString(); });
        const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')); }, 30000);
        p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `code ${code}`)); });
        p.on('error', (e) => { clearTimeout(timer); reject(e); });
      });
      const dur = Math.round(parseFloat(out));
      if (dur > 0) return dur;
    } catch {
      // try next client
    }
  }
  return 0;
}

// Clean up old temp files periodically
setInterval(() => {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    files.forEach((file) => {
      const filePath = path.join(TEMP_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(filePath);
        console.log(`[Cleanup] Deleted old file: ${file}`);
      }
    });
  } catch {
    // Ignore cleanup errors
  }
}, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`[Server] YouTube Audio Server running on port ${PORT}`);
});
