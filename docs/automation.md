# 本地功能：自动化、提醒、联网对话、跳回终端、专注模式（`local/automation` 分支，仅本地使用）

在 `~/.config/agent-pet/config.jsonc` 里写 `automations`，保存即生效。它和其他顶层字段一样**整段替换**默认值，所以 `chime`、`tasks`、`rules` 用到哪个写哪个，没写的视为关闭或为空。

配置写错的条目会被跳过，原因打印在 Quickshell 日志里，也能用 `state` 查看（`automations.errors`）。

## 整点报时 `chime`

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 开关 |
| `from` / `to` | `8` / `23` | 报时时段（含两端，按小时）。`from > to` 表示跨午夜，如 `22` → `2` |
| `text` | `"{hour} 点啦～"` | 气泡文字，可用 `{hour}`、`{time}`（HH:mm） |
| `anims` | 见下 | 小时 → 候选动画（字符串或数组，随机挑一个），`"*"` = 其他整点 |
| `quietWhenBusy` | `true` | agent 正在干活时只冒气泡，不打断工作状态动画 |

默认动画：7 点刷牙或吃早餐，8 点吃早餐或伸懒腰，12 点吃午餐，15 点伸懒腰，18 点吃晚餐，22–23 点打哈欠或小憩，其余整点挥手。

## 定时任务 `tasks`

每个任务二选一调度：`every`（秒，最少 30）或 `at`（`"HH:MM"` 或数组，每天到点触发一次）。`every` 任务在宠物启动时先跑一次。

| 字段 | 默认 | 说明 |
|---|---|---|
| `name` | 序号 | 任务名，IPC 手动触发时用 |
| `run` | 无 | 要运行的命令。字符串交给 `bash -c`，数组当 argv。不写 = 纯提醒 |
| `say` | 有 `run` 时 `"{output}"`，否则空 | 气泡文字，可用 `{output}`（输出，去颜色、截到 200 字）、`{exit}`（退出码）、`{name}` |
| `play` | 无 | 说话时播的动画（字符串或数组，随机挑一个） |
| `when` | 有 `run` 时 `changed`，否则 `always` | 什么时候说：`always` 每次；`changed` 输出和上次不同（启动后第一次只记录，不说）；`fail` 退出码非 0；`success` 退出码为 0 |
| `skipWhenBusy` | `false` | agent 正在干活时跳过这次 |
| `timeoutSec` | `30` | 超时后发 SIGTERM |
| `pet` | 所有宠物 | 只让某只宠物说 |

命令在 `$HOME` 下运行，环境变量带 `AGENT_PET_INTERNAL=1`：命令里再调用 `claude` / `codex` 不会被当成工作状态事件。命令没有输出但退出码非 0 时，`{output}` 取 stderr。

## 事件规则 `rules`

Claude Code / Codex 每发来一个 hook 事件，按顺序检查所有规则，匹配的都会执行。

**匹配条件**（不写 = 不限制）：

| 字段 | 匹配方式 | 说明 |
|---|---|---|
| `event` | 精确，字符串或数组（必填） | `UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest`、`Notification`、`Stop`、`StopFailure`、`SessionEnd` 等 |
| `agent` | 精确，字符串或数组 | `claude` / `codex` |
| `tool` | 精确，字符串或数组 | 如 `Bash`、`Edit` |
| `detail` | 正则 | 工具参数摘要：命令、文件路径等的第一行（最多 120 字） |
| `message` | 正则 | 通知或错误消息 |
| `project` | 正则 | 项目名（cwd 的最后一段） |

正则区分大小写，按 JavaScript 语法写。

Codex 只发 `UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PermissionRequest`、`Stop`、`SessionEnd`；`PostToolUseFailure`、`StopFailure`、`Notification`、`Elicitation` 只有 Claude Code 有。

**动作**：`say`、`play`、`run`、`timeoutSec`、`pet` 的含义同定时任务；`cooldownSec`（默认 0）表示同一条规则触发后多少秒内不再触发。

`say` 可用的变量：`{agent}`、`{agentName}`、`{event}`、`{tool}`、`{detail}`、`{message}`、`{project}`、`{cwd}`；写了 `run` 时还有 `{output}`、`{exit}`，并且会等命令跑完再说。

