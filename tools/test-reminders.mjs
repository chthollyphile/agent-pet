// lib/reminders.mjs 单测：node --test tools/test-reminders.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../lib/reminders.mjs';

// 2026-10-09（周五）14:00:00
const NOW = new Date(2026, 9, 9, 14, 0, 0).getTime();
const at = (day, h, m) => new Date(2026, 9, day, h, m, 0).getTime();

test('toReminder: 相对时间', () => {
  const r = R.toReminder({ type: 'add', text: ' 喝水 ', in_minutes: 10 }, NOW, 'x');
  assert.equal(r.due, NOW + 600000);
  assert.equal(r.text, '喝水');
  assert.equal(r.repeat, 'none');
  assert.equal(R.toReminder({ in_minutes: 0.5 }, NOW, 'x').due, NOW + 30000);
  assert.deepEqual(R.toReminder({ in_minutes: 0 }, NOW, 'x'), { error: 'remindBadTime' });
  assert.deepEqual(R.toReminder({ in_minutes: 'abc' }, NOW, 'x'), { error: 'remindBadTime' });
  assert.deepEqual(R.toReminder({ in_minutes: 10 ** 9 }, NOW, 'x'), { error: 'remindBadTime' });
});

test('toReminder: 具体时刻', () => {
  const r = R.toReminder({ text: '开会', at: '2026-10-09 15:00' }, NOW, 'x');
  assert.equal(r.due, at(9, 15, 0));
  assert.equal(r.h, 15);
  assert.deepEqual(R.toReminder({ at: '2026-10-09 14:00' }, NOW, 'x'), { error: 'remindPast' });
  assert.deepEqual(R.toReminder({ at: '2026-10-09 09:00' }, NOW, 'x'), { error: 'remindPast' });
  assert.deepEqual(R.toReminder({ at: '2026-02-30 09:00' }, NOW, 'x'), { error: 'remindBadTime' });
  assert.deepEqual(R.toReminder({ at: '明天 9 点' }, NOW, 'x'), { error: 'remindBadTime' });
  assert.deepEqual(R.toReminder({ text: 'x' }, NOW, 'x'), { error: 'remindBadTime' });
});

test('toReminder: 重复', () => {
  let r = R.toReminder({ text: '站会', repeat: 'daily', time: '09:00' }, NOW, 'x');
  assert.equal(r.due, at(10, 9, 0));
  r = R.toReminder({ text: '下班', repeat: 'weekdays', time: '18:30' }, NOW, 'x');
  assert.equal(r.due, at(9, 18, 30));
  assert.deepEqual(R.toReminder({ repeat: 'daily', time: '25:00' }, NOW, 'x'), { error: 'remindBadTime' });
  // 周五 19:00 之后的工作日提醒 → 下周一
  assert.equal(R.nextDaily(at(9, 19, 0), 18, 30, 'weekdays'), at(12, 18, 30));
});

test('apply: 添加、取消、列出', () => {
  const list = [
    { id: 'a', text: '晚饭', due: at(9, 18, 0), repeat: 'none', h: 18, m: 0 },
    { id: 'b', text: '喝水', due: at(9, 14, 10), repeat: 'none', h: 14, m: 10 },
  ];
  // 提示词里的编号：#1 喝水（14:10）#2 晚饭（18:00）
  const res = R.apply(list, [
    { type: 'cancel', ids: [1] },
    { type: 'add', text: '开会', at: '2026-10-09 15:00' },
    { type: 'add', text: '过去', at: '2026-10-09 09:00' },
    { type: 'list' },
    'junk',
  ], NOW);
  assert.deepEqual(res.canceled.map((r) => r.id), ['b']);
  assert.deepEqual(res.added.map((r) => r.text), ['开会']);
  assert.deepEqual(res.errors, ['remindPast']);
  assert.equal(res.showList, true);
  assert.deepEqual(res.list.map((r) => r.text), ['开会', '晚饭']);
  assert.deepEqual(R.apply(list, undefined, NOW).list.length, 2);
  // 编号越界、重复取消都忽略
  assert.equal(R.apply(list, [{ type: 'cancel', ids: [2, 2, 9] }], NOW).canceled.length, 1);
});

test('promptVars 与格式', () => {
  const list = [{ id: 'a', text: '站会', repeat: 'daily', h: 9, m: 0, due: at(10, 9, 0) }];
  assert.deepEqual(R.promptVars(list, NOW, 'zh'), { now: '2026-10-09 14:00', weekday: '星期五', list: '#1 每天 09:00 站会' });
  assert.equal(R.promptVars([], NOW, 'en').list, 'none');
  assert.equal(R.formatWhen({ due: at(9, 15, 0) }, NOW, 'zh'), '15:00');
  assert.equal(R.formatWhen({ due: at(10, 9, 30) }, NOW, 'zh'), '明天 09:30');
  assert.equal(R.formatWhen({ due: at(12, 9, 0) }, NOW, 'zh'), '10月12日 09:00');
  assert.equal(R.formatWhen({ due: NOW + 30000 }, NOW, 'zh'), '14:00:30');
  assert.equal(R.formatWhen({ repeat: 'weekdays', h: 18, m: 30 }, NOW, 'en'), 'weekdays at 18:30');
  assert.equal(R.formatLine({ due: at(9, 15, 0), text: '' }, NOW, 'zh'), '15:00 （提醒）');
});

test('collectDue', () => {
  const list = [
    { id: 1, text: 'a', due: NOW - 1000, repeat: 'none', h: 13, m: 59 },
    { id: 2, text: 'b', due: NOW - 3600000, repeat: 'daily', h: 13, m: 0 },
    { id: 3, text: 'c', due: NOW + 1000, repeat: 'none', h: 14, m: 0 },
  ];
  const { fired, list: next } = R.collectDue(list, NOW);
  assert.deepEqual(fired.map((f) => [f.reminder.id, f.late]), [[1, false], [2, true]]);
  assert.deepEqual(next.map((r) => r.id), [3, 2]);
  assert.equal(next[1].due, at(10, 13, 0));
});

test('sanitize', () => {
  const ok = { id: 1, text: 'a', due: NOW, repeat: 'none', h: 1, m: 2 };
  assert.deepEqual(R.sanitize([ok, null, { ...ok, repeat: 'x' }, { ...ok, due: 'x' }, { ...ok, h: 24 }]), [ok]);
  assert.deepEqual(R.sanitize({}), []);
});
