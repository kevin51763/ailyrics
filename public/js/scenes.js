// Scene templates. Each draws one full frame from the song time and audio features.
// Motion is computed from time, not accumulated per frame, so seeking lands on the right picture.
//
// f = { w, h, t, st, palette, bg, accent, intensity, speed, density, audio, seed }
//   t: song time, st: seconds since this scene started
//   audio: { bass, mid, high, level, beat, beatCount }, all 0..1 except beatCount

const TAU = Math.PI * 2;

// Deterministic noise in [0, 1) from integers.
function rnd(seed, i, k = 0) {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fract = (x) => x - Math.floor(x);

function fillBackground(ctx, f, glow = 0.25) {
  ctx.fillStyle = f.bg;
  ctx.fillRect(0, 0, f.w, f.h);
  const r = Math.max(f.w, f.h) * (0.7 + 0.15 * f.audio.level);
  const g = ctx.createRadialGradient(f.w / 2, f.h / 2, 0, f.w / 2, f.h / 2, r);
  g.addColorStop(0, withAlpha(f.accent, glow * (0.5 + f.audio.level)));
  g.addColorStop(1, withAlpha(f.accent, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, f.w, f.h);
}

export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function particles(ctx, f) {
  fillBackground(ctx, f, 0.3);
  const count = Math.round(80 + f.density * 320);
  const rise = 0.01 + 0.05 * f.speed;
  const unit = Math.min(f.w, f.h) / 400;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const z = 0.2 + 0.8 * rnd(f.seed, i, 2);
    const x = fract(rnd(f.seed, i, 0) + Math.sin(f.t * 0.1 * f.speed + i) * 0.02);
    const y = fract(rnd(f.seed, i, 1) - f.t * rise * z);
    const twinkle = 0.5 + 0.5 * Math.sin(f.t * (1 + 3 * rnd(f.seed, i, 3)) + i);
    const size = unit * z * (1.5 + 2.5 * f.audio.bass * f.intensity + twinkle);
    ctx.fillStyle = withAlpha(f.palette[i % f.palette.length], 0.25 + 0.6 * z * twinkle);
    ctx.beginPath();
    ctx.arc(x * f.w, y * f.h, size, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function rings(ctx, f) {
  fillBackground(ctx, f, 0.2);
  const cx = f.w / 2;
  const cy = f.h / 2;
  const maxR = Math.hypot(f.w, f.h) / 2;
  const n = Math.round(6 + f.density * 14);
  const flow = f.t * (0.03 + 0.12 * f.speed);
  for (let k = 0; k < n; k++) {
    const p = fract(k / n + flow);
    const r = p * maxR;
    ctx.strokeStyle = withAlpha(f.palette[k % f.palette.length], (1 - p) * (0.4 + 0.5 * f.intensity));
    ctx.lineWidth = (1 + 6 * f.audio.beat * f.intensity) * (1 - p) * Math.min(f.w, f.h) / 300;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
  }

  // A rotating polygon at the centre that swells with the bass.
  const sides = 3 + Math.floor(rnd(f.seed, 7) * 4);
  const size = Math.min(f.w, f.h) * (0.12 + 0.1 * f.audio.bass * (0.5 + f.intensity));
  const rot = f.t * (0.1 + 0.5 * f.speed);
  for (let layer = 0; layer < 3; layer++) {
    ctx.strokeStyle = withAlpha(f.palette[(f.accentIndex + layer) % f.palette.length], 0.8 - layer * 0.2);
    ctx.lineWidth = Math.min(f.w, f.h) / 250;
    ctx.beginPath();
    for (let s = 0; s <= sides; s++) {
      const a = rot * (layer % 2 ? -1 : 1) + (s / sides) * TAU;
      const r = size * (1 + layer * 0.35);
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function waves(ctx, f) {
  const sky = ctx.createLinearGradient(0, 0, 0, f.h);
  sky.addColorStop(0, f.bg);
  sky.addColorStop(1, withAlpha(f.accent, 0.35));
  ctx.fillStyle = f.bg;
  ctx.fillRect(0, 0, f.w, f.h);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, f.w, f.h);

  const layers = Math.round(4 + f.density * 4);
  const step = Math.max(4, f.w / 160);
  for (let l = 0; l < layers; l++) {
    const depth = l / (layers - 1 || 1); // 0 far, 1 near
    const base = f.h * (0.45 + 0.45 * depth);
    const amp = f.h * (0.02 + 0.05 * depth) * (1 + f.audio.mid * f.intensity * 1.5);
    const freq = (1.5 + 2 * rnd(f.seed, l)) / f.w * TAU;
    const phase = rnd(f.seed, l, 1) * TAU + f.t * (0.2 + 0.8 * f.speed) * (0.4 + depth);
    ctx.fillStyle = withAlpha(f.palette[l % f.palette.length], 0.25 + 0.55 * depth);
    ctx.beginPath();
    ctx.moveTo(0, f.h);
    for (let x = 0; x <= f.w + step; x += step) {
      const y = base + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.3 - phase * 0.7) * amp * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(f.w, f.h);
    ctx.closePath();
    ctx.fill();
  }
}

function grid(ctx, f) {
  ctx.fillStyle = f.bg;
  ctx.fillRect(0, 0, f.w, f.h);
  const horizon = f.h * 0.56;
  const cx = f.w / 2;

  // Sun with horizontal cut-outs.
  const sunR = Math.min(f.w, f.h) * (0.2 + 0.03 * f.audio.bass * f.intensity);
  const sunY = horizon - sunR * 0.35;
  const sun = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
  sun.addColorStop(0, f.palette[0]);
  sun.addColorStop(1, f.palette[1]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, f.w, horizon);
  ctx.clip();
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(cx, sunY, sunR, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.bg;
  for (let i = 0; i < 6; i++) {
    const y = sunY + sunR * (0.1 + i * 0.15);
    ctx.fillRect(cx - sunR, y, sunR * 2, sunR * 0.02 * (i + 1));
  }
  ctx.restore();

  // Ground.
  const ground = ctx.createLinearGradient(0, horizon, 0, f.h);
  ground.addColorStop(0, withAlpha(f.accent, 0.25));
  ground.addColorStop(1, f.bg);
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, f.w, f.h - horizon);

  const lineColor = withAlpha(f.palette[2 % f.palette.length], 0.55 + 0.45 * f.audio.beat * f.intensity);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(1, f.h / 400);
  const rows = 14;
  const move = fract(f.t * (0.3 + 1.5 * f.speed));
  for (let i = 0; i < rows; i++) {
    const z = (i + move) / rows; // 0 near horizon, 1 near viewer
    const y = horizon + (f.h - horizon) * z * z;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(f.w, y);
    ctx.stroke();
  }
  const cols = Math.round(10 + f.density * 20);
  for (let i = -cols; i <= cols; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + (i / cols) * f.w * 0.05, horizon);
    ctx.lineTo(cx + (i / cols) * f.w * 1.6, f.h);
    ctx.stroke();
  }
}

function blocks(ctx, f) {
  ctx.fillStyle = f.bg;
  ctx.fillRect(0, 0, f.w, f.h);
  const cols = Math.round(3 + f.density * 5);
  const rows = Math.max(2, Math.round(cols * f.h / f.w));
  const gap = Math.min(f.w, f.h) * 0.012;
  const cw = f.w / cols;
  const ch = f.h / rows;
  const step = Math.floor(f.t * (0.25 + 1.2 * f.speed));
  const flashCell = Math.floor(rnd(f.seed, f.audio.beatCount, 9) * cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c;
      const v = rnd(f.seed, cell, step + (cell % 3));
      if (v < 0.35) continue; // leave some cells empty
      const color = f.palette[Math.floor(v * 97) % f.palette.length];
      const flash = cell === flashCell ? f.audio.beat * f.intensity : 0;
      ctx.fillStyle = withAlpha(color, 0.25 + 0.45 * v + 0.3 * flash);
      const inset = gap + (1 - flash) * gap * 2 * rnd(f.seed, cell, 5);
      ctx.fillRect(c * cw + inset, r * ch + inset, cw - inset * 2, ch - inset * 2);
    }
  }
}

function rain(ctx, f) {
  const sky = ctx.createLinearGradient(0, 0, 0, f.h);
  sky.addColorStop(0, f.bg);
  sky.addColorStop(1, withAlpha(f.accent, 0.2));
  ctx.fillStyle = f.bg;
  ctx.fillRect(0, 0, f.w, f.h);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, f.w, f.h);

  const count = Math.round(100 + f.density * 300);
  const fall = 0.25 + 0.9 * f.speed;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const z = 0.2 + 0.8 * rnd(f.seed, i, 2);
    const x = rnd(f.seed, i, 0) * f.w;
    const y = (fract(rnd(f.seed, i, 1) + f.t * fall * z * 0.5) * 1.2 - 0.1) * f.h;
    const len = f.h * (0.02 + 0.08 * z) * (1 + f.audio.high * f.intensity);
    ctx.strokeStyle = withAlpha(f.palette[i % f.palette.length], 0.15 + 0.5 * z);
    ctx.lineWidth = Math.max(1, z * f.h / 500);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + len);
    ctx.stroke();
  }

  // Ripples on the ground, one born at each beat.
  const groundY = f.h * 0.88;
  for (let k = 0; k < 4; k++) {
    const id = f.audio.beatCount - k;
    if (id <= 0) continue;
    const age = k + (1 - f.audio.beat);
    const rx = rnd(f.seed, id, 4) * f.w;
    const r = f.w * 0.03 * (1 + age * 1.5);
    ctx.strokeStyle = withAlpha(f.accent, Math.max(0, 0.6 - age * 0.18) * (0.5 + f.intensity));
    ctx.lineWidth = Math.max(1, f.h / 600);
    ctx.beginPath();
    ctx.ellipse(rx, groundY, r, r * 0.18, 0, 0, TAU);
    ctx.stroke();
  }
}

export const SCENES = { particles, rings, waves, grid, blocks, rain };
