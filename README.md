# DeepSeek Harness 桌面端

一个自包含的 **DeepSeek Harness（dsh）桌面应用**：用 Electron 原生窗口承载官方 `dsh web` 引擎，并新增多项设置功能：

1. **用户** —— 查看当前 DeepSeek API Key（脱敏）、余额/用量、一键跳转充值；
2. **外观 → 背景** —— 导入图片作为背景，覆盖主界面与侧边栏（在既有的浅色/深色/跟随系统之上追加）；
3. **关于** —— 创作者 Adrain Lin、创作时间 2024-11-04、版本号、检查更新（带进度条）；
4. **插件市场** —— 内嵌社区插件市场 [`dshmarket`](https://github.com/dsh-market/dsh-market)，在「设置 → 插件市场」浏览 / 搜索 / 一键安装社区插件与主题（bundled 模式内置）。

## 目录结构

```
creat_app/
├── README.md                  # 本文件
├── docs/
│   ├── architecture.md        # 架构与设计决策（含调研结论）
│   └── build-and-package.md   # 构建 / 打包 / 分发步骤
├── desktop/                   # Electron 桌面壳（原生窗口 + 内嵌 dsh 引擎）
│   ├── package.json
│   ├── main.js                # 拉起 dsh web、开窗、单实例、更新检查
│   ├── preload.js             # 渲染进程桥（版本/更新/充值跳转）
│   └── package.json           # 含 electron-builder 自包含打包配置（build 字段）
├── plugin/                    # 可分发的 DSH bundle 插件（承载三项新功能）
│   ├── package.json           # dsh.bundle.patch 声明
│   ├── cordis.patch.yml       # 把插件行注入 web profile
│   ├── src/
│   │   ├── host.js            # Host：/api/desktop/* 路由（余额/关于/更新）
│   │   └── client.js          # Client：设置板块 UI（用户/背景/关于）
│   └── README.md
└── packaging/
    └── build.ps1              # 一键构建编排
```

## 快速开始（开发态）

1. 确保已安装 Node.js（`^22.19 || >=24`）。
2. 启动桌面壳（默认用 `npx @deepseek-ai/dsh web` 拉起引擎）：

```powershell
cd desktop
npm install
npx electron .
```

引擎就绪后会自动打开原生窗口并加载 `http://127.0.0.1:3080`。

## 两种引擎拉起模式

| 模式 | 说明 | 目标用户 |
| --- | --- | --- |
| `bundled`（默认） | 引擎随应用打包，用随包便携 Node 运行；内置插件市场 `dshmarket` | 分发给无 Node 的用户 |
| `npx` | 首次运行联网 `npx @deepseek-ai/dsh web`；插件市场需手动 `dsh plugin --profile web add dshmarket` | 开发/自用 |

通过环境变量 `DSH_LAUNCH=npx|bundled` 切换；`bundled` 模式需先执行
`packaging/build.ps1` 把 dsh 引擎 + 插件市场 + 便携 Node 打进 `resources/`。

## 分发

详情见`docs/build-and-package.md`。核心思路：`packaging/build.ps1` 构建插件 +
打包 Electron 应用（`electron-builder`），产出免安装便携版/安装包。
