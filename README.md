# Agent Pet

English | [简体中文](README.zh-CN.md)

![Agent Pet showing Claude Code's current work status](docs/screenshot.png)

Agent Pet is a desktop pet for Quickshell that reacts to what Claude Code and Codex are doing. When an agent thinks, calls a tool, waits for approval, finishes, or fails, the pet switches to a matching animation and shows the current progress in a speech bubble. It runs as an Omarchy 4 plugin (`chthollyphile.agent-pet`) or standalone on any Wayland desktop with layer-shell support.

The character, animations, and core pet behavior are ported from [dsh-pet](https://github.com/PC2005-cloud/dsh-pet). See [Credits and license](#credits-and-license).

## Features

- **Pet behavior**: idling, random actions, turning, walking, click reactions, and physics-based dragging and throwing.
- **Work status**: receives events through Claude Code / Codex hooks and switches between six states (thinking, working, reviewing results, waiting, success, error). The bubble can show the project name, the current tool and command, and either the agent's own step narration or a model-generated step summary.
- **Attention alerts**: shows a bubble when approval is needed, when a task completes, or when it fails, and sends a desktop notification if the terminal that sent the event is not focused.
- **Usage**: plays an animation for the most constrained limit window and lists each window's usage and reset countdown. Uses Omarchy's `omarchy.agents` data on Omarchy and a built-in collector elsewhere.
- **Murmurs and chat**: generated with `claude -p` or `codex exec`. By default the pet only calls a model when you explicitly ask it to.
- **English and Chinese UI**: chosen automatically from the system locale, or set manually.

## Requirements

- [Quickshell](https://quickshell.org/) and a Wayland compositor with layer-shell support (Hyprland, Sway, niri, …; GNOME is not supported)
- `qt6-imageformats` for WebP decoding in Qt (Arch: `sudo pacman -S qt6-imageformats`). Restart any running Quickshell instance after installing it.
- `jq`, `notify-send`
- `python3` for usage collection outside Omarchy
- Claude Code and/or the Codex CLI for work-status integration

## Installation

### Quick install (recommended)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chthollyphile/agent-pet/main/install.sh)
```

The repository includes the animation assets, so the download is about 180 MB. The installer asks before each step:

1. Check dependencies.
2. Install the plugin: with `omarchy plugin add` from the plugin release repository when Omarchy is present (Omarchy shows its own security prompt), otherwise as a standalone instance cloned to `~/.local/share/agent-pet`. Set `AGENT_PET_MODE=standalone` to use standalone mode on Omarchy as well.
3. Install the Claude Code / Codex hooks (configuration files are backed up first).
4. Enable the plugin, or start the standalone instance and show how to launch it at login.

### Install with `omarchy plugin add`

```bash
omarchy plugin add https://github.com/chthollyphile/omarchy-agent-pet --enable
```

[omarchy-agent-pet](https://github.com/chthollyphile/omarchy-agent-pet) is the plugin release repository: it is generated from this repository by `tools/export-omarchy.sh` and contains only the files the plugin needs at runtime.

The animation assets are part of the repository, so the pet appears as soon as the plugin is enabled. `omarchy plugin add` runs no install steps; to connect Claude Code / Codex, install the hooks yourself:

```bash
~/.config/omarchy/plugins/chthollyphile.agent-pet/bin/agent-pet-install-hooks
```

### Standalone mode

Standalone mode needs only Quickshell:

```bash
qs -p /path/to/agent-pet                       # start; Quickshell reloads automatically when QML changes
qs ipc -p /path/to/agent-pet call agent-pet state
```

To start it at login on Hyprland, add `exec-once = qs -p /path/to/agent-pet` to your configuration; elsewhere, use a systemd user service.

Differences from plugin mode:

- Menus and the chat box use the default theme in `Commons/`; as an Omarchy plugin they follow the Omarchy theme.
- If Omarchy's `omarchy-agent-usage-update` is not available, usage is collected by `bin/agent-pet-usage` and stored in `~/.local/state/agent-pet/usage/`.
- Hooks send events to the Omarchy plugin first and fall back to the standalone instance, so both modes share one hook configuration.
- Do not run both modes at once, or two pets will appear.

### Connect Claude Code and Codex

```bash
bin/agent-pet-install-hooks               # writes ~/.claude/settings.json and ~/.codex/hooks.json (backed up first)
bin/agent-pet-install-hooks --uninstall   # removes them
```

- Running the installer again does not create duplicate entries.
- Codex may ask you to review new hooks the first time it sees them; trust them when prompted.
- `bin/agent-pet-hook` writes nothing to standard output and returns immediately. Events are forwarded in the background in about 40 ms, so agents are not slowed down.

## Configuration

Built-in defaults live in `assets/config.json`. Put your settings in `~/.config/agent-pet/config.jsonc` (comments allowed); changes apply as soon as the file is saved.

Each top-level field in your file **replaces** the default as a whole. For example, if you set `stepSummary`, include both `mode` and `intervalSec`.

| Field | Default | Description |
|---|---|---|
| `language` | `"auto"` | UI language: `auto`, `zh`, or `en`. `auto` checks `LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, then `LANG`, and uses Chinese for locales starting with `zh`, English otherwise. |
| `workStatusDetail` | `false` | Show the tool name and a command or file summary in the work-status bubble, e.g. `Bash · npm test`. No model call. |
| `stepSummary` | `{"mode":"off","intervalSec":60}` | Step narration in the bubble. `off`: disabled. `transcript`: the agent's own latest message from the session transcript, with no model call; shows the final reply when the task ends. `model`: `autoModel` summarizes the request and the last 8 actions in one sentence, about 8 s after the first step of a turn, then at most every `intervalSec` seconds and only when there are new steps. |
| `autoModel` | `{"provider":"claude","claudeModel":"haiku","codexModel":"gpt-5.6-luna"}` | Model for automated tasks (model step summaries, timed murmurs). Defaults to low-cost models instead of the CLI's default model; Codex runs with low reasoning effort. |
| `llm` | `{"provider":"claude","claudeModel":"haiku","codexModel":""}` | CLI and model for murmurs and chat you trigger manually. An empty `codexModel` uses Codex's default model. |
| `whisperAuto` | `false` | Murmur on a timer every `eventsRefreshSec.whisper` seconds (uses `autoModel`). Skipped while an agent is working. |
| `agents` | `{"claude":true,"codex":true}` | Which agents' events to accept. |
| `usage` | `{"agent":"auto","source":"auto","refreshSec":900}` | `agent`: whose usage to show; `auto` is the agent that sent the latest event. `source`: `auto` uses Omarchy's data when available and the built-in collector otherwise; `omarchy` or `builtin` force one. `refreshSec`: records older than this are refreshed in the background. A manual check refreshes data older than 60 s first. |
| `notify.onlyWhenUnfocused` | `true` | Send desktop notifications only when the terminal that sent the event is not focused. |
| `clickAction` | `"react"` | Left-click behavior: `react` plays a click reaction, `usage` shows usage. |
| `bubbleFont` | `{"family":"","file":"","size":14}` | Bubble font. `file` (a font file path, `~/` allowed) takes precedence over `family` (an installed font name, see `fc-list : family`). When both are empty, the English UI uses Noto Sans and the Chinese UI uses Noto Sans CJK SC. |
| `layer` | `"top"` | Layer the pet lives on. `overlay` keeps it above fullscreen applications. |
| `pets[].screen` | first screen | Output the pet lives on (see `hyprctl monitors`). |

Fields inherited from dsh-pet (`animations`, `physics`, `pets`, `workStatusTexts`, `whisperPrompt`, `memes`, …) keep their meaning. In the English UI, English versions of `workStatusTexts` and `whisperPrompt` are used unless you customize them.

### Example

```jsonc
{
  // Appearance and interaction
  "language": "auto",
  "bubbleFont": { "family": "", "file": "", "size": 14 },
  "clickAction": "usage",
  "layer": "top",

  // Work status
  "workStatusDetail": true,
  "stepSummary": { "mode": "transcript", "intervalSec": 60 },
  "notify": { "onlyWhenUnfocused": true },
  "agents": { "claude": true, "codex": true },

  // Usage
  "usage": { "agent": "auto", "source": "auto", "refreshSec": 900 },

  // Models
  "llm": { "provider": "claude", "claudeModel": "haiku", "codexModel": "" },
  "autoModel": { "provider": "claude", "claudeModel": "haiku", "codexModel": "gpt-5.6-luna" },
  "whisperAuto": false,
  "eventsRefreshSec": { "balance": 1800, "whisper": 600 },

  // Pets (if you set pets, write out every field of each pet)
  "pets": [
    {
      "name": "Agent Pet",
      "id": "main",
      "size": 300,
      "balanceEnabled": true,
      "whisperEnabled": true,
      "workStatusEnabled": true,
      "fixedEnabled": false,           // true: never walks or turns on its own
      "display": "both",
      "screen": "eDP-1",               // optional; defaults to the first screen
      "position": { "corner": "bottom-right", "marginX": 24, "marginY": 0 }
    }
  ]
}
```

## Command-line control

The plugin registers the IPC target `agent-pet`. Use `omarchy-shell` on Omarchy and `qs ipc -p <plugin directory> call` in standalone mode:

```bash
omarchy-shell agent-pet state           # JSON: sessions, usage, configuration status
omarchy-shell agent-pet say "Hello"
omarchy-shell agent-pet play 涮火锅      # animation names are the asset file names
omarchy-shell agent-pet usage
omarchy-shell agent-pet whisper         # calls a model once
omarchy-shell agent-pet chat "Hi there" # calls a model once
omarchy-shell agent-pet toggle          # hide / show
omarchy-shell agent-pet reload
```

## Privacy and model usage

- **Model calls** happen only for the context-menu **Murmur** and **Chat** actions, the `whisper` and `chat` IPC methods, and the opt-in `whisperAuto` and `stepSummary.mode = "model"` settings. The pet's own model calls never trigger hooks.
- **Data forwarded by hooks** is limited to the event name, session ID, project path, tool name, the first line of the tool arguments (up to 120 characters), notification text (up to 200), the first 300 characters of the turn's prompt, the final reply when a turn ends (up to 2000), and the transcript path. It travels over local IPC to Quickshell and never leaves your machine.
- **Session transcripts** are read only when `stepSummary.mode = "transcript"`, and only the last 400 KB each time.
- **Network access** is used only outside Omarchy, to query Claude / Codex rate limits. Limit queries only read usage and do not consume any quota.

## Known limitations

- A pet stays on its own screen and does not fly across screens.
- Detecting whether the terminal is focused relies on `hyprctl`. Outside Hyprland, and for sessions inside tmux or ssh, the terminal is always treated as unfocused.
- dsh-pet's pet-to-pet collisions, click scoring, and pet packs are not ported yet.

## Development

### Build from source

The animation assets are transcoded from dsh-pet's source videos. You need the dsh-pet sources (in `../dsh-pet` by default), `ffmpeg` with libvpx and libwebp, and Node.js:

```bash
git clone https://github.com/PC2005-cloud/dsh-pet.git ../dsh-pet
npm install
npm run build        # builds lib/shared.mjs, assets/config.json, assets/webp, assets/memes, assets/pic
ln -s "$PWD" ~/.config/omarchy/plugins/chthollyphile.agent-pet
omarchy-shell shell rescanPlugins
omarchy plugin enable chthollyphile.agent-pet
```

Notes:

- Omarchy does not watch a symlinked plugin directory for changes.
- `omarchy-shell shell rescanPlugins` reloads only `Service.qml`; components such as `Pet.qml` keep their previously compiled version. Run `omarchy-restart-shell` after changing them, or develop in standalone mode, which reloads automatically.

The built assets under `assets/` are committed. Every committed version stays in the history that each install clones, so commit asset changes only when they are final.

### Publishing the Omarchy plugin

The Omarchy marketplace lists [omarchy-agent-pet](https://github.com/chthollyphile/omarchy-agent-pet), not this repository. Export the committed `HEAD` into a checkout of it, which also runs `omarchy plugin validate`:

```bash
tools/export-omarchy.sh --commit                       # writes ../omarchy-agent-pet and commits "Sync from agent-pet <sha>"
git -C ../omarchy-agent-pet push
```

The export contains the plugin QML files, `lib/`, `bin/`, `assets/`, and `LICENSE`, plus the release repository's own README and preview image from `packaging/omarchy/` and `docs/`. Standalone mode, the installer, and build tools stay here. After pushing, request verification of the new commit through the marketplace's plugin verification form.

### Project layout

| Path | Description |
|---|---|
| `Service.qml` | Central state: configuration, session aggregation, usage, model calls, notifications, IPC |
| `PetOverlay.qml` | One full-screen transparent layer-shell window per screen; input is limited to the pet |
| `Pet.qml` | Animation playback and transitions, movement, dragging and throwing, bubbles |
| `PetMenu.qml`, `ChatInput.qml`, `Bubble.qml`, `Llm.qml` | Context menu, chat box, speech bubble, CLI calls |
| `lib/shared.mjs` | Bundled from dsh-pet's `src/shared`; do not edit by hand |
| `lib/work-status.mjs`, `lib/usage.mjs`, `lib/i18n.mjs`, `lib/jsonc.mjs` | Event aggregation, usage parsing, UI strings, JSONC parsing |
| `shell.qml`, `Commons/` | Standalone entry point and default theme |
| `install.sh` | Installer |
| `bin/` | Hook bridge and installer, transcript reader, built-in usage collector |
| `assets/` | Default configuration, animations (`webp/`), stickers (`memes/`), and notification icons (`pic/`) |
| `tools/` | Build scripts for assets, shared logic, and default configuration; Omarchy plugin export |
| `packaging/omarchy/` | README for the plugin release repository |
| `docs/` | Screenshots |

## Credits and license

**[dsh-pet](https://github.com/PC2005-cloud/dsh-pet)** (MIT, © PC2005-cloud): the character, animations, and pet behavior come from dsh-pet. Many thanks to [@PC2005-cloud](https://github.com/PC2005-cloud). Specifically:

- The 106 transparent animations, stickers, and notification icons under `assets/`, transcoded from dsh-pet's assets.
- The default configuration: animation pools, weights, physics parameters, work-status texts, and persona prompt.
- The physics, animation picking, movement planning, and menu tree from `src/shared`, bundled unchanged into `lib/shared.mjs`.
- The design of the six work states.

The third-party font bundled with dsh-pet is not used.

**[Omarchy](https://github.com/basecamp/omarchy)** (MIT, © David Heinemeier Hansson): usage collection is ported from Omarchy's `omarchy.agents` plugin. On Omarchy, the pet uses its `omarchy-agent-usage-update` command and records directly; elsewhere, `bin/agent-pet-usage` collects rate limits the same way. Only the rate-limit part is ported.

Agent Pet is released under the MIT License; see [LICENSE](LICENSE), which also carries the dsh-pet and Omarchy copyright notices.
