# agent-pet

把 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的桌宠移植成 Omarchy 4 的 Quickshell 插件（`lia.pet`），并接入 Claude Code / Codex：

- 待机、随机动作、转向、行走、点击 Q 弹、拖拽甩抛反弹（物理与抽选逻辑直接复用 dsh-pet 的纯函数）。
- 工作状态联动：hooks 事件切换思考 / 工作 / 整理 / 等待 / 成功 / 出错 6 档动画和头顶气泡。
- 等待提醒：需要确认、任务完成、出错时冒气泡；发事件的终端不在前台时再发系统通知。
- 用量动画：读取 `omarchy.agents` 生成的用量记录，按最紧张窗口的百分比播放余额档位动画；气泡列出每个窗口的用量和重置倒计时（5 小时窗口精确到分钟，周额度精确到小时）。
- 碎碎念 / 对话：调用 `claude -p` 或 `codex exec`。**默认只在右键菜单或 IPC 显式触发时调用**；定时碎碎念由 `whisperAuto` 开启，默认关闭。

## 致谢

本项目移植自 **[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**（MIT），感谢原作者 [@PC2005-cloud](https://github.com/PC2005-cloud) 制作的角色、动画和整套桌宠逻辑。

来自 dsh-pet 的部分：

- **动画与静态素材**：106 段透明动画、表情包、通知图标、字体（上首软糖体）。本仓库不包含这些文件，构建时从本地的 dsh-pet 克隆转码 / 复制生成。
- **默认配置**：动画池、权重、物理参数、工作状态文案、人设提示词，由 `tools/build-config.mjs` 从 dsh-pet 的 `assets/config.jsonc` 生成。
- **纯逻辑代码**：`src/shared` 中的物理（拖拽 / 甩抛 / Q 弹）、动画抽选、移动规划、菜单树，由 `tools/build-shared.mjs` 原样打包进 `lib/shared.mjs`。
- 工作状态 6 档的设计与档位顺序。

agent-pet 新写的部分：Quickshell / Omarchy 插件外壳（QML）、Claude Code / Codex hooks 桥接、用量与 LLM 调用。许可证见 [LICENSE](LICENSE)，保留了 dsh-pet 的版权声明。

## 安装

依赖：`qt6-imageformats`（WebP 解码）、`ffmpeg`（带 libvpx / libwebp）、`jq`、node。

构建需要 dsh-pet 的源码和素材，默认放在本仓库旁边（`../dsh-pet`）。也可以把路径作为参数传给 `tools/build-*.{sh,mjs}`。

```bash
git clone https://github.com/PC2005-cloud/dsh-pet.git ../dsh-pet
sudo pacman -S qt6-imageformats   # 装完要重启 shell：omarchy-restart-shell
npm install
npm run build                     # lib/shared.mjs + assets/config.json + assets/webp（约 170 MB）
ln -s "$PWD" ~/.config/omarchy/plugins/lia.pet
omarchy-shell shell rescanPlugins
omarchy plugin enable lia.pet
```

开发注意：

- 插件目录是符号链接，omarchy 的 inotify 监视不会跟进改动。
- `omarchy-shell shell rescanPlugins` 只会刷新 `Service.qml`。`Pet.qml`、`PetOverlay.qml` 等子组件仍沿用旧的已编译类型（宿主 `destroy()` 延迟执行，清缓存时旧类型还被引用）。改了子组件要执行 `omarchy-restart-shell`。

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
| `llm` | `{"provider":"claude","claudeModel":"haiku","codexModel":""}` | 碎碎念 / 对话用哪个 CLI 和模型 |
| `whisperAuto` | `false` | 按 `eventsRefreshSec.whisper` 定时碎碎念；有会话在工作时跳过 |
| `agents` | `{"claude":true,"codex":true}` | 接收哪些 agent 的事件 |
| `usage.agent` | `"auto"` | 用量动画读哪个 agent；auto = 最近发来事件的那个 |
| `notify.onlyWhenUnfocused` | `true` | 只在发事件的终端不在前台时通知 |
| `clickAction` | `"react"` | 左键点击宠物：`react` 播点击回应动画；`usage` 查看用量 |
| `bubbleFont` | `{"family":"","file":"","size":14}` | 气泡字体。`file`（字体文件路径，支持 `~/`）优先于 `family`（已安装字体名，见 `fc-list : family`）；都留空 = 内置上首软糖体。菜单和对话框跟随 Omarchy 主题字体 |
| `layer` | `"top"` | `overlay` = 全屏应用之上也显示 |
| `pets[].screen` | 第一块屏 | 宠物所在显示器名（`hyprctl monitors`） |

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
| `bin/` | hook 桥接与安装脚本 |
| `tools/` | 素材、共享逻辑、配置的构建脚本 |
