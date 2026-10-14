// The scene script: what the AI director writes and the renderer plays.
// Shared by the browser and the server, so it must stay free of DOM and Node APIs.

export const SCRIPT_VERSION = 1;

export const TEMPLATES = {
  particles: '漂浮的光点与星尘，安静、梦幻、空旷',
  rings: '从中心扩散的同心圆和旋转多边形，律动、催眠、电子感',
  waves: '层层叠叠的波浪或远山，舒展、抒情、怀旧',
  grid: '透视网格与地平线上的落日，复古合成器、公路、速度感',
  blocks: '随节拍切换的几何色块拼贴，明快、跳跃、流行',
  rain: '向下坠落的光线与地面涟漪，孤独、伤感、夜晚',
};

export const TEXT_STYLES = {
  fade: '淡入淡出，最克制',
  rise: '从下方浮起',
  type: '逐字打出，像在讲述',
  split: '每个字依次弹入，适合有力的段落',
  big: '整屏大字，只用于最重要的句子',
};

export const TRANSITIONS = {
  fade: '交叉淡化，约一秒',
  cut: '硬切',
  flash: '白闪后切换，适合副歌进入',
  wipe: '横向擦除',
};

export const CAMERAS = {
  still: '静止',
  drift: '缓慢漂移',
  zoom: '在场景内缓慢推近',
  pulse: '随鼓点轻微缩放',
};

export const FONTS = ['sans', 'serif', 'mono'];

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_SCENES = 60;
const MAX_HIGHLIGHTS = 12;

/**
 * Turn whatever the model returned into a script the renderer can trust.
 * Unknown values fall back to defaults; numbers are clamped; scenes are sorted.
 * Throws only when nothing usable is left.
 */
export function normalizeScript(raw, { duration = Infinity, lineCount = 0 } = {}) {
  if (!(duration > 0)) duration = Infinity;
  if (!raw || typeof raw !== 'object') throw new Error('script is not an object');
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) throw new Error('script has no scenes');

  const palette = (Array.isArray(raw.palette) ? raw.palette : [])
    .filter((c) => typeof c === 'string' && HEX.test(c))
    .slice(0, 5);
  while (palette.length < 3) palette.push(DEFAULT_PALETTE[palette.length]);

  const background = HEX.test(raw.background) ? raw.background : darken(palette[0]);

  const scenes = raw.scenes
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      at: clampNumber(s.at, 0, Number.isFinite(duration) ? duration : 36000, 0),
      template: pick(s.template, TEMPLATES, 'particles'),
      text: pick(s.text, TEXT_STYLES, 'fade'),
      transition: pick(s.transition, TRANSITIONS, 'fade'),
      camera: pick(s.camera, CAMERAS, 'drift'),
      intensity: clampNumber(s.intensity, 0, 1, 0.5),
      speed: clampNumber(s.speed, 0, 1, 0.5),
      density: clampNumber(s.density, 0, 1, 0.5),
      accent: Math.round(clampNumber(s.accent, 0, palette.length - 1, 0)),
    }))
    .filter((s) => !(Number.isFinite(duration) && s.at >= duration && s.at > 0))
    .sort((a, b) => a.at - b.at);

  // Drop scenes that start too close to the previous one; they would only flicker.
  const spaced = [];
  for (const scene of scenes) {
    const prev = spaced[spaced.length - 1];
    if (prev && scene.at - prev.at < 1.5) continue;
    spaced.push(scene);
  }
  if (spaced.length === 0) throw new Error('script has no usable scenes');
  spaced[0].at = 0;

  const highlights = [...new Set((Array.isArray(raw.highlights) ? raw.highlights : [])
    .map(Number)
    .filter((i) => Number.isInteger(i) && i >= 0 && (lineCount === 0 || i < lineCount)))]
    .slice(0, MAX_HIGHLIGHTS);

  return {
    version: SCRIPT_VERSION,
    mood: typeof raw.mood === 'string' ? raw.mood.slice(0, 80) : '',
    palette,
    background,
    font: FONTS.includes(raw.font) ? raw.font : 'sans',
    scenes: spaced.slice(0, MAX_SCENES),
    highlights,
  };
}

/**
 * A script made without AI: shown while the director is still thinking,
 * or for good when no API key is set. Same input, same script.
 */
export function fallbackScript({ title = '', artist = '', lines = [], duration = 240 } = {}) {
  const rand = mulberry32(hashString(`${artist}\u0000${title}`));
  const hue = Math.floor(rand() * 360);
  const palette = [0, 40, 180].map((d, i) => hslToHex((hue + d) % 360, 70 - i * 10, 60 + i * 5));
  const background = hslToHex((hue + 200) % 360, 35, 7);

  // Change scene at long gaps between lyrics, or every ~20 seconds without lyrics.
  const cuts = [0];
  const timed = lines.filter((l) => l.text);
  for (let i = 1; i < timed.length; i++) {
    const gap = timed[i].time - timed[i - 1].time;
    if (gap > 6 && timed[i].time - cuts[cuts.length - 1] > 12) cuts.push(timed[i].time - 0.3);
  }
  if (cuts.length < 3) {
    cuts.length = 1;
    for (let t = 20; t < duration - 8; t += 20) cuts.push(t);
  }

  const names = Object.keys(TEMPLATES);
  const start = Math.floor(rand() * names.length);
  const textStyles = ['fade', 'rise', 'type', 'split'];
  const scenes = cuts.map((at, i) => ({
    at,
    template: names[(start + i) % names.length],
    text: textStyles[i % textStyles.length],
    transition: i === 0 ? 'cut' : 'fade',
    camera: i % 2 ? 'zoom' : 'drift',
    intensity: 0.4 + 0.3 * rand(),
    speed: 0.3 + 0.4 * rand(),
    density: 0.3 + 0.4 * rand(),
    accent: i % palette.length,
  }));

  return normalizeScript({ mood: '', palette, background, font: 'sans', scenes }, { duration, lineCount: lines.length });
}

/** Index of the scene playing at time t. */
export function sceneIndexAt(scenes, t) {
  let index = 0;
  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i].at <= t) index = i;
    else break;
  }
  return index;
}

const DEFAULT_PALETTE = ['#f2c14e', '#f78154', '#4d9078'];

function pick(value, table, fallback) {
  return typeof value === 'string' && Object.hasOwn(table, value) ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function darken(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 255) * 0.08);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}
