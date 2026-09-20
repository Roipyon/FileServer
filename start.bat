@echo off
chcp 65001 >nul
title FileServer
cd /d "%~dp0"

echo ============================================
echo   FileServer - 一键启动
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [Info] Node.js %%v

if not exist "node_modules" (
    echo [Info] 首次运行，安装依赖（可能需要几分钟）...
    call npm install --registry=https://registry.npmmirror.com
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试
        pause
        exit /b 1
    )
)

if not exist "dist\index.html" (
    echo [Info] 首次运行，构建前端...
    call npm run build
    if errorlevel 1 (
        echo [错误] 前端构建失败
        pause
        exit /b 1
    )
)

echo [Info] 启动服务器（Ctrl+C 停止，启动后自动打开浏览器）...
call npm start
pause
