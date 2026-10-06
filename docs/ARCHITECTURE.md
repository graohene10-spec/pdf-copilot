# 结构与维护

~~~text
extension/
  background.js       浏览器事件、内存附件交接、窗口与回跳
  common/             设置、上下文边界、共享样式
  providers/          OpenAI / DeepSeek / Codex 适配、SSE
  chat/               同一页面承载侧栏和独立临时窗口
  settings/           模型、密钥、可选网站权限
  reader/             PDF.js 连续阅读、页面窗口与 PDF 坐标
  capture/            原生标签页截图的裁剪页面
native-host/          C# Native Messaging / Codex stdio / Windows Job
scripts/              构建、图标、打包、安装、卸载、静态检查
tests/                协议、SSE、隐私边界、几何与目录测试
~~~

后台不持有长模型请求。API 流由仍打开的聊天页负责，关闭时 Abort；Codex 由 Native Messaging port 控制寿命。后台可能休眠，附件队列放 chrome.storage.session，并在取走后删除；完整截图仅在短暂的后台/裁剪页内存中。

侧栏会话以来源 tabId 和 PDF 指纹隔离。临时对话独立窗口独立内存。队列带目标 sidebar/quick，避免错误文档或不同窗口混用。图片在边界层验证格式/大小，PDF 与普通模型文本用 textContent 渲染。公式仅交给本地 KaTeX，只有它产生的标记被插入 DOM，trust:false 禁用外部资源和可信 HTML 指令；代码片段跳过公式解析。没有网页注入和远程可执行脚本。

增强阅读器复用 PDF.js render、TextLayer、getOutline/getDestination。所有页建立轻量占位，保留当前页及邻页最多3个画布，合计约1600万像素，其余页释放渲染资源及交互监听。原生纵向滚动同步当前页；页码、目录、书签定位目标页。混合尺寸页面在按需取得真实尺寸后维护滚动锚点。每次开文件/重排用代次令牌与取消控制竞态；选文和截图绑定操作所在页。夜间使用显示滤镜，截图读取 canvas 原色像素。PDF.js 禁用 eval，未开启脚本执行。

chat/math.mjs 只解析公式与代码边界。流式期间显示原文，完成/停止后一次排版，避免每token重新解析；每式长度、每消息公式数量、宏展开次数与显示尺寸均有上限。聊天请求拥有自己的取消控制器与来源状态，清空/切文档立即终止等待，旧流回调不能更新新会话。EMBEDDED_MATH 构建常量决定是否加载本地模块；极简版不包含模块或字体，仍安全显示原文。

扩展调用 Native host com.pdfcopilot.codex，仅允许 metadata、chat、cancel。助手保持 Codex 自有认证，创建 ephemeral 线程，显式禁执行环境和继承工具；异常工具请求失败关闭。详细协议和版本边界见 [native-host.md](native-host.md)。

增加服务商时，在 providers/index.js 添加服务描述及请求适配，并补 payload/流式终止测试；不需要改阅读器。升级 PDF.js 时更新精确版本/锁文件，重新检查 TextLayer CSS和几何验证。发布前维护权限、第三方许可和验收记录。