`run` 命令在事件的项目目录（cwd）下运行，**完整事件 JSON 从 stdin 传入**，不会出现在进程参数里。可以用 `jq` 取字段。

## 聊天设提醒 `reminders`

在聊天框（右键菜单 →「对话」）里直接说，比如：

- 「10 分钟后提醒我喝水」「周三开会前半小时叫我」
- 「每天 9 点提醒我站会」「工作日 18:30 提醒我下班」
- 「我有哪些提醒？」「把喝水那个取消掉」

模型只负责听懂这句话，回复里附带结构化指令。计算时间、校验、保存和到点触发都由本地代码完成。气泡会在模型回复后面追加实际排定的结果，比如 `⏰ 15:00 开会`。模型理解错了，一眼就能看出来。说的时间已经过去，或者模型给出的格式不对，会提示你换个说法。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关闭后聊天不再带提醒功能，已有提醒也不再触发 |
| `play` | `["点击回应-元气挥手"]` | 到点时播的动画，`[]` 不播 |
| `notify` | `true` | 到点时同时发桌面通知（不管终端是否在前台） |

- 提醒保存在 `~/.local/state/agent-pet/reminders.json`，重启后仍在。关机或挂起期间错过的提醒，启动后补报，并注明「迟到了」。
- 到点时气泡停留 30 秒。精度约 1 秒。
- 设置和管理提醒需要调用模型（用 `llm` 配置的 CLI），会等几秒；到点触发不需要模型。
- 聊天时，当前时间和现有提醒列表会附在发给模型的系统提示里。
- 没有图形界面时也可以用命令行：`omarchy-shell agent-pet chat "10分钟后提醒我喝水"`。注意这句话会出现在进程参数里。`omarchy-shell agent-pet reminders` 以 JSON 列出现有提醒。

## 联网对话（右键菜单 →「联网对话」）

用同一个聊天框，但这次模型可以上网搜索、打开网页，适合问最新版本、新闻、文档这类问题。不想要这个菜单项，就在配置里写 `"webChat": false`。

- **只多开放联网**：Claude 只给 `WebSearch` 和 `WebFetch`，并预先放行，因为 `-p` 模式没人能点批准；Codex 只把 `web_search` 改成 `live`。其他工具照旧全部关闭。
- **防网页注入**：网页内容可能夹带指令。所以联网时**不带对话记忆、表情包和提醒功能**，模型能看到、也就可能被诱导发出去的，只有你这一句问题。联网回复里即使带了提醒指令也不会执行。联网对话的问答仍会记进对话记忆，之后的普通聊天能接着聊。
- 比普通聊天慢，实测 15–30 秒；超时上限是 180 秒。
- 命令行：`omarchy-shell agent-pet webchat "问题"`（这句话会出现在进程参数里）。

## 分段气泡

聊天、联网对话和碎碎念的长回复，会拆成多个气泡依次显示，右下角带页码（如 `1/3`）。

- 模型被要求分几段说、段间换行。本地再兜底：太长的段按句子切，句子还太长按逗号切；太短的段并进相邻段。所以模型不守规矩时也能正常分段。
- 每个气泡最多 50 字（英文 120 个字符），按字数停留 4–15 秒，最后一段多留 4 秒。新消息来了会打断剩下的段。
- 模型偶尔会在 JSON 字符串里直接换行（没写成 `\n`），解析时会自动修复。

## 跳回终端

Claude Code / Codex 的会话需要你处理时，可以直接跳回它所在的终端窗口：

- **点工作状态气泡**：宠物头顶显示「需要你确认」「任务完成」这类工作状态时，点一下气泡就切到那个终端；窗口在别的工作区也会跟过去。
- **点通知**：通知带一个「跳到终端」默认动作，点通知本身即可。通知助手发完通知后会留一个后台小进程等你点击，通知关闭或 1 小时后自动退出。
- **快捷键**：`omarchy-shell agent-pet jump` 跳到当前显示的会话，可以绑到 Hyprland 快捷键上，例如 `bind = SUPER, J, exec, omarchy-shell agent-pet jump`。

窗口是 hook 顺着父进程链找到的最近一个 Hyprland 窗口。只在新一轮请求、等待批准、完成、出错这几类事件里查，工具调用事件不多跑 `hyprctl`。tmux 或 ssh 里的会话，父进程链上没有终端窗口，跳不过去。

