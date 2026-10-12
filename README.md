<div align="center">

<img src="public/brand-icon.png" width="88" alt="fanbox-pro 图标">

# fanbox-pro

**Windows 本地工作台 · 文件浏览 × 内嵌终端 × Git 仓库管理 × 定时任务**

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Windows](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D4)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[下载 Windows 版本](https://github.com/ayxyj/fanbox-pro/releases) · [项目来源](#项目来源与致谢) · [主要功能](#主要功能) · [安装](#安装与环境要求) · [快速开始](#快速开始) · [开发与打包](#开发与打包)

</div>

## 项目来源与致谢

**fanbox-pro 基于 [alchaincyf/fanbox](https://github.com/alchaincyf/fanbox)（作者：花叔 / Huashu）进行 Windows 适配和功能扩展。**

原项目 FanBox 提供文件浏览、内容预览与编辑、内嵌终端及 Coding Agent 工作台。本项目参考并沿用其界面结构与相关实现，在此基础上增加多工作区 Git 仓库管理、自动同步和定时任务，并针对 Windows 的盘符、PowerShell、资源管理器、剪贴板及安装包进行适配。

本项目为独立维护的 **Windows 衍生版本**，不代表原作者或原项目的官方 Windows 发行版。感谢原作者开放源码；原版权声明和 MIT 许可证保留在 [LICENSE](LICENSE)。

主题配置参考了 Terax AI 的主题实现与配色，编辑器配色包含 UIW 主题的适配。第三方来源与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 为什么使用 fanbox-pro

当项目散落在 `D:\code`、`D:\rrs_1104_ai` 等多个目录中，逐个打开仓库查看分支、执行同步、再切换终端会比较繁琐。fanbox-pro 将这些操作集中在一个 Windows 桌面窗口：浏览文件、查看代码、运行终端任务，并集中掌握各仓库的状态。

应用在本机运行，无需注册账号。Git 远端访问使用本机 Git 的 SSH 密钥、凭据和代理配置；Claude Code、Codex 等工具使用各自已有的配置。

## 主要功能

### 文件浏览与编辑

- 浏览本机目录，在路径栏根盘符下拉菜单中切换 C:、D: 等可用磁盘。
- 文件搜索、收藏、最近使用记录，以及在 Windows 资源管理器中定位文件。
- 预览代码、SQL、Markdown、HTML、图片、音视频、PDF 和压缩包内容；具体格式能力以 Windows 环境为准。
- HTML/HTM 在软件预览区直接渲染和交互，支持按钮、表单、相对路径 CSS/图片、JavaScript 模块、fetch 和 localStorage；链接与新窗口请求留在预览区，可重新加载或切换查看源码，支持 Ctrl + 鼠标滚轮缩放（25%–300%），工具栏可缩小、放大和恢复 100%。预览仅提供文件所在目录的静态资源，需要后端的页面仍需运行对应服务。
- Windows 内置 PowerShell 使用当前会话的执行策略，支持直接运行 claude、npm 等脚本入口；不修改永久系统配置。更新后重新打开终端生效。
- 仓库目录终端支持 Claude、CodeBuddy、Codex 快速入口：空闲标签直接启动，忙碌时在同目录新建标签，重复点击切换到已有工具标签；CodeBuddy 使用 CMD，Claude/Codex 使用 PowerShell。
- Monaco 代码编辑器与 Markdown 编辑，未保存内容提供离开提示。
- 文件变化监听和预览更新，长 SQL 预览保留滚动位置。

### 内嵌终端与 Agent

- 真实终端、多标签，支持在右侧或底部显示。
- Windows Shell，以及本机已安装的 Claude Code、Codex 等命令行工具。
- 终端选区复制、粘贴和右键菜单；无选区时 `Ctrl+C` 保留中断功能。
- Windows 内置 Claude / Codex 启动入口使用 `.cmd`，避免 npm `.ps1` 启动脚本受 PowerShell 执行策略拦截。

### Git 仓库管理

- 添加多个工作区，扫描其中的 Git 仓库，集中展示仓库总览。
- 查看当前分支、关注分支、未提交改动、stash 数量及上次同步时间。
- 提前获取分支列表，通过下拉选择每个仓库的关注分支，并保存配置；未设置时默认 `master`。
- 支持切换到关注分支；本地存在未提交改动时提示先提交或 stash，不强制覆盖。
- 远端同步默认使用 `origin`。自动同步会 fetch 关注分支，并在条件允许时切换分支、快进更新工作区。
- 仓库有未提交改动时仅 fetch；出现分叉时记录原因，不自动合并、变基或重置本地代码。
- 同步结果保存为日志，列表展示摘要，可查看详情定位失败原因。

### 自动同步与定时任务

| 页面 | 用途 |
| --- | --- |
| Git 仓库管理 → 自动同步 | 按计划同步指定仓库，可选择多个仓库 |
| 定时任务 → 任务管理 | 在指定目录执行 Shell、Claude Code 或 Codex 任务 |

- 时间配置支持一次性、每天、每周、每小时、间隔和 cron。
- 支持全局启动 / 暂停，以及单条任务的启动 / 暂停；状态保存后重启仍保留。
- 可手动运行任务，暂停不会终止已经开始执行的任务。
- 显示未来最近 10 次计划运行时间，并保存运行结果供查看。
- **仅在软件运行期间调度。** 关闭软件后不执行，重新打开不会补跑已经错过的计划；不注册 Windows 后台服务或系统计划任务。

### 主题与布局

- 默认使用终端主题，保留档案、索引主题，并提供 16 套 Terax 内置主题及自定义 JSON 主题。
- 支持深色、浅色、跟随系统，以及独立选择 22 套编辑器配色。
- 背景图片支持透明度与模糊；Windows Mica 需要 Windows 11 22H2 或更新系统。
- 主题入口位于顶部「视图 → 主题」，菜单勾选与当前应用主题一致。
- 工作区、仓库、自动同步、同步日志和总览页面使用可用宽度；长分支名支持悬浮查看。

## 安装与环境要求

当前发行版本：**1.0.0 · Windows x64**。

1. 在 [本项目 Releases](https://github.com/ayxyj/fanbox-pro/releases) 下载 `fanbox-pro-1.0.0-x64.exe`。
2. 运行安装程序，选择安装目录，安装完成后启动 **fanbox-pro**。
3. 使用 Git 功能前，安装 Git for Windows，并确保终端执行 `git --version` 正常。
4. 使用 Agent 功能时，另行安装并配置 Claude Code / Codex；应用不包含这些工具的账号或订阅。

安装版已包含 Electron 运行环境，普通使用不需要单独安装 Node.js。当前安装包未配置代码签名。

上游 FanBox 的 Releases 属于原项目，**不要将上游安装包当作本项目 Windows 更新包**。请从 [ayxyj/fanbox-pro Releases](https://github.com/ayxyj/fanbox-pro/releases) 获取本项目更新。

## 快速开始

### 管理多个工作区

1. 打开「Git 仓库管理 → 工作区」，添加 `D:\code` 等项目根目录。
2. 扫描工作区，在「仓库」页面查看扫描结果。
3. 为各仓库选择关注分支；不配置时使用 `master`。若远端只有 `main`，请明确选择 `main`。
4. 按需手动同步，或在「自动同步」中新建计划并选择仓库。
5. 通过「同步日志」查看成功、跳过或失败的原因。

### 配置定时任务

1. 打开「定时任务 → 任务管理」，点击「新建」。
2. 填写名称、工作目录、执行方式与命令 / 提示词。
3. 配置运行时间，检查未来 10 次计划时间，然后保存。
4. 使用同一个启动 / 暂停按钮切换状态；需要立即执行时点击「运行」。

### 配置主题

打开顶部「视图 → 主题 → 主题配置」，选择界面主题和编辑器配色。背景透明度与模糊作用于所选图片，需先选择背景图片。

## 本地数据与升级

为兼容此前版本，1.0.0 保留原存储位置：

- 仓库、工作区、同步日志和任务配置：`%USERPROFILE%\.fanbox-pro-win\`。
- 主题选择、背景图片和窗口状态：Electron 用户数据目录。已有安装优先沿用 `%APPDATA%\fanbox-pro-win\`，首次安装通常为 `%APPDATA%\fanbox-pro\`。
- 默认后端地址：`http://127.0.0.1:4569`，仅监听本机回环地址。

升级前关闭旧版本；需要备份时复制上述数据目录。存储目录中的 `-win` 为历史兼容名称，软件显示名称已统一为 **fanbox-pro**。

开发和测试可通过环境变量使用独立数据：

| 变量 | 用途 |
| --- | --- |
| `GITSYNC_HOME` | 覆盖仓库与任务配置目录 |
| `GITSYNC_PORT` / `FANBOX_PORT` | 覆盖本地服务端口 |
| `FANBOX_RELEASE_REPOSITORY` | 可选覆盖更新源，格式为 `owner/repository`；默认 `ayxyj/fanbox-pro` |

更新入口检查本项目的 GitHub Releases，不检查原项目发行版；下载后手动安装，不自动下载安装。

## 开发与打包

建议在 Windows x64 使用 Node.js 22 LTS、npm 和 Git。`package-lock.json` 已锁定依赖。

```powershell
npm ci
npm run app
```

只运行本地 Web 后端：

```powershell
npm start
```

浏览器访问 `http://127.0.0.1:4569`。内嵌终端、原生剪贴板与窗口材质等能力需要桌面版。

生成 Windows 安装包：

```powershell
npm run dist:win
```

默认产物：

```text
dist/fanbox-pro-1.0.0-x64.exe       # NSIS 安装包
dist/win-unpacked/fanbox-pro.exe   # 解压目录中的应用
```

`win-unpacked` 需要作为完整目录使用，不能只复制其中一个 EXE。

锁定的 `node-pty` 提供 Windows x64 预编译模块。如果环境需要从源码构建，请安装 Python 与 Visual Studio C++ Build Tools，再执行 `npm run rebuild`。

若打包时 EXE 资源写入失败，而完整的 `win-unpacked` 已生成，可尝试修复资源后重新封装：

```powershell
node scripts/finalize-win.js dist/win-unpacked
npm run dist:win -- --prepackaged dist/win-unpacked
```

### 验证

```powershell
npm test
node tests/scheduler-controls.integration.js
node tests/theme-menu-state.js
node tests/appearance-clipboard-smoke.js
node tests/sql-preview-smoke.js
node tests/file-scroll-smoke.js
node tests/html-preview-smoke.js
```

验证打包后的主题、编辑器、剪贴板、任务界面及盘符菜单：

```powershell
node tests/appearance-clipboard-smoke.js dist/win-unpacked/fanbox-pro.exe
```

界面测试使用独立临时配置，不修改日常使用的仓库与任务设置。

## 项目结构

```text
electron/               Electron 主进程、原生菜单与 IPC 桥接
public/                 文件界面、Git / 任务页面、主题和本地前端资源
gitsync/                仓库扫描、同步、配置、日志与任务调度
server.js               本地 HTTP 服务与文件 / 终端任务接口
build/                  打包图标与资源
scripts/                构建辅助脚本
tests/                  集成与桌面验证
docs/                   设计资料与保留的旧 README
```

## 文档与贡献

- [操作说明](操作说明.md)
- [更新日志](CHANGELOG.md)
- [原 Windows README（保留）](docs/README-legacy-windows.md)
- [原 FanBox README（参考文件保留）](docs/README-original-fanbox.md)

欢迎提交 [Issues](https://github.com/ayxyj/fanbox-pro/issues) 和 Pull Request。报告问题时请注明 Windows 版本、软件版本、复现步骤，以及可提供的错误日志；提交改动时附上对应验证结果。

## 许可证

本项目采用 [MIT License](LICENSE)，保留 FanBox 原作者的版权声明。主题及第三方资源按各自许可分发，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
