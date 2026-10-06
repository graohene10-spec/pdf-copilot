# PDF Copilot Windows 小助手

本包只包含连接本机 Codex 的可选助手。使用 DeepSeek / OpenAI API Key 时不需要安装它。

本版为 v0.3.2，包含当前 PDF 的只读工具桥接，用于增强阅读器的“自动上下文”。从上一公开发行版 v0.2.3 更新时，Codex 用户需要同时重新安装此助手。目录、搜索、文字和页图由当前浏览器阅读页提供；没有常驻服务、任意文件读取或命令执行接口。

## 按顺序安装

1. 下载完整安装包 `pdf-copilot-0.3.2.zip` 并全部解压，按[安装与使用教程](https://github.com/graohene10-spec/pdf-copilot/blob/v0.3.2/docs/USER_GUIDE.md)在 Edge / Chrome 加载 `extension`。如果只下载助手 ZIP，它本身不含浏览器扩展，需要另装扩展。
2. 按同一教程安装或更新 Windows 原生 Codex CLI，打开新的 PowerShell，运行 `codex --version` 和 `codex login`。已有登录也要检查实际 CLI。不要复制登录令牌。
3. 打开完整包的 `windows-helper`，双击 `install.cmd`；助手独立 ZIP 解压后，直接双击解压目录中的 `install.cmd`。默认登记随包固定扩展 ID，只为当前 Windows 用户安装，无需管理员。等待安装窗口显示结果后再关闭。
4. 点击浏览器工具栏的 PDF Copilot 图标，在侧栏顶部点 **⋯ → 模型与密钥设置**。
5. 在 **服务商** 选择 **Codex 本机登录**，点 **检查连接并读取模型**。
6. 确认 **版本兼容：符合要求**、**登录状态：已登录**，选择模型及思考强度，再点 **保存设置**。
7. 返回侧栏先发送一句文字问题验证连接，再按教程打开 PDF。

**成功标志：** 设置页可读取模型，对话能收到回复。安装器成功只代表助手安装完成，不代表已确认 Codex 登录或推理可用。

## 版本与登录排查

需要 Windows Codex CLI 0.159.2 或更新版本。安装器只检查程序版本，登录在插件设置中另行检查。它会验证现有助手配置、PATH、独立安装目录、npm 全局包内部的 Windows 程序及 Codex 桌面附带的程序，并选择满足要求的最新版本。不会因为旧程序排在 PATH 前面，就忽略已经安装的新版本。

安装后，插件设置会分别显示「CLI 版本」「实际程序」「版本兼容」「登录状态」。请按检查结果处理：

- **版本不兼容**：先更新上方显示的 CLI，或安装较新的 CLI，再重新运行小助手安装程序。此时登录状态没有检查，不代表未登录。
- **版本兼容，但登录尚未确认**：查看诊断详情，先解决连接、网络或管理配置问题。
- **明确显示未登录**：使用同一 Windows 用户、设置中显示的同一个程序执行 `login`，然后重新检查。例如在 PowerShell 中运行 `& 'C:\实际路径\codex.exe' login`。

桌面应用开着或已登录，并不能证明另一份 CLI 的登录状态。助手通过 Codex 自身的账户接口检查登录，不读取或复制桌面应用内部登录令牌。

## 自定义安装参数

如果实际 ID 与 `extension-id.txt` 不同，在设置页复制实际 ID。在文件资源管理器打开 `windows-helper`，右键空白处打开终端（或先在 PowerShell 切换到这个目录），然后运行：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-host.ps1 -ExtensionId 实际32位ID
~~~

也可加 `-CodexPath 'C:\实际路径\codex.exe'` 指定 Windows 程序，或用 `-EdgeExtensionId` 和 `-ChromeExtensionId` 登记两家商店的不同 ID。明确指定的程序不会被安装器静默替换；如果它版本过低，安装器会列出该程序版本和路径并停止。`.cmd` 启动脚本和 WSL 程序不能作为 `CodexPath`。更换 Codex 路径或扩展 ID 后重新安装。

可用 `-WhatIf` 先检查版本与候选选择，不写入程序或浏览器注册信息。安装器不会代替你登录、读取登录令牌或自动升级 Codex。

## 卸载与数据保存

双击 `uninstall.cmd` 可卸载助手及其浏览器注册；不会卸载 Codex，不删除 Codex 登录或聊天数据。安装只保存程序路径和允许的扩展 ID，不保存 PDF、图片、密钥或会话。没有常驻服务和本地网络端口。

助手目前未签名，插件尚未上架浏览器商店。程序源码随 PDF Copilot 源码包提供，发布包附带 SHA-256 校验。Codex CLI 0.160.0 的真实连接、合成文字/图片问答与 PDF 工具引用往返已验证；其他测试范围见[测试记录](https://github.com/graohene10-spec/pdf-copilot/blob/v0.3.2/docs/QA_REPORT.md)。
