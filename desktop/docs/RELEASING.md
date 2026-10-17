# 发布开智桌面版

开智会读取 GitHub Releases 来发现新版本：只看 `desktop-v` 开头的标签（浏览器插件的 `v0.3.3` 这类标签不受影响），比较版本号，在右下角提示用户更新。安装版可以在应用内下载安装包，用 `SHA256SUMS.txt` 校验后静默安装并自动重启。免安装版会打开发布页，由用户手动替换。

## 1. 更新版本号

三处必须一致，否则打包脚本和发布流程会直接失败：

- `desktop/package.json` 的 `version`
- `desktop/src-tauri/tauri.conf.json` 的 `version`
- `desktop/src-tauri/Cargo.toml` 中 `[package]` 的 `version`（之后运行一次 `cargo check` 更新 `Cargo.lock`）

版本号遵循 SemVer：

- 正式版：`0.3.0`
- 测试版：`0.3.0-beta.1`、`0.3.0-beta.2`……数字按大小比较，`beta.10` 高于 `beta.2`；同一版本的正式版高于测试版（`0.3.0` > `0.3.0-rc.1` > `0.3.0-beta.2`）。

建议同时写好 `desktop/RELEASE_NOTES_<版本>.md`，自动发布会用它作为发布说明，更新卡片里显示的也是这段文字。没有这个文件时，GitHub 会自动生成提交列表。

## 2. 打标签并推送

```powershell
git commit -am "desktop: 0.3.0"
git tag desktop-v0.3.0          # 测试版：git tag desktop-v0.3.0-beta.1
git push origin main desktop-v0.3.0
```

标签必须与 `package.json` 的版本完全一致（`desktop-v` + 版本号）。

## 3. 自动构建与发布

推送标签后，`.github/workflows/desktop-release.yml` 在 `windows-latest` 上运行：

1. 检查标签与三处版本号；
2. 在仓库根目录 `npm ci`、`npm run build:host` 构建 Codex 助手；
3. 在 `desktop/` 中 `npm ci`、准备离线资源、运行 `npm test` 与 `cargo test`；
4. `npm run desktop:build` 生成 NSIS 安装包，`npm run package:desktop` 整理 `release/`；
5. `node scripts/release-assets.mjs` 生成发布附件：
   - `kaizhi_<版本>_x64-setup.exe`（应用内更新使用这个文件）
   - `kaizhi_<版本>_x64-portable.zip`
   - `kaizhi_<版本>_source.zip`（`git archive` 生成的完整源码）
   - `manifest.json`（文件大小、SHA-256、源码提交）
   - `SHA256SUMS.txt`（`<sha256>  <文件名>` 格式，更新程序据此校验安装包）
6. 创建 GitHub Release 并上传附件。版本号带 `-`（如 `0.3.0-beta.1`）时标记为 **Pre-release**；否则标记为 Latest。

重新运行同一标签的流程会覆盖附件（`--clobber`），已有的标题和说明不变。也可以在 Actions 页面手动运行 “Desktop release”，填入已推送的标签。

发布后，用户的开智启动约 8 秒后、之后每 6 小时检查一次（可在设置中关闭「自动检查更新」），发现新版本就弹出更新卡片：

- 「立即更新」→ 下载并校验 → 「重启并安装」：开智退出，安装程序静默运行，完成后自动重新打开。文档库、设置和已保存的密钥都会保留。
- 「稍后」：本次运行不再提示该版本。
- 「跳过此版本」：自动检查不再提示该版本；在设置里手动「检查更新」仍会显示。
- 免安装版或缺少可校验的安装包时，显示「前往下载页」。

## 4. 测试版

把调试版或候选版发给测试者时：

1. 版本号使用预发布后缀，例如 `0.3.0-beta.1`，标签 `desktop-v0.3.0-beta.1`；
2. 推送标签，流程会把它发布为 Pre-release；
3. 测试者在「设置」中打开 **「接收测试版更新」**，再点「检查更新」即可看到测试版。

普通用户默认不接收测试版。测试者关闭该选项后，会停留在当前测试版，直到更高的正式版（例如 `0.3.0`）发布。

## 5. 手动发布（不使用 CI）

在 Windows 上：

```powershell
npm ci; npm run build:host            # 仓库根目录
cd desktop
npm ci
npm test; cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build                 # 或 scripts/build-windows.ps1 -Test
npm run package:desktop
node scripts/release-assets.mjs       # 输出到 release/github/
gh release create desktop-v0.3.0 (Get-ChildItem release/github -File).FullName --title "开智 0.3.0 · Windows 桌面版" --notes-file RELEASE_NOTES_0.3.0.md
# 测试版追加 --prerelease
```

也可以在 GitHub 网页上新建 Release，上传 `release/github/` 中的五个文件。注意：

- 安装包文件名必须以 `_x64-setup.exe` 结尾，并且 `SHA256SUMS.txt` 中有它的校验值，否则应用只会提供「前往下载页」；
- 仍在准备的发布请保存为 Draft：Draft 不会被检查到，点 Publish 后用户才会收到提示；
- 修改附件后必须同时更新 `SHA256SUMS.txt`，校验不一致时应用会拒绝安装并删除下载的文件。

## 说明与限制

- 安装包目前没有代码签名。应用内下载的文件不带 “来自网络” 标记，静默安装通常不会出现 SmartScreen 提示；用户从浏览器手动下载时仍可能看到提示。
- 应用内安装依赖 Tauri NSIS 安装包的 `/S`（静默）参数，安装位置沿用当前安装目录（当前用户安装，无需管理员权限）。
- 未登录的 GitHub API 每小时每个 IP 最多 60 次请求，自动检查的频率远低于此限制。
