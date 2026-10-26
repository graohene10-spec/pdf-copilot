# 发布开智桌面版

桌面发布使用 `desktop-v<版本>` 标签，例如 `desktop-v0.7.1`。浏览器插件的 `v0.3.3` 等标签有独立版本，不触发桌面构建。用户升级方式见[升级指南](UPDATING.md)。

## 版本与提交

发布前同步以下五个文件中的桌面版本：

| 文件 | 版本位置 |
| --- | --- |
| `desktop/package.json` | `version` |
| `desktop/package-lock.json` | 顶层 `version` 和 `packages[""].version` |
| `desktop/src-tauri/tauri.conf.json` | `version` |
| `desktop/src-tauri/Cargo.toml` | `[package].version` |
| `desktop/src-tauri/Cargo.lock` | `name = "phydog"` 对应的包版本 |

CI 与打包脚本检查 `package.json`、Tauri 配置和 `Cargo.toml` 三处主版本，锁文件也应随依赖工具更新并提交。仓库根目录的 `package.json` 属于浏览器插件，不跟随桌面版本修改。

正式版使用 `0.7.1` 这类 SemVer 版本；测试版可使用 `0.7.1-beta.1`。更新程序按 SemVer 比较版本，`beta.10` 高于 `beta.2`，同一版本的正式版高于预发布版。

同时编写 `desktop/RELEASE_NOTES_<版本>.md`。自动发布使用此文件作为 Release 正文，应用内更新卡片也显示该正文；没有说明文件时使用 GitHub 生成的提交列表。完整源码 ZIP 来自构建时的 Git 提交，因此版本、说明和实现都应先提交。

## 自动发布

[Desktop release 工作流](../../.github/workflows/desktop-release.yml) 支持三种入口：

- **推送到 `main`**：读取 `desktop/package.json` 的版本。对应标签不存在时，在本次提交创建 `desktop-v<版本>` 标签并继续构建、发布；已有该标签时跳过。因此，已发布版本的普通文档更新不会重新打包；尚未打标签的版本，即使这次只改文档，也会发布。
- **推送 `desktop-v*` 标签**：检出该标签并构建。标签必须与标签所指提交中的桌面版本完全一致。
- **Actions 手动运行**：选择 “Desktop release”，填写已推送的标签，例如 `desktop-v0.7.1`。

通常将版本修改、实现和更新说明一并合入 `main` 即可，无需另行手动打标签。若选择手动打标签，先确认标签尚不存在，并将它指向已完成的发布提交；不要将已发布标签移到其他提交。

工作流在 Windows 上依次完成：

1. 检查标签和三处主版本。
2. 安装 Node.js 22 和 Rust 稳定工具链。
3. 在仓库根目录执行 `npm ci`、`npm run build:host`，构建 Windows Codex 助手。
4. 在 `desktop/` 执行 `npm ci`、`node scripts/prepare-assets.mjs`，准备离线资源及 Tauri 所需的助手程序，然后运行 JavaScript 和 Rust 测试。
5. 执行 `npm run desktop:build` 生成 NSIS 安装包，再执行 `npm run package:desktop`。
6. 执行 `node scripts/release-assets.mjs --tag <标签>`，将发布附件整理到 `desktop/release/github/`。
7. 上传构建附件并创建 GitHub Release。带预发布后缀的版本标为 Pre-release，其余标为 Latest。

重新运行同一标签的工作流会覆盖同名 Release 附件（`--clobber`），已有标题和说明保持不变。只需更正文档或 Release 正文时，可直接修改对应内容，无需重跑构建。

## 发布附件

以 `0.7.1` 为例，`release/github/` 包含五个文件：

| 文件 | 用途 |
| --- | --- |
| `kaizhi_0.7.1_x64-setup.exe` | Windows x64 安装版；安装版应用内更新使用此文件 |
| `kaizhi_0.7.1_x64-portable.zip` | Windows x64 免安装版；免安装版应用内更新使用此文件 |
| `kaizhi_0.7.1_source.zip` | `git archive` 生成的完整源码 |
| `manifest.json` | 文件大小、SHA-256、源码提交与标签 |
| `SHA256SUMS.txt` | 四个附件的 SHA-256，采用 `<sha256>  <文件名>` 格式 |

