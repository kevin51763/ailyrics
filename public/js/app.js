// The player: queue, controls, lyrics lookup, and calls to the AI director.

import { parseLrc } from './lrc.js';
import { fallbackScript, hashString } from './script.js';
import { AudioFeatures } from './audio.js';
import { Renderer } from './engine.js';

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const features = new AudioFeatures(audio);
const renderer = new Renderer($('stage'), audio, features);

const state = {
  tracks: [],
  current: -1,
  ai: false,
  model: '',
};

let nextId = 1;

// ---------- tracks ----------

function baseName(name) {
  return name.replace(/\.[^.]+$/, '').trim().toLowerCase();
}

// "Artist - Title" → { artist, title }
function splitTags(name) {
  const parts = name.replace(/_/g, ' ').trim().split(/\s+-\s+/);
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - ') };
  return { artist: '', title: parts[0] };
}

function probeDuration(url) {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => resolve(0);
    probe.src = url;
  });
}

async function addAudioFiles(files, lyricFiles = []) {
  // Read lyrics first, so a song dropped together with its .lrc never starts without it.
  const lyrics = new Map();
  for (const file of lyricFiles) lyrics.set(baseName(file.name), await file.text());
  const added = [];
  for (const file of files) {
    const { artist, title } = splitTags(file.name.replace(/\.[^.]+$/, ''));
    const track = {
      id: nextId++,
      key: baseName(file.name),
      url: URL.createObjectURL(file),
      title,
      artist,
      duration: 0,
      lines: [],
      lyricsState: 'none', // none | file | lrclib | searching | missing
      script: null,
      aiState: 'idle', // idle | pending | done | cached | error | off
      aiError: '',
    };
    track.duration = await probeDuration(track.url);
    if (lyrics.has(track.key)) attachLyrics(track, lyrics.get(track.key), 'file');
    track.script = fallbackScript(track);
    state.tracks.push(track);
    added.push(track);
  }
  renderQueue();
  if (state.current < 0 && added.length) playTrack(state.tracks.indexOf(added[0]));
  else if (added.length) prefetchNext();
}

async function addLrcFiles(files) {
  for (const file of files) {
    const text = await file.text();
    const key = baseName(file.name);
    // Pair by file name; a lone lyric file goes to the song that is playing.
    let track = state.tracks.find((t) => t.key === key);
    if (!track && files.length === 1) track = state.tracks[state.current];
    if (track) attachLyrics(track, text, 'file');
  }
  renderQueue();
}

function attachLyrics(track, lrcText, source) {
  const { meta, lines } = parseLrc(lrcText);
  track.lines = lines;
  track.lyricsState = lines.length ? source : 'missing';
  if (source === 'file') {
    if (meta.ti) track.title = meta.ti;
    if (meta.ar) track.artist = meta.ar;
  }
  const hasAiScript = track.aiState === 'done' || track.aiState === 'cached';
  if (!hasAiScript) track.script = fallbackScript(track);
  if (isCurrent(track)) {
    renderer.updateSong({ lines, title: track.title, artist: track.artist });
    if (!hasAiScript) renderer.swapScript(track.script);
    updateNowPlaying();
  }
  // Lyrics the user added by hand deserve a fresh direction.
  if (source === 'file' && track.aiState !== 'off') {
    if (track.aiState === 'pending') track.redirect = true;
    else if (track.aiState !== 'idle' || isCurrent(track)) {
      track.aiState = 'idle';
      if (isCurrent(track)) direct(track);
    }
  }
}

function songFor(track) {
  return {
    title: track.title,
    artist: track.artist,
    lines: track.lines,
    seed: hashString(`${track.artist}\u0000${track.title}`),
    script: track.script,
  };
}

const isCurrent = (track) => state.tracks[state.current] === track;

// ---------- lyrics and AI director ----------

