# FileServer 构建脚本
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File backend\build.ps1
# 产物: backend\FileServer-win.exe（内嵌前端，单文件分发）
param(
    # Go 可执行文件：默认取 PATH 中的 go，需要时在此指定完整路径
    [string]$GoExe = 'go'
)
$ErrorActionPreference = 'Stop'

$backendDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $backendDir

# 1. 同步前端产物到嵌入目录（go:embed 要求源码树内；先清空避免旧哈希资产残留）
#    注意：目标目录必须先建出来——目标不存在时 Copy-Item 会把 assets 子目录内容
#    摊平到 dist 根部，导致运行后所有 /assets/* 404、前端白屏
$embedDistDir = Join-Path $backendDir 'dist'
Remove-Item -Path $embedDistDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -Path $embedDistDir -ItemType Directory -Force | Out-Null
Copy-Item -Path (Join-Path $repoRoot 'dist\*') -Destination $embedDistDir -Recurse -Force

# 2. 编译（-s -w 裁剪符号表，-trimpath 去路径指纹，-X 注入版本号）
#    代理与 GOPATH 沿用当前环境；未配置代理时可按需设置 $env:GOPROXY
Push-Location $backendDir
& $GoExe build -trimpath -ldflags '-s -w -X main.appVersion=2.3.0' -o FileServer-win.exe .
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0) { throw "go build failed, exit code $buildExit" }

$exe = Get-Item (Join-Path $backendDir 'FileServer-win.exe')
Write-Host ("[OK] FileServer-win.exe  {0:N1} MB" -f ($exe.Length / 1MB))