其他气泡也能点了：分段气泡点一下翻到下一段，最后一段或普通气泡点一下收起。代价是气泡显示期间，那块区域的鼠标点击不会再穿透到下面的窗口。

## 专注模式（番茄钟）

右键菜单「专注 25 分钟」开始，专注期间菜单项变成「结束专注（还剩 N 分钟）」。

- **专注期间**：随机动画只从 `focus.anims` 里挑，不走动也不转身。整点报时和定时碎碎念暂停；提醒、定时任务、事件规则、工作状态照常。
- **结束时**：伸个懒腰，冒气泡并发通知，进入休息；休息结束再提醒一次。
- 状态保存在 `~/.local/state/agent-pet/focus.json`，重启 shell 不会丢。挂起期间到点的，恢复后补报并注明「迟到了」。
- 命令行：`omarchy-shell agent-pet focus 50`（参数为空用默认时长），`omarchy-shell agent-pet focusStop`。

配置写在 `automations.focus`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `minutes` | `25` | 专注时长（分钟） |
| `breakMinutes` | `5` | 休息时长，`0` = 不休息 |
| `anims` | `["写代码", "轻快记录", "原地敲击桌面互动", "待机呼吸休闲"]` | 专注期间的动画池 |
| `notify` | `true` | 专注结束、休息结束时发桌面通知 |

## 示例

```jsonc
"automations": {
  "chime": { "enabled": true, "from": 9, "to": 23 },
  "tasks": [
    // 每天 18:30 提醒下班
    { "name": "offwork", "at": "18:30", "say": "该下班啦", "play": "超大伸懒腰" },
    // 每 10 分钟查 CI，状态变化时播报
    {
      "name": "ci",
      "every": 600,
      "run": "cd ~/coding/wan/agent-pet && gh run list -L 1 --json status,conclusion -q '.[0] | .status + \" \" + .conclusion'",
      "say": "CI：{output}"
    },
    // 每 30 分钟检查有没有没推送的提交，只在失败（有未推送）时说
    {
      "name": "unpushed",
      "every": 1800,
      "run": "cd ~/coding/wan/agent-pet && test -z \"$(git log @{u}.. --oneline)\"",
      "when": "fail",
      "say": "还有提交没推送哦"
    }
  ],
  "rules": [
    // 提交时放烟花
    { "name": "commit", "event": "PostToolUse", "tool": "Bash", "detail": "^git commit", "say": "{project} 提交成功！", "play": "放烟花" },
    // 测试命令失败时叹气
    { "name": "test-fail", "event": "PostToolUseFailure", "tool": "Bash", "detail": "(npm|pnpm) test|pytest|cargo test", "say": "测试挂了……", "play": "工作状态-垂头叹气冒汗", "cooldownSec": 60 },
    // 任务完成时把最后一句回复记到日志（事件 JSON 从 stdin 读）
    { "name": "journal", "event": "Stop", "run": "jq -r '\"\\(now | strflocaltime(\"%F %T\")) \\(.cwd) \\(.lastMessage | .[0:200])\"' >> ~/.local/state/agent-pet/journal.log" }
  ]
}
```

## 命令行

```bash
qs ipc -p <插件目录> call agent-pet chime        # 立即报一次时
qs ipc -p <插件目录> call agent-pet task ci      # 立即跑一次任务，并且总是说出结果
qs ipc -p <插件目录> call agent-pet state        # automations 字段：已启用的任务、规则、错误、正在运行的任务
```

在 Omarchy 上把 `qs ipc -p <插件目录> call` 换成 `omarchy-shell`。

## 注意

- 调度每 15 秒按系统时间检查一次。电脑挂起期间错过的整点和 `at` 时间点，恢复后超过 2 分钟的不会补报。
- 这个分支不能发布到插件市场：`tools/export-omarchy.sh` 遇到含 `Automation.qml` 的提交会拒绝导出，发布请用 `--ref main`。
- 测试：`node --test tools/test-automation.mjs tools/test-reminders.mjs tools/test-segments.mjs`（纯逻辑），`python3 tools/test-runtime.py`（含自动化集成测试）。
