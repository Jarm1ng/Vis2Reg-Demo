#!/usr/bin/env bash
# Serve the bundled demo locally. Usage: ./serve.sh [port]
set -euo pipefail
VIS2REG_DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
VIS2REG_PORT="${1:-${PORT:-8777}}"
if (( $# > 1 )) || [[ ! "$VIS2REG_PORT" =~ ^[0-9]{1,5}$ ]]; then
  echo "Usage / 用法: ./serve.sh [port, 1–65535]" >&2
  exit 2
fi
VIS2REG_PORT=$((10#$VIS2REG_PORT))
if (( VIS2REG_PORT < 1 || VIS2REG_PORT > 65535 )); then
  echo "Port must be between 1 and 65535 / 端口应为 1–65535。" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required to serve the demo. Install Python 3, then run this command again." >&2
  echo "需要 Python 3 启动本地服务；安装后重新运行。" >&2
  exit 1
fi
if [[ ! -f "$VIS2REG_DEMO_DIR/index.html" ]]; then
  echo "index.html is missing. Keep this launcher inside the complete vis2reg_demo folder." >&2
  exit 1
fi
exec python3 -u - "$VIS2REG_PORT" "$VIS2REG_DEMO_DIR" <<'PY'
import functools
import http.server
import os
import subprocess
import sys

if sys.version_info < (3, 7):
    print("Python 3.7 or newer is required / 需要 Python 3.7 或更新版本。", file=sys.stderr)
    raise SystemExit(1)

port, directory = int(sys.argv[1]), sys.argv[2]
url = f"http://127.0.0.1:{port}/index.html"
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
try:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
except OSError as error:
    print(f"Could not start Vis2Reg on port {port}: {error}", file=sys.stderr)
    print("Another service may be using this port. Stop that service or choose another port,", file=sys.stderr)
    print("for example: ./serve.sh 8778  (or ./launch.command 8778).", file=sys.stderr)
    print("端口可能已占用；请停止占用进程，或指定其他端口。未打开任何已有服务。", file=sys.stderr)
    raise SystemExit(1)

print(f"Vis2Reg — Liver AR Studio\n{url}\nLocal computer only · 仅本机访问\nCtrl-C to stop / 按 Ctrl-C 停止")
if os.environ.get("VIS2REG_OPEN_BROWSER") == "1":
    try:
        subprocess.run(["open", url], check=True)
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"Could not open the browser automatically: {error}\nOpen the URL above manually.", file=sys.stderr)
try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nVis2Reg server stopped / 本地服务已停止。")
finally:
    server.server_close()
PY
