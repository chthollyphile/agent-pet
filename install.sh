#!/usr/bin/env bash
# agent-pet 安装脚本。每一步都先询问，不会在未确认时下载或修改配置。
#
# 用法：bash <(curl -fsSL https://raw.githubusercontent.com/chthollyphile/agent-pet/main/install.sh)
#       或在 clone 下来的仓库里运行 ./install.sh
#       AGENT_PET_MODE=standalone ./install.sh   在 Omarchy 上也装成独立模式
#
# 步骤：检查依赖 → 安装插件（Omarchy 用 `omarchy plugin add` 安装发布仓库 omarchy-agent-pet，
#      否则 clone 到 ~/.local/share/agent-pet，
#      作为独立 Quickshell 实例运行）→ 接入 Claude Code / Codex hooks → 启用 / 启动
set -euo pipefail

REPO_URL=${AGENT_PET_REPO:-https://github.com/chthollyphile/agent-pet.git}
# Omarchy 插件从发布仓库安装（由 tools/export-omarchy.sh 生成，只含运行文件）
PLUGIN_REPO_URL=${AGENT_PET_PLUGIN_REPO:-https://github.com/chthollyphile/omarchy-agent-pet.git}
PLUGIN_ID=chthollyphile.agent-pet

zh() { [[ ${LANGUAGE:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}} == zh* ]]; }
say() { if zh; then echo "$1"; else echo "$2"; fi; }
step() { echo; if zh; then echo "==> $1"; else echo "==> $2"; fi; }
# ask "中文问题" "English question" → 默认是
ask() {
  local q answer
  if zh; then q="$1 [Y/n] "; else q="$2 [Y/n] "; fi
  read -r -p "$q" answer </dev/tty || return 1
  [[ ! $answer =~ ^[Nn] ]]
}

[[ -r /dev/tty ]] || { say "需要在终端里交互运行" "Run this interactively in a terminal" >&2; exit 1; }

# ---------------------------------------------------------------- 依赖
step "检查依赖" "Checking dependencies"
missing=()
for cmd in git jq notify-send; do
  command -v "$cmd" >/dev/null || missing+=("$cmd")
done
command -v qs >/dev/null || command -v quickshell >/dev/null || missing+=("quickshell")
if (( ${#missing[@]} )); then
  say "缺少命令：${missing[*]}" "Missing commands: ${missing[*]}" >&2
  exit 1
fi
command -v python3 >/dev/null || say "提示：没有 python3，非 Omarchy 环境下无法采集用量" \
  "Note: python3 not found; usage limits can't be collected outside Omarchy"
if ! find /usr/lib /usr/lib64 /usr/lib/qt6 -path '*qt6/plugins/imageformats/libqwebp.so' -print -quit 2>/dev/null | grep -q .; then
  say "缺少 Qt 的 WebP 支持：请安装 qt6-imageformats（Arch：sudo pacman -S qt6-imageformats），装完要重启 Quickshell。" \
    "Qt WebP support is missing: install qt6-imageformats (Arch: sudo pacman -S qt6-imageformats), then restart Quickshell."
  ask "仍然继续安装？" "Continue anyway?" || exit 1
fi

# ---------------------------------------------------------------- 安装插件
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || true)
local_repo=""
[[ -n $script_dir && -f $script_dir/manifest.json && -d $script_dir/.git ]] && local_repo=$script_dir

# AGENT_PET_MODE=omarchy|standalone 可强制指定；默认有 omarchy-plugin-add 就装成 Omarchy 插件
mode=${AGENT_PET_MODE:-}
if [[ -z $mode ]]; then
  if command -v omarchy-plugin-add >/dev/null; then mode=omarchy; else mode=standalone; fi
fi

if [[ $mode == omarchy ]]; then
  dir=$HOME/.config/omarchy/plugins/$PLUGIN_ID
  step "安装 Omarchy 插件" "Installing the Omarchy plugin"
  if [[ -e $dir ]]; then
    say "已安装：$dir" "Already installed: $dir"
  else
    # omarchy plugin add 会自己显示安全提示并询问；这里不加 --yes
    omarchy-plugin-add "$PLUGIN_REPO_URL"
  fi
else
  step "安装独立模式（只依赖 Quickshell）" "Installing standalone mode (Quickshell only)"
  if [[ -n $local_repo ]]; then
    dir=$local_repo
    say "使用当前仓库：$dir" "Using this checkout: $dir"
  else
    dir=${XDG_DATA_HOME:-$HOME/.local/share}/agent-pet
    if [[ -d $dir/.git ]]; then
      say "已安装：$dir（更新请运行 git -C $dir pull）" "Already installed: $dir (update with git -C $dir pull)"
    else
      git clone "$REPO_URL" "$dir"
    fi
  fi
fi

# ---------------------------------------------------------------- hooks
step "Claude Code / Codex 工作状态" "Claude Code / Codex work status"
if ask "接入 hooks？会修改 ~/.claude/settings.json 和 ~/.codex/hooks.json（先自动备份）" \
  "Install hooks? This edits ~/.claude/settings.json and ~/.codex/hooks.json (backed up first)"; then
  "$dir/bin/agent-pet-install-hooks"
else
  say "已跳过。之后可以运行：$dir/bin/agent-pet-install-hooks" "Skipped. Run later: $dir/bin/agent-pet-install-hooks"
fi

# ---------------------------------------------------------------- 启用 / 启动
if [[ $mode == omarchy ]]; then
  step "启用插件" "Enabling the plugin"
  if omarchy-plugin-list --json 2>/dev/null | jq -e --arg id "$PLUGIN_ID" 'any(.[]; .id == $id and .enabled)' >/dev/null; then
    say "插件已启用" "The plugin is already enabled"
  elif ask "现在启用 $PLUGIN_ID？" "Enable $PLUGIN_ID now?"; then
    omarchy-plugin-enable "$PLUGIN_ID"
  else
    say "之后可以运行：omarchy plugin enable $PLUGIN_ID" "Enable later with: omarchy plugin enable $PLUGIN_ID"
  fi
else
  step "启动" "Starting"
  qs_bin=$(command -v qs || command -v quickshell)
  if ask "现在启动？（$qs_bin -p $dir）" "Start it now? ($qs_bin -p $dir)"; then
    setsid "$qs_bin" -p "$dir" >/dev/null 2>&1 < /dev/null &
  fi
  say "开机启动：Hyprland 可在配置里加  exec-once = $qs_bin -p $dir" \
    "Autostart: on Hyprland add  exec-once = $qs_bin -p $dir"
fi

echo
say "完成。" "Done."
