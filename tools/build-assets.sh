#!/usr/bin/env bash
# 把 dsh-pet 的 VP9-alpha webm 转成 Qt AnimatedImage 能播放的 Animated WebP，并复制其它静态素材。
# 用法：tools/build-assets.sh [dsh-pet 插件目录]   （默认 ../dsh-pet/dsh-pet）
# 环境变量：FPS（默认 15）、WIDTH（默认 480）、QUALITY（默认 70）、FORCE=1 重新转码已有文件
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=${1:-$ROOT/../dsh-pet/dsh-pet}
SRC=$(cd "$SRC" && pwd)
FPS=${FPS:-15}
WIDTH=${WIDTH:-480}
QUALITY=${QUALITY:-70}
OUT=$ROOT/assets/webp

mkdir -p "$OUT"
for dir in memes pic; do
  rm -rf "${ROOT:?}/assets/$dir"
  cp -r "$SRC/assets/$dir" "$ROOT/assets/$dir"
done
cp "$SRC/assets/logo.png" "$ROOT/assets/logo.png"

shopt -s nullglob
files=("$SRC"/assets/webm/*.webm)
total=${#files[@]}
i=0
for f in "${files[@]}"; do
  i=$((i + 1))
  name=$(basename "$f" .webm)
  dst=$OUT/$name.webp
  if [[ -f $dst && ${FORCE:-0} != 1 ]]; then continue; fi
  echo "[$i/$total] $name"
  # -c:v libvpx-vp9 必须在 -i 之前：ffmpeg 自带的 vp9 解码器会丢弃 alpha 通道
  ffmpeg -v error -y -c:v libvpx-vp9 -i "$f" \
    -vf "fps=$FPS,scale=$WIDTH:-1:flags=lanczos" \
    -c:v libwebp_anim -q:v "$QUALITY" -loop 0 "$dst.tmp.webp"
  mv "$dst.tmp.webp" "$dst"
done

# 帧率写进清单，播放端用它把帧号换算成秒（移动动画的 leadSec/tailSec 依赖它）
printf '{"fps": %s, "width": %s}\n' "$FPS" "$WIDTH" > "$OUT/manifest.json"
du -sh "$OUT"
