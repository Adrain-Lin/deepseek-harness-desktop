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

function Invoke-Native {
  # 运行外部命令：临时把 ErrorActionPreference 降到 Continue，避免原生命令写到 stderr 的
  # 内容（npm 的 deprecation 警告、npx/electron-builder 的进度与警告）被 'Stop' 当致命错误。
  # 真实失败通过 $LASTEXITCODE 判断并抛出。
  param([scriptblock]$Command, [string]$FailMessage)
  $ErrorActionPreference = 'Continue'
  & $Command
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($code -ne 0) { throw "$FailMessage（exit $code）" }
}

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
    Invoke-Native { npm init -y *> $null } 'npm init 失败'
    # dshmarket 随引擎一起 npm 安装（含其运行时依赖 js-yaml/undici）。锁定大版本，
    # 避免上游破坏性变更静默进入发版产物。
    # npm 11 默认拦截 install scripts（allowScripts 白名单）。但引擎的原生依赖（koffi、
    # node-pty）本就以预编译二进制分发：koffi 走 @koromix/koffi-* optionalDependencies、
    # node-pty 走包内 prebuilds/，跑 install 脚本反而会触发 koffi 的 cnoke.cjs 源码
    # 编译/下载而卡死；其余脚本（ensure-spawn-helper 的 chmod、protobufjs 的 .proto 拉取、
    # @google/genai 的 no-op）在 Windows 上均无实际作用。故用 --ignore-scripts 全部跳过。
    Invoke-Native { npm install @deepseek-ai/dsh dshmarket@1.38.1 --ignore-scripts } 'npm install 失败'
    # 读版本号必须显式 -Encoding UTF8：dshmarket 的 package.json 描述含中文，PS 5.1 的
    # Get-Content 默认按 GBK 读会把 UTF-8 字节读乱、破坏 JSON（ConvertFrom-Json 报错）。
    $dshVersion = (Get-Content (Join-Path $DshDest 'node_modules\@deepseek-ai\dsh\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $marketVersion = (Get-Content (Join-Path $DshDest 'node_modules\dshmarket\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    Write-Host "==> 已安装 dsh $dshVersion / dshmarket $marketVersion"
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
  Invoke-Native { npm install } '桌面壳依赖安装失败'

  Write-Host "==> 打包（electron-builder）..."
  # Electron 二进制走 npmmirror（GitHub 直连会超时）；electron-builder 自身
  # 二进制（winCodeSign/nsis）也走 npmmirror。
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  if ($Portable) {
    Invoke-Native { npx electron-builder --win portable } 'electron-builder 打包失败'
  }
  else {
    Invoke-Native { npx electron-builder --win } 'electron-builder 打包失败'
  }
}
finally { Pop-Location }

Write-Host "==> 完成。产物在: $Dist"
