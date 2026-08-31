# 构建 / 打包 / 分发

## 一、开发态运行

```powershell
cd desktop
npm install
npx electron .
```

桌面壳会用 `npx @deepseek-ai/dsh web --no-open` 拉起引擎（默认 3080 端口），
就绪后开原生窗口。插件 patch 自动从 `desktop/../plugin/cordis.patch.yml`（或
`$DSH_HOME/cordis.patch.yml`）注入。

环境变量（可选）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_LAUNCH` | `npx` | `npx` 或 `bundled` |
| `DSH_PORT` | `3080` | 引擎端口 |
| `DSH_HOST` | `127.0.0.1` | 绑定地址 |
| `DSH_HOME` | `<userData>/dsh-home` | harness home |
| `DSH_DESKTOP_VERSION` | package.json 版本 | 注入「关于」的版本号 |
| `DSH_UPDATE_MANIFEST_URL` | 空 | 自定义更新清单 `{ version, url }`；空则查 npm |

## 二、自包含打包（分发给无 Node 用户）

```powershell
cd packaging
.\build.ps1                 # bundled：dsh 引擎打进应用
# 或
.\build.ps1 -Portable       # 额外产出免安装便携版
```

产物在 `dist/`：
- `deepseek-harness-desktop Setup *.exe`（NSIS 安装包）
- `deepseek-harness-desktop *.exe`（便携版，如启用 -Portable）

原理：`electron-builder` 把 `desktop/resources/dsh/node_modules`（bundled 引擎 + 插件 +
**插件市场 dshmarket**）和 `desktop/resources/node`（便携 Node）打进 `resources/`；
`main.js` 用**便携 Node** 运行 dsh（不用 `ELECTRON_RUN_AS_NODE`，它会让 dsh web
启动后立即退出）。目标用户无需安装 Node。

## 三、内置功能实现位置

| 功能 | Host | Client |
| --- | --- | --- |
| 用户（key/余额/充值） | `plugin/src/host.js` 的 `/api/desktop/user`（读凭据 + 调 DeepSeek 余额接口） | `plugin/lib/client.js` 的 `UserSection` |
| 背景图 | —（localStorage 持久化） | `BackgroundRow`（注入 `<style>` 覆盖） |
| 关于/检查更新 | `/api/desktop/about`、`/update/check`、`/update/download` | `AboutSection`（进度条） |
| 插件市场 | 第三方 `dshmarket` 包（随引擎 npm 安装） | `dshmarket` 的 `client/client.js`（设置 → 插件市场） |

插件市场随 `build.ps1` 的 `npm install @deepseek-ai/dsh dshmarket@1.38.1` 一并装进
引擎 `node_modules`；`main.js` 启动时把它复制进 `$DSH_HOME/profiles/node_modules/`
（客户端 `dsh.client` 扫描器从 profile 目录解析裸包名），并在运行时 patch 里注入
`dshmarket`（`config.allowRestart: false`，重启生命周期归 Electron 壳所有）。

## 四、注意事项与已知边界

1. **DeepSeek「用量」**：官方公开接口只有余额（`GET /user/balance`，返回
   充值/赠送/总余额），逐次 token 用量无公开接口，需跳转网页控制台查看。
2. **检查更新的对象**：默认查 npm 上 `@deepseek-ai/dsh`（引擎）最新版；
   若要更新「桌面应用」本身，需搭建发布渠道（GitHub Releases + electron-updater，
   或把 `DSH_UPDATE_MANIFEST_URL` 指向自定义清单），安装步骤留待接入。
3. **客户端 bundle**：`plugin/lib/client.js` 是手写的 factory 形式 bundle
   （`window.__ModuleLoader__.load`），`require('react')` 命中 shell 种子词，
   无需 monorepo tsdown 构建。
4. **背景覆盖**：通过全局 CSS 覆盖，具体层级若与未来官方 UI 调整冲突，需微调
   `BackgroundRow` 的 CSS 选择器。

## 五、实测验证结果（本轮已执行）

| 验证项 | 结果 |
| --- | --- |
| 服务契约 | `webServer.register()` / `credentials.resolve()` 与 `plugin/src/host.js` 完全一致（经 Host Inspect 核对） |
| bundled 引擎 | `npm install @deepseek-ai/dsh`（452 包）后 `node lib/bin.js --version` → `0.1.1-rc.2`；`web --help` 正常 |
| 插件挂载（Host） | `dsh web --patch <裸包名> --no-open` 成功；`/api/desktop/*` 三个路由实测返回正确 |
| 插件挂载（Client） | 裸包名经 node_modules 解析后，`__DSH_BOOT__` entries 出现 `@adrainlin/dsh-desktop-plugin`；bundle 路由 `/plugins/.../client.js` 返回 200，`exports.apply`/`exports.inject` 存在 |
| `/api/desktop/about` | `{"creator":"Adrain Lin","createdAt":"2024-11-04","version":"0.1.0"}` ✅ |
| `/api/desktop/user` | 无 key 时 `configured:false` + 充值地址正确 ✅ |
| `/api/desktop/update/check` | 真实 npm 查询：`latest 0.1.1-rc.2`、`updateAvailable:true`、tarball URL 正确 ✅ |

关键经验（已写进代码/文档）：
- `--patch` 是启动器标志，必须放在 app 标志（`--no-open`/`--host`/`--port`）**之前**；
- 插件 `name` 必须用**裸包名**（插件以「包」形式在引擎 node_modules 里）：Client 模块
  扫描器只认包名，`file://` URL 只能加载 Host、Client 半部不会进 `__DSH_BOOT__`；
- 插件必须放进 `$DSH_HOME/profiles/node_modules/`（dsh 的 `healProfilesModuleFallback`
  只链接 dsh 依赖闭包，不链 out-of-tree 插件）——由 `main.js` 的 `ensurePluginInstalled` 复制；
- Client bundle 是手写的 `window.__ModuleLoader__.load` 工厂形式，`require('react')`
  命中 shell 种子词，无需 monorepo tsdown 构建；
- **Electron 必须 ≥44**（自带 Node 24）：Electron 33 的 Node 20 缺 dsh 所需的
  `node:zlib` `createZstdDecompress` / `node:module` `stripTypeScriptTypes`；
- **不能用 `ELECTRON_RUN_AS_NODE`** 跑 dsh（会在打印 URL 后立即退出），改随应用打包
  便携 Node 并 `spawn`；
- electron-builder 26 的 `extraResources` 会跳过源根目录的 `node_modules`
  （`filter.js` 里 `relative === "node_modules"` 直接 return false），故 `from` 要指向
  `resources/dsh/node_modules` 而不是 `resources/dsh`；
- Electron 二进制/electron-builder 二进制都走 npmmirror：`ELECTRON_MIRROR` +
  `ELECTRON_BUILDER_BINARIES_MIRROR`（GitHub 直连会超时）；
- 用 `Copy-Item` 复制插件（`npm install file:` 会生成 junction，electron-builder 会丢链）；
- 独立 `DSH_HOME` 必须，否则与已有 `~/.dsh` 的 profiles 冲突。
