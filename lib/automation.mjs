// 自动化（本地分支功能）：整点报时、定时任务、事件触发规则。
// 纯逻辑（无 QML 依赖），QML 以 import "lib/automation.mjs" 导入，node 可直接单测。
//
// 配置 automations：
//   chime: { enabled, from, to, text, anims, quietWhenBusy }
//   tasks: [{ name, every | at, run, say, play, when, skipWhenBusy, timeoutSec, pet }]
//   rules: [{ name, event, agent, tool, detail, message, project, run, say, play, cooldownSec, timeoutSec, pet }]
// 事件内容（命令、消息、提示词）只通过模板进气泡、通过 stdin 进 run 命令，从不拼进进程参数。

/** 整点报时默认动画：按小时挑，"*" = 其他整点 */
export const DEFAULT_CHIME_ANIMS = {
  7: ['晨间刷牙', '吃早餐'],
  8: ['吃早餐', '超大伸懒腰'],
  12: ['吃午餐'],
  15: ['超大伸懒腰'],
  18: ['吃晚餐'],
  22: ['哈欠连天'],
  23: ['哈欠连天', '原地小憩沉眠'],
  '*': ['点击回应-元气挥手'],
};

/** run 命令默认超时（秒） */
export const DEFAULT_TIMEOUT_SEC = 30;
/** 定时任务最短间隔（秒）：调度器每 15 秒检查一次，再短没有意义 */
export const MIN_EVERY_SEC = 30;
/** 命令输出进气泡前的上限 */
export const OUTPUT_MAX_CHARS = 200;

const asList = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);

/** 用户写的正则：非法时返回 { error }，调用方报一次警告并让该规则失效 */
function compile(pattern, where) {
  if (pattern === undefined || pattern === null || pattern === '') return { re: null };
  try {
    return { re: new RegExp(String(pattern)) };
  } catch (e) {
    return { error: where + ': ' + e.message };
  }
}

/** "HH:MM" → 当天分钟数；非法返回 -1 */
export function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return -1;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : -1;
}

/** run：字符串交给 bash -c，数组原样当 argv；其他 = 不运行 */
function normalizeRun(run) {
  if (typeof run === 'string' && run.trim()) return ['bash', '-c', run];
  if (Array.isArray(run) && run.length && run.every((a) => typeof a === 'string')) return run.slice();
  return null;
}

function normalizeTimeout(v) {
  const n = Number(v);
  return n > 0 ? n : DEFAULT_TIMEOUT_SEC;
}

/**
 * 配置 → 运行时结构。无效条目跳过并记进 errors（不抛异常，配置写错不影响其他条目）。
 * 返回 { chime, tasks, rules, errors }
 */
export function normalize(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const errors = [];

  const c = cfg.chime && typeof cfg.chime === 'object' ? cfg.chime : {};
  const hour = (v, d) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23 ? Number(v) : d);
  const chime = {
    enabled: c.enabled === true,
    from: hour(c.from, 8),
    to: hour(c.to, 23),
    text: typeof c.text === 'string' ? c.text : '',
    anims: c.anims && typeof c.anims === 'object' ? c.anims : DEFAULT_CHIME_ANIMS,
    quietWhenBusy: c.quietWhenBusy !== false,
  };

  const tasks = [];
  asList(cfg.tasks).forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    const key = t.name ? String(t.name) : '#' + i;
    const at = asList(t.at).map(parseClock);
    const every = Number(t.every);
    if (at.some((m) => m < 0)) {
      errors.push('tasks[' + key + '].at: 时间格式应为 HH:MM');
      return;
    }
    if (!at.length && !(every > 0)) {
      errors.push('tasks[' + key + ']: 需要 every（秒）或 at（HH:MM）');
      return;
    }
    const run = normalizeRun(t.run);
    if (t.run !== undefined && !run) {
      errors.push('tasks[' + key + '].run: 应为字符串或字符串数组');
      return;
    }
    tasks.push({
      key,
      every: at.length ? 0 : Math.max(MIN_EVERY_SEC, every),
      at,
      run,
      say: typeof t.say === 'string' ? t.say : run ? '{output}' : '',
      play: asList(t.play).map(String),
      // 没有 run 的提醒每次都说；有 run 的默认只在输出变化时说
      when: ['always', 'changed', 'fail', 'success'].includes(t.when) ? t.when : run ? 'changed' : 'always',
      skipWhenBusy: t.skipWhenBusy === true,
      timeoutSec: normalizeTimeout(t.timeoutSec),
      pet: t.pet ? String(t.pet) : '',
    });
  });

  const rules = [];
  asList(cfg.rules).forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const key = r.name ? String(r.name) : '#' + i;
    const events = asList(r.event).map(String);
    if (!events.length) {
      errors.push('rules[' + key + ']: 需要 event');
      return;
    }
    const res = {};
    let bad = false;
    for (const f of ['detail', 'message', 'project']) {
      const c2 = compile(r[f], 'rules[' + key + '].' + f);
      if (c2.error) {
        errors.push(c2.error);
        bad = true;
      }
      res[f] = c2.re;
    }
    if (bad) return;
    const run = normalizeRun(r.run);
    if (r.run !== undefined && !run) {
      errors.push('rules[' + key + '].run: 应为字符串或字符串数组');
      return;
    }
    rules.push({
      key,
      events,
      agents: asList(r.agent).map(String),
      tools: asList(r.tool).map(String),
      detail: res.detail,
      message: res.message,
      project: res.project,
      run,
      say: typeof r.say === 'string' ? r.say : '',
      play: asList(r.play).map(String),
      cooldownSec: Math.max(0, Number(r.cooldownSec) || 0),
      timeoutSec: normalizeTimeout(r.timeoutSec),
      pet: r.pet ? String(r.pet) : '',
    });
  });

  return { chime, tasks, rules, errors };
}

