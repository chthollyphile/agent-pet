# agent-pet

把 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的桌宠移植到 Quickshell，并接入 Claude Code / Codex。可以作为 Omarchy 4 插件（`lia.pet`）运行，也可以只依赖 Quickshell 独立运行（见「独立模式」）。

- 待机、随机动作、转向、行走、点击 Q 弹、拖拽甩抛反弹（物理与抽选逻辑直接复用 dsh-pet 的纯函数）。
- 工作状态联动：hooks 事件切换思考 / 工作 / 整理 / 等待 / 成功 / 出错 6 档动画和头顶气泡。
- 等待提醒：需要确认、任务完成、出错时冒气泡；发事件的终端不在前台时再发系统通知。
- 用量动画：按最紧张窗口的百分比播放余额档位动画；气泡列出每个窗口的用量和重置倒计时（5 小时窗口精确到分钟，周额度精确到小时）。Omarchy 上直接用 `omarchy.agents` 的记录，其他环境用移植的内置采集；数据超过 60 秒的手动查看会先刷新再显示。
- 中英双语界面：按系统 locale 自动选择，也可在设置里指定。
- 碎碎念 / 对话：调用 `claude -p` 或 `codex exec`。**默认只在右键菜单或 IPC 显式触发时调用**；定时碎碎念（`whisperAuto`）和模型版步骤总结（`stepSummary.mode = "model"`）都默认关闭，开启后用单独指定的便宜模型（`autoModel`）。

## 致谢

