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

chat/ui.mjs 封装字号偏好和更多菜单交互。字号使用独立的 chrome.storage.local.chatFontSize 键，通过 CSS 变量更新文字与公式，不重新解析回复或改变模型参数。快速连点合并为最新偏好，storage 事件同步其他对话窗口；模型设置保留在 chat.js，默认用原生 details 折叠，不增加 UI 框架。

扩展调用 Native host com.pdfcopilot.codex，允许 metadata、chat、cancel，以及绑定当前问题的 tool-result。助手保持 Codex 自有认证，创建 ephemeral 线程，显式禁执行环境和继承工具；自动上下文只登记四个 PDF 只读工具，其他动作失败关闭。详细协议和版本边界见 [native-host.md](native-host.md)。

## 按需 PDF 上下文

- `common/document-tools.mjs` 定义跨服务商复用的只读工具参数；`common/document-limits.mjs` 统一资源默认值、设置字段与可调边界。`settings.js` 在加载/保存时归一化配置，读取会话锁定本题预算，不接受路径、URL 或执行指令。
- `reader/text-index.mjs` 用 PDF.js 文字坐标还原有限段落和双栏顺序，建立有界内存 BM25 索引，保留原文、物理页码、页标签和 PDF 坐标。中文用字词片段匹配，公式编号保留；提取不等价于 OCR。
- `reader/document-service.mjs` 管理当前 PDF 的元数据、惰性提取、搜索覆盖、文字/页图证据以及每题预算。索引缓存最多 256 页/200 万字符；每次搜索默认不超过 120 页/10 秒，扫描页数和时间可调。扫描覆盖与完整缓存覆盖分别报告。截图由独立临时 canvas 生成，压缩为有界 JPEG 后释放画布。
- `chat/document-client.mjs` 通过 background → reader 的 runtime 消息访问已打开文档。后台检查自有聊天页、目标阅读页和请求编号；阅读器核对 PDF 指纹。模型看不到本地来源路径、标签页编号或任意文件读取接口。
- `providers/document-chat.mjs` 负责有界工具循环与阅读计划降级。OpenAI Responses 重放 reasoning/function call 项和相应 call_id，DeepSeek 保留工具轮次的 reasoning_content；旧图片不重复发送。默认 3 轮 API 检索、12 次调用/8 页证据/24,000 正文字符/5 次自动页图（含当前页），这些预算可在设置中调整。工具循环与兼容计划都使用本题剩余预算，API 调用状态仍有固定 16 MiB 字符边界。
- Codex 使用 `DocumentTools.cs` 与异步 `item/tool/call` 桥接：请求绑定 thread/turn/chat，随机 call token 只能消费一次，45 秒超时不会阻塞 stdout 接收。只读工具通信需要 `code_mode_host=true`，同时保持 `code_mode=false`、空执行环境、无 shell/MCP/插件；0.160.0 真实收发已验证。不支持动态工具字段时使用同一套浏览器检索的兼容阅读计划。
- 回答的引用仅对实际返回的 sourceId 生成按钮，未知编号保留文字；原文面板使用 textContent，点击回跳再核对 PDF 指纹并高亮坐标。

自动上下文默认开启，保留显式关闭偏好。`common/page-context.mjs` 共用开关与自动附页策略：仅本题没有手动附件时附页。增强模式通过当前会话的 `pdf_view` 提供当前物理页，计入既有图片预算；文字模型通过 `pdf_read` 提供当前页文字。原生模式由仅限受信对话页的 `page:capture` 获取可见标签页，在捕获前后核对来源网址和激活状态，再由 `chat/page-image.mjs` 在内存压缩，沿用 activeTab，不新增常驻权限。最新问题包含页图，历史只传文字；自动页图预览收起，旧图片预览有内存保留上限。

后台不保存 PDF/index 或自动截图，索引属于阅读页生命周期。每题都有取消令牌，停止/换文档/关页后不得将旧结果交给新问题；缓存文字可在同一打开文档内复用。长书的局部搜索无命中不能据此断言全文不存在。

增加服务商时，在 providers/index.js 添加服务描述及请求适配，并补 payload/流式终止测试；不需要改阅读器。升级 PDF.js 时更新精确版本/锁文件，重新检查 TextLayer CSS和几何验证。发布前维护权限、第三方许可和验收记录。
