// LRC lyric parsing. Shared by the browser and the server.

const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const META_TAG = /^\[(ti|ar|al|by|offset|length):(.*)\]\s*$/i;

/**
 * Parse LRC text into sorted lines.
 * Empty lines are kept: in LRC they mark where a lyric stops showing.
 * @returns {{ meta: Record<string, string>, lines: { time: number, text: string }[] }}
 */
export function parseLrc(source) {
  const meta = {};
  const lines = [];
  let offsetMs = 0;

  for (const raw of String(source).split(/\r?\n/)) {
    const tags = [...raw.matchAll(TIME_TAG)];
    if (tags.length === 0) {
      const m = raw.trim().match(META_TAG);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === 'offset') offsetMs = Number(value) || 0;
      else meta[key] = value;
      continue;
    }
    const text = raw
      .replace(/\[[^\]]*\]/g, '')
      .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '') // enhanced LRC word stamps
      .trim();
    for (const tag of tags) {
      const time = Number(tag[1]) * 60 + Number(tag[2].replace(':', '.'));
      lines.push({ time, text });
    }
  }

  // A positive offset shows lyrics earlier.
  for (const line of lines) line.time = Math.max(0, line.time - offsetMs / 1000);
  lines.sort((a, b) => a.time - b.time);
  return { meta, lines };
}

/** Index of the line showing at time t, or -1 before the first line. */
export function lineIndexAt(lines, t) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