本项目移植自 **[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**（MIT），感谢原作者 [@PC2005-cloud](https://github.com/PC2005-cloud) 制作的角色、动画和整套桌宠逻辑。

来自 dsh-pet 的部分：

- **动画与静态素材**：106 段透明动画、表情包、通知图标。本仓库不包含这些文件，构建时从本地的 dsh-pet 克隆转码 / 复制生成。dsh-pet 附带的第三方字体（上首软糖体）不使用，气泡用系统字体。
- **默认配置**：动画池、权重、物理参数、工作状态文案、人设提示词，由 `tools/build-config.mjs` 从 dsh-pet 的 `assets/config.jsonc` 生成。
- **纯逻辑代码**：`src/shared` 中的物理（拖拽 / 甩抛 / Q 弹）、动画抽选、移动规划、菜单树，由 `tools/build-shared.mjs` 原样打包进 `lib/shared.mjs`。
- 工作状态 6 档的设计与档位顺序。

用量采集移植自 **[Omarchy](https://github.com/basecamp/omarchy)**（MIT，© David Heinemeier Hansson）的 `omarchy.agents` 插件：在 Omarchy 上直接使用它的 `omarchy-agent-usage-update` 和记录文件；在其他环境中，`bin/agent-pet-usage` 按相同行为采集额度（Claude 的 OAuth 用量接口、Codex app-server 的 `account/rateLimits/read`，以及百分比换算、模型专属窗口、探测复用与过期处理），输出相同格式的记录。只移植了额度部分，没有移植本地 token 统计。

agent-pet 新写的部分：Quickshell / Omarchy 插件外壳（QML）、Claude Code / Codex hooks 桥接、步骤总结与 LLM 调用。许可证见 [LICENSE](LICENSE)，保留了 dsh-pet 和 Omarchy 的版权声明。

## 安装

依赖：Quickshell、`qt6-imageformats`（WebP 解码，Arch：`sudo pacman -S qt6-imageformats`，装完要重启已在运行的 Quickshell）、`jq`、`curl`、`notify-send`；非 Omarchy 环境采集用量还需要 python3。

### 一行命令安装（推荐）

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chthollyphile/agent-pet/main/install.sh)
```

脚本每一步都先询问：

1. 检查依赖。
2. 安装插件：有 Omarchy 时用 `omarchy plugin add`（会显示 Omarchy 自己的安全提示），否则 clone 到 `~/.local/share/agent-pet` 作为独立 Quickshell 实例运行。`AGENT_PET_MODE=standalone` 可在 Omarchy 上也装成独立模式。
3. 下载动画素材（约 177 MB，来自本仓库的 GitHub Release，校验 sha256）。
4. 接入 Claude Code / Codex hooks（修改前自动备份配置）。
5. 启用插件，或启动独立实例并给出开机启动的写法。

### 用 `omarchy plugin add` 安装

```bash
omarchy plugin add https://github.com/chthollyphile/agent-pet.git --enable
```

Omarchy 只会 clone 仓库，不会运行任何安装步骤，所以这时还没有动画素材。插件启动后发现缺素材，会弹出一条通知，点“下载”才开始下载，完成后宠物自动出现。也可以手动运行：

```bash
~/.config/omarchy/plugins/lia.pet/bin/agent-pet-fetch-assets
~/.config/omarchy/plugins/lia.pet/bin/agent-pet-install-hooks   # 可选：接入 Claude Code / Codex
```

### 从源码构建（开发）

素材由 dsh-pet 的原始视频转码生成，需要 dsh-pet 的源码（默认放在本仓库旁边 `../dsh-pet`，也可以把路径作为参数传给 `tools/build-*.{sh,mjs}`）、`ffmpeg`（带 libvpx / libwebp）和 node：

```bash
git clone https://github.com/PC2005-cloud/dsh-pet.git ../dsh-pet
npm install
npm run build                     # lib/shared.mjs + assets/config.json + assets/webp（约 170 MB）
ln -s "$PWD" ~/.config/omarchy/plugins/lia.pet   # Omarchy 插件模式
omarchy-shell shell rescanPlugins
omarchy plugin enable lia.pet
```

开发注意：

- 插件目录是符号链接，omarchy 的 inotify 监视不会跟进改动。
- `omarchy-shell shell rescanPlugins` 只会刷新 `Service.qml`。`Pet.qml`、`PetOverlay.qml` 等子组件仍沿用旧的已编译类型（宿主 `destroy()` 延迟执行，清缓存时旧类型还被引用）。改了子组件要执行 `omarchy-restart-shell`。

### 发布素材（维护者）

素材不进 git，作为 GitHub Release 附件发布，`assets.json` 记录下载地址、sha256 和大小：

```bash
tools/pack-assets.sh              # 打包 dist/agent-pet-assets-v1.tar，更新 assets.json（tar 可复现，同样素材 sha256 不变）
gh release create assets-v1 dist/agent-pet-assets-v1.tar --title "Assets v1"
git add assets.json && git commit -m "chore: update asset release metadata"
```

素材有变化时用 `tools/pack-assets.sh --version 2` 发新版本。

### 独立模式（只依赖 Quickshell）

不需要 Omarchy，适用于 Hyprland、Sway、niri 等支持 layer-shell 的 Wayland 混成器（GNOME 不支持 layer-shell）。

```bash
qs -p "$PWD"                      # 启动；改动 QML 后 Quickshell 会自动重载
qs ipc -p "$PWD" call lia.pet state
```

开机启动：Hyprland 在配置里加 `exec-once = qs -p /path/to/agent-pet`，其他环境可写一个 systemd 用户服务。

与插件模式的差别：

- 菜单和对话框用 `Commons/` 里的默认主题。`qs.Commons` 解析到当前 shell 的根目录，所以作为 Omarchy 插件运行时用的是 Omarchy 的主题，独立运行时用这里的。
- 用量数据：找不到 `omarchy-agent-usage-update` 时自动改用内置采集 `bin/agent-pet-usage`，记录写到 `~/.local/state/agent-pet/usage/`。
- hook 先尝试 `omarchy-shell lia.pet event`，失败再发给 `qs ipc -p <仓库目录>`，两种模式用同一套 hooks 配置。
- 不要同时运行两种模式，否则屏幕上会有两只宠物（hooks 事件只会发给 Omarchy 那只）。

### 接入 Claude Code / Codex

```bash
bin/agent-pet-install-hooks             # 写入 ~/.claude/settings.json 和 ~/.codex/hooks.json（先自动备份）
bin/agent-pet-install-hooks --uninstall # 移除
```

Codex 第一次遇到新 hook 可能要求审核，在 Codex 里按提示信任即可。

`bin/agent-pet-hook` 不向 stdout 输出任何内容，立即 `exit 0`，IPC 在后台完成（约 40 ms）。宠物自己调用 LLM 时设置 `AGENT_PET_INTERNAL=1`，hook 看到后直接退出，避免自己触发自己。

## 配置

内置默认值在 `assets/config.json`（由 dsh-pet 的 `config.jsonc` 生成）。在 `~/.config/agent-pet/config.jsonc` 中覆盖：顶层字段整段替换，保存后立即生效。dsh-pet 原有字段（`animations`、`physics`、`pets`、`workStatusTexts`、`memes` 等）语义不变。新增字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `llm` | `{"provider":"claude","claudeModel":"haiku","codexModel":""}` | 手动触发的碎碎念 / 对话用哪个 CLI 和模型；`codexModel` 留空 = Codex 的默认模型 |
| `whisperAuto` | `false` | 按 `eventsRefreshSec.whisper` 定时碎碎念（用 `autoModel`）；有会话在工作时跳过 |
| `workStatusDetail` | `false` | 工作状态气泡显示 hook 里的工具名和命令 / 文件摘要，如 `Bash · npm test`；不调用模型 |
| `stepSummary` | `{"mode":"off","intervalSec":60}` | 气泡里的步骤总结。`mode`：`off` 关闭；`transcript` 读会话记录（`transcript_path`）里 agent 自己写的最新一段话（只读文件末尾 400 KB，不调用模型，任务结束时显示最后一句回复）；`model` 用 `autoModel` 把用户请求和最近 8 步操作概括成一句话（新一轮第一步后约 8 秒先总结一次，之后最多每 `intervalSec` 秒一次，且只在有新步骤时调用）。旧写法 `enabled: true` 等同于 `model` |
| `autoModel` | `{"provider":"claude","claudeModel":"haiku","codexModel":"gpt-5.6-luna"}` | 自动任务（步骤总结、定时碎碎念）用的模型，默认是便宜的小模型，不跟随 CLI 的默认模型；Codex 另外以低推理强度运行 |
| `agents` | `{"claude":true,"codex":true}` | 接收哪些 agent 的事件 |
| `usage` | `{"agent":"auto","source":"auto","refreshSec":900}` | `agent`：读哪个 agent，`auto` = 最近发来事件的那个。`source`：`auto` = 有 Omarchy 的 `omarchy-agent-usage-update` 就用 `omarchy.agents` 的记录，否则用内置采集；也可强制 `omarchy` / `builtin`。`refreshSec`：记录比这个秒数旧就在后台重新采集；手动查看时超过 60 秒就先刷新 |
| `notify.onlyWhenUnfocused` | `true` | 只在发事件的终端不在前台时通知 |
| `language` | `"auto"` | 界面语言：`auto` 按系统 locale（`LANGUAGE` → `LC_ALL` → `LC_MESSAGES` → `LANG`）判断，以 `zh` 开头用中文，否则英文；也可写 `zh` / `en`。英文时，没自定义的 `workStatusTexts`、`whisperPrompt` 换成英文版，菜单里的动画显示英文名；动画和表情包图片本身不变 |
| `clickAction` | `"react"` | 左键点击宠物：`react` 播点击回应动画；`usage` 查看用量 |
| `bubbleFont` | `{"family":"","file":"","size":14}` | 气泡字体。`file`（字体文件路径，支持 `~/`）优先于 `family`（已安装字体名，见 `fc-list : family`）；都留空 = 中文界面用 Noto Sans CJK SC，英文界面用 Noto Sans（没装时由 fontconfig 回退到其他字体）。菜单和对话框跟随 Omarchy 主题字体 |
| `layer` | `"top"` | `overlay` = 全屏应用之上也显示 |
| `pets[].screen` | 第一块屏 | 宠物所在显示器名（`hyprctl monitors`） |

### 配置范例

`~/.config/agent-pet/config.jsonc`，只写想改的字段，其余用内置默认值。注意顶层字段是**整段替换**：比如写了 `stepSummary`，就要把 `mode` 和 `intervalSec` 都写上，没写的子字段不会从默认值补回来。

```jsonc
{
  // ---- 外观与交互
  "language": "auto",                // auto / zh / en
  "bubbleFont": { "family": "WenQuanYi Micro Hei", "file": "", "size": 14 },
  "clickAction": "usage",            // 左键点击查看用量；"react" = 播点击回应动画
  "layer": "top",                    // "overlay" = 全屏应用之上也显示

  // ---- 工作状态气泡
  "workStatusDetail": true,          // 显示工具名和命令摘要，如 "Bash · npm test"
  "stepSummary": {
    "mode": "transcript",            // off / transcript（agent 自己的话，不调模型）/ model（模型总结）
    "intervalSec": 60                // 只对 model 生效：两次总结的最短间隔，≥ 20
  },
  "notify": { "onlyWhenUnfocused": true },
  "agents": { "claude": true, "codex": true },

  // ---- 用量
  "usage": {
    "agent": "auto",                 // auto / claude / codex
    "source": "auto",                // auto / omarchy / builtin
    "refreshSec": 900
  },

  // ---- 模型
  // 手动触发的碎碎念 / 对话
  "llm": { "provider": "claude", "claudeModel": "haiku", "codexModel": "" },
  // 自动任务（stepSummary.mode = "model"、定时碎碎念）
  "autoModel": { "provider": "claude", "claudeModel": "haiku", "codexModel": "gpt-5.6-luna" },
  "whisperAuto": false,              // 定时碎碎念，开启后每 eventsRefreshSec.whisper 秒调用一次模型
  "eventsRefreshSec": { "balance": 1800, "whisper": 600 },

  // ---- 宠物本身（写了 pets 就要写全每只宠物的字段）
  "pets": [
    {
      "name": "蓝毛小女仆",
      "id": "main",
      "size": 300,
      "balanceEnabled": true,
      "whisperEnabled": true,
      "workStatusEnabled": true,
      "fixedEnabled": false,         // true = 不自己走动、不自己转身
      "display": "both",
      "screen": "eDP-1",             // 可省略，默认第一块屏
      "position": { "corner": "bottom-right", "marginX": 24, "marginY": 0 }
    }
  ]
}
```

## IPC

```bash
omarchy-shell lia.pet state          # JSON：会话、用量、配置状态
omarchy-shell lia.pet say "你好"
omarchy-shell lia.pet play 涮火锅
omarchy-shell lia.pet usage
omarchy-shell lia.pet whisper        # 会调用一次 LLM
omarchy-shell lia.pet chat "在吗"    # 会调用一次 LLM
omarchy-shell lia.pet toggle         # 隐藏 / 显示
omarchy-shell lia.pet reload
omarchy-shell lia.pet event '{"agent":"claude","event":"Stop","session":"x","cwd":"/tmp"}'
```

## 已知限制

- 前台检测用的是 `hyprctl`；非 Hyprland 环境下一律当作不在前台，每次都会发通知。

- 宠物只在所属屏幕内活动，不跨屏飞行。
- 前台检测沿进程父链查找 Hyprland 当前窗口的 pid，在 tmux / ssh 里检测不到，会当作不在前台。
- 多宠物互相碰撞（`physics.petCollision`）、点击积分、pet pack 暂未移植。

## 目录

| 路径 | 内容 |
|---|---|
| `Service.qml` | 状态中枢：配置、会话聚合、用量、LLM、通知、IPC |
| `PetOverlay.qml` | 每块屏一个全屏透明 layer-shell 窗口，输入 mask 只覆盖宠物身体 |
| `Pet.qml` | 双缓冲 AnimatedImage、动画链、移动、拖拽甩抛、气泡 |
| `PetMenu.qml` / `ChatInput.qml` / `Bubble.qml` / `Llm.qml` | 右键菜单 / 对话框 / 气泡 / CLI 调用 |
| `lib/shared.mjs` | dsh-pet `src/shared` 打包产物，勿手改 |
| `lib/work-status.mjs` / `lib/usage.mjs` / `lib/jsonc.mjs` | hooks 事件聚合 / 用量解析 / JSONC |
| `shell.qml` / `Commons/` | 独立模式入口与默认主题 |
| `install.sh` | 一行命令安装脚本 |
| `bin/` | hook 桥接与安装脚本、素材下载（`agent-pet-fetch-assets`）、会话记录读取（`agent-pet-last-message`）、内置用量采集（`agent-pet-usage`，移植自 Omarchy） |
| `assets.json` | 素材 Release 的下载地址、sha256、大小（由 `tools/pack-assets.sh` 生成） |
| `tools/` | 素材、共享逻辑、配置的构建脚本，素材打包（`pack-assets.sh`） |
