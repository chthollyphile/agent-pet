// 聊天设提醒（本地分支功能）：模型在聊天回复里附带结构化指令，这里校验并执行。
// 纯逻辑（无 QML 依赖），QML 以 import "lib/reminders.mjs" 导入，node 可直接单测。
//
// 模型只负责理解自然语言，给出结构化结果；时间计算、校验、存储和到点触发都在本地完成。
// 聊天回复 JSON 里的 "reminders" 数组，元素为：
//   { "type": "add", "text": "喝水", "in_minutes": 10 }                     相对时间
//   { "type": "add", "text": "开会", "at": "2026-10-09 15:00" }             具体时刻（本地时间）
//   { "type": "add", "text": "站会", "repeat": "daily", "time": "09:00" }  每天 / 工作日（weekdays）
//   { "type": "cancel", "ids": [1, 2] }                                     编号来自提示词里的当前列表
//   { "type": "list" }
//
// 存储的提醒：{ id, text, due（下次触发的毫秒时间戳）, repeat: 'none' | 'daily' | 'weekdays', h, m }

/** 相对提醒最长一年 */
const MAX_IN_MINUTES = 366 * 24 * 60;
/** 一次聊天最多处理几条指令 */
const MAX_ACTIONS = 10;
/** 提醒内容上限 */
const MAX_TEXT = 100;

const pad = (n) => String(n).padStart(2, '0');
const isWeekday = (d) => d.getDay() >= 1 && d.getDay() <= 5;

/** 每天 / 工作日 h:m 的下一次触发时间（严格晚于 now） */
export function nextDaily(now, h, m, repeat) {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  while (repeat === 'weekdays' && !isWeekday(d)) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** "HH:MM" → { h, m }；非法返回 null */
function parseHm(s) {
  const r = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!r || Number(r[1]) > 23 || Number(r[2]) > 59) return null;
  return { h: Number(r[1]), m: Number(r[2]) };
}

/** "YYYY-MM-DD HH:MM"（本地时间）→ 毫秒；非法返回 NaN */
function parseLocal(s) {
  const r = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!r) return NaN;
  const [y, mo, d, h, mi] = r.slice(1).map(Number);
  const t = new Date(y, mo - 1, d, h, mi, 0, 0);
  // 拒绝 2 月 30 日这类被 Date 自动进位的日期
  if (t.getMonth() !== mo - 1 || t.getDate() !== d || h > 23 || mi > 59) return NaN;
  return t.getTime();
}

const cleanText = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/** 列表顺序 = 按下次触发时间排序；提示词里的编号和取消用的都是这个顺序（从 1 起） */
export const sorted = (list) => (list || []).slice().sort((a, b) => a.due - b.due);

/** 「什么时候」：10:42 / 明天 09:30 / 10月12日 09:30 / 每天 18:30 / 工作日 09:00 */
export function formatWhen(r, now, lang) {
  const en = lang === 'en';
  if (r.repeat === 'daily') return (en ? 'every day at ' : '每天 ') + pad(r.h) + ':' + pad(r.m);
  if (r.repeat === 'weekdays') return (en ? 'weekdays at ' : '工作日 ') + pad(r.h) + ':' + pad(r.m);
  const d = new Date(r.due);
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes()) + (r.due - now < 120000 ? ':' + pad(d.getSeconds()) : '');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (days === 0) return hm;
  if (days === 1) return (en ? 'tomorrow ' : '明天 ') + hm;
  return en ? d.getMonth() + 1 + '/' + d.getDate() + ' ' + hm : d.getMonth() + 1 + '月' + d.getDate() + '日 ' + hm;
}

/** 一行：「15:00 开会」 */
export const formatLine = (r, now, lang) => formatWhen(r, now, lang) + ' ' + (r.text || (lang === 'en' ? '(reminder)' : '（提醒）'));

