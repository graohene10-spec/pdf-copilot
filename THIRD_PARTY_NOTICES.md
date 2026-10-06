# 第三方代码与许可

本项目自身代码采用 MIT 许可。

浏览器包包含 Mozilla PDF.js / pdfjs-dist 6.4.299 的构建、文字层样式、CMaps、标准字体、色彩与 WebAssembly 解码资源，遵循 Apache License 2.0。原始 LICENSE 保存在 vendor/pdfjs/LICENSE。项目：https://github.com/mozilla/pdf.js

PDF.js 第三方字体、色彩和 WebAssembly 资源包含自己的许可声明。构建保留对应目录的原始许可文件，升级/精简时应继续保留。

浏览器包包含 KaTeX 0.19.0 的 ES 模块、样式与 WOFF2 字体，用于本地公式排版，遵循 MIT 许可。原始 LICENSE 保存在 vendor/katex/LICENSE。项目：https://github.com/KaTeX/KaTeX 。KaTeX 的命令行依赖与旧字体格式不包含在浏览器包中。

助手使用 Windows 自带 .NET Framework 类库，无 NuGet 运行依赖。Codex CLI 为独立安装前置，不包含在分发包；通过公开协议通信，未复制其源码或认证数据。

浏览器测试可使用 Playwright，它是开发工具，不包含在运行包。
