# 文档阅读、导入与维护

本指南提供 GitBook 可用的 Markdown 目录、`SUMMARY.md` 导航、`.gitbook.yaml` 配置及相对路径截图。无需启动 FanBox 即可阅读。

## 本地阅读

打开同目录 `index.html` 查看带侧栏导航的离线阅读版。保留 `assets` 文件夹和 HTML 的相对位置；直接分享时建议发送整个 ZIP 包。

Markdown 编辑器可以直接打开 `README.md`，通过章节链接阅读。截图都保存在 `assets` 中，不依赖外部图床。

## 导入 GitBook

通过 Git Sync 把此目录映射为一个文档空间，内容目录使用 `docs/user-guide`；如果将本指南单独放到文档仓库根目录，则使用该根目录。保留 `.gitbook.yaml`、`README.md` 和 `SUMMARY.md`。

现有 GitBook 站点请沿用它自己的空间映射，不要盲目覆盖全站配置。本交付仅生成可导入文件，没有替你创建或发布线上站点。

GitBook 的导航和内容配置依据：[官方内容配置文档](https://gitbook.com/docs/docs-as-code/git-sync/content-configuration)。

## 截图来源与更新

截图于 2026-10-20 从当前 Windows 应用生成，采用独立用户目录、本机模拟模型和示例项目。AI 对话中的模型回复为明确标记的演示内容；命令授权图使用真实弹窗组件展示，没有执行该命令。

没有创建真实企微机器人、发送真实消息或连接生产服务器；因此企微手机端和 SFTP 没有伪造的操作截图，相关章节通过步骤和命令示例说明。

维护时更新对应章节及截图，再检查 `SUMMARY.md` 和图片相对链接。源码仓库中的 `scripts/capture-user-guide.js` 可重新生成演示截图；它使用测试端口和独立配置，不应与相同端口的测试同时运行。

本次文字文档同步到 2026-10-22 的当前 1.0.3 本地调试包，现有截图继续用于说明界面位置，没有把它们冒充为真实企微在线联调或长期运行验证结果。

## 重新生成离线版和网站版

在项目根目录执行：

```powershell
node scripts/build-user-guide.js
node scripts/build-user-guide-web.js
```

第一条校验 Markdown 链接和截图路径并更新 `docs/user-guide/index.html`；第二条生成 `dist/fanbox-pro-guide-web`，其中 `index.html` 与 `assets` 可一起部署。离线页的适用版本和文档日期从本指南首页读取，不再单独维护旧版本标注。这些操作不修改软件版本号，也不发布网站或 Release。
