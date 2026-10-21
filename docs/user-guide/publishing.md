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
