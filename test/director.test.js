import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, directSong, parseJson } from '../lib/director.js';

const song = {
  title: '夜航',
  artist: '某乐队',
  duration: 125.4,
  lines: [
    { time: 0, text: '' },
    { time: 12.5, text: '第一句' },
  ],
};

const reply = (content) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

test('puts numbered, timed lyrics in the prompt', () => {
  const [system, user] = buildMessages(song);
  assert.match(system.content, /JSON/);
  assert.match(user.content, /歌名：夜航/);
  assert.match(user.content, /时长：02:05\.40/);
  assert.match(user.content, /\[0\] 00:00\.00 （间奏）/);
  assert.match(user.content, /\[1\] 00:12\.50 第一句/);
});

test('calls the chat completions endpoint and normalizes the reply', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return reply(JSON.stringify({ palette: ['#ff0000', '#00ff00', '#0000ff'], scenes: [{ at: 0, template: 'rings' }] }));
  };
  const script = await directSong(song, { apiKey: 'k', baseUrl: 'https://api.example.com/', model: 'm', fetchImpl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/chat/completions');
  assert.equal(calls[0].auth, 'Bearer k');
  assert.equal(calls[0].body.model, 'm');
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  assert.equal(script.scenes[0].template, 'rings');
});

test('retries once on an unusable reply', async () => {
  const replies = ['not json', JSON.stringify({ scenes: [{ at: 0, template: 'grid' }] })];
  const fetchImpl = async () => reply(replies.shift());
  const script = await directSong(song, { apiKey: 'k', baseUrl: 'x', model: 'm', fetchImpl });
  assert.equal(script.scenes[0].template, 'grid');
});

test('reports API errors', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'bad key' });
  await assert.rejects(directSong(song, { apiKey: 'k', baseUrl: 'x', model: 'm', fetchImpl }), /401: bad key/);
});

test('parses JSON inside a code fence', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
});
