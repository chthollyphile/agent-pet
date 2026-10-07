#!/usr/bin/env bash
# 从本仓库导出 Omarchy 插件发布仓库（chthollyphile/omarchy-agent-pet）。
# 本仓库是唯一源头；发布仓库只放插件运行需要的文件，不手工修改。
#
# 用法：tools/export-omarchy.sh [--commit] [--ref <rev>] [目标目录]
#   目标目录默认 ../omarchy-agent-pet；不是 git 仓库时会 git init
#   --commit  导出后在目标仓库提交，提交信息带上源 commit
#   --ref     导出指定的 commit（默认 HEAD）
# 导出的是已提交的内容，工作区里未提交的改动不会带过去。
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
commit=0
ref=HEAD
target=""
while (( $# )); do
  case $1 in
    --commit) commit=1; shift ;;
    --ref) ref=$2; shift 2 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) target=$1; shift ;;
  esac
done
target=${target:-$ROOT/../omarchy-agent-pet}

# 插件运行需要的文件。独立模式（shell.qml、Commons/）、安装脚本和构建工具不导出：
# 作为 Omarchy 插件运行时 qs.Commons 解析到 Omarchy 自己的 Commons。
runtime=(
  manifest.json LICENSE assets
  Service.qml EventServer.qml Pet.qml PetOverlay.qml PetMenu.qml ChatInput.qml Bubble.qml Llm.qml
  lib bin
)
# 发布仓库专用文件：源路径 → 目标路径
extra=(
  packaging/omarchy/README.md:README.md
  packaging/omarchy/README.zh-CN.md:README.zh-CN.md
  docs/screenshot.png:preview.png
  docs/screenshot.zh-CN.png:docs/screenshot.zh-CN.png
)

sha=$(git -C "$ROOT" rev-parse --verify "$ref^{commit}")
[[ $ref != HEAD || -z $(git -C "$ROOT" status --porcelain) ]] || echo "注意：工作区有未提交的改动，只导出 HEAD" >&2

mkdir -p "$target"
target=$(cd "$target" && pwd -P)
[[ $target != "$ROOT" ]] || { echo "目标目录不能是本仓库" >&2; exit 1; }
# 下面会清空目标目录，只接受空目录或之前导出过的发布仓库
if [[ -n $(find "$target" -mindepth 1 -maxdepth 1 ! -name .git -print -quit) ]] \
  && ! jq -e '.id == "chthollyphile.agent-pet"' "$target/manifest.json" >/dev/null 2>&1; then
  echo "目标目录非空且不是 agent-pet 发布仓库：$target" >&2
  exit 1
fi
[[ -d $target/.git ]] || git -C "$target" init -q -b main

# 清空除 .git 外的所有内容，保证删掉的文件在发布仓库里也消失
find "$target" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

git -C "$ROOT" archive --format=tar "$sha" -- "${runtime[@]}" | tar -x -C "$target"
for pair in "${extra[@]}"; do
  src=${pair%%:*} dst=${pair#*:}
  mkdir -p "$(dirname "$target/$dst")"
  git -C "$ROOT" show "$sha:$src" > "$target/$dst"
done
echo "已导出 $sha → $target"

if command -v omarchy >/dev/null; then
  omarchy plugin validate "$target"
  echo "omarchy plugin validate 通过"
fi

if (( commit )); then
  git -C "$target" add -A
  if git -C "$target" diff --cached --quiet; then
    echo "没有变化，不提交"
  else
    git -C "$target" commit -q -m "Sync from agent-pet ${sha:0:7}" -m "Source: https://github.com/chthollyphile/agent-pet/commit/$sha"
    git -C "$target" log --oneline -1
  fi
fi
