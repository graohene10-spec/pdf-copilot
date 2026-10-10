# 开发验收

本版结果与限制见[测试记录](QA_REPORT.md)。常规自动验证使用合成 PDF 与本机模拟接口，不需要真实 API Key；真实账户检查单独启用并记录。

当前未发行的多标签页/排队改动见[开发版测试记录](MULTI_TAB_QA.md)。

## 运行准备

在仓库根目录打开 PowerShell，安装 Node.js 22+ 和当前 Edge。先构建并执行基础检查：

~~~powershell
npm ci --ignore-scripts
npm run build
npm run build:lite
npm run build:host
npm run check
npm run check:lite
npm test
~~~

浏览器回归需要 Playwright，仅安装到开发目录，不进入发行包：

~~~powershell
npm install --no-save --package-lock=false playwright
$env:PDF_COPILOT_PLAYWRIGHT_PATH = Join-Path (Get-Location).Path 'node_modules/playwright'
~~~

脚本默认使用 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`；Edge 在其他位置时，用 `PDF_COPILOT_EDGE_PATH` 环境变量指定。脚本使用独立配置目录，不更改日常浏览器配置。先关闭无用测试窗口，避免进程争用。

## 浏览器回归

~~~powershell
node scripts/upgrade-smoke.mjs
node scripts/acceptance-smoke.mjs
node scripts/context-smoke.mjs
node scripts/resource-limits-smoke.mjs
node scripts/page-smoke.mjs
node scripts/multi-tab-smoke.mjs
node scripts/file-url-smoke.mjs
~~~

再次运行当前页测试时可验证极简版：

~~~powershell
$env:PDF_COPILOT_MATH_PROFILE = 'plain'
node scripts/page-smoke.mjs
node scripts/multi-tab-smoke.mjs
node scripts/file-url-smoke.mjs
Remove-Item Env:\PDF_COPILOT_MATH_PROFILE
~~~

截图、摘要和隔离配置输出至 `artifacts` / `.cache`，不会打包。部分无头原生截图测试副本增加网站授权；发行扩展不得沿用测试权限。本地 URL 脚本使用原始 Manifest。

`scripts/native-inference-smoke.mjs`、`scripts/context-native-smoke.mjs` 会使用本机真实 Codex 和账户额度，只在需要检验真实连接、模型及工具往返时单独执行。不得把这些结果与模拟接口混淆，不使用个人文档作为默认输入。

## 手动逐项验收

在实际 Edge / Chrome、Windows 与目标 Codex 版本上记录结果：

- 从 Release 下载、全部解压、加载扩展；设置显示正确版本，重启后仍可用；默认版公式直接排版，极简版显示原文。
- 按用户教程分别走 API Key 和 Codex 安装路线；检查新用户安装/卸载助手、自定义扩展 ID、失效 CLI 路径、版本与登录未知提示。
- 真实按键打开侧栏、增强阅读器、临时窗口和截图；在快捷键页重新分配，核对冲突提示。原生 PDF 选文菜单不支持时复制到对话。
- 本地选择/拖入、原生在线和 file PDF、首次可选权限、拒绝授权、密码 PDF、目录/内链/书签、连续滚动、快速换文件、缩放与高 DPI。
- 增强框选、反向拖动、等待渲染、取消与夜间原色预览；引用回跳及区域高亮。
- 直接问当前页、翻页后再问、手动附件优先、关闭自动上下文并重开；文字模型读取文字层，扫描页给出图片要求。
- 两个 PDF 标签页和多个窗口之间切换，附件/会话不会串文档；侧栏与临时窗口独立。
- 开发版：真实全局侧栏切换标签页后原回答继续接收；切回显示完整回复与草稿。多窗口共用名额、队列位置/满额恢复、取消与关闭来源释放名额，后台线程重启不超额。增强模式框选快捷键在浏览器快捷键设置中可修改。
- 指定章节/公式/页码，让 AI 搜索、读页、查看页图；核对原文引用和物理页码/页标签；达到预算后正常收束。
- 设置资源限制、恢复默认及范围校验；默认五次页图，修改设置后下一题生效，进行中问题保留原预算；API/Codex 与兼容阅读计划均不超过自定义上限。
- DeepSeek / OpenAI 各一次真实文字/图片问答，检查所选模型、低/高思考强度及错误模型/权限/额度；Codex 验证真实文字、图片、工具和取消。
- 回复字号、复制、公式、长回答、停止/清空、网络断开、睡眠唤醒和窗口关闭。
- API Key 默认不跨浏览器重启；勾选记住才持久，忘记立即移除；附件消费后队列清空。
- Windows Process Monitor 检查插件/助手是否主动写入截图或提示/回复日志；核对 Codex 临时会话。不能把交换文件或服务商留存作为应用能保证的范围。

发布前仅在已完成范围内描述验证结果，参照[发布流程](RELEASING.md)核对源码、文档、许可、打包与校验和。
