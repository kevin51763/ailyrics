// Local server: serves the player and keeps the DeepSeek key off the browser.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { directSong, PROMPT_VERSION } from './lib/director.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const CACHE_DIR = path.join(ROOT, 'cache', 'scripts');

const config = {
  port: Number(process.env.PORT) || 5173,
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

// The same song may be requested twice at once (prefetch, then a click): share the call.
const inFlight = new Map();

async function handleScript(req, res) {
  const song = await readJson(req);
  const lines = Array.isArray(song.lines)
    ? song.lines.map((l) => ({ time: Number(l.time) || 0, text: String(l.text ?? '') }))
    : [];
  const input = {
    title: String(song.title ?? '').slice(0, 200),
    artist: String(song.artist ?? '').slice(0, 200),
    duration: Number(song.duration) || 0,
    lines,
  };

  if (!config.apiKey) return sendJson(res, 503, { error: '没有设置 DEEPSEEK_API_KEY' });

  const key = createHash('sha256')
    .update(JSON.stringify([PROMPT_VERSION, config.model, input.title, input.artist, lines]))
    .digest('hex')
    .slice(0, 32);
  const file = path.join(CACHE_DIR, `${key}.json`);

  if (!song.force) {
    const cached = await readFile(file, 'utf8').then(JSON.parse, () => null);
    if (cached) return sendJson(res, 200, { script: cached, cached: true });
  }

  if (!inFlight.has(key)) {
    const job = directSong(input, config)
      .then(async (script) => {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, JSON.stringify(script, null, 2));
        return script;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, job);
  }

  const script = await inFlight.get(key);
  sendJson(res, 200, { script, cached: false });
}

// Look up synced lyrics on LRCLIB, a free public lyrics database.
async function handleLyrics(req, res, url) {
  const title = url.searchParams.get('title') || '';
  const artist = url.searchParams.get('artist') || '';
  const duration = Number(url.searchParams.get('duration')) || 0;
  if (!title) return sendJson(res, 400, { error: '缺少歌名' });

  const headers = { 'User-Agent': 'ailyrics (https://github.com/kevin51763/ailyrics)' };
  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set('artist_name', artist);

  let search;
  try {
    search = await fetch(`https://lrclib.net/api/search?${params}`, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return sendJson(res, 502, { error: `无法连接 LRCLIB：${err.message}` });
  }
  if (!search.ok) return sendJson(res, 502, { error: `LRCLIB ${search.status}` });

  const results = (await search.json()).filter((r) => r.syncedLyrics);
  if (results.length === 0) return sendJson(res, 404, { error: '没有找到带时间轴的歌词' });

  // Prefer the version whose length matches the audio file.
  if (duration > 0) results.sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration));
  const best = results[0];
  sendJson(res, 200, { lrc: best.syncedLyrics, title: best.trackName, artist: best.artistName });
}

async function serveStatic(res, url) {
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求太大'), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('请求不是合法的 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(body));
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/config') {
        return sendJson(res, 200, { ai: Boolean(config.apiKey), model: config.model });
      }
      if (req.method === 'POST' && url.pathname === '/api/script') return await handleScript(req, res);
      if (req.method === 'GET' && url.pathname === '/api/lyrics') return await handleLyrics(req, res, url);
      if (req.method === 'GET') return await serveStatic(res, url);
      sendJson(res, 405, { error: 'method not allowed' });
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(config.port, () => {
    console.log(`ailyrics: http://localhost:${config.port}`);
    console.log(config.apiKey ? `AI 导演：DeepSeek ${config.model}` : 'AI 导演未启用：没有设置 DEEPSEEK_API_KEY，将只使用默认画面');
  });
}
