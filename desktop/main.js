/**
 * DeepSeek Harness 桌面端 —— Electron 主进程。
 *
 * 职责：
 *  1. 单实例锁；
 *  2. 拉起 dsh web 引擎（npx 或 bundled 两种模式），等待端口就绪；
 *  3. 打开原生窗口加载 127.0.0.1:<port>；
 *  4. 通过 IPC 向渲染进程暴露「关于 / 检查更新 / 充值跳转」等应用级能力；
 *  5. 退出时回收引擎子进程。
 *
 * 环境变量：
 *  DSH_PORT            引擎端口（默认 0 = 系统自动分配，避免与已有 dsh web 冲突）
 *  DSH_HOST            绑定地址（默认 127.0.0.1）
 *  DSH_HOME            harness home（默认 <userData>/dsh-home）
 *  DSH_LAUNCH          npx | bundled（默认 bundled：用打包好的引擎 + 便携 Node）
 *  DSH_DESKTOP_VERSION 应用版本（注入「关于」页面；默认读 package.json）
 */

'use strict'

const { app, BrowserWindow, shell, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

// 默认 0：让 dsh 自己挑空闲端口，避免与用户手动启动的 `dsh web`（默认 3080）冲突。
const PORT = Number(process.env.DSH_PORT || 0)
const HOST = process.env.DSH_HOST || '127.0.0.1'
const DSH_LAUNCH = process.env.DSH_LAUNCH || 'bundled'
const DSH_HOME = process.env.DSH_HOME || path.join(app.getPath('userData'), 'dsh-home')
const DESKTOP_VERSION = process.env.DSH_DESKTOP_VERSION || require('./package.json').version

const ABOUT = {
  creator: 'Adrain Lin',
  createdAt: '2024-11-04',
  version: DESKTOP_VERSION,
}

const RECHARGE_URL = 'https://platform.deepseek.com/top_up'

// 更新源：默认读 GitHub「最新 Release」接口（tag 即版本号，自动取 .exe 资产）。
// 有新版就下载 .exe 并启动安装，无需手动维护 latest.json。
// 也可用环境变量 DSH_UPDATE_MANIFEST_URL 覆盖成一个普通 { version, url } 清单。
const DEFAULT_UPDATE_URL = 'https://api.github.com/repos/Adrain-Lin/deepseek-harness-desktop/releases/latest'

// 简单语义化版本比较：a > b 返回 true（如 0.1.10 > 0.1.9）
function isNewer(a, b) {
  const pa = String(a).split('.').map((n) => Number(n) || 0)
  const pb = String(b).split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y
  }
  return false
}

let dshProcess = null
let mainWindow = null
let shuttingDown = false
let resolveDshUrl = null

// ---------------------------------------------------------------------------
// 引擎拉起
// ---------------------------------------------------------------------------

function ensureDshHome() {
  fs.mkdirSync(DSH_HOME, { recursive: true })
}

function findPluginDir() {
  const candidates = [
    path.join(process.resourcesPath, 'dsh', 'node_modules', '@adrainlin', 'dsh-desktop-plugin'),
    path.join(__dirname, '..', 'plugin'),
  ]
  return candidates.find((p) => fs.existsSync(path.join(p, 'package.json')))
}

// 把插件复制进 $DSH_HOME/profiles/node_modules/，使 loader 能从 profile 目录按裸包名
// 解析到它（等效 `dsh plugin add`，但自包含、不依赖 npm）。dsh 自身的
// healProfilesModuleFallback 只链接 dsh 的依赖闭包，不会链接这个 out-of-tree 插件，
// 因此必须由桌面壳自己安装。
function ensurePluginInstalled() {
  const pluginDir = findPluginDir()
  if (!pluginDir) return
  ensureDshHome()
  const dest = path.join(DSH_HOME, 'profiles', 'node_modules', '@adrainlin', 'dsh-desktop-plugin')
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(pluginDir, dest, { recursive: true })
}

