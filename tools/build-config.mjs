// dsh-pet 的 assets/config.jsonc → assets/config.json（去注释），并套上 agent-pet 的默认值。
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
  // 工作状态气泡显示 hook 里的工具名和命令 / 文件摘要（不调用模型）
  workStatusDetail: false,
  // 步骤总结，显示在工作状态气泡里。mode：
  //   off        = 关闭（默认）
  //   transcript = 读会话记录里 agent 自己写的最新一段话，不调用模型
  //   model      = 用 autoModel 把用户请求 + 最近几步操作概括成一句话；每次总结调用一次模型，
  //                intervalSec = 两次总结的最短间隔（≥ 20 秒）
  stepSummary: { mode: 'off', intervalSec: 60 },
  // 自动任务（步骤总结、定时碎碎念）用的模型：默认用便宜的小模型，不跟随 CLI 自己的默认模型
  autoModel: { provider: 'claude', claudeModel: 'haiku', codexModel: 'gpt-5.6-luna' },
  // 接收哪些 agent 的 hooks 事件
  agents: { claude: true, codex: true },
  // 用量动画读哪个 agent 的记录：auto = 最近发来事件的那个
  usage: { agent: 'auto' },
  // true = 只有发事件的终端不在前台时才弹系统通知
  notify: { onlyWhenUnfocused: true },
  // 左键点击宠物：react = 播点击回应动画；usage = 查看用量（余额动画 + 各窗口重置倒计时气泡）
  clickAction: 'react',
  // 气泡字体：file（字体文件路径，支持 ~/）优先于 family（已安装字体名，见 fc-list）；都留空 = 内置上首软糖体
  bubbleFont: { family: '', file: '', size: 14 },
  // 宠物所在的 layer-shell 层：top（普通窗口之上、全屏应用之下）或 overlay（永远置顶）
  layer: 'top',
});

writeFileSync(resolve(root, 'assets/config.json'), JSON.stringify(cfg, null, 2) + '\n');
console.log('assets/config.json written');