async function findLyrics(track) {
  if (track.lyricsState !== 'none' || !track.title) return;
  track.lyricsState = 'searching';
  updateStatus();
  try {
    const params = new URLSearchParams({ title: track.title, artist: track.artist, duration: String(track.duration) });
    const res = await fetch(`/api/lyrics?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // Lyrics the user added during the search win.
    if (track.lyricsState === 'searching') attachLyrics(track, data.lrc, 'lrclib');
  } catch {
    if (track.lyricsState === 'searching') track.lyricsState = 'missing';
  }
  renderQueue();
  updateStatus();
}

async function direct(track, { force = false } = {}) {
  await configReady;
  if (!state.ai) {
    track.aiState = 'off';
    updateStatus();
    await findLyrics(track);
    return;
  }
  if (track.aiState === 'pending') return;
  if (!force && track.aiState !== 'idle' && track.aiState !== 'error') return;

  track.aiState = 'pending';
  track.aiError = '';
  updateStatus();
  renderQueue();
  try {
    // The director works much better with lyrics, so look them up first.
    await findLyrics(track);
    const res = await fetch('/api/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        lines: track.lines,
        force,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    track.script = data.script;
    track.aiState = data.cached ? 'cached' : 'done';
    if (isCurrent(track)) renderer.swapScript(track.script);
  } catch (err) {
    track.aiState = 'error';
    track.aiError = err.message;
  }
  updateStatus();
  renderQueue();
  // Lyrics arrived while the director was working: direct again with them.
  if (track.redirect) {
    track.redirect = false;
    track.aiState = 'idle';
    await direct(track);
  }
}

// Direct the next song while this one plays, so its visuals are ready on time.
function prefetchNext() {
  const next = state.tracks[state.current + 1];
  if (next) direct(next);
}

// ---------- playback ----------

function playTrack(index) {
  const track = state.tracks[index];
  if (!track) return;
  state.current = index;
  audio.src = track.url;
  renderer.setSong(songFor(track));
  features.start();
  audio.play().catch(() => {});
  $('empty').hidden = true;
  updateNowPlaying();
  renderQueue();
  direct(track).then(prefetchNext);
}

function togglePlay() {
  if (state.current < 0) return $('audio-input').click();
  features.start();
  if (audio.paused) audio.play();
  else audio.pause();
}

audio.addEventListener('ended', () => {
  if (state.current + 1 < state.tracks.length) playTrack(state.current + 1);
});
audio.addEventListener('play', () => ($('play').textContent = '❚❚'));
audio.addEventListener('pause', () => ($('play').textContent = '▶'));
audio.addEventListener('timeupdate', updateTime);
audio.addEventListener('loadedmetadata', () => {
  const track = state.tracks[state.current];
  if (track && !track.duration) track.duration = audio.duration;
  updateTime();
});

// ---------- UI ----------

function formatTime(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function updateTime() {
  $('time').textContent = formatTime(audio.currentTime);
  $('duration').textContent = formatTime(audio.duration);
  if (!seeking && audio.duration) $('seek').value = String(Math.round((audio.currentTime / audio.duration) * 1000));
}

let seeking = false;
$('seek').addEventListener('input', () => {
  seeking = true;
  if (audio.duration) audio.currentTime = (Number($('seek').value) / 1000) * audio.duration;
});
$('seek').addEventListener('change', () => (seeking = false));

function updateNowPlaying() {
  const track = state.tracks[state.current];
  $('now-title').textContent = track ? [track.title, track.artist].filter(Boolean).join(' · ') : '未选择歌曲';
  updateStatus();
}

function statusText(track) {
  const lyrics = {
    none: '无歌词',
    searching: '正在查找歌词…',
    missing: '没有找到歌词',
    file: '本地歌词',
    lrclib: 'LRCLIB 歌词',
  }[track.lyricsState];
  const ai = {
    idle: '默认画面',
    pending: 'AI 导演正在设计画面…',
    done: 'AI 画面',
    cached: 'AI 画面（缓存）',
    error: `AI 失败，使用默认画面：${track.aiError}`,
    off: '默认画面（未设置 DeepSeek API key）',
  }[track.aiState];
  return `${ai} · ${lyrics}`;
}

function updateStatus() {
  const track = state.tracks[state.current];
  const el = $('status');
  el.textContent = track ? statusText(track) : state.ai ? `AI 导演：DeepSeek ${state.model}` : '未设置 DeepSeek API key，只有默认画面';
  el.classList.toggle('error', track?.aiState === 'error');
  $('regen').disabled = !state.ai || !track || track.aiState === 'pending';
}

function renderQueue() {
  const list = $('queue-list');
  list.replaceChildren(
    ...state.tracks.map((track, i) => {
      const li = document.createElement('li');
      li.className = i === state.current ? 'current' : '';
      const name = document.createElement('div');
      name.textContent = [track.title, track.artist].filter(Boolean).join(' · ');
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${formatTime(track.duration)} · ${statusText(track)}`;
      li.append(name, meta);
      li.addEventListener('click', () => playTrack(i));
      return li;
    }),
  );
}

