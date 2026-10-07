// dsh-pet 的 assets/config.jsonc → assets/config.json（去注释），并套上 omar-pet 的默认值。
// 用法：node tools/build-config.mjs [dsh-pet 插件目录]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from '../lib/jsonc.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dsh = resolve(process.argv[2] ?? resolve(root, '../dsh-pet/dsh-pet'));
const cfg = parseJsonc(readFileSync(resolve(dsh, 'assets/config.jsonc'), 'utf8'));

// 桌面逻辑分辨率通常比 DSH 的浏览器视口小：缩小默认尺寸，站在右下角（工作区底部 = 地面）
const main = cfg.pets[0];
main.size = 300;
main.position = { corner: 'bottom-right', marginX: 24, marginY: 0 };

Object.assign(cfg, {
  // 碎碎念 / 对话调用哪个 CLI（claude / codex）；模型留空 = 该 CLI 自己的默认模型
  llm: { provider: 'claude', claudeModel: 'haiku', codexModel: '' },
  // 定时碎碎念：默认关闭。关闭时只有右键菜单 / IPC 显式触发才会调用 LLM
  whisperAuto: false,
  // 接收哪些 agent 的 hooks 事件
  agents: { claude: true, codex: true },
  // 用量动画读哪个 agent 的记录：auto = 最近发来事件的那个
  usage: { agent: 'auto' },
  // true = 只有发事件的终端不在前台时才弹系统通知
  notify: { onlyWhenUnfocused: true },
  // 宠物所在的 layer-shell 层：top（普通窗口之上、全屏应用之下）或 overlay（永远置顶）
  layer: 'top',
});

writeFileSync(resolve(root, 'assets/config.json'), JSON.stringify(cfg, null, 2) + '\n');
console.log('assets/config.json written');
