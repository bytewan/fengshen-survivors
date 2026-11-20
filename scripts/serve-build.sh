#!/usr/bin/env bash
# 试玩用的打包版（docs/deploy.md「首次载入与后台预载」「试玩用的打包版」）：生产构建到 dist/，再在局域网里开出来，手机上试真实的加载速度。
# 和开发服务器（5180）互不相干，不会停它。默认端口 5181，可以给别的：scripts/serve-build.sh 5331
# 联机还要另开中继（npm run relay，端口 5300；主目录里一般已经开着）。
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-5181}"
npx tsc --noEmit
npx vite build
echo
echo "打包版：http://localhost:${PORT}/（局域网地址见下面 Network 一行）；Ctrl+C 停止"
exec npx vite preview --host --port "$PORT" --strictPort
