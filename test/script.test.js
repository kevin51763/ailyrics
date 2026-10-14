import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScript, fallbackScript, sceneIndexAt, TEMPLATES } from '../public/js/script.js';

test('normalizes a messy script from the model', () => {
  const script = normalizeScript(
    {
      mood: '雨夜',
      palette: ['#112233', 'red', '#AABBCC'],
      background: 'black',
      font: 'comic',
      scenes: [
        { at: 30, template: 'rain', intensity: 3, speed: -1, text: 'split', transition: 'flash' },
        { at: 5, template: 'lasers', density: '0.7', accent: 9 },
        { at: 30.5, template: 'grid' },
        { at: 999, template: 'waves' },
      ],
      highlights: [2, 2, 50, -1, 'x'],
    },
    { duration: 200, lineCount: 10 },
  );

  assert.deepEqual(script.palette, ['#112233', '#AABBCC', '#4d9078']);
  assert.match(script.background, /^#[0-9a-f]{6}$/);
  assert.equal(script.font, 'sans');
  assert.equal(script.scenes.length, 2, 'drops the scene past the end and the one 0.5s after another');
  assert.equal(script.scenes[0].at, 0, 'first scene starts at zero');
  assert.equal(script.scenes[0].template, 'particles', 'unknown template falls back');
  assert.equal(script.scenes[0].density, 0.7);
  assert.equal(script.scenes[0].accent, 2, 'accent clamped to the palette');
  assert.equal(script.scenes[1].intensity, 1);
  assert.equal(script.scenes[1].speed, 0);
  assert.deepEqual(script.highlights, [2]);
});

test('rejects a script without scenes', () => {
  assert.throws(() => normalizeScript({ palette: [] }), /no scenes/);
  assert.throws(() => normalizeScript(null), /not an object/);
});

test('treats an unknown duration as unbounded', () => {
  const script = normalizeScript({ scenes: [{ at: 0 }, { at: 50 }] }, { duration: 0 });
  assert.equal(script.scenes.length, 2);
});

test('fallback script is deterministic and valid', () => {
  const lines = [
    { time: 10, text: 'a' },
    { time: 12, text: 'b' },
    { time: 30, text: 'c' },
    { time: 60, text: 'd' },
    { time: 90, text: 'e' },
  ];
  const a = fallbackScript({ title: 'T', artist: 'A', lines, duration: 120 });
  const b = fallbackScript({ title: 'T', artist: 'A', lines, duration: 120 });
  assert.deepEqual(a, b);
  assert.ok(a.scenes.length >= 3);
  for (const s of a.scenes) assert.ok(Object.hasOwn(TEMPLATES, s.template));
  assert.notDeepEqual(fallbackScript({ title: 'Other', lines, duration: 120 }).palette, a.palette);
});

test('finds the scene playing at a given time', () => {
  const scenes = [{ at: 0 }, { at: 10 }, { at: 20 }];
  assert.equal(sceneIndexAt(scenes, 0), 0);
  assert.equal(sceneIndexAt(scenes, 15), 1);
  assert.equal(sceneIndexAt(scenes, 25), 2);
});
