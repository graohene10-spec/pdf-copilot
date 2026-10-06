# PDF Copilot v0.2.3

轻量的 Windows Edge / Chrome PDF 阅读扩展，附带可选 Codex 小助手。保留浏览器原有 PDF 阅读方式，并提供支持连续滚动、直接框选和页码引用的 PDF.js 增强阅读器。

## 下载与安装

推荐 **pdf-copilot-0.2.3.zip**：包含扩展、内置 KaTeX 公式模块与字体、可选 Windows 小助手、教程和许可。无需为公式安装任何额外环境。**pdf-copilot-lite-0.2.3.zip** 为公式显示原文的极简版。

另提供扩展独立包、助手独立包、可构建源码包、SHA256SUMS.txt 和发行版体积对照。两个发行版使用相同扩展 ID，选择一种即可。

1. 解压完整包，打开 edge://extensions 或 chrome://extensions，开启开发人员模式。
2. 加载包含 manifest.json 的 **extension** 文件夹，并固定扩展图标。
3. 打开侧栏“设置”，配置 DeepSeek / OpenAI API Key；或安装 windows-helper/install.cmd 后选择 Codex 本机登录。
4. 打开 PDF，使用侧栏提问、截图框选，或切换增强阅读器。

[详细功能与安装教程](https://github.com/graohene10-spec/pdf-copilot/blob/main/README.md) · [使用教程](https://github.com/graohene10-spec/pdf-copilot/blob/main/docs/USER_GUIDE.md) · [隐私说明](https://github.com/graohene10-spec/pdf-copilot/blob/main/PRIVACY.md)

## 本版修复

- 修复含文档链接的 PDF 页初始化失败，恢复内部链接与框选。
- 页面仍在渲染时，框选会等待完成再显示预览，并取消已经过期的选区。
- 取消文字选择后，不再保留旧文字附件入口。
- 翻页后继续保留框选模式提示。
- 取消加密 PDF 密码输入后，正确显示取消提示并允许继续打开文档。

侧栏快捷键为普通“打开 AI 侧栏”命令，建议 Ctrl + Shift + 7；增强阅读器建议 Ctrl + Shift + 8。未设置时可在浏览器扩展快捷键页手动分配。升级后需重新加载扩展，并关闭重开旧阅读器页。

## 验证与限制

57 项单元测试通过；1 项真实元数据测试默认跳过，另用真实 Edge Native Messaging 检查通过。隔离 Edge 的 26 组阅读验收通过，覆盖高 DPI、目录/内链、连续滚动、书签、慢渲染、正反向框选和加密 PDF。完整/极简公式和等待状态使用本机模拟服务验证。真实 Codex 极小合成文字与图片问答各通过一次；未向模型发送个人 PDF。

本版为侧载初版，尚未上架商店，小助手 EXE 尚未签名。真实浏览器快捷键/原生 PDF 右键菜单跨环境、DeepSeek/OpenAI API 真实推理、全新电脑安装卸载等仍需进一步实测。[完整测试记录](https://github.com/graohene10-spec/pdf-copilot/blob/main/docs/QA_REPORT.md)

应用不主动保存截图文件；系统交换文件、浏览器行为和服务商处理政策不属于绝不落盘保证。Codex 需要 Windows 原生 CLI 0.159.2 或更新版本，登录由 Codex 自身管理。