/** 项目名 = cwd 的最后一段 */
export const projectOf = (cwd) => String(cwd || '').replace(/\/+$/, '').split('/').pop() || '';

/** 模板变量：hook 事件 → 规则可用的 {name} */
export function eventVars(ev) {
  const agent = ev.agent || '';
  return {
    agent,
    agentName: agent === 'codex' ? 'Codex' : agent === 'claude' ? 'Claude Code' : agent,
    event: ev.event || '',
    tool: ev.tool || '',
    detail: ev.detail || '',
    message: ev.message || '',
    project: projectOf(ev.cwd),
    cwd: ev.cwd || '',
  };
}

/** 规则是否匹配事件（不含冷却判断） */
export function matchRule(rule, ev) {
  if (!rule.events.includes(ev.event)) return false;
  if (rule.agents.length && !rule.agents.includes(ev.agent)) return false;
  if (rule.tools.length && !rule.tools.includes(ev.tool)) return false;
  if (rule.detail && !rule.detail.test(ev.detail || '')) return false;
  if (rule.message && !rule.message.test(ev.message || '')) return false;
  if (rule.project && !rule.project.test(projectOf(ev.cwd))) return false;
  return true;
}

/** 替换 {name} 占位；未知变量保留原样，方便发现写错 */
export function render(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m,
  );
}

/** 命令输出 → 气泡文本：去掉 ANSI 颜色和首尾空白，截断 */
export function cleanOutput(text) {
  // eslint-disable-next-line no-control-regex
  const s = String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
  return s.length > OUTPUT_MAX_CHARS ? s.slice(0, OUTPUT_MAX_CHARS - 1) + '…' : s;
}

/** 定时任务跑完后要不要说：prev = 上次输出（首次运行为 undefined） */
export function taskShouldSpeak(when, output, exitCode, prev) {
  switch (when) {
    case 'always':
      return true;
    case 'fail':
      return exitCode !== 0;
    case 'success':
      return exitCode === 0;
    default:
      // changed：第一次只记基线，不说
      return prev !== undefined && prev !== output;
  }
}

/** 是否在报时时段内：from > to 表示跨午夜（如 22 → 2） */
export function inChimeHours(hour, from, to) {
  return from <= to ? hour >= from && hour <= to : hour >= from || hour <= to;
}

/** 该整点的候选动画 */
export function chimeAnims(anims, hour) {
  const a = anims || {};
  return asList(a[hour] ?? a[String(hour)] ?? a['*']).map(String);
}

/**
 * 调度：给定当前时间和上次检查时间，判断哪些事该做。纯函数，按墙上时钟判断，挂起恢复后不会错乱。
 * state = { chimed: 'YYYY-MM-DD HH', due: { key: ms }, firedAt: { key: 'YYYY-MM-DD HH:MM' } }
 * 返回 { chime: hour | -1, tasks: [key] }，并就地更新 state。
 */
export function tick(state, norm, now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hourKey = day + ' ' + pad(d.getHours());
  const out = { chime: -1, tasks: [] };

  // 整点后 2 分钟内补报一次（调度粒度 15 秒，挂起恢复后不补报更早的整点）
  if (norm.chime.enabled && d.getMinutes() < 2 && state.chimed !== hourKey) {
    state.chimed = hourKey;
    if (inChimeHours(d.getHours(), norm.chime.from, norm.chime.to)) out.chime = d.getHours();
  }

  const minutes = d.getHours() * 60 + d.getMinutes();
  const due = state.due || (state.due = {});
  const fired = state.firedAt || (state.firedAt = {});
  for (const t of norm.tasks) {
    if (t.at.length) {
      // 到点后 2 分钟内触发一次
      const hit = t.at.find((m) => minutes >= m && minutes - m < 2);
      if (hit === undefined) continue;
      const stamp = day + ' ' + hit;
      if (fired[t.key] === stamp) continue;
      fired[t.key] = stamp;
      out.tasks.push(t.key);
    } else {
      // 首次立即跑一次（changed 模式据此记基线）
      if (due[t.key] === undefined || now >= due[t.key]) {
        due[t.key] = now + t.every * 1000;
        out.tasks.push(t.key);
      }
    }
  }
  return out;
}
