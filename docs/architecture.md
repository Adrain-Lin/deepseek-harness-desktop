# 架构与设计决策

## 1. 调研结论（关键事实）

- `npx @deepseek-ai/dsh web` 启动的是**官方发布的 npm 包**，其前端 `dist`
  由 `@deepseek-ai/dsh-web-frontend` 提供，由 `packages/bundle/web-app` 的
  `frontend-static` 服务于 `127.0.0.1:3080`。
  **因此：本地改 `apps/web` 源码不会通过这条命令生效，也无法用它分发给别人，**
  除非 fork 并重新发布。
- 设置界面是**插槽驱动**的：
  - `settings.section`（`list`）：注册一个完整设置板块，登记项 `{ id, order, label }`，
    owner props 为 `{ close }`。
  - `settings.general.item`（`list`）：在「通用」板块注册一行偏好，登记项
    `{ id, order, label }`，owner props 为空（行自己画内容）。
- 外观主题内置 `light / dark / system`，由 `ui-theme` 的 `theme` 服务提供
  `setTheme` / `overrideTokens`。
- Host 扩展的正规通道：
  - `webServer.register({ kind, path, handler })` 注册 HTTP 路由；
  - `credentials.resolve('DEEPSEEK_API_KEY')` 读取 DeepSeek API Key；
  - `settings.register(namespace, schema)` 注册持久化设置（`$DSH_HOME/settings.yaml`）。
- 可分发包 = 声明 `dsh.bundle.patch` 的 npm 包，其 `cordis.patch.yml` 以
  `insert`/`id` 行把插件注入 profile 组合。`--profile web` 即 Web UI 使用的 profile。

## 2. 总体架构

```
┌─────────────────────────────────────────────┐
│ Electron 桌面壳 (desktop/)                    │
│  main.js: 拉起 dsh web --no-open + 开原生窗口  │
│  preload.js: 版本/更新/充值 桥                │
└───────────────┬─────────────────────────────┘
                │ DSH_HOME / --patch plugin/cordis.patch.yml
                ▼
┌─────────────────────────────────────────────┐
│ dsh web 引擎（官方，未修改）                  │
│  └─ plugin/ (DSH bundle 插件，随壳分发)        │
│     ├─ Host: /api/desktop/* (余额/关于/更新)  │
│     └─ Client: settings.section 用户/关于      │
│                 + settings.general.item 背景   │
└─────────────────────────────────────────────┘
```

## 3. 关键决策

1. **不 fork、不重发布 npm**：桌面壳内嵌官方引擎，新功能全部放进一个 DSH
   bundle 插件，随壳分发。官方升级不冲突。
2. **Host 用纯 JS、可正确分发**：余额/关于/更新走 `webServer.register` +
   `credentials.resolve`，都是已确认的稳定接口。
3. **Client 设置 UI**：登记契约已确认（`settings.section` / `settings.general.item`）。
   运行时通过 `ctx.get('slots')` → `slots.inject(...)` → `slots.register(...)`
   注册。分发版是**手写的 factory 形式 bundle**（`lib/client.js`，`window.__ModuleLoader__.load`
   格式，`require('react')` 命中 shell 种子词），**无需 monorepo tsdown 构建**。
4. **背景图**：作为「通用 → 背景」偏好行，图片以 data URL 存 `localStorage`，
   通过向 `document.head` 注入 `<style data-desktop-bg>` 的全局 CSS 覆盖主界面与侧边栏。
5. **关于 + 检查更新**：版本号读 `$DSH_DESKTOP_VERSION`（桌面壳注入）或插件版本；
   检查更新查 npm registry `@deepseek-ai/dsh` 的 `dist-tags.latest`，下载走
   `GET /api/desktop/update/download` 流式传输，前端按 `Content-Length` 画进度条。
   安装步骤依赖用户的发布渠道（electron-updater / 安装包），已预留接口。
6. **自包含**：`bundled` 模式把 dsh 引擎打进 `resources/dsh/`、把便携 Node 打进
   `resources/node/`，用**真实 Node** 运行 dsh。教训：`ELECTRON_RUN_AS_NODE=1` 会让
   dsh web 在打印 URL 后立即退出，且 Electron 33 自带的 Node 20 缺 dsh 所需的
   Node 22+ API（`createZstdDecompress`/`stripTypeScriptTypes`）；故用 Electron 44
   + 独立便携 Node。目标用户免装 Node。插件以「包」形式复制进引擎的 `node_modules`，
   patch 引用**裸包名**（Client 扫描器只认包名、不认 file:// URL）。

## 4. 需求可行性对照

| 需求 | 结论 |
| --- | --- |
| 用户：API key + 用量 + 充值跳转 | ✅ key 读凭据、余额调 DeepSeek `GET /user/balance`、充值跳 `platform.deepseek.com/top_up`；⚠️ 公开接口只有「余额」，逐次 token 用量需在网页控制台看 |
| 外观：背景图覆盖主界面+侧边栏 | ✅ 在浅色/深色/跟随系统之上追加，CSS 注入 + 持久化 |
| 关于：创作者/时间/版本/检查更新+进度条 | ✅ 创作者 Adrain Lin、时间 2024-11-04、版本号、npm 检查 + 流式下载进度条 |
| 工作区划分 | ✅ 全部落在 `E:\Deepseek Harness_Work\creat_app`，不污染 checkout |
