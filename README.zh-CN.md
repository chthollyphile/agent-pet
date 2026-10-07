# Agent Pet

[English](README.md) | 简体中文

![Agent Pet 显示 Claude Code 当前的工作状态](docs/screenshot.zh-CN.png)

Agent Pet 是一只运行在 Quickshell 上的桌面宠物，会随 Claude Code 和 Codex 的工作状态做出反应：agent 思考、调用工具、等待确认、完成或出错时，宠物会切换对应的动画，并在头顶的气泡里显示当前进度。它既可以作为 Omarchy 4 插件（`chthollyphile.agent-pet`）运行，也可以在其他支持 layer-shell 的 Wayland 桌面上独立运行。

角色、动画和桌宠核心逻辑移植自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，详见[致谢与许可证](#致谢与许可证)。

## 功能

- **桌宠行为**：待机、随机动作、转向、行走、点击回应，以及带物理效果的拖拽与甩抛。
- **工作状态联动**：通过 Claude Code / Codex 的 hooks 接收事件，在思考、工作、整理、等待、成功、出错 6 种状态之间切换动画。气泡可显示项目名、当前工具与命令摘要，以及 agent 自己写的步骤说明或模型生成的步骤总结。
- **等待提醒**：需要确认、任务完成或出错时显示气泡；发出事件的终端不在前台时，同时发送系统通知。
- **用量显示**：按最紧张的额度窗口播放对应档位的动画，气泡列出每个窗口的用量和重置倒计时。Omarchy 上直接使用 `omarchy.agents` 的数据，其他环境使用内置采集。
- **碎碎念与对话**：通过 `claude -p` 或 `codex exec` 生成。默认只在用户显式触发时调用模型。
- **双语界面**：根据系统语言自动选择中文或英文，也可以手动指定。

## 运行要求

- [Quickshell](https://quickshell.org/)，以及支持 layer-shell 的 Wayland 混成器（Hyprland、Sway、niri 等；GNOME 不支持）
- `qt6-imageformats`：Qt 的 WebP 解码插件（Arch：`sudo pacman -S qt6-imageformats`）。安装后需要重启正在运行的 Quickshell。
- `jq`、`curl`、`notify-send`
- 非 Omarchy 环境下采集用量需要 `python3`
- 工作状态联动需要 Claude Code 和/或 Codex CLI

## 安装

### 快速安装（推荐）

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chthollyphile/agent-pet/main/install.sh)
```

安装脚本在每一步执行前都会询问：

1. 检查依赖。
2. 安装插件：检测到 Omarchy 时使用 `omarchy plugin add`（会显示 Omarchy 自身的安全提示）；否则 clone 到 `~/.local/share/agent-pet`，以独立模式运行。设置 `AGENT_PET_MODE=standalone` 可在 Omarchy 上同样使用独立模式。
3. 下载动画素材（约 177 MB，来自本仓库的 GitHub Release，下载后校验 sha256）。
4. 接入 Claude Code / Codex hooks（修改配置前自动备份）。
5. 启用插件；独立模式下启动实例，并给出开机启动的配置方法。

### 通过 `omarchy plugin add` 安装

```bash
omarchy plugin add https://github.com/chthollyphile/agent-pet.git --enable
```

`omarchy plugin add` 只会 clone 仓库，不执行任何安装步骤，因此首次启用时还没有动画素材。插件检测到素材缺失后会发送一条通知，点击“下载”后才开始下载，完成后宠物会自动出现。也可以手动执行：

```bash
~/.config/omarchy/plugins/chthollyphile.agent-pet/bin/agent-pet-fetch-assets
~/.config/omarchy/plugins/chthollyphile.agent-pet/bin/agent-pet-install-hooks   # 可选：接入 Claude Code / Codex
```

### 独立模式

独立模式只依赖 Quickshell，不需要 Omarchy：

```bash
qs -p /path/to/agent-pet                       # 启动；修改 QML 后 Quickshell 会自动重载
qs ipc -p /path/to/agent-pet call agent-pet state
```

开机启动：在 Hyprland 配置中加入 `exec-once = qs -p /path/to/agent-pet`，其他环境可以使用 systemd 用户服务。

与插件模式的区别：

- 菜单与对话框使用 `Commons/` 中的默认主题；作为 Omarchy 插件运行时跟随 Omarchy 主题。
- 找不到 Omarchy 的 `omarchy-agent-usage-update` 时，自动使用内置采集 `bin/agent-pet-usage`，记录保存在 `~/.local/state/agent-pet/usage/`。
- hook 优先将事件发送给 Omarchy 插件，失败时再发送给独立实例，两种模式共用同一套 hooks 配置。
- 请勿同时运行两种模式，否则屏幕上会出现两只宠物。

### 接入 Claude Code 与 Codex

```bash
bin/agent-pet-install-hooks               # 写入 ~/.claude/settings.json 与 ~/.codex/hooks.json（修改前自动备份）
bin/agent-pet-install-hooks --uninstall   # 移除
```

- 重复运行不会产生重复条目。
- Codex 首次遇到新的 hook 时可能要求审核，按提示信任即可。
- `bin/agent-pet-hook` 不向标准输出写入任何内容，并立即返回；事件在后台转发，约 40 ms，不会拖慢 agent。

## 配置

内置默认值位于 `assets/config.json`。用户配置写在 `~/.config/agent-pet/config.jsonc`（支持注释），保存后立即生效。

用户配置中的顶层字段会**整段替换**默认值。例如写了 `stepSummary`，就需要同时写出 `mode` 和 `intervalSec`。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `language` | `"auto"` | 界面语言：`auto`、`zh` 或 `en`。`auto` 依次读取 `LANGUAGE`、`LC_ALL`、`LC_MESSAGES`、`LANG`，以 `zh` 开头时使用中文，否则使用英文。 |
| `workStatusDetail` | `false` | 在工作状态气泡中显示工具名与命令或文件摘要，例如 `Bash · npm test`。不调用模型。 |
| `stepSummary` | `{"mode":"off","intervalSec":60}` | 气泡中的步骤说明。`off`：关闭。`transcript`：读取会话记录中 agent 自己写的最新一段话，不调用模型，任务结束时显示最后一条回复。`model`：使用 `autoModel` 将用户请求与最近 8 步操作概括成一句话，每一轮第一步后约 8 秒先总结一次，之后最多每 `intervalSec` 秒一次，且只在有新步骤时调用。 |
| `autoModel` | `{"provider":"claude","claudeModel":"haiku","codexModel":"gpt-5.6-luna"}` | 自动任务（模型版步骤总结、定时碎碎念）使用的模型。默认为低成本模型，不跟随 CLI 的默认模型；Codex 以低推理强度运行。 |
| `llm` | `{"provider":"claude","claudeModel":"haiku","codexModel":""}` | 手动触发的碎碎念与对话使用的 CLI 和模型。`codexModel` 留空时使用 Codex 的默认模型。 |
| `whisperAuto` | `false` | 按 `eventsRefreshSec.whisper` 的间隔定时碎碎念（使用 `autoModel`）。有 agent 正在工作时跳过。 |
| `agents` | `{"claude":true,"codex":true}` | 接收哪些 agent 的事件。 |
| `usage` | `{"agent":"auto","source":"auto","refreshSec":900}` | `agent`：显示哪个 agent 的用量，`auto` 为最近发来事件的 agent。`source`：`auto` 在可用时使用 Omarchy 的数据，否则使用内置采集，也可指定 `omarchy` 或 `builtin`。`refreshSec`：记录超过该秒数后在后台重新采集。手动查看时，超过 60 秒的数据会先刷新。 |
| `notify.onlyWhenUnfocused` | `true` | 仅在发出事件的终端不在前台时发送系统通知。 |
| `clickAction` | `"react"` | 左键点击宠物的行为：`react` 播放点击回应动画，`usage` 显示用量。 |
| `bubbleFont` | `{"family":"","file":"","size":14}` | 气泡字体。`file`（字体文件路径，支持 `~/`）优先于 `family`（已安装的字体名，见 `fc-list : family`）。都留空时，中文界面使用 Noto Sans CJK SC，英文界面使用 Noto Sans。 |
| `layer` | `"top"` | 宠物所在的层。`overlay` 可在全屏应用之上显示。 |
| `pets[].screen` | 第一块屏幕 | 宠物所在的显示器名（见 `hyprctl monitors`）。 |

继承自 dsh-pet 的字段（`animations`、`physics`、`pets`、`workStatusTexts`、`whisperPrompt`、`memes` 等）含义不变。英文界面下，如果没有自定义 `workStatusTexts` 和 `whisperPrompt`，会使用英文版本。

### 配置示例

```jsonc
{
  // 外观与交互
  "language": "auto",
  "bubbleFont": { "family": "", "file": "", "size": 14 },
  "clickAction": "usage",
  "layer": "top",

  // 工作状态
  "workStatusDetail": true,
  "stepSummary": { "mode": "transcript", "intervalSec": 60 },
  "notify": { "onlyWhenUnfocused": true },
  "agents": { "claude": true, "codex": true },

  // 用量
  "usage": { "agent": "auto", "source": "auto", "refreshSec": 900 },

  // 模型
  "llm": { "provider": "claude", "claudeModel": "haiku", "codexModel": "" },
  "autoModel": { "provider": "claude", "claudeModel": "haiku", "codexModel": "gpt-5.6-luna" },
  "whisperAuto": false,
  "eventsRefreshSec": { "balance": 1800, "whisper": 600 },

  // 宠物（写了 pets 就需要写出每只宠物的全部字段）
  "pets": [
    {
      "name": "蓝毛小女仆",
      "id": "main",
      "size": 300,
      "balanceEnabled": true,
      "whisperEnabled": true,
      "workStatusEnabled": true,
      "fixedEnabled": false,           // true：不自行走动或转身
      "display": "both",
      "screen": "eDP-1",               // 可省略，默认第一块屏幕
      "position": { "corner": "bottom-right", "marginX": 24, "marginY": 0 }
    }
  ]
}
```

## 命令行控制

插件注册了 IPC 目标 `agent-pet`。Omarchy 下使用 `omarchy-shell`，独立模式下使用 `qs ipc -p <插件目录> call`：

```bash
omarchy-shell agent-pet state           # 输出 JSON：会话、用量、配置状态
omarchy-shell agent-pet say "你好"
omarchy-shell agent-pet play 涮火锅
omarchy-shell agent-pet usage
omarchy-shell agent-pet whisper         # 调用一次模型
omarchy-shell agent-pet chat "在吗"     # 调用一次模型
omarchy-shell agent-pet toggle          # 隐藏 / 显示
omarchy-shell agent-pet reload
omarchy-shell agent-pet fetchAssets     # 下载缺失的动画素材
```

## 隐私与模型调用

- **模型调用**：只有以下情况会调用模型：右键菜单中的“碎碎念”和“对话”、IPC 的 `whisper` 和 `chat`，以及用户主动开启的 `whisperAuto` 与 `stepSummary.mode = "model"`。宠物自身的模型调用不会触发 hooks。
- **hooks 转发的数据**：只有事件名、会话 ID、项目路径、工具名、工具参数第一行（最多 120 字）、通知文本（最多 200 字）、本轮请求的前 300 字、结束时的最后一条回复（最多 2000 字），以及会话记录路径。这些数据只通过本机 IPC 传给 Quickshell，不会离开本机。
- **会话记录**：仅在 `stepSummary.mode = "transcript"` 时读取，每次只读取文件末尾 400 KB。
- **网络访问**：下载动画素材，以及非 Omarchy 环境下查询 Claude / Codex 的额度。额度查询只读取用量，不消耗额度。

## 已知限制

- 宠物只在所属的屏幕内活动，不会跨屏飞行。
- “终端是否在前台”的判断依赖 `hyprctl`。非 Hyprland 环境，以及 tmux、ssh 中运行的会话，一律视为不在前台。
- dsh-pet 的多宠物碰撞、点击积分和 pet pack 尚未移植。

## 开发

### 从源码构建

动画素材由 dsh-pet 的原始视频转码生成，需要 dsh-pet 源码（默认位于 `../dsh-pet`）、带 libvpx 与 libwebp 的 `ffmpeg`，以及 Node.js：

```bash
git clone https://github.com/PC2005-cloud/dsh-pet.git ../dsh-pet
npm install
npm run build        # 生成 lib/shared.mjs、assets/config.json、assets/webp
ln -s "$PWD" ~/.config/omarchy/plugins/chthollyphile.agent-pet
omarchy-shell shell rescanPlugins
omarchy plugin enable chthollyphile.agent-pet
```

开发注意事项：

- 插件目录为符号链接时，Omarchy 不会监视其中的改动。
- `omarchy-shell shell rescanPlugins` 只会重新加载 `Service.qml`，`Pet.qml` 等子组件仍使用已编译的旧版本。修改子组件后请执行 `omarchy-restart-shell`，或改用独立模式开发（支持自动重载）。

### 发布素材

动画素材不纳入 git，而是作为 GitHub Release 附件发布。下载地址、sha256 和大小记录在 `assets.json` 中：

```bash
tools/pack-assets.sh                                   # 生成 dist/agent-pet-assets-v1.tar 并更新 assets.json
gh release create assets-v1 dist/agent-pet-assets-v1.tar --title "Assets v1"
git add assets.json && git commit -m "chore: update asset release metadata"
```

打包结果可复现：相同的素材得到相同的 sha256。素材更新时，使用 `tools/pack-assets.sh --version 2` 发布新版本。

### 目录结构

| 路径 | 说明 |
|---|---|
| `Service.qml` | 状态中枢：配置、会话聚合、用量、模型调用、通知、IPC |
| `PetOverlay.qml` | 每块屏幕一个全屏透明的 layer-shell 窗口，输入区域只覆盖宠物 |
| `Pet.qml` | 动画播放与切换、移动、拖拽与甩抛、气泡 |
| `PetMenu.qml`、`ChatInput.qml`、`Bubble.qml`、`Llm.qml` | 右键菜单、对话框、气泡、CLI 调用 |
| `lib/shared.mjs` | 由 dsh-pet `src/shared` 打包生成，请勿手动修改 |
| `lib/work-status.mjs`、`lib/usage.mjs`、`lib/i18n.mjs`、`lib/jsonc.mjs` | 事件聚合、用量解析、界面文本、JSONC 解析 |
| `shell.qml`、`Commons/` | 独立模式的入口与默认主题 |
| `install.sh` | 安装脚本 |
| `bin/` | hook 转发与安装、素材下载、会话记录读取、内置用量采集 |
| `tools/` | 素材、共享逻辑、默认配置的构建脚本，以及素材打包 |
| `assets.json` | 素材 Release 的下载地址、sha256 与大小 |
| `docs/` | 截图 |

## 致谢与许可证

**[dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**（MIT，© PC2005-cloud）：本项目的角色、动画与桌宠逻辑来自 dsh-pet，感谢原作者 [@PC2005-cloud](https://github.com/PC2005-cloud)。具体包括：

- 106 段透明动画、表情包与通知图标。本仓库不包含这些文件，由 dsh-pet 的素材转码生成，并通过 Release 分发。
- 默认配置：动画池、权重、物理参数、工作状态文案与人设提示词。
- `src/shared` 中的物理、动画抽选、移动规划与菜单树，原样打包为 `lib/shared.mjs`。
- 6 种工作状态的设计。

dsh-pet 附带的第三方字体不在本项目中使用。

**[Omarchy](https://github.com/basecamp/omarchy)**（MIT，© David Heinemeier Hansson）：用量采集的行为移植自 Omarchy 的 `omarchy.agents` 插件。在 Omarchy 上直接使用其 `omarchy-agent-usage-update` 和记录文件；在其他环境中，`bin/agent-pet-usage` 以相同的方式采集额度。只移植了额度部分。

本项目以 MIT 许可证发布，完整内容见 [LICENSE](LICENSE)，其中保留了 dsh-pet 与 Omarchy 的版权声明。
