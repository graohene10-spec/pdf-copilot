# 第三方代码与许可

本项目自身代码采用 MIT 许可。

浏览器包包含 Mozilla PDF.js / pdfjs-dist 6.4.299 的构建、文字层样式、CMaps、标准字体、色彩与 WebAssembly 解码资源，遵循 Apache License 2.0。原始 LICENSE 保存在 vendor/pdfjs/LICENSE。项目：https://github.com/mozilla/pdf.js

PDF.js 第三方字体、色彩和 WebAssembly 资源包含自己的许可声明。构建保留对应目录的原始许可文件，升级/精简时应继续保留。

浏览器包包含 KaTeX 0.19.0 的 ES 模块、样式与 WOFF2 字体，用于本地公式排版，遵循 MIT 许可。原始 LICENSE 保存在 vendor/katex/LICENSE。项目：https://github.com/KaTeX/KaTeX 。KaTeX 的命令行依赖与旧字体格式不包含在浏览器包中。

助手使用 Windows 自带 .NET Framework 类库，无 NuGet 运行依赖。Codex CLI 为独立安装前置，不包含在分发包；通过公开协议通信，未复制其源码或认证数据。

浏览器测试可使用 Playwright，它是开发工具，不包含在运行包。

## 开智桌面版

桌面版复用 PDF.js 和 KaTeX，另使用 Vue、Mermaid 与 perfect-freehand。锁定版本及声明许可见 [desktop/package-lock.json](desktop/package-lock.json)：Vue、Mermaid、perfect-freehand 声明为 MIT；`@fontsource-variable/source-serif-4` 包声明为 OFL-1.1。分发这些依赖时应保留各自许可文本。

0.3.1 内置的独立字体文件为 [AnthropicSerif-Variable.woff2](desktop/src/assets/fonts/AnthropicSerif-Variable.woff2)。该文件目录目前没有附带单独的许可文本，来源与授权说明尚需提供者补充；不能用 Source Serif 4 包的许可代替这个独立文件的授权说明。

用户在设置中导入的字体保存在其本机文档库，不会加入项目发布包。