$('play').addEventListener('click', togglePlay);
$('prev').addEventListener('click', () => {
  if (audio.currentTime > 3 || state.current <= 0) audio.currentTime = 0;
  else playTrack(state.current - 1);
});
$('next').addEventListener('click', () => playTrack(state.current + 1));
$('pick-audio').addEventListener('click', () => $('audio-input').click());
$('pick-empty').addEventListener('click', () => $('audio-input').click());
$('pick-lrc').addEventListener('click', () => $('lrc-input').click());
$('audio-input').addEventListener('change', (e) => {
  addAudioFiles([...e.target.files]);
  e.target.value = '';
});
$('lrc-input').addEventListener('change', (e) => {
  addLrcFiles([...e.target.files]);
  e.target.value = '';
});
$('regen').addEventListener('click', () => {
  const track = state.tracks[state.current];
  if (track) direct(track, { force: true });
});
$('edit').addEventListener('click', () => {
  const track = state.tracks[state.current];
  if (!track) return;
  const answer = prompt('歌手 - 歌名', [track.artist, track.title].filter(Boolean).join(' - '));
  if (answer === null) return;
  Object.assign(track, splitTags(answer));
  // New name, new lyrics search and new direction.
  if (track.lyricsState !== 'file') {
    track.lyricsState = 'none';
    track.lines = [];
  }
  track.script = fallbackScript(track);
  track.aiState = track.aiState === 'off' ? 'off' : 'idle';
  renderer.setSong(songFor(track));
  updateNowPlaying();
  renderQueue();
  direct(track);
});
$('toggle-queue').addEventListener('click', () => ($('queue').hidden = !$('queue').hidden));
$('close-queue').addEventListener('click', () => ($('queue').hidden = true));
$('fullscreen').addEventListener('click', toggleFullscreen);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 'ArrowRight') audio.currentTime += 5;
  else if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
  else if (e.key === 'n' || e.key === 'N') playTrack(state.current + 1);
});

// Hide the controls while the music plays and the mouse rests.
let idleTimer;
function wake() {
  $('bar').classList.remove('hidden');
  document.body.style.cursor = '';
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!audio.paused && $('queue').hidden) {
      $('bar').classList.add('hidden');
      document.body.style.cursor = 'none';
    }
  }, 3000);
}
for (const type of ['mousemove', 'pointerdown', 'keydown']) document.addEventListener(type, wake);
// The audio graph can only start after a user gesture; any click will do.
document.addEventListener('pointerdown', () => state.current >= 0 && features.start());

// Drag and drop: audio and lyric files together or separately.
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  $('empty').classList.add('drag');
});
document.addEventListener('dragleave', () => $('empty').classList.remove('drag'));
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  $('empty').classList.remove('drag');
  const files = [...e.dataTransfer.files];
  const lrc = files.filter((f) => /\.(lrc|txt)$/i.test(f.name));
  const songs = files.filter((f) => f.type.startsWith('audio/') || /\.(mp3|flac|m4a|aac|ogg|opus|wav)$/i.test(f.name));
  if (songs.length) await addAudioFiles(songs, lrc);
  else if (lrc.length) await addLrcFiles(lrc);
});

// ---------- start ----------

const configReady = fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    state.ai = cfg.ai;
    state.model = cfg.model;
  })
  .catch(() => {})
  .finally(updateStatus);

renderer.start();
wake();
