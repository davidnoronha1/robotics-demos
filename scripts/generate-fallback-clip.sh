#!/usr/bin/env bash
# Regenerates demos/opticalflow/assets/fallback.webm — the bundled clip that
# powers the demo when the visitor has no webcam / denies permission.
#
# The scene is synthetic and license-free: a textured backdrop (the Mandelbrot
# set) that the "camera" pans across, plus two high-contrast shapes moving on
# top. Features are plentiful, and the different layers move at different
# rates so the tracker's motion model reads as genuine parallax.
#
#   FFmpeg must be on PATH. Run:  scripts/generate-fallback-clip.sh
#
# Deterministic except for encoder noise; sizes ~270 KB.
set -euo pipefail

OUT="${1:-demos/opticalflow/assets/fallback.webm}"
DUR="8"

mkdir -p "$(dirname "$OUT")"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "mandelbrot=size=640x480:r=30" \
  -t "$DUR" \
  -vf "fps=30,crop=320:240:x='20 + 40*sin(2*PI*(t/6))':y='10 + 15*sin(PI*(t/6)*0.6)',format=yuv420p,drawbox=x='20+70*sin(2*PI*(t/5))':y='30+40*cos(2*PI*(t/4))':w=52:h=40:color=0xeeeeee@0.9:t=fill,drawbox=x='20+70*sin(2*PI*(t/5))':y='30+40*cos(2*PI*(t/4))':w=52:h=40:color=0x141414@0.9:t=3,drawbox=x='240+30*cos(2*PI*(t/3))':y='180+20*sin(2*PI*(t/5))':w=30:h=30:color=0x141414@0.9:t=fill" \
  -c:v libvpx-vp9 -b:v 300k -crf 36 -an "$OUT"

echo "wrote $OUT"