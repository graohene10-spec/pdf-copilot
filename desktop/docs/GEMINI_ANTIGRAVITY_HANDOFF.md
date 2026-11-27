# 交接：0.10.155 的 Gemini 与 Antigravity

写给维护主线的会话。这一版是另一个本地会话做的，用户要求直接发版。本机没有 Rust 工具链，**桌面版一次都没跑过**，下面"没验证的"请在真机上过一遍。

## 加了什么

**Gemini API 预设**（`src/ai/providers.mjs`）

- 服务商 `gemini`，走 Google 的 OpenAI 兼容接口 `https://generativelanguage.googleapis.com/v1beta/openai`，协议 `chat`。
- `thinking: 'effort'`：只发 `reasoning_effort`，且只发 low / medium / high（Gemini 3 以后不能关思考）。
- 流式工具调用里的 `extra_content`（Gemini 的思考签名）原样留在 `tool_calls` 上，下一轮带回。
- 凭据名 `gemini`，Rust 白名单已加（`google` 已被谷歌云翻译占用）。
- 小模型 `gemini-3.8-flash`，上下文窗口按 100 万算。

**Antigravity 本机登录**

- 小助手多了一个引擎：请求带 `engine: "antigravity"` 时走 `native-host/AntigravityClient.cs`，通过 `agy acp`（ACP，stdio 上一行一个 JSON-RPC）对话。不带 `engine` 的请求和原来完全一样。
- 每个小助手懒启动一个 agy 进程，所有会话开在里面。启动参数 `--sandbox --app-data-dir antigravity-kaizhi --agent kaizhi-reader`：
  - `--app-data-dir` 让它的对话记录落到 `~\.gemini\antigravity-kaizhi`，不进用户自己的 Antigravity 历史，登录照样有效。每次会话用完会清掉 `conversations`、`brain`、`annotations` 里的条目；小助手被杀时来不及清的，下一个小助手启动 Antigravity 时按 `work-<pid>\sessions` 补清。
  - `--agent kaizhi-reader` 是工作目录里的一个自定义代理：默认代理每次请求自带约 1 万 token 的系统提示，它只有约 2000。
- 工作目录 `%LOCALAPPDATA%\PdfCopilot\antigravity\work-<pid>`，里面有一个拒绝一切工具的 PreToolUse 钩子（钩子命令是小助手自己 `--deny-tool`）。客户端不声明 fs / terminal 能力，权限请求一律拒绝，看到工具真的在跑就杀进程。
  - **这套锁定不可靠**：审查实测发现，agy 启动时拉服务端配置失败（走代理时常见）的会话里，钩子整个不生效，联网搜索照常执行。用户决定不再投入这一块，所以保持现状。
- **不支持文档工具**：带 `pdfTools` 的请求直接回含 `PDF_TOOLS_UNAVAILABLE` 的错误；前端对 antigravity 直接走 `plannedChat`（先列阅读计划、再作答）。
- **会话复用**：chat 可带 `session: {key, base, next}`。`key` 是对话 id，`base` / `next` 是这一问前后消息 id 的指纹（`workspace.ts` 的 `chain()`）。小助手记着每段对话上次成功后的 `next`，新请求的 `base` 与它相同就只把新的一问发给原会话，否则新开会话发完整历史。编辑、重答、分支、压缩都会让指纹变样。
  - **只有不带文档上下文、也不是总结的提问才带 `session`**。实测一段 6 轮的文档对话：每问附带约 1.3 万 token 的原文和说明，复用后它们一轮轮攒在会话里，未缓存输入只省 13%，模型处理的总量反而是 2.3 倍。
- 前端：`native-models.ts` 的 `isNative()` / `inventoryOf()` / `loadInventory()` / `checkAntigravity()`。原来写死 `provider === 'codex'` 的约 40 处，属于"本机登录"共性的改成了 `isNative`；速度档、快速解释预热、备用热连接这些 Codex 专有的没动。

**「猜你想问」单独选模型**：`settings.mjs` 的 `predictSettings()`，设置里多一格。跟着阅读助手且它是 Antigravity 时不预判。

**学习**：摸底结束时在同一条回答里给出摸底结论和路线图（`learning-prompts.ts`）；probe 阶段只收到路线图也进 plan 阶段（`learning.ts`）；只有摸底结论、没有给读者看的字的回答不显示（`AiPane.vue` 的 `silentLearn`）。

## 没验证的

1. **Antigravity 在桌面版里的整条链路**：设置里检查登录、模型下拉、发问、流式显示、停止、读文档。小助手这一层用脚本按帧协议实测过（状态、模型清单、问答、复用、取消、清理），界面没跑过。
2. **Gemini API 没有用真实的 Key 调过**，只有模拟响应的单测（`tests/gemini.test.mjs`）。最可能出问题的地方：
   - 文档工具的 schema 用了 `type: ['integer', 'null']` 和 `additionalProperties: false`（`extension/common/document-tools.mjs`）。兼容层如果不认，会回 400，而 `providers.mjs` 里降级到 `plannedChat` 的判断只认含 unsupported / unknown 的报错，接不住 "Invalid value" 这类。那样每个文档提问都会直接报错。
   - 模型 id：`gemini-4-argon` 在官方模型页上查到了；`gemini-3.8-flash` 只在官方文档的示例代码里见过。可以用 `GET /v1beta/openai/models` 核对。
   - 流式 `tool_calls` 不带 `index` 时，现有代码会把并行调用并成一个。
3. 设置里新增的「猜你想问」一格、启动时对 Antigravity 的登录检查，只过了类型检查。
4. 教程里的服务商列表没有加这两家。

## 已知的问题

- Antigravity 的耗时也写进了 Codex 的耗时记录（`native.mjs` 的 `recordTiming`），设置里那行"最近一次"会把它当 Codex 显示。
- `done` 里的 `timing.usage`（真实 token 数）没有交给 `onUsage`，Antigravity 的用量一直是估算值。
- `extension/common/request-queue.mjs` 里"其中 Codex 同时运行数"不管 Antigravity。
- 新会话的第一问要等 agy 冷启动，约 7 秒出第一个字；之后约 3 秒。
