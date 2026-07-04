const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const TEMP_DIR = '/tmp/audio';
const COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || '/tmp/cookies.txt';

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Supply YouTube cookies via env (YTDLP_COOKIES_TXT = full Netscape cookies.txt
// content) so they survive redeploys. yt-dlp needs valid cookies to get past
// YouTube's "Sign in to confirm you're not a bot" gate on many videos.
if (process.env.YTDLP_COOKIES_TXT && process.env.YTDLP_COOKIES_TXT.trim()) {
  try {
    fs.writeFileSync(COOKIES_PATH, process.env.YTDLP_COOKIES_TXT);
    console.log('[Server] Wrote YouTube cookies from env to', COOKIES_PATH);
  } catch (e) {
    console.warn('[Server] Could not write cookies from env:', e.message);
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'youtube-audio-server' });
});

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
      console.log(`[yt-dlp:${playerClient}] ${data}`.trim());
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

// Extract audio from a YouTube video (optionally only a time section).
app.post('/api/extract-audio', async (req, res) => {
  const { videoId, startSec, durationSec } = req.body;
  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  // When startSec/durationSec are given, only that slice is extracted — this is
  // how the Whisper caller chunks long videos to stay under the 25MB API limit.
  const section = (typeof startSec === 'number' && typeof durationSec === 'number' && durationSec > 0)
    ? { startSec: Math.max(0, startSec), durationSec }
    : null;

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const outputId = crypto.randomBytes(8).toString('hex');
  const outputPath = path.join(TEMP_DIR, `${outputId}.mp3`);

  console.log(`[Server] Extracting audio for: ${videoId}${section ? ` [${section.startSec}s +${section.durationSec}s]` : ''}`);

  // Try several player clients in order; YouTube gates formats differently per
  // client. android_vr / tv are the least bot-gated (same trick used for
  // captions), so try them first.
  const clients = ['android_vr', 'tv', 'default', 'android', 'web_safari', 'ios'];
  let lastError = null;

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
        console.log(`[Server] client="${client}" failed: ${err.message.split('\n').pop()}`);
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
    console.error(`[Server] Error extracting audio:`, error.message);
    if (fs.existsSync(outputPath)) {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
    res.status(500).json({
      error: 'Failed to extract audio',
      details: error.message,
    });
  }
});

// Fast metadata: just the video duration (no download). The Whisper caller uses
// this to chunk long videos even when InnerTube can't report duration (bot-gated).
app.post('/api/info', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId is required' });
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const clients = ['android_vr', 'tv', 'default', 'android', 'ios'];

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
      if (dur > 0) return res.json({ duration: dur });
    } catch {
      // try next client
    }
  }
  res.status(502).json({ error: 'Could not determine duration' });
});

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