// 生成运行时 patch（引用插件的裸包名）。插件必须以「包」的形式存在于 dsh 引擎的
// node_modules（打包脚本用 Copy-Item 复制进 resources/dsh/node_modules/@adrainlin/…），
// 这样 Host 与 Client 两半都能被 loader 解析——实测 Client 扫描器只认包名、不认 file:// URL。
function writeRuntimePatch() {
  ensureDshHome()
  const patchPath = path.join(DSH_HOME, 'desktop-plugin.patch.yml')
  fs.writeFileSync(patchPath, `- insert:\n    - id: desktop-plugin\n      name: '@adrainlin/dsh-desktop-plugin'\n`)
  return patchPath
}

function dshArgs() {
  // 启动器标志（--patch）必须先于 app 标志（--no-open/--host/--port），
  // 否则会被当作 web 应用的内部参数透传，导致 unknown option '--patch'。
  const args = ['web']
  const patch = writeRuntimePatch()
  if (patch) args.push('--patch', patch)
  args.push('--no-open', '--host', HOST, '--port', String(PORT))
  return args
}

function startDsh() {
  ensureDshHome()
  ensurePluginInstalled()
  // 把应用版本号传给引擎，让插件「关于」页显示的版本号与 package.json 一致。
  const env = { ...process.env, DSH_HOME, DSH_DESKTOP_VERSION: DESKTOP_VERSION }
  const args = dshArgs()
  const stdio = ['ignore', 'pipe', 'pipe']
  // 引擎输出写进日志文件，便于在打包应用（无控制台）里排查。
  const logPath = path.join(DSH_HOME, 'dsh.log')
  let log = null
  try { log = fs.createWriteStream(logPath, { flags: 'a' }) } catch { log = null }

  if (DSH_LAUNCH === 'bundled') {
    // 用随应用打包的便携 Node 运行 dsh 引擎。不能用 ELECTRON_RUN_AS_NODE：Electron
    // 自带的 Node 运行 dsh web 会在打印 URL 后立即退出（实测），真实 Node 则常驻。
    // resources/dsh/ 与 resources/node/ 由 packaging/build.ps1 生成。
    const dshPkgJson = path.join(
      process.resourcesPath, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json',
    )
    let dshBin = null
    if (fs.existsSync(dshPkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(dshPkgJson, 'utf8'))
      const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.dsh
      if (rel) dshBin = path.join(path.dirname(dshPkgJson), rel)
    }
    const nodeBin = path.join(process.resourcesPath, 'node', 'node.exe')
    if (!dshBin || !fs.existsSync(dshBin)) {
      console.error(`[desktop] bundled dsh not found (${dshBin}); run packaging/build.ps1 first`)
    }
    if (!fs.existsSync(nodeBin)) {
      console.error(`[desktop] bundled node not found (${nodeBin}); run packaging/build.ps1 first`)
    }
    dshProcess = spawn(nodeBin, [dshBin, ...args], {
      env,
      stdio,
      cwd: DSH_HOME,
    })
  } else {
    // npx 模式：需要本机 Node + 首次联网下载。
    dshProcess = spawn('npx', ['@deepseek-ai/dsh', ...args], {
      env,
      stdio,
      cwd: DSH_HOME,
      shell: process.platform === 'win32',
    })
  }

  dshProcess.stdout.on('data', (d) => {
    const line = String(d)
    if (log) log.write(line)
    process.stdout.write(`[dsh] ${line}`)
    const url = extractUrl(line)
    if (url && resolveDshUrl) resolveDshUrl(url)
  })
  dshProcess.stderr.on('data', (d) => {
    const s = String(d)
    if (log) log.write(s)
    process.stderr.write(`[dsh] ${s}`)
  })
  dshProcess.on('exit', (code) => {
    dshProcess = null
    if (!shuttingDown) console.log(`[desktop] dsh 引擎退出，code=${code}`)
  })
  dshProcess.on('error', (err) => {
    console.error('[desktop] 无法启动 dsh 引擎：', err.message)
  })
}

