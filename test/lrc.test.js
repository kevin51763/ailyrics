import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, lineIndexAt } from '../public/js/lrc.js';

test('parses metadata, repeated time tags and offsets', () => {
  const { meta, lines } = parseLrc([
    '[ti:夜航]',
    '[ar:某乐队]',
    '[offset:500]',
    '[00:12.50]第一句',
    '[00:20.00][01:10.25]副歌 <00:20.10>重复',
    '[00:30]',
    'not a lyric',
  ].join('\n'));

  assert.equal(meta.ti, '夜航');
  assert.equal(meta.ar, '某乐队');
  assert.deepEqual(lines, [
    { time: 12, text: '第一句' },
    { time: 19.5, text: '副歌 重复' },
    { time: 29.5, text: '' },
    { time: 69.75, text: '副歌 重复' },
  ]);
});

test('accepts the mm:ss:xx variant', () => {
  assert.equal(parseLrc('[01:02:50]x').lines[0].time, 62.5);
});

test('finds the line showing at a given time', () => {
  const lines = [{ time: 1 }, { time: 5 }, { time: 9 }];
  assert.equal(lineIndexAt(lines, 0.5), -1);
  assert.equal(lineIndexAt(lines, 1), 0);
  assert.equal(lineIndexAt(lines, 8.9), 1);
  assert.equal(lineIndexAt(lines, 100), 2);
  assert.equal(lineIndexAt([], 3), -1);
});