const WEEKDAYS = { zh: ['日', '一', '二', '三', '四', '五', '六'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };

/** 提示词变量：当前时间、星期几、当前提醒列表（带编号） */
export function promptVars(list, now, lang) {
  const d = new Date(now);
  const en = lang === 'en';
  const items = sorted(list).map((r, i) => '#' + (i + 1) + ' ' + formatLine(r, now, lang));
  return {
    now: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()),
    weekday: en ? WEEKDAYS.en[d.getDay()] : '星期' + WEEKDAYS.zh[d.getDay()],
    list: items.length ? items.join(en ? '; ' : '；') : en ? 'none' : '无',
  };
}

/** 一条 add 指令 → 提醒；非法返回 { error }。error 是给 i18n 用的 key */
export function toReminder(a, now, id) {
  const text = cleanText(a.text);
  if (a.repeat === 'daily' || a.repeat === 'weekdays') {
    const hm = parseHm(a.time);
    if (!hm) return { error: 'remindBadTime' };
    return { id, text, due: nextDaily(now, hm.h, hm.m, a.repeat), repeat: a.repeat, h: hm.h, m: hm.m };
  }
  let due;
  if (a.in_minutes !== undefined) {
    const n = Number(a.in_minutes);
    if (!(n > 0 && n <= MAX_IN_MINUTES)) return { error: 'remindBadTime' };
    due = now + Math.round(n * 60000);
  } else {
    due = parseLocal(a.at);
    if (!isFinite(due)) return { error: 'remindBadTime' };
    // 模型按分钟给时间：本分钟内的也算已过
    if (due <= now) return { error: 'remindPast' };
  }
  const d = new Date(due);
  return { id, text, due, repeat: 'none', h: d.getHours(), m: d.getMinutes() };
}

/**
 * 执行模型给出的指令。返回 { list, added, canceled, errors, showList }：
 * added / canceled = 提醒数组；errors = i18n key 数组；showList = 要展示当前列表。
 * cancel 的编号指执行前的列表（与提示词里给模型看的一致）。
 */
export function apply(list, actions, now) {
  const before = sorted(list);
  const out = { list: before.slice(), added: [], canceled: [], errors: [], showList: false };
  if (!Array.isArray(actions)) return out;
  let seq = 0;
  for (const a of actions.slice(0, MAX_ACTIONS)) {
    if (!a || typeof a !== 'object') continue;
    if (a.type === 'add') {
      const r = toReminder(a, now, now + '-' + seq++);
      if (r.error) out.errors.push(r.error);
      else {
        out.list.push(r);
        out.added.push(r);
      }
    } else if (a.type === 'cancel') {
      const ids = (Array.isArray(a.ids) ? a.ids : [a.ids]).map(Number);
      for (const n of ids) {
        const target = before[n - 1];
        if (!target || out.canceled.includes(target)) continue;
        out.canceled.push(target);
        out.list = out.list.filter((r) => r !== target);
      }
    } else if (a.type === 'list') {
      out.showList = true;
    }
  }
  out.list = sorted(out.list);
  return out;
}

/**
 * 到期处理：返回 { fired: [{ reminder, late }], list: 更新后的列表 }。
 * 重复提醒排到下一次；一次性提醒删除。late = 晚了 2 分钟以上（关机或挂起期间错过）。
 */
export function collectDue(list, now) {
  const fired = [];
  const next = [];
  for (const r of list || []) {
    if (r.due > now) {
      next.push(r);
      continue;
    }
    fired.push({ reminder: r, late: now - r.due > 120000 });
    if (r.repeat === 'daily' || r.repeat === 'weekdays') next.push(Object.assign({}, r, { due: nextDaily(now, r.h, r.m, r.repeat) }));
  }
  return { fired, list: sorted(next) };
}

/** 从文件读出的列表：丢掉结构不对的条目 */
export function sanitize(list) {
  if (!Array.isArray(list)) return [];
  return sorted(
    list.filter(
      (r) => r && typeof r === 'object' && isFinite(r.due) && ['none', 'daily', 'weekdays'].includes(r.repeat)
        && r.h >= 0 && r.h <= 23 && r.m >= 0 && r.m <= 59,
    ).map((r) => Object.assign({}, r, { text: cleanText(r.text) })),
  );
}
