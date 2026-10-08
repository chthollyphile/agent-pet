// lib/automation.mjs 单测：node --test tools/test-automation.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../lib/automation.mjs';

const at = (h, m, day = 9) => new Date(2026, 9, day, h, m, 0).getTime();

test('normalize: 默认值与无效条目', () => {
  const n = A.normalize({
    chime: { enabled: true },
    tasks: [
      { name: 'ci', every: 5, run: 'gh run list' },
      { name: 'standup', at: '09:30', say: '开站会' },
      { name: 'bad-at', at: '25:00' },
      { name: 'no-schedule', run: 'true' },
    ],
    rules: [
      { name: 'commit', event: 'PostToolUse', tool: 'Bash', detail: '^git commit', play: '放烟花' },
      { name: 'bad-re', event: 'Stop', detail: '(' },
      { name: 'no-event', say: 'x' },
    ],
  });
  assert.equal(n.chime.enabled, true);
  assert.equal(n.chime.from, 8);
  assert.deepEqual(n.tasks.map((t) => t.key), ['ci', 'standup']);
  assert.equal(n.tasks[0].every, A.MIN_EVERY_SEC);
  assert.deepEqual(n.tasks[0].run, ['bash', '-c', 'gh run list']);
  assert.equal(n.tasks[0].say, '{output}');
  assert.equal(n.tasks[0].when, 'changed');
  assert.equal(n.tasks[1].when, 'always');
  assert.deepEqual(n.rules.map((r) => r.key), ['commit']);
  assert.equal(n.errors.length, 4);
});

test('normalize: 空配置', () => {
  const n = A.normalize(undefined);
  assert.equal(n.chime.enabled, false);
  assert.deepEqual(n.tasks, []);
  assert.deepEqual(n.rules, []);
  assert.deepEqual(n.errors, []);
});

test('matchRule', () => {
  const [rule] = A.normalize({
    rules: [{ event: ['PostToolUse'], agent: 'claude', tool: 'Bash', detail: '^git commit', project: '^agent-' }],
  }).rules;
  const ev = { event: 'PostToolUse', agent: 'claude', tool: 'Bash', detail: 'git commit -m x', cwd: '/home/u/agent-pet' };
  assert.equal(A.matchRule(rule, ev), true);
  assert.equal(A.matchRule(rule, { ...ev, agent: 'codex' }), false);
  assert.equal(A.matchRule(rule, { ...ev, detail: 'git status' }), false);
  assert.equal(A.matchRule(rule, { ...ev, cwd: '/tmp/other' }), false);
  assert.equal(A.matchRule(rule, { ...ev, event: 'Stop' }), false);
});

test('render 与 eventVars', () => {
  const vars = A.eventVars({ agent: 'codex', event: 'Stop', cwd: '/x/proj/' });
  assert.equal(A.render('{agentName} 在 {project} 完成了 {unknown}', vars), 'Codex 在 proj 完成了 {unknown}');
});

test('cleanOutput 去颜色并截断', () => {
  assert.equal(A.cleanOutput('\x1b[32mok\x1b[0m\n'), 'ok');
  const long = A.cleanOutput('x'.repeat(500));
  assert.equal(long.length, A.OUTPUT_MAX_CHARS);
  assert.ok(long.endsWith('…'));
});

test('taskShouldSpeak', () => {
  assert.equal(A.taskShouldSpeak('changed', 'a', 0, undefined), false);
  assert.equal(A.taskShouldSpeak('changed', 'a', 0, 'a'), false);
  assert.equal(A.taskShouldSpeak('changed', 'b', 0, 'a'), true);
  assert.equal(A.taskShouldSpeak('fail', '', 1, undefined), true);
  assert.equal(A.taskShouldSpeak('success', '', 1, undefined), false);
  assert.equal(A.taskShouldSpeak('always', '', 1, 'x'), true);
});

test('inChimeHours 支持跨午夜', () => {
  assert.equal(A.inChimeHours(7, 8, 23), false);
  assert.equal(A.inChimeHours(23, 8, 23), true);
  assert.equal(A.inChimeHours(1, 22, 2), true);
  assert.equal(A.inChimeHours(12, 22, 2), false);
});

test('chimeAnims 按小时，回退到 *', () => {
  assert.deepEqual(A.chimeAnims(A.DEFAULT_CHIME_ANIMS, 12), ['吃午餐']);
  assert.deepEqual(A.chimeAnims(A.DEFAULT_CHIME_ANIMS, 10), ['点击回应-元气挥手']);
  assert.deepEqual(A.chimeAnims({ 10: '写代码' }, 10), ['写代码']);
  assert.deepEqual(A.chimeAnims({}, 10), []);
});

test('tick: 整点报时每小时一次、时段外不报', () => {
  const norm = A.normalize({ chime: { enabled: true, from: 8, to: 22 } });
  const st = {};
  assert.equal(A.tick(st, norm, at(9, 59)).chime, -1);
  assert.equal(A.tick(st, norm, at(10, 0)).chime, 10);
  assert.equal(A.tick(st, norm, at(10, 1)).chime, -1);
  assert.equal(A.tick(st, norm, at(10, 30)).chime, -1);
  assert.equal(A.tick(st, norm, at(23, 0)).chime, -1);
  // 挂起恢复后已过整点 2 分钟：不补报
  assert.equal(A.tick(st, norm, at(11, 5)).chime, -1);
});

test('tick: every 任务首次立即跑，之后按间隔', () => {
  const norm = A.normalize({ tasks: [{ name: 'a', every: 60, run: 'true' }] });
  const st = {};
  const t0 = at(10, 0);
  assert.deepEqual(A.tick(st, norm, t0).tasks, ['a']);
  assert.deepEqual(A.tick(st, norm, t0 + 30000).tasks, []);
  assert.deepEqual(A.tick(st, norm, t0 + 60000).tasks, ['a']);
});

test('tick: at 任务每天每个时间点一次', () => {
  const norm = A.normalize({ tasks: [{ name: 'b', at: ['09:30', '18:00'], say: 'x' }] });
  const st = {};
  assert.deepEqual(A.tick(st, norm, at(9, 29)).tasks, []);
  assert.deepEqual(A.tick(st, norm, at(9, 30)).tasks, ['b']);
  assert.deepEqual(A.tick(st, norm, at(9, 31)).tasks, []);
  assert.deepEqual(A.tick(st, norm, at(18, 0)).tasks, ['b']);
  assert.deepEqual(A.tick(st, norm, at(9, 30, 10)).tasks, ['b']);
});
