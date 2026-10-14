// The renderer: plays a scene script against the audio clock, one canvas frame at a time.

import { SCENES } from './scenes.js';
import { sceneIndexAt } from './script.js';
import { lineIndexAt } from './lrc.js';

const TRANSITION_SECONDS = { fade: 1.2, cut: 0, flash: 0, wipe: 0.9 };
const SCRIPT_SWAP_SECONDS = 1.5;

const FONT_STACKS = {
  sans: '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  serif: '"Noto Serif SC", "Songti SC", "STSong", Georgia, serif',
  mono: '"JetBrains Mono", "SFMono-Regular", Menlo, "Noto Sans SC", monospace',
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - (1 - x) ** 3;
const easeOutBack = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

export class Renderer {
  constructor(canvas, audio, features) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = audio;
    this.features = features;
    this.tmp = document.createElement('canvas');
    this.swapLayer = document.createElement('canvas');
    this.song = null;
    this.script = null;
    this.oldScript = null;
    this.swapStartedAt = 0;
    this.layoutCache = new Map();
    this._last = performance.now();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Show a new song. `song` = { title, artist, lines, seed, script } */
  setSong(song) {
    this.song = song;
    this.script = song.script;
    this.oldScript = null;
    this.layoutCache.clear();
  }

  /** Update lyrics or title of the current song without restarting it. */
  updateSong(changes) {
    if (this.song) Object.assign(this.song, changes);
    this.layoutCache.clear();
  }

  /** Replace the script mid-song with a short crossfade. */
  swapScript(script) {
    this.oldScript = this.script;
    this.script = script;
    this.swapStartedAt = performance.now();
  }

  start() {
    const loop = (now) => {
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      this.features.update(dt);
      this.draw(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    for (const c of [this.canvas, this.tmp, this.swapLayer]) {
      c.width = w;
      c.height = h;
    }
    this.layoutCache.clear();
  }

  draw(now) {
    const { ctx } = this;
    const { width: w, height: h } = this.canvas;
    if (!this.song || !this.script) {
      ctx.fillStyle = '#07070a';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const t = this.audio.currentTime || 0;

    this.renderScript(this.script, t, ctx);

    if (this.oldScript) {
      const k = (now - this.swapStartedAt) / 1000 / SCRIPT_SWAP_SECONDS;
      if (k >= 1) {
        this.oldScript = null;
      } else {
        const lctx = this.swapLayer.getContext('2d');
        this.renderScript(this.oldScript, t, lctx);
        ctx.globalAlpha = 1 - easeOut(k);
        ctx.drawImage(this.swapLayer, 0, 0);
        ctx.globalAlpha = 1;
      }
    }

    this.drawLyrics(ctx, t);
  }

  /** Draw the scene playing at time t, including any transition into it. */
  renderScript(script, t, ctx) {
    const scenes = script.scenes;
    const index = sceneIndexAt(scenes, t);
    const scene = scenes[index];
    const since = t - scene.at;
    const span = TRANSITION_SECONDS[scene.transition];

    if (index > 0 && since < span) {
      this.drawScene(script, index - 1, t, ctx);
      const tctx = this.tmp.getContext('2d');
      this.drawScene(script, index, t, tctx);
      const k = easeOut(since / span);
      if (scene.transition === 'wipe') {
        const x = this.canvas.width * k;
        ctx.drawImage(this.tmp, 0, 0, x, this.canvas.height, 0, 0, x, this.canvas.height);
      } else {
        ctx.globalAlpha = k;
        ctx.drawImage(this.tmp, 0, 0);
        ctx.globalAlpha = 1;
      }
    } else {
      this.drawScene(script, index, t, ctx);
    }

    if (scene.transition === 'flash' && index > 0 && since < 0.7) {
      ctx.fillStyle = `rgba(255,255,255,${(0.85 * Math.exp(-since * 6)).toFixed(3)})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  drawScene(script, index, t, ctx) {
    const scene = script.scenes[index];
    const next = script.scenes[index + 1];
    const songEnd = Number.isFinite(this.audio.duration) ? this.audio.duration : scene.at + 60;
    const end = next ? next.at : Math.max(scene.at + 1, songEnd);
    const st = Math.max(0, t - scene.at);
    const { width: w, height: h } = this.canvas;
    const a = this.features;

    ctx.save();
    let scale = 1;
    let dx = 0;
    let dy = 0;
    if (scene.camera === 'zoom') scale = 1 + 0.12 * clamp01(st / (end - scene.at));
    else if (scene.camera === 'drift') {
      scale = 1.06;
      dx = Math.sin(t * 0.07 + index) * w * 0.02;
      dy = Math.cos(t * 0.05 + index) * h * 0.02;
    } else if (scene.camera === 'pulse') scale = 1.02 + 0.04 * a.beat * scene.intensity;
    ctx.translate(w / 2 + dx, h / 2 + dy);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);

    SCENES[scene.template](ctx, {
      w,
      h,
      t,
      st,
      palette: script.palette,
      bg: script.background,
      accent: script.palette[scene.accent],
      accentIndex: scene.accent,
      intensity: scene.intensity,
      speed: scene.speed,
      density: scene.density,
      audio: a,
      seed: (this.song.seed ^ Math.imul(index + 1, 7919)) >>> 0,
    });
    ctx.restore();
  }

  drawLyrics(ctx, t) {
    const { width: w, height: h } = this.canvas;
    const lines = this.song.lines || [];
    const index = lineIndexAt(lines, t);
    const script = this.script;
    const family = FONT_STACKS[script.font];

    if (index < 0) {
      this.drawTitleCard(ctx, t, lines[0]?.time ?? 8, family);
      return;
    }

    const line = lines[index];
    if (!line.text) return;
    const nextTime = lines[index + 1]?.time ?? Infinity;
    const end = Math.min(nextTime, line.time + 8);
    const since = t - line.time;
    const fadeOut = clamp01((end - t) / 0.25);

    const highlighted = script.highlights.includes(index);
    const style = highlighted ? 'big' : script.scenes[sceneIndexAt(script.scenes, t)].text;
    const unit = Math.min(w, h);
    const size = style === 'big' ? unit * 0.12 : unit * 0.06;
    const layout = this.layout(ctx, line.text, size, family, w * 0.86, style === 'big' ? 2 : 3);

    if (highlighted && since < 0.6) {
      ctx.fillStyle = `rgba(255,255,255,${(0.3 * Math.exp(-since * 6)).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = layout.font;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = layout.size * 0.35;
    const beat = this.features.beat;
    const total = layout.chars.length;
    const typeSpan = Math.max(0.3, Math.min((end - line.time) * 0.7, total * 0.09 + 0.2));

    for (let i = 0; i < total; i++) {
      const c = layout.chars[i];
      let alpha = fadeOut;
      let scale = 1;
      let oy = 0;
      if (style === 'fade') {
        alpha *= easeOut(clamp01(since / 0.5));
      } else if (style === 'rise') {
        const e = easeOut(clamp01(since / 0.6));
        alpha *= e;
        oy = (1 - e) * layout.size * 0.8;
      } else if (style === 'type') {
        alpha *= i < Math.ceil(total * clamp01(since / typeSpan)) ? 1 : 0;
      } else if (style === 'split') {
        const p = clamp01((since - i * 0.04) / 0.35);
        alpha *= clamp01(p * 2);
        scale = 0.6 + 0.4 * easeOutBack(p) + 0.05 * beat;
      } else if (style === 'big') {
        const p = clamp01((since - i * 0.03) / 0.4);
        alpha *= clamp01(p * 2);
        scale = 1.3 - 0.3 * easeOut(p) + 0.03 * beat;
      }
      if (alpha <= 0.001) continue;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = style === 'big' ? '#ffffff' : '#f6f4ef';
      const x = c.x + w / 2;
      const y = c.y + h / 2 + oy;
      if (scale !== 1) {
        ctx.save();
        ctx.translate(x + c.width / 2, y);
        ctx.scale(scale, scale);
        ctx.fillText(c.ch, -c.width / 2, 0);
        ctx.restore();
      } else {
        ctx.fillText(c.ch, x, y);
      }
    }
    ctx.restore();
  }

  drawTitleCard(ctx, t, firstLineAt, family) {
    const { title, artist } = this.song;
    if (!title) return;
    const { width: w, height: h } = this.canvas;
    const alpha = clamp01(t / 1.2) * clamp01((firstLineAt - t) / 0.8);
    if (alpha <= 0) return;
    const unit = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = unit * 0.02;
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(unit * 0.08)}px ${family}`;
    ctx.fillText(title, w / 2, h / 2 - unit * 0.03, w * 0.9);
    if (artist) {
      ctx.globalAlpha = alpha * 0.75;
      ctx.font = `400 ${Math.round(unit * 0.035)}px ${family}`;
      ctx.fillText(artist, w / 2, h / 2 + unit * 0.06, w * 0.9);
    }
    ctx.restore();
  }

  /**
   * Lay a lyric line out into rows of characters, centred on (0, 0).
   * Shrinks the font until the text fits in maxRows rows.
   */
  layout(ctx, text, size, family, maxWidth, maxRows) {
    const key = `${text}\u0000${size}\u0000${family}\u0000${maxWidth}\u0000${maxRows}`;
    const hit = this.layoutCache.get(key);
    if (hit) return hit;

    ctx.save();
    let rows;
    let font;
    for (;;) {
      font = `600 ${Math.round(size)}px ${family}`;
      ctx.font = font;
      rows = wrap(ctx, text, maxWidth);
      if (rows.length <= maxRows || size < 12) break;
      size *= 0.88;
    }

    const lineHeight = size * 1.35;
    const chars = [];
    rows.forEach((row, r) => {
      const y = (r - (rows.length - 1) / 2) * lineHeight;
      let x = -ctx.measureText(row).width / 2;
      for (const ch of row) {
        const width = ctx.measureText(ch).width;
        chars.push({ ch, x, y, width });
        x += width;
      }
    });
    ctx.restore();

    const result = { font, size, chars };
    if (this.layoutCache.size > 200) this.layoutCache.clear();
    this.layoutCache.set(key, result);
    return result;
  }
}

// Break text into rows no wider than maxWidth. Latin words stay whole; CJK breaks anywhere.
function wrap(ctx, text, maxWidth) {
  const tokens = text.match(/[A-Za-z0-9'’\-.,!?;:]+\s*|\s+|./gu) || [];
  const rows = [];
  let row = '';
  for (const token of tokens) {
    const candidate = row + token;
    if (row && ctx.measureText(candidate.trimEnd()).width > maxWidth) {
      rows.push(row.trimEnd());
      row = token.trimStart();
    } else {
      row = candidate;
    }
  }
  if (row.trim()) rows.push(row.trimEnd());
  return rows;
}
