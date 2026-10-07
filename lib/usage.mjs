// omarchy.agents 用量记录（~/.local/state/omarchy/agents/usage/<agent>.json）→ 余额动画档位 + 气泡文案。
// limits[].percent 是 0–1 的小数（omarchy agents Panel.qml 同口径）。

/** 档位与 dsh-pet 的 events.balance 一致：0–4 每 20% 一档，用满（≥100%）单独为 5 */
export function tierOf(p) {
  if (!(p >= 0)) return -1;
  if (p >= 1) return 5;
  return Math.min(4, Math.floor(p * 5));
}

const SHORT_LABELS = [
  [/5-?h|session/i, '5h'],
  [/week|7-day/i, '周'],
];

function shortLabel(label) {
  for (const [re, short] of SHORT_LABELS) if (re.test(label)) return label.match(/fable|opus|sonnet/i) ? label : short;
  return label;
}

function resetIn(resetsAt, now) {
  const t = Date.parse(resetsAt);
  if (!Number.isFinite(t) || t <= now) return '';
  const h = (t - now) / 3600000;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' 分钟';
  if (h < 48) return Math.round(h) + ' 小时';
  return Math.round(h / 24) + ' 天';
}

/**
 * 解析一份用量记录。返回 null = 记录不可用（缺失 / 未登录 / 没有限额窗口）。
 * { agent, name, percent, tier, text }：percent 取最紧张的窗口。
 */
export function summarize(record, now) {
  if (!record || !Array.isArray(record.limits)) return null;
  const windows = record.limits
    .map((l) => ({ label: String(l.label || ''), percent: Number(l.percent), resetsAt: l.resetsAt || '' }))
    .filter((w) => w.percent >= 0);
  if (!windows.length) return null;
  let worst = windows[0];
  for (const w of windows) if (w.percent > worst.percent) worst = w;
  const parts = windows.map((w) => shortLabel(w.label) + ' ' + Math.round(w.percent * 100) + '%');
  const reset = resetIn(worst.resetsAt, now);
  return {
    agent: record.id || '',
    name: record.name || record.id || '',
    percent: worst.percent,
    tier: tierOf(worst.percent),
    text: (record.name || record.id) + ' · ' + parts.join(' · ') + (reset ? '\n' + shortLabel(worst.label) + '额度 ' + reset + '后重置' : ''),
  };
}
