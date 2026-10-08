// lib/segments.mjs 单测：node --test tools/test-segments.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../lib/segments.mjs';

test('按换行分段，短句并进相邻段', () => {
  assert.deepEqual(S.split('', 'zh'), []);
  assert.deepEqual(S.split('好的！', 'zh'), ['好的！']);
  const long1 = '今天的天气很不错，阳光明媚，适合出去走走散散步，顺便买点水果回来。';
  const long2 = '不过下午可能有阵雨，出门记得带把伞哦，别淋湿了感冒了可就不好啦。';
  assert.deepEqual(S.split('嗯嗯\n' + long1 + '\n\n' + long2, 'zh'), ['嗯嗯\n' + long1, long2]);
});

test('一段太长按句子切，句子太长按逗号切，再不行硬切', () => {
  const text = '第一句话说的是今天上午的计划安排和要见的人。第二句话讲的是明天下午要做的几件事情！第三句话问你周末有没有空一起吃饭？';
  const segs = S.split(text, 'zh');
  assert.ok(segs.length >= 2, segs);
  assert.equal(segs.join(''), text);
  assert.ok(segs.every((s) => s.length <= 50), segs);
  const clauses = '这是一个没有句号但是有很多逗号的长句子，' .repeat(5);
  assert.ok(S.split(clauses, 'zh').every((s) => s.length <= 50));
  const hard = '啊'.repeat(120);
  assert.deepEqual(S.split(hard, 'zh').map((s) => s.length), [50, 50, 20]);
});

test('英文按句子切，不在缩写小数点处断', () => {
  const text = 'Quickshell 0.3.2 is the latest release. It came out on October 8 and fixes several bugs in the layer shell. '
    + 'You can update it from the AUR with your usual helper. Let me know if anything breaks!';
  const segs = S.split(text, 'en');
  assert.ok(segs.length >= 2, segs);
  assert.ok(segs[0].startsWith('Quickshell 0.3.2 is'), segs);
  assert.ok(segs.every((s) => s.length <= 120), segs);
});

test('duration', () => {
  assert.equal(S.duration('短', 'zh', false), 4000);
  assert.equal(S.duration('短', 'zh', true), 8000);
  assert.equal(S.duration('字'.repeat(40), 'zh', false), 8800);
  assert.equal(S.duration('字'.repeat(200), 'zh', false), 15000);
});

test('escapeNewlinesInStrings', () => {
  const raw = '{\n  "text": "第一段\n第二段",\n  "meme": ""\n}';
  assert.throws(() => JSON.parse(raw));
  assert.deepEqual(JSON.parse(S.escapeNewlinesInStrings(raw)), { text: '第一段\n第二段', meme: '' });
  const ok = '{"text": "a\\nb \\"q\\""}';
  assert.equal(S.escapeNewlinesInStrings(ok), ok);
});
