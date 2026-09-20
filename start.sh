#!/usr/bin/env bash
# FileServer 一键启动（macOS / Linux）
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  FileServer - 一键启动"
echo "============================================"

if ! command -v node >/dev/null 2>&1; then
    echo "[错误] 未检测到 Node.js，请先安装：https://nodejs.org"
    exit 1
fi
echo "[Info] Node.js $(node -v)"

if [ ! -d "node_modules" ]; then
    echo "[Info] 首次运行，安装依赖（可能需要几分钟）..."
    npm install --registry=https://registry.npmmirror.com
fi

if [ ! -f "dist/index.html" ]; then
    echo "[Info] 首次运行，构建前端..."
    npm run build
fi

echo "[Info] 启动服务器（Ctrl+C 停止，启动后自动打开浏览器）..."
npm start
