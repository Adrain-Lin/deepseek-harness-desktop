# packaging/build.ps1
#
# 一键构建 + 打包桌面端。
#
# 用法：
#   .\build.ps1                 # bundled 模式：dsh 引擎打进应用（自包含）
#   .\build.ps1 -LaunchMode npx # npx 模式：目标机器需 Node，首次联网拉取
#   .\build.ps1 -Portable       # 额外产出免安装便携版
#
# 依赖：本机已装 Node.js + npm（构建机），Electron/electron-builder 由脚本安装。

param(
  [ValidateSet('npx', 'bundled')]
  [string]$LaunchMode = 'bundled',
  [switch]$Portable
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot          # creat_app\
$Desktop = Join-Path $Root 'desktop'
$Dist = Join-Path $Root 'dist'

Write-Host "==> 工作区: $Root"
Write-Host "==> 引擎模式: $LaunchMode"

# 1) 准备 bundled 引擎目录（npx 模式也给个占位，避免 electron-builder 找不到 from）
$DshDest = Join-Path $Desktop 'resources\dsh'
New-Item -ItemType Directory -Force -Path $DshDest | Out-Null

if ($LaunchMode -eq 'bundled') {
  Write-Host "==> 安装 dsh 引擎 + 插件市场到 $DshDest ..."
  Push-Location $DshDest
  try {
    npm init -y | Out-Null
    # dshmarket 随引擎一起 npm 安装（含其运行时依赖 js-yaml/undici）。锁定大版本，
    # 避免上游破坏性变更静默进入发版产物。
    npm install @deepseek-ai/dsh dshmarket@1.38.1
    Write-Host "==> 已安装 dsh $((Get-Content (Join-Path $DshDest 'node_modules\@deepseek-ai\dsh\package.json') | ConvertFrom-Json).version) / dshmarket $((Get-Content (Join-Path $DshDest 'node_modules\dshmarket\package.json') | ConvertFrom-Json).version)"
  }
  finally { Pop-Location }

  # 把插件作为「真实目录」复制进引擎的 node_modules（不用 npm file:，因为那会生成
  # junction/符号链接，electron-builder 打包时会丢链）。loader 按裸包名解析。
  $pluginDest = Join-Path $DshDest 'node_modules\@adrainlin\dsh-desktop-plugin'
  Remove-Item $pluginDest -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path (Split-Path $pluginDest) | Out-Null
  Copy-Item (Join-Path $Root 'plugin') $pluginDest -Recurse
  Write-Host "==> 插件已复制到 $pluginDest"
}

# 1.5) 便携 Node 运行时（bundled 用真实 Node 跑 dsh；ELECTRON_RUN_AS_NODE 会让
# dsh web 启动后立即退出，不可用）。npx 模式给占位目录避免 electron-builder 找不到 from。
$NodeDest = Join-Path $Desktop 'resources\node'
if ($LaunchMode -eq 'bundled') {
  if (-not (Test-Path (Join-Path $NodeDest 'node.exe'))) {
    $NodeVer = 'v24.16.0'
    $nodeZip = Join-Path $Desktop "node-$NodeVer-win-x64.zip"
    if (-not (Test-Path $nodeZip)) {
      Write-Host "==> 下载便携 Node $NodeVer ..."
      curl.exe -L --retry 3 --connect-timeout 40 -o $nodeZip "https://npmmirror.com/mirrors/node/$NodeVer/node-$NodeVer-win-x64.zip"
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $Desktop 'resources') | Out-Null
    tar.exe -xf $nodeZip -C (Join-Path $Desktop 'resources')
    Move-Item (Join-Path $Desktop "resources\node-$NodeVer-win-x64") $NodeDest
    Remove-Item $nodeZip -Force -ErrorAction SilentlyContinue
  }
  Write-Host "==> 便携 Node 就绪: $(Test-Path (Join-Path $NodeDest 'node.exe'))"
}
else {
  New-Item -ItemType Directory -Force -Path $NodeDest | Out-Null
}

# 2) 安装桌面壳依赖并打包
Push-Location $Desktop
try {
  Write-Host "==> 安装桌面壳依赖 ..."
  npm install

  Write-Host "==> 打包（electron-builder）..."
  # Electron 二进制走 npmmirror（GitHub 直连会超时）；electron-builder 自身
  # 二进制（winCodeSign/nsis）也走 npmmirror。
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  if ($Portable) {
    npx electron-builder --win portable
  }
  else {
    npx electron-builder --win
  }
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder 打包失败（exit $LASTEXITCODE）"
  }
}
finally { Pop-Location }

Write-Host "==> 完成。产物在: $Dist"
