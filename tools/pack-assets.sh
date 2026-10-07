#!/usr/bin/env bash
# 把构建好的素材（assets/webp、memes、pic）打包成 GitHub Release 附件，并写入 assets.json
# （下载地址、sha256、大小）。tar 用固定的排序、时间和属主生成，同样的素材得到同样的 sha256。
#
# 用法：tools/pack-assets.sh [--repo owner/name] [--version N]
#   默认 repo 取 git remote origin，取不到时用 chthollyphile/agent-pet；version 默认 1
# 打包后上传：gh release create assets-v<N> dist/agent-pet-assets-v<N>.tar
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
repo=""
version=1
while (( $# )); do
  case $1 in
    --repo) repo=$2; shift 2 ;;
    --version) version=$2; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
if [[ -z $repo ]]; then
  origin=$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)
  repo=$(sed -nE 's#^.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#p' <<<"$origin")
  repo=${repo:-chthollyphile/agent-pet}
fi

"$ROOT/bin/agent-pet-fetch-assets" --check || { echo "素材不完整，先运行 npm run build" >&2; exit 1; }

tag="assets-v$version"
file="agent-pet-assets-v$version.tar"
mkdir -p "$ROOT/dist"
tar --sort=name --mtime='2026-01-01 00:00Z' --owner=0 --group=0 --numeric-owner \
  -C "$ROOT" -cf "$ROOT/dist/$file" assets/webp assets/memes assets/pic

sha=$(sha256sum "$ROOT/dist/$file" | cut -d' ' -f1)
size=$(stat -c%s "$ROOT/dist/$file")
jq -n --argjson version "$version" --arg tag "$tag" --arg file "$file" --arg sha "$sha" --argjson size "$size" \
  --arg url "https://github.com/$repo/releases/download/$tag/$file" \
  '{version: $version, tag: $tag, file: $file, url: $url, sha256: $sha, size: $size}' > "$ROOT/assets.json"

echo "dist/$file  $(( size / 1048576 )) MB  sha256 $sha"
echo "assets.json 已更新。上传：gh release create $tag dist/$file --title \"Assets v$version\""
