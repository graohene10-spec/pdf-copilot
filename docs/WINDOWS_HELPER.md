# PDF Copilot Windows 小助手

本包只包含连接本机 Codex 的可选助手。使用 DeepSeek / OpenAI API Key 时不需要安装它。

1. 先在 Edge / Chrome 加载 PDF Copilot 扩展。
2. 双击 install.cmd。默认登记随包固定开发扩展 ID，只为当前 Windows 用户安装，无需管理员。
3. 在插件设置选择「Codex 本机登录」，点击检查连接并读取模型。

需要 Windows Codex CLI 0.159.2 或更新版本。安装器只检查程序版本，登录在插件设置中另行检查。它会验证现有助手配置、PATH、独立安装目录、npm 全局包内部的 Windows 程序及 Codex 桌面附带的程序，并选择满足要求的最新版本。不会因为旧程序排在 PATH 前面，就忽略已经安装的新版本。

安装后，插件设置会分别显示「CLI 版本」「实际程序」「版本兼容」「登录状态」。请按检查结果处理：

- **版本不兼容**：先更新上方显示的 CLI，或安装较新的 CLI，再重新运行小助手安装程序。此时登录状态没有检查，不代表未登录。
- **版本兼容，但登录尚未确认**：查看诊断详情，先解决连接、网络或管理配置问题。
- **明确显示未登录**：使用同一 Windows 用户、设置中显示的同一个程序执行 `login`，然后重新检查。例如在 PowerShell 中运行 `& 'C:\实际路径\codex.exe' login`。

桌面应用开着或已登录，并不能证明另一份 CLI 的登录状态。助手通过 Codex 自身的账户接口检查登录，不读取或复制桌面应用内部登录令牌。

如果扩展来自商店，或实际 ID 与 extension-id.txt 不同，在设置页复制实际 ID，然后运行：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-host.ps1 -ExtensionId 实际32位ID
~~~

也可加 `-CodexPath 'C:\实际路径\codex.exe'` 指定 Windows 程序，或用 `-EdgeExtensionId` 和 `-ChromeExtensionId` 登记两家商店的不同 ID。明确指定的程序不会被安装器静默替换；如果它版本过低，安装器会列出该程序版本和路径并停止。`.cmd` 启动脚本和 WSL 程序不能作为 `CodexPath`。更换 Codex 路径或扩展 ID 后重新安装。

可用 `-WhatIf` 先检查版本与候选选择，不写入程序或浏览器注册信息。安装器不会代替你登录、读取登录令牌或自动升级 Codex。

双击 uninstall.cmd 可卸载助手及其浏览器注册；不会卸载 Codex，不删除 Codex 登录或聊天数据。安装只保存程序路径和允许的扩展 ID，不保存 PDF、图片、密钥或会话。没有常驻服务和本地网络端口。

这是未签名的侧载初版。程序源码随 PDF Copilot 源码包提供，发布包附带 SHA-256 校验。真实 Codex 连接与极小合成文字/图片问答已验收；其他测试范围与待验项目见主 README。当前尚未上架浏览器商店。