function extractUrl(text) {
  const m = /https?:\/\/[^\s"'<>]+/.exec(text)
  return m ? m[0] : null
}

function stopDsh() {
  if (dshProcess) {
    const p = dshProcess
    dshProcess = null
    try { p.kill() } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'DeepSeek Harness 桌面端',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 外部链接（充值、文档）交给系统浏览器，不新开应用窗口。
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ---------------------------------------------------------------------------
// IPC：关于 / 更新 / 充值
// ---------------------------------------------------------------------------

ipcMain.handle('desktop:about', () => ABOUT)

ipcMain.handle('desktop:recharge', () => {
  shell.openExternal(RECHARGE_URL)
  return { url: RECHARGE_URL }
})

// 检查更新：默认读 GitHub 最新 Release（DEFAULT_UPDATE_URL），也支持普通 { version, url } 清单。
ipcMain.handle('desktop:update:check', async () => {
  const manifestUrl = process.env.DSH_UPDATE_MANIFEST_URL || DEFAULT_UPDATE_URL
  if (!manifestUrl || manifestUrl.includes('你的用户名')) {
    return { current: DESKTOP_VERSION, latest: null, updateAvailable: false, message: '未配置更新源（请在 main.js 里填写 GitHub 用户名和仓库名）' }
  }
  try {
    const res = await fetch(manifestUrl, { headers: { Accept: 'application/vnd.github+json' } })
    const data = await res.json()
    // 还没有发布过 Release（GitHub 返回 404 Not Found）
    if (!res.ok && data && data.message) {
      return { current: DESKTOP_VERSION, latest: null, updateAvailable: false, message: '尚未发布任何版本（请先在 GitHub 创建 Release）' }
    }
    // GitHub Release：版本取 tag（去掉 v 前缀），下载地址取第一个 .exe 资产
    if (data.tag_name) {
      const latest = String(data.tag_name).replace(/^v/, '')
      const asset = Array.isArray(data.assets)
        ? (data.assets.find((a) => /\.exe$/i.test(a.name || '')) || data.assets[0])
        : null
      return {
        current: DESKTOP_VERSION,
        latest,
        updateAvailable: Boolean(latest && isNewer(latest, DESKTOP_VERSION)),
        url: asset ? asset.browser_download_url : null,
      }
    }
    // 普通清单 { version, url }
    return {
      current: DESKTOP_VERSION,
      latest: data.version || null,
      updateAvailable: Boolean(data.version && isNewer(data.version, DESKTOP_VERSION)),
      url: data.url || null,
    }
  } catch (err) {
    return { current: DESKTOP_VERSION, latest: null, updateAvailable: false, error: err.message }
  }
})

// 下载并运行更新安装包（.exe），进度通过 update:progress 事件回传给渲染进程。
ipcMain.handle('desktop:update:install', async (event, url) => {
  try {
    const dest = path.join(app.getPath('temp'), `deepseek-harness-update-${Date.now()}.exe`)
    const res = await fetch(url)
    if (!res.ok || !res.body) return { ok: false, error: `下载失败（HTTP ${res.status}）` }
    const total = Number(res.headers.get('content-length')) || 0
    const reader = res.body.getReader()
    const chunks = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
      received += value.length
      if (total && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('update:progress', { received, total, pct: Math.round((received / total) * 100) })
      }
    }
    fs.writeFileSync(dest, Buffer.concat(chunks))
    shell.openPath(dest)
    return { ok: true, path: dest }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    createWindow()
    // 等待 dsh 打印「带 token 的鉴权 URL」，再加载它——不能加载裸 http://127.0.0.1:PORT，
    // 否则会命中浏览器鉴权页（authentication required）。
    const urlPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('dsh web 未在 90 秒内就绪（引擎启动失败或端口被占用）'))
      }, 90000)
      resolveDshUrl = (url) => { clearTimeout(timer); resolve(url) }
    })
    startDsh()
    try {
      const url = await urlPromise
      await mainWindow.loadURL(url)
    } catch (err) {
      console.error('[desktop]', err.message)
      await mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<html><body style="font-family:system-ui;padding:40px;background:#111;color:#eee">' +
        '<h1>DeepSeek Harness 启动失败</h1><p>' + err.message + '</p></body></html>',
      ))
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', () => {
    shuttingDown = true
    stopDsh()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
