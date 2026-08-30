# 桌面端 DSH 插件

承载桌面端的三项新功能。结构：

```
plugin/
├── package.json        # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml    # bundle patch：把插件行（裸包名）注入 profile
├── lib/client.js       # Client 半部（手写的 factory 形式 bundle，已可分发）
└── src/
    ├── host.js         # Host 半部（纯 JS，无需构建）
    └── client.js       # Client 半部的可读源（逻辑与 lib/client.js 一致）
```

## 分发与加载方式

### 方式一：npm 分发（`dsh plugin add`）

发布本包到 npm 后，用户执行：

```sh
dsh plugin --profile web add @adrainlin/dsh-desktop-plugin
dsh web
```

### 方式二：自包含（桌面壳内置，推荐）

打包脚本把插件作为「真实目录」复制进引擎的 node_modules：

```
resources/dsh/node_modules/@adrainlin/dsh-desktop-plugin/
```

桌面壳启动时生成运行时 patch（引用**裸包名**）通过 `--patch` 传入：

```yaml
- insert:
    - id: desktop-plugin
      name: '@adrainlin/dsh-desktop-plugin'
```

```sh
dsh web --patch <patch.yml> --no-open --host 127.0.0.1 --port 3080
```

> ⚠️ `--patch` 是启动器标志，必须放在 app 标志（`--no-open` 等）之前。
> ⚠️ `name` 必须用裸包名：实测 Client 模块扫描器只认包名（经 node_modules 解析
> `package.json` 的 `dsh.client`），`file://` URL 只能加载 Host、Client 半部不会被
> 扫描进 `__DSH_BOOT__`。

## Host 能力（已确认接口）

- `webServer.register({ kind, path, handler })` —— 注册 HTTP 路由
- `credentials.resolve('DEEPSEEK_API_KEY')` —— 读取 DeepSeek API Key

| 路由 | 说明 |
| --- | --- |
| `GET /api/desktop/about` | 创作者 / 时间 / 版本 |
| `GET /api/desktop/user` | 脱敏 key + 余额 + 充值地址 |
| `GET /api/desktop/update/check` | 查 npm 最新版本 |
| `GET /api/desktop/update/download?url=` | 流式下载（Content-Length 供进度条） |

## Client bundle 说明

`lib/client.js` 是手写的「factory 形式」客户端 bundle，格式与 monorepo tsdown 产物
一致，**无需 tsdown 构建**即可分发：

```js
window.__ModuleLoader__.load({
  id: "@adrainlin/dsh-desktop-plugin",
  factory: (require) => { ...; return module.exports }
})
```

- `require('react')` 命中 shell 的平台种子词（seed：`react`/`react-dom`/`@deepseek-ai/cordis` 等，
  见 `packages/client/web/src/seed.ts`）；
- `exports.inject = ['slots']` 声明 Cordis 服务依赖，`slots` 通过 `ctx.get('slots')` 使用；
- 注册 `settings.section`（用户/关于）与 `settings.general.item`（背景）。

登记契约（已核对）：`settings.section` 为 `list`，登记 `{ id, order, label }`，owner
props `{ close }`；`settings.general.item` 为 `list`，登记 `{ id, order, label }`，
owner props 为空。主题服务 `theme` 内置 light/dark/system。

背景图通过向 `document.head` 注入 `<style data-desktop-bg>`（覆盖主界面+侧边栏），
用 `localStorage` 持久化。
