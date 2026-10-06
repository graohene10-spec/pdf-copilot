# 打包与发布

1. 同步 package.json 与 extension/manifest.json 版本。
2. 下载锁定依赖，运行 `npm run build` 构建自带公式版、`npm run build:lite` 构建极简版。构建助手，运行两版静态检查/测试。
3. 按 ACCEPTANCE.md 检查功能，并在 QA_REPORT.md、README 和发行说明中准确记录已测试与未测试的范围。真实账户推理检查会使用额度；不要将模拟回复或命令处理函数检查写成真实服务/快捷键已通过。
4. 运行 npm run package，获得两种完整包及扩展商店 ZIP、助手 ZIP、源码 ZIP、SHA256SUMS.txt 和 DISTRIBUTIONS.md 体积对照。默认版必须包含本地 KaTeX ES 模块、样式、WOFF2 字体及许可；极简版必须设置 EMBEDDED_MATH=false 并不包含这些资源，不能因缺资源导致聊天失效。
5. 为扩展商店准备图标、实际界面截图、隐私政策公开 URL、功能描述与权限说明。提交扩展 ZIP 并等待审核；不要把 API Key、用户 PDF、测试缓存或助手 exe 放进商店 ZIP。
6. 商店分配的 Edge/Chrome ID 可能不同。助手安装需要允许真实 ID；通过 -ExtensionId、-EdgeExtensionId、-ChromeExtensionId 参数登记。开发公钥只稳定侧载 ID，不是签名密钥，不控制商店 ID。
7. 助手 exe 目前未签名。正式广泛传播可增加 Authenticode 代码签名，提供版本/校验和及可验证源码。不要承诺 Windows SmartScreen 已认可。

## GitHub Release

提交源代码、文档和锁文件；dist、release、node_modules、测试 artifacts 与 .cache 不进入 Git。发布前扫描待提交文件和 ZIP，排除密钥、用户 PDF、个人配置和临时测试文件。

先查询 GitHub 上最新公开发行版，以它为基线整理更新日志；不要列出仅在本机开发、未公开发行的中间版本。日志只列新增、改进和修复，已有能力留在功能介绍中。

创建并推送与源码提交一致的版本标签（例如 v0.3.3）。先创建草稿 Release，上传六个 ZIP、SHA256SUMS.txt 和 DISTRIBUTIONS.md，使用对应版本的 docs/RELEASE_NOTES_v0.3.3.md 作为说明。核对标签、附件名称、大小和 SHA-256 后再公开 Release。安装教程须使用本次附件文件名，并逐步写出解压、加载扩展、连接模型、首次阅读及成功标志。

GitHub 自动生成的源码归档没有编译后的扩展，应在 README 明确提示用户下载完整安装包。侧载扩展更新需要覆盖实际加载目录、重新加载扩展并重开旧页面，不能承诺自动更新。

完整包用于开发侧载；助手独立分发并以 HKCU 注册，无常驻服务、无系统网络端口。卸载脚本只删除自身注册和安装目录。不得复制 Codex 登录凭据到包中。

初版依赖最新浏览器（manifest 最低 Chromium 132）。商店审核还需测试真实 Edge/Chrome 版本，特别是原生 PDF 选文、快捷键冲突、本地文件访问，以及侧栏 user-gesture 要求。