安装包名称须以 `_x64-setup.exe` 结尾，免安装包名称须以 `_x64-portable.zip` 结尾，并使用脚本生成的 ASCII 文件名。发布时同时提供 `SHA256SUMS.txt`。0.6.1 起，更新器优先读取 GitHub API 为附件生成的 `sha256:` 摘要，API 无有效摘要时再读取校验文件；对应附件或两种校验信息都不可用时，应用提供下载页入口。修改附件后须一并更新清单和校验文件。

仍在准备的 Release 可保存为 Draft。更新程序忽略 Draft，只读取本仓库 `desktop-v` 标签下已发布、版本高于当前程序的桌面版本。

## 本机构建与手动整理

Windows 构建需要 Node.js 22、Rust MSVC 工具链（项目最低 Rust 1.90）、Visual Studio C++ 构建工具及 Windows SDK。Codex 助手使用系统 .NET Framework 4.x 的 `csc.exe` 构建。运行程序需要系统 WebView2；安装包可在缺少运行时时联网下载安装，免安装包不携带 WebView2。

从仓库根目录开始，按顺序准备助手与资源，再运行原生测试：

```powershell
npm ci
npm run build:host
cd desktop
npm ci
node scripts/prepare-assets.mjs
npm test
cargo test --release --manifest-path src-tauri/Cargo.toml
npm run desktop:build
npm run package:desktop
node scripts/release-assets.mjs --tag desktop-v0.7.1
```

请逐步确认命令成功后继续；上述版本示例需与当前源码版本一致。`prepare-assets.mjs` 会复制 PDF 离线资源及 `PdfCopilotHost.exe`，必须先于首次 Rust 测试或构建。版本修改后，Cargo 命令会同步本地包的锁文件版本，应将更新后的锁文件提交后再整理最终源码包。

本机 Rust 测试可使用上例的 `--release`，复用正式构建目录，避免额外生成较大的 `target/debug`；当前 CI 仍使用默认测试配置。`scripts/build-windows.ps1` 可调用已经配置好的 Windows 工具链，但其 `-Test` 参数使用默认测试配置。

本机整理后检查五个附件、版本与校验值，确认源码提交已推送。可以在 GitHub 网页创建对应标签的 Release 并上传这五个文件，或使用 GitHub CLI；推送桌面标签也会触发上述 CI，手动整理不能阻止自动流程。已有 Release 仅需更正标题或说明时，直接编辑正文即可。

## 应用内更新约定

`0.3.1` 起，安装版与免安装版点击「立即更新」后自动下载、校验、安装并重启，无需再次确认安装。安装版静默运行 NSIS 安装程序；免安装版解压已校验的 ZIP，替换所在文件夹中包内的程序文件，保留额外文件，并在下次启动清理旧程序副本。文档库、设置与凭据沿用原应用数据目录。

更新请求使用系统代理与 HTTPS，仅接受本仓库的桌面发布附件。0.6.1 起优先使用 GitHub API 中的附件摘要验证 SHA-256，无有效摘要时回退到同次发布的 `SHA256SUMS.txt`；取得有效摘要后，下载完成仍须核对文件哈希。下载失败、取消或 SHA-256 不符时清理临时文件；免安装版替换失败时回滚已替换的文件。下载时可取消，失败后可重试。安装及自动重启前，用户应完成正在进行的操作；未发送草稿和进行中的请求不属于升级保留范围。

自动检查默认在每次启动约 8 秒后进行，之后每 6 小时检查一次，可在「设置 → 更新」关闭；测试版默认不接收。升级起点、手动替换方法、跳过版本与故障处理见[升级指南](UPDATING.md)。

安装包目前没有代码签名，Windows 可能显示安全提示；不保证 SmartScreen 的具体表现。NSIS 为当前用户安装，更新复用现有安装位置。未登录的 GitHub API 有请求额度限制，达到上限时应用显示错误，可稍后重试。
