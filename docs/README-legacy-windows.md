# fanbox-pro-win

基于本地 Windows 参考项目 fan-box-windows，移植 fanbox-pro 的 Git 管理与定时任务。

- 多 workspace 扫描与仓库总览：当前分支、关注分支、脏状态、stash、同步结果。
- 每仓库一个关注分支，默认 master，远端 origin；自动 fetch、切换和快进更新。
- 未提交改动只 fetch，提示提交或 stash；分叉不自动合并或覆盖。
- Git 自动同步：间隔或 cron，支持选择多个仓库，独立日志。
- 定时终端任务：一次性、每天、每周、每小时、间隔、cron；执行 Shell、Claude Code 或 Codex。

使用 Windows 原生窗口和 PowerShell 终端。软件运行时调度，关闭后不执行，不补跑错过的任务。
默认端口 4569，数据目录为用户主目录下的 .fanbox-pro-win，独立于旧软件。

## 开发与打包

Node.js >=18，本机 Git 在 PATH。

运行 npm ci，然后 npm run app。执行 npm test 验证 Git 同步，执行 npm run dist:win 生成 x64 安装包。
node-pty 1.1.0 提供 Windows x64 预编译模块；需要源码构建时安装 Visual Studio C++ Build Tools。

详见 操作说明.md。上游参考资料保留在 docs 和 CHANGELOG.md，许可证见 LICENSE。

## 验证

运行 npm test 验证真实 Git 仓库同步与调度。打包后可运行 node tests/electron-smoke.js ./dist/win-unpacked/fanbox-pro-win.exe 验证界面、配置加载、手动终端任务和自动一次性任务。测试使用独立临时目录。

如果 Windows 打包时更新 exe 资源失败，但 win-unpacked 已生成，可以先运行 node scripts/finalize-win.js dist/win-unpacked，再执行 npm run dist:win -- --prepackaged dist/win-unpacked。
