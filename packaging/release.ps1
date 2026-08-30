# packaging/release.ps1
#
# 一键发版：改版本号 → 打包 → 生成 GitHub Release 上传指引（装了 gh CLI 则自动发）。
#
# 用法：
#   .\release.ps1 0.1.1
#   .\release.ps1 0.1.1 -Notes "修复了 xxx"
#
# 依赖：构建机已装 Node + npm（脚本内部会调 build.ps1 完成打包）。
# 发布到 GitHub 需要 GitHub CLI（gh）；没装则脚本会打印手动发布步骤。

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version,
  [string]$Notes = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot          # creat_app\
$Desktop = Join-Path $Root 'desktop'
$Dist = Join-Path $Root 'dist'

# 1) 校验版本号
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  Write-Error "版本号格式不对，应为 x.y.z（如 0.1.1）"
  exit 1
}
$Tag = "v$Version"

# 2) 改版本号（desktop/package.json 的第一个 version 字段）
$pkgPath = Join-Path $Desktop 'package.json'
# 用 UTF-8 显式读取，避免 Windows PowerShell 按 GBK 读乱中文
$content = [System.IO.File]::ReadAllText($pkgPath)
$old = ([regex]::Match($content, '"version"\s*:\s*"([^"]+)"')).Groups[1].Value
if ($old -eq $Version) {
  Write-Host "==> 版本已是 $Version，跳过改写"
}
else {
  $content = [regex]::Replace($content, '"version"\s*:\s*"[^"]+"', ('"version": "' + $Version + '"'), 1)
  [System.IO.File]::WriteAllText($pkgPath, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Host "==> 版本号 $old -> $Version"
}

# 3) 打包
Write-Host "==> 打包（会花几分钟）..."
& (Join-Path $PSScriptRoot 'build.ps1') -LaunchMode bundled
if ($LASTEXITCODE -ne 0) {
  Write-Error "打包失败（exit $LASTEXITCODE），已停止。"
  exit 1
}

# 4) 找到 Setup 安装包，复制成无空格/无中文的干净文件名（避免下载链接被 URL 编码）
$setup = Get-ChildItem $Dist -File -Filter '*.exe' |
  Where-Object { $_.Name -match 'Setup' -and $_.Name -notmatch 'blockmap' } |
  Select-Object -First 1
if (-not $setup) {
  Write-Error "打包后没找到 Setup exe"
  exit 1
}
$cleanName = "DeepSeek.Harness.Setup.$Version.exe"
$cleanExe = Join-Path $Dist $cleanName
Copy-Item $setup.FullName $cleanExe -Force
Write-Host "==> 安装包：$cleanExe"

# 5) 发布 Release
$notes = if ($Notes) { $Notes } else { "发布 $Tag" }
Write-Host ""
Write-Host "==== 发布 Release ===="
if (Get-Command gh -ErrorAction SilentlyContinue) {
  Write-Host "==> 检测到 gh CLI，自动创建 Release $Tag ..."
  gh release create $Tag $cleanExe --title $Tag --notes $notes
  Write-Host "==> 完成！"
}
else {
  Write-Host "==> 未安装 gh CLI，请手动发布（约 1 分钟）："
  Write-Host "    1. 打开  https://github.com/Adrain-Lin/deepseek-harness-desktop/releases/new"
  Write-Host "    2. Tag 填  $Tag"
  Write-Host "    3. 把下面这个文件拖进去上传："
  Write-Host "       $cleanExe"
  Write-Host "    4. 点 Publish release"
  Write-Host ""
  Write-Host "    想全自动的话，装 GitHub CLI 后运行：  winget install GitHub.cli  再  gh auth login"
}

Write-Host ""
Write-Host "==> 别忘了把版本号改动提交到 git："
Write-Host "    git add desktop/package.json && git commit -m ""发布 $Tag"" && git push"
