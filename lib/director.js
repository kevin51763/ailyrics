// The AI director: asks DeepSeek for a scene script for one song.

import { TEMPLATES, TEXT_STYLES, TRANSITIONS, CAMERAS, FONTS, normalizeScript } from '../public/js/script.js';

// Bump when the prompt changes, so cached scripts from the old prompt are not reused.
export const PROMPT_VERSION = 1;

const MAX_LINES = 240;
const MAX_LINE_CHARS = 120;

const describe = (table) => Object.entries(table).map(([k, v]) => `  - ${k}: ${v}`).join('\n');

const SYSTEM_PROMPT = `你是一位音乐视频导演。播放器会按你写的分镜脚本，实时渲染出跟随歌曲的动态画面。
你不画画，只做决定：整首歌用什么配色，在什么时刻换场景，每段用哪种画面、文字动效和转场。

可用的画面模板 template：
${describe(TEMPLATES)}

歌词动效 text：
${describe(TEXT_STYLES)}

转场 transition：
${describe(TRANSITIONS)}

镜头 camera：
${describe(CAMERAS)}

字体 font：${FONTS.join(' / ')}

只输出一个 JSON 对象，结构如下：
{
  "mood": "一句话概括这首歌的情绪和视觉方向",
  "palette": ["#rrggbb", "#rrggbb", "#rrggbb"],
  "background": "#rrggbb",
  "font": "sans",
  "scenes": [
    {
      "at": 0,
      "template": "particles",
      "text": "fade",
      "transition": "cut",
      "camera": "drift",
      "intensity": 0.4,
      "speed": 0.3,
      "density": 0.5,
      "accent": 0
    }
  ],
  "highlights": [12, 13]
}

规则：
1. palette 给 3 到 5 个颜色，background 是深色底，两者要和歌曲情绪一致，整首歌保持统一。
2. scenes 按 at（秒）升序，第一个 at 为 0。在段落交界处换场景，比如前奏、主歌、副歌、桥段、尾奏。at 取那一段第一句歌词的时间，可以提前 0.2 到 0.5 秒。
3. 一般 6 到 16 个场景。同一类段落（比如每次副歌）可以重复同一个模板，形成呼应。
4. intensity、speed、density 都在 0 到 1 之间。主歌偏低，副歌偏高，让整首歌有起伏。
5. accent 是 palette 里的颜色序号，作为这个场景的主色。
6. highlights 是最值得强调的歌词行号（方括号里的数字），最多 8 个，通常是副歌的核心句。
7. 没有歌词时，根据歌名、歌手和时长推断结构，大约每 15 到 30 秒换一次场景。
8. 不要输出 JSON 以外的任何文字。`;

/** Build the chat messages for one song. */
export function buildMessages({ title = '', artist = '', duration = 0, lines = [] }) {
  const lyricRows = lines
    .slice(0, MAX_LINES)
    .map((l, i) => `[${i}] ${formatTime(l.time)} ${String(l.text).slice(0, MAX_LINE_CHARS) || '（间奏）'}`)
    .join('\n');

  const user = [
    `歌名：${title || '未知'}`,
    `歌手：${artist || '未知'}`,
    `时长：${duration > 0 ? formatTime(duration) : '未知'}`,
    '',
    lyricRows ? `歌词（行号 时间 文本）：\n${lyricRows}` : '没有歌词。',
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/**
 * Ask DeepSeek for a script and return it normalized.
 * Retries once when the reply is not valid JSON or has no usable scenes.
 */
export async function directSong(song, { apiKey, baseUrl, model, fetchImpl = fetch, timeoutMs = 90_000 }) {
  const messages = buildMessages(song);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chat({ apiKey, baseUrl, model, messages, fetchImpl, timeoutMs });
    try {
      return normalizeScript(parseJson(content), { duration: song.duration, lineCount: song.lines?.length ?? 0 });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`DeepSeek returned an unusable script: ${lastError.message}`);
}

async function chat({ apiKey, baseUrl, model, messages, fetchImpl, timeoutMs }) {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 1,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`DeepSeek API ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('DeepSeek returned an empty reply');
  return content;
}

/** Parse JSON, tolerating a Markdown code fence around it. */
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1] : text);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(2).padStart(5, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}
