#!/usr/bin/env bash
# macOS: double-click in Finder, or run ./launch.command [port].
set -u
VIS2REG_DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(uname -s)" != "Darwin" ]] || ! command -v open >/dev/null 2>&1; then
  echo "This launcher is for macOS. Run ./serve.sh on another operating system." >&2
  exit 1
fi
# Open a browser only after our server successfully binds its own listening socket.
if VIS2REG_OPEN_BROWSER=1 "$VIS2REG_DEMO_DIR/serve.sh" "$@"; then
  exit 0
else
  VIS2REG_EXIT_CODE=$?
  if [[ -t 0 ]]; then
    echo "Press Return to close / 按回车结束。"
    read -r VIS2REG_CLOSE_LINE
  fi
  exit "$VIS2REG_EXIT_CODE"
fi
