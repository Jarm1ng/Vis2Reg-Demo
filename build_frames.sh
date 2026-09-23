#!/usr/bin/env bash
# Rebuild local 960×540 JPEGs from the external saved manual-registration sequence.
set -euo pipefail
VIS2REG_DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
: "${VIS2REG_SOURCE_ROOT:?Set VIS2REG_SOURCE_ROOT to the external patient4 source directory before rebuilding.}"
VIS2REG_REBUILD_ROOT="$VIS2REG_SOURCE_ROOT"
VIS2REG_FRAME_SOURCE="$VIS2REG_REBUILD_ROOT/patient4_liver1_compressed_clip_0_57_sampled_30pct_manual_registration/frames_raw"
VIS2REG_FRAME_OUTPUT="$VIS2REG_DEMO_DIR/data/frames"
VIS2REG_FFMPEG="${FFMPEG:-ffmpeg}"
if ! command -v "$VIS2REG_FFMPEG" >/dev/null 2>&1; then
  echo "FFmpeg is required for rebuilding. Add it to PATH or set FFMPEG to its executable path." >&2
  exit 1
fi
if [[ ! -f "$VIS2REG_FRAME_SOURCE/frame_000000.png" ]]; then
  echo "Missing source frames: $VIS2REG_FRAME_SOURCE" >&2
  echo "Set VIS2REG_SOURCE_ROOT to your external patient4 source directory." >&2
  exit 1
fi
mkdir -p "$VIS2REG_DEMO_DIR/data"
VIS2REG_FRAME_TEMP="$(mktemp -d "$VIS2REG_DEMO_DIR/data/.frames-build.XXXXXX")"
trap 'rm -rf "$VIS2REG_FRAME_TEMP"' EXIT
"$VIS2REG_FFMPEG" -hide_banner -loglevel error -y -start_number 0 \
  -i "$VIS2REG_FRAME_SOURCE/frame_%06d.png" -vf scale=960:540 -q:v 4 \
  -start_number 0 "$VIS2REG_FRAME_TEMP/f_%06d.jpg"
VIS2REG_ENCODED_FRAMES=("$VIS2REG_FRAME_TEMP"/f_*.jpg)
if [[ ! -f "${VIS2REG_ENCODED_FRAMES[0]}" ]]; then
  echo "FFmpeg produced no frames; existing images were preserved." >&2
  exit 1
fi
# Only replace bundled frame images after a successful encode.
mkdir -p "$VIS2REG_FRAME_OUTPUT"
rm -f "$VIS2REG_FRAME_OUTPUT"/f_*.jpg
mv "${VIS2REG_ENCODED_FRAMES[@]}" "$VIS2REG_FRAME_OUTPUT/"
echo "Encoded ${#VIS2REG_ENCODED_FRAMES[@]} frames into $VIS2REG_FRAME_OUTPUT"
