# 学习模式 设计方案（草案）

> 状态：待评审，尚未动任何代码。
> 分支：`learning-mode-design`。
> 依据：对开智 `desktop/`（HEAD `a712432`）和 LearnHarness v0.7.0 的只读调研。文中的 `文件:行号` 都指这个提交。

## 1. 一句话

给开智加一种新的会话类型：读者圈定书里的一段范围，说"我要读懂这里"，助手不再等着被问，而是**先摸底、再画路线图、然后一步一步带着读**，每一步都链回原书的页码，学完的东西沉淀成这本书的知识地图。

思路来自 LearnHarness。它的方法是通用的，开智的优势是**手里有书**：目标可以是"第 3 章"，每一步讲解都能点回原文，知识地图上的每个节点都落在具体的页上。这一点 LearnHarness 做不到，它的图谱只能链回聊天记录。

## 2. 边界

### 2.1 许可证

LearnHarness 是 AGPL-3.0，开智是 MIT。本方案只借鉴**方法**（摸底、依赖图、一步一讲、命题图谱），这些不受版权保护。

实现时遵守三条：

- 不复制它的任何代码。
- 不复制、不翻译它的系统提示词。开智的提示词用中文从头写。
- 数据结构按开智自己的习惯设计（见第 5 节），不照搬它的 schema。

### 2.2 不能碰已安装的正式版

开发版和正式版**共用同一份数据**：两者的 identifier 都是 `com.phydog.reading`（`src-tauri/tauri.conf.json`），Rust 侧无条件使用 `app_data_dir()`（`src-tauri/src/lib.rs:201`）。直接 `tauri dev` 会读写正式版的 `library.sqlite3`，对话、记忆、API Key 都在里面。两个程序同时开着时，还会互相覆盖整本书的对话。

所以实现的**第零步**是隔离，二选一：

| 办法 | 做法 | 代价 |
| --- | --- | --- |
| A. 浏览器预览（推荐用于日常开发） | 只跑 vite，数据走 IndexedDB（`src/sdk/browser.ts`），配合现有的假 SSE 模型服务（`scripts/ai-conversation-ui-check.mjs`） | 没有 Codex、没有真实文件系统 |
| B. 换 identifier 的桌面开发版 | `tauri dev --config` 覆盖成 `com.phydog.reading.dev` | 需要实测 WebView2 目录是否也随之隔离 |

在隔离验证通过之前，不运行任何桌面开发版。

### 2.3 第一版不做的事

- 独立的练习会话（变式题、分级提示）。
- 间隔复习。
- 跨书的命题合并与去重。
- 全局知识图谱的力导向视图。
- 后台调研、交互演示这类子代理。

这些放在第 9 节的后续阶段。

## 3. 读者看到的流程

### 3.1 入口

和"总结"的三个入口对齐（先例见 `AiPane.vue:855, 947-954`、`App.vue:1568, 1588, 1601`）：

- 斜杠命令 `/learn`。
- 阅读区右键"学懂这一段…"。
- 文档库右键"带我学…"。

### 3.2 五个阶段

| 阶段 | 读者看到什么 | 助手在做什么 |
| --- | --- | --- |
| ① 设定 | 一张表：范围（按目录勾章节，或用当前选区）、想达到什么程度（一句话，可空）、题型 | 无请求 |
| ② 摸底 | 一次一道题，共若干道。每题有选项、"我的想法"、把握程度、"不知道" | 读范围内的原文，找出前置概念，逐条探到"哪里开始不会" |
| ③ 路线图 | 一张依赖图，每个节点是一个要点，标着页码。下面两个按钮："就这样开始"和"我想调整" | 根据摸底结果，规划从读者现状到目标的最短路径 |
| ④ 带读 | 每个节点循环：**先猜**（预测题）→ **讲解**（带原文引用）→ **检查**（检查题）。路线图上当前节点高亮 | 一次只讲一步。答错就停下来修，不往后讲 |
| ⑤ 收尾 | 路线图全部点亮，一段回顾，"存入知识地图"的结果 | 无额外请求 |

几条贯穿的规则：

- **每一轮回答至多以一道题结尾**，读者答完才有下一轮。这是整个模式的节拍。
- **"我的想法"比对错重要。** 助手下一步怎么走，依据是读者写的推理，对错和把握程度是辅助。
- **读者随时可以打字插话**，不必非得答题。问题卡保留，可以稍后再答，也可以跳过。
- **旁问用现有的侧边对话**，不打断主线。

### 3.3 不让阅读助手变复杂：界面上的逻辑关系

阅读助手已经有自由对话、侧边对话、分支、总结、/btw、快速解释、翻译。再平铺一种"学习对话"，读者要记的东西就太多了。所以学习**不作为一种新东西出现**，而是套进读者已经认识的三个概念里。

**一、对话只有两种：自由的，和带任务的。**

- 一本书下面有多段对话，这一点不变。
- 一段对话要么是自由对话，要么带**一个任务**。任务目前有两种：总结、学习。
- 任务在对话开始时选定，开始前可以取消变回自由对话（总结已经是这样，`cancelSummary`）。
- 侧边对话、/btw、摘录对任何对话都一样用，不因任务而变。

**二、两种任务长得一样。** 学习完全照总结的样子走，读者学会一个就会另一个：

| | 总结 | 学习 |
| --- | --- | --- |
| 开始前 | 一张设定表 | 一张设定表（同一种版式，同一棵章节勾选树） |
| 进行中 | 对话流里出现"草稿牌子" | 对话流里出现"题目卡片" |
| 成果 | 草稿 | 路线图 |
| 成果的开关 | 头部同一个按钮位 | 头部同一个按钮位 |
| 对话记录里 | 标题前一个小标记 | 标题前一个小标记 |

唯一的版式差别：草稿盖在阅读区上（读者此时在看草稿），路线图是助手栏顶部的一条可折叠的带子（读者此时要看书，不能盖住）。

**三、入口只有一处是"正门"。** 新对话的欢迎页上并排放两个按钮："总结这份文档""学习这一段"。`/learn` 和右键菜单只是通到同一张设定表的近路，和 `/summary` 完全对称。不加新的窗口、标签页、侧栏。

**四、学完就变回普通对话。** 所有节点通过后，这段对话照常可以自由提问，路线图留在头部。没有"已结束、不能再用"的状态。

**五、知识地图不是新地方，是"记忆"的一部分。** 开智的记忆本来就定义为"读者学过什么"（`memory.ts` 文件头）。所以学习沉淀下来的要点，直接显示在现有的记忆界面里（设置 → 记忆、对话管理页的记忆栏），按书分组，排在那本书的记忆条目下面，叫"学过的要点"。读者不需要知道有一个叫"知识地图"的东西。

**六、题目不抢输入框。** 题目卡片在对话流里，输入框始终是那个输入框：打字就是插话。不做单独的答题停靠栏。

实现上的对应约束：AiPane 里现有的十来处 `state.summary` 判断（不猜下一问、不摘录卡片等），改成判断"这段对话带不带任务"的一个小函数，不再逐处追加 `|| state.learning`。总结的现有代码不重构。

### 3.4 路线图

- 放在助手栏头部，可折叠，位置类似总结的草稿开关（`AiPane.vue:1115`）。
- 节点三种状态：没到、正在学、已通过检查。
- **点节点有两个动作**：跳到原书对应页，或滚到对话里讲这个节点的位置。
- 助手发现漏了前置知识时可以改图。改图后旧节点的状态按 id 保留。

### 3.5 学过的要点（知识地图）

- 每本书一份。节点是"通过了检查的要点"，带页码和原文摘句，边是依赖关系。
- 第一版只做**按书的列表加依赖缩进**，显示在现有的记忆界面里（见 3.3 第五条）。点一条跳回原书。
- 之后在同一本书里开新的学习会话，助手会先读这份地图：已经通过的不再重讲，可以直接当作起点。

## 4. 关键设计决定

### 4.1 用"约定格式的代码块"，不用工具调用

**决定：题目、路线图、摸底结论都由助手写成带标记的代码块，本地解析。**

理由：

- 开智的工具调用只有 4 个只读文档工具，收到清单外的调用会直接报错（`providers.mjs:173-174`）。
- Codex 路径的工具清单写死在 C# 宿主里（`native-host/DocumentTools.cs:32-56`）。加新工具要改宿主、重新发布。
- 开智已有成熟的先例：` ```ui ` 块（Intelligent UI）、`<summary-doc>` 标签、`[[继续]]` 标记。全部是"提示词约定 + 本地解析"，对六家服务商和 Codex 一视同仁。

代价是没有"校验失败就让模型在同一轮重试"的机制。应对办法见 4.6。

三种块：

````text
```learn-quiz
{ "node": "limit-def", "kind": "predict",
  "question": "……",
  "options": ["……", "……", "……"],
  "answer": [1],
  "why": "……" }
```

```learn-plan
{ "nodes": [ { "id": "limit-def", "title": "极限的 ε-δ 定义", "page": 42 } ],
  "edges": [ ["sequence", "limit-def"] ] }
```

```learn-level
{ "goal": "……",
  "strands": [ { "topic": "……", "holds": "……", "breaks": "……", "untested": false } ] }
```
````

第四种块用来给节点下结论：

````text
```learn-mark
{ "node": "limit-def", "passed": true, "statement": "一句话把这个要点说清楚" }
```
````

字段说明：

- `learn-mark`
  - 自述题没法在本地判分，助手读完读者的回答后用它表态。
  - 选择题答错、经过修复后读者用文字讲明白了，助手也可以用它放行。
  - `passed: false` 会把节点退回"正在学"。
  - `statement` 进入"学过的要点"。
- `learn-quiz`
  - `kind`：`probe`（摸底）、`predict`（讲之前猜）、`check`（讲之后查）。
  - `node`：路线图节点 id。摸底题没有这一项。
  - `options` 省略时是自述题：读者写一段话，助手下一轮对照 `answer`（此时是一段参考答案）来判断。
  - `answer` 是正确选项的下标数组，多于一个就是多选。
  - `why` 是解析，答完才显示。
- `learn-plan`
  - id 只许小写字母、数字、连字符。
  - 3 到 15 个节点，必须无环。
  - `page` 是物理页码（Markdown 是行号），和现有引用的含义一致（`document-service.mjs:82-92`）。
- `learn-level`
  - 摸底的结论。每条 `strand` 写清楚读者稳稳掌握到哪（`holds`）、从哪开始不行（`breaks`）。
  - `untested: true` 表示这一条没测到，不能当成"不会"。

### 4.2 状态存在会话上，不从消息里反推

**决定：`ChatState` 加一个 `learning?: LearningState` 字段，路线图、摸底结论、进度都存在里面。**

LearnHarness 的做法是从消息记录里推导当前位置。开智不能照搬，因为：

- 每段对话最多存 200 条消息（`workspace.ts:58`），超出的会被裁掉。路线图是早期消息，最先丢。
- 自动压缩之后，旧消息不再随请求发出（`Message.compressed`）。

所以状态单独存，每次回答写完后由一个纯函数推进：

```ts
type LearningState = {
  options: LearningOptions          // 设定表里填的东西
  phase: 'setup' | 'probe' | 'plan' | 'teach' | 'done'
  level?: LearningLevel             // 摸底结论（learn-level 块）
  plan?: { nodes: PlanNode[]; edges: [string, string][] }
  /** 正在学的节点。 */
  current?: string
  /** 讲过的节点：通过没有、讲它的那几条消息、用到的原文。 */
  progress: Record<string, { passed: boolean; statement?: string; messageIds: string[]; sources: SourceRef[] }>
  /** 还没答的那道题。助手的回答里没有新题时它不变，读者可以稍后再答。 */
  pending?: { messageId: string; index: number; node?: string }
}
```

序列化跟着 `summary` 字段的先例走（`workspace.ts:434, 467, 72-78`）。

**每次请求都把当前状态附在问题后面**：路线图、各节点状态、摸底结论。这和总结对话"每次附上草稿全文"是同一个做法（`workspace.ts:543-544`）。好处是压缩和裁剪都不会让助手忘了自己讲到哪。

### 4.3 系统提示词按阶段切换

`sendChat` 里加一个分支，和总结对话并列（`workspace.ts:578-584`）：

```ts
state.learning ? learningInstructions(state.learning, …) : …
```

`learningInstructions` 按 `phase` 给不同的说明。阶段的推进全部由本地代码决定：

| 何时 | 推进 |
| --- | --- |
| 读者提交设定表 | `setup → probe`，发出第一问 |
| 回答里出现合法的 `learn-level` 块 | `probe → plan`，应用自动补发一句"请规划路线"（`auto: true`，对话栏里不显示，和总结的"继续"同一机制） |
| 读者点"就这样开始" | `plan → teach` |
| 所有节点都通过 | `teach → done` |
| 学完后有节点被退回，或改图加了新节点 | `done → teach` |

节点变成 `passed` 有两条路：**这个节点的 `check` 选择题答对了**，或者助手写了 `learn-mark` 放行。预测题答错不影响，它本来就是引子。

### 4.3.1 纯函数模块的接口（`src/ai/learning.ts`）

这个模块没有 import，不碰 Vue、不碰存储、不发请求，只做数据进数据出。提示词正文不在这里（另放 `learning-prompts.ts`）。

```ts
export type LearningOptions = { scope: string; pages?: [number, number]; goal: string; quiz: 'choice' | 'open' }
export type Quiz = { index: number; node?: string; kind: 'probe' | 'predict' | 'check'; question: string; options?: string[]; answer: number[] | string; why: string }
export type PlanNode = { id: string; title: string; page?: number }
export type Plan = { nodes: PlanNode[]; edges: [string, string][] }
export type Level = { goal: string; strands: { topic: string; holds: string; breaks: string; untested: boolean }[] }
export type Mark = { node: string; passed: boolean; statement?: string }
export type SourceRef = { page: number; line?: number; rect?: unknown; text: string }
export type QuizAnswer = { picked?: number[]; text?: string; sure?: 0 | 1 | 2 | 3; thinking?: string; dontKnow?: boolean; skipped?: boolean }
export type LearningState = {
  options: LearningOptions
  phase: 'setup' | 'probe' | 'plan' | 'teach' | 'done'
  level?: Level
  plan?: Plan
  current?: string
  progress: Record<string, { passed: boolean; statement?: string; messageIds: string[]; sources: SourceRef[] }>
  pending?: { messageId: string; index: number; node?: string }
  /** 本轮已经自动补发过几次修正请求。读盘时归零。 */
  repairs: number
}

/** 从一条回答里取出四种块。没写完的块（流式途中）不算错，writing 为 true。节点按这条回答里的新路线图校验，没有新图才用传入的。 */
export function parseLearning(content: string, plan?: Plan): { quizzes: Quiz[]; plan?: Plan; level?: Level; marks: Mark[]; errors: { block: string; index: number; message: string }[]; writing: boolean }
/** 选项的显示顺序：返回原始下标的排列。同一个 seed 永远同一个结果。 */
export function shuffledOrder(seed: string, count: number): number[]
/** 选择题判分：选中的原始下标集合与答案完全相等。 */
export function gradeChoice(quiz: Quiz, picked: number[]): boolean
/** 作答发给模型的文本：只有读者新增的信息。 */
export function answerText(quiz: Quiz, answer: QuizAnswer): string
/** 状态机。事件之外不改任何东西，返回新对象。 */
export type LearningEvent =
  | { type: 'start' }
  | { type: 'assistant'; messageId: string; content: string; sources: SourceRef[] }
  | { type: 'answer'; messageId: string; quiz: Quiz; answer: QuizAnswer }
  | { type: 'accept-plan' }
export function advanceLearning(state: LearningState, event: LearningEvent): LearningState
/** 回答写完后，应用要不要替读者自动补发一句：请规划路线 / 请重写某一块（没写完的块也算）。没有就返回 null。before、after 是这条回答前后的状态。 */
export function followUp(before: LearningState, after: LearningState, content: string): string | null
/** 补发了一次修正请求之后 / 这一轮收尾之后。 */
export function repaired(state: LearningState): LearningState
export function settled(state: LearningState): LearningState
/** 每次请求附在问题后面的状态说明。 */
export function learningContext(state: LearningState): string
/** 抹掉题目块里的 answer 和 why（给侧边对话继承、复制、摘录用）。已答的题要不要抹，由调用方按消息决定。 */
export function withoutAnswers(content: string): string
/** 读盘时的清洗：设定或阶段不合法才返回 undefined，其余坏的部分各自丢掉。 */
export function readLearning(raw: unknown): LearningState | undefined
/** 把一段学习对话里通过的节点并进这本书的要点。会成环的边不并。 */
export type MapNode = { id: string; title: string; statement: string; page?: number; sources: SourceRef[]; conversationId: string; at: number }
export type BookMap = { nodes: MapNode[]; edges: [string, string][] }
export function mergeMap(map: BookMap, state: LearningState, conversationId: string, now: number): BookMap
```

### 4.4 题目卡片

- **渲染**：`render.ts` 把 ` ```learn-quiz ` 块转成占位元素，AiPane 往里挂一个 `QuizCard.vue`。做法和 ` ```ui ` 块一致（`render.ts:29`、`AiPane.vue:453`）。
- **选项打乱**：用 `消息 id + 块序号` 做种子的确定性洗牌。刷新、侧边对话里看到的顺序必须一致。
- **判分在本地**：选择题当场出对错和解析，不需要再请求一次。自述题不判分，交给助手下一轮判断。
- **把握程度**：四档，"蒙的 / 不太确定 / 比较确定 / 确定"。只有选择题有。
- **"我的想法"**：一个可选的文本框。
- **"不知道"**：一个按钮，不算错，算"没测出下限"。
- **检查题默认折叠**，读完讲解再点开。预测题直接展开。

答案作为下一条用户消息发出。`Message` 加一个可选字段记下结构化的作答，对话栏里据此画成一张"已答"小卡片，而不是一段文字：

```ts
learn?: { quizOf: string; picked?: number[]; text?: string; sure?: 0 | 1 | 2 | 3; thinking?: string; correct?: boolean; skipped?: boolean }
```

发给模型的文本只带读者**新增的信息**（选了哪个、对不对、多大把握、怎么想的），不重复题干。

**答案不能提前漏给读者**，有三处要处理：

- 对话栏渲染时不显示 `answer` 和 `why`。
- 复制回答、摘录（Ctrl+方向键）时去掉这两项。
- 侧边对话继承主对话快照时（`inheritedContext`，`workspace.ts:114-124`），未答题的 `answer` 和 `why` 要抹掉，否则读者在侧边一问就问出来了。

### 4.5 讲解必须落在原文上

带读阶段，助手的每一步讲解都要先用现有的文档工具读原文（`pdf_read` / `pdf_search`），并用现有的 `[sourceId]` 标注出处（`document-chat.mjs:6`）。这样：

- 讲解里的引用按钮照常工作（`AiPane.vue:429-450`）。
- 回答的 `sources` 自动收集了这一步用到的原文位置（`workspace.ts:600-604`），节点通过检查时把它们记进 `progress[node].sources`，知识地图的"链回原书"就是这么来的。**不需要额外的抽取请求。**

阅读预算比普通对话高一档，但不像总结对话那样放到上限。具体数值待定（见第 8 节）。

### 4.6 格式出错怎么办

模型写出的块可能不合法（JSON 坏了、节点 id 不存在、路线图有环）。

1. 本地校验失败时，应用自动补发一条不显示的消息，写明哪里不对，请它重写这一块。
2. 每轮最多自动补发 2 次。
3. 还不行就把原文当普通回答显示，并在卡片位置提示"这道题没能生成"，读者可以点"重答"。

带读阶段如果一轮回答里**没有**题目块，也不算错：读者可以直接打字，或者点"继续"。

### 4.7 知识地图的数据

**决定：第一版的知识地图就是"各次学习会话里通过了检查的路线图节点"的并集，不另外调用模型抽取。**

LearnHarness 用两个额外的模型角色（抽取、审计）从讲解正文里提炼命题并合并同义项。那套管线是它最复杂、最容易出错的部分，而且合并错了没有办法拆开。开智第一版绕开它：路线图节点本身就是要点，依赖边本身就是推理关系，出处来自 4.5。

存储用现有的设置表，每本书一个 key：

```text
learn.map.v1.<documentId>
```

```ts
type MapNode = {
  id: string; title: string
  /** 一句话把这个要点说清楚，取自检查题通过时助手写的小结。 */
  statement: string
  page: number; line?: number
  /** 原文摘句和位置，来自那一步回答的 sources。 */
  sources: { page: number; line?: number; rect?: Rect; text: string }[]
  conversationId: string; at: number
}
type BookMap = { nodes: MapNode[]; edges: [string, string][] }
```

要注意存储层的硬限制（`src-tauri/src/db.rs:223, 229-232`）：

- 单个值不能超过 1 MiB，超了会**静默存不进去**。每条 `sources` 的摘句截到 300 字，每个节点最多 4 条。
- key 只能用 ASCII 字母数字和 `._-`，长度不超过 100。需要确认 `documentId` 的字符集满足这一条（现有的 `ai.conversations.v1.<documentId>` 已经在这么用，应当没问题）。

同一本书里再次学到同名节点时，按 id 覆盖。跨会话的同义合并留给后续阶段。

### 4.8 和现有功能的关系

| 功能 | 在学习会话里 |
| --- | --- |
| 记忆（`memory.ts`） | **照常读写。** 摸底前读记忆，已经记为"已会"的不重复测。会话结束照常由小模型整理出几条 `[已会]` `[难点]` |
| 侧边对话 | 照常可用，承担"旁问"。注意 4.4 的防漏答案 |
| 自动压缩 | 照常。状态每次附带（4.2），压缩不丢进度 |
| 猜你想问 | 关掉，和总结对话一致（`AiPane.vue:1023`） |
| Intelligent UI、mermaid 图 | 讲解里照常可用 |
| 分支、重答、编辑 | 重答可用。编辑和分支第一版禁用，因为它们会让 `LearningState` 和消息对不上 |
| 请求队列 | 照常走 `sendChat` 的队列，没有新的并发来源 |
| 用量统计 | 新增一类 `learn` |

### 4.9 成本

第一版没有新增的后台模型调用。开销只来自主对话本身，比普通问答多在三处：

- 每轮附带一份状态（路线图加进度，几百字量级）。
- 带读阶段每步都读原文。
- 轮数多：一个节点至少两轮（预测、检查），答错再加。

用量面板里单列 `learn` 一类，读者能看到一次学习会话花了多少。

## 5. 要改的地方

照"总结对话"这个先例推算。

**新增**

| 文件 | 内容 |
| --- | --- |
| `src/ai/learning.ts` | 纯函数，无 import，可直接单测（仿 `summary.ts`）：三种块的解析与校验、确定性洗牌、`advanceLearning`（推进状态）、`learningInstructions`（各阶段提示词）、作答的文本拼装、抹掉答案的 `withoutAnswers` |
| `src/ai/learning-map.ts` | 知识地图的读写（仿 `memory.ts` 的 reactive 单例加防抖落盘） |
| `src/components/LearningSetup.vue` | 设定表，章节勾选树复用 `summaryChapters` / `chapterScope` |
| `src/components/QuizCard.vue` | 题目卡片与已答卡片 |
| `src/components/LearningPlan.vue` | 路线图，自己画，节点可点 |
| `src/components/LearningMap.vue` | 知识地图列表 |
| `tests/learning.test.mjs` | 解析、校验、状态推进、洗牌稳定性、答案抹除 |
| `scripts/learning-ui-check.mjs` | Playwright 加假 SSE，走完一整轮 |

路线图**不用 mermaid 渲染**：现有配置是 `securityLevel: 'strict'`（`render.ts:52-101`），节点点不了；`diagrams.ts` 的自绘图也只有悬停提示。所以单写一个小组件，按拓扑分层排版。

**修改**

| 文件 | 改什么 |
| --- | --- |
| `src/ai/workspace.ts` | `ChatState.learning`、`Message.learn`，各自的序列化与反序列化；`newLearningConversation` / `cancelLearning`；`sendChat` 里的提示词、阅读预算、状态附带、回答写完后调用 `advanceLearning`、自动补发；`inheritedContext` 抹答案 |
| `src/ai/render.ts` | 识别三种 `learn-*` 代码块 |
| `src/components/AiPane.vue` | `/learn` 命令；设定表阶段；挂载题目卡片；头部路线图开关；各种排除条件（猜你想问、摘录、编辑、分支）；暴露 `learn()` |
| `src/App.vue` | 两个右键菜单项；给设定表提供目录；路线图节点点击后的跳转 |
| `src/components/ConversationManager.vue` | 知识地图入口 |
| `src/ai/usage.ts` | 新增 `learn` 类 |

不需要改 Rust，不需要改 C# 宿主，不需要新的 sdk 方法。

## 6. 已知风险

1. **小模型写不稳格式。** 4.6 兜底，但体验会打折。需要在 DeepSeek、GLM 这类模型上实测通过率，可能要在设置里注明"学习模式建议用较强的模型"。
2. **跳转可能跳错书。** `App.vue:1874` 的 `jump` 作用在当前激活的阅读器上，不看回答属于哪本书。多栏并排时，点路线图节点可能跳到另一本书。这是现有问题，学习模式会让它更显眼，建议顺手修掉。（调研时未实测。）
3. **1 MiB 上限。** 学习会话消息多、每条都带 `sources`，一本书的全部对话更容易撞到上限，而且是静默失败。建议在落盘处加一次大小检查，超了就提示。
4. **路线图粒度。** 节点太粗，一步讲不完；太细，图没法看。靠提示词约束在 3 到 15 个，需要用真实教材调。
5. **文档过期。** `docs/PRIVACY.md:17` 写"每段对话最多 60 条消息"，代码是 200。新功能上线时要一并更新隐私说明（学习记录、知识地图都存在本机）。

## 7. 分步实施

每一步都能单独验收。

| 步骤 | 内容 | 验收 |
| --- | --- | --- |
| 0 | 开发环境隔离（2.2） | 开发版读不到正式版的文档库 |
| 1 | `learning.ts` 加单测 | `npm test` 通过，覆盖坏 JSON、有环、未知节点、洗牌稳定 |
| 2 | 设定表、摸底、题目卡片 | 假模型下能出题、作答、看到已答卡片，得到摸底结论 |
| 3 | 路线图、带读循环 | 假模型下走完三个节点，状态正确推进，刷新后进度还在 |
| 4 | 知识地图、跳回原书 | 通过的节点出现在地图里，点击跳到正确页并高亮 |
| 5 | 真模型调提示词 | 用两三本真实教材，在至少三家服务商上各走一遍 |
| 6 | 收尾 | 防漏答案、用量分类、隐私说明、发布说明 |

后续阶段（不在本方案范围内）：练习会话、间隔复习、跨书合并、图形化的全局知识地图。

## 8. 已定的事

| 事项 | 决定 | 谁定的 |
| --- | --- | --- |
| 名字 | **学习**。命令 `/learn`，按钮"学习这一段" | 用户 |
| 阅读预算 | 实测后定。步骤 5 里测出几档的成本和效果，再选默认值 | 用户 |
| 界面复杂度 | 学习不作为新概念平铺，套进"带任务的对话"和"记忆"（3.3） | 用户提出，方案见 3.3 |
| 默认题型 | 选择题，设定表里可切到自述题 | 设计方 |
| 把握程度 | 要，四档，可以不选 | 设计方 |
| 要点记不记掌握程度 | 不记。要点只存内容和出处，掌握情况继续由记忆的 `[已会]` `[难点]` 承担 | 设计方 |
| 路线图能否手动改 | 第一版只能用文字让助手调整 | 设计方 |
| Codex | 支持，排在步骤 5 最后验证 | 设计方 |
| 顺手修的两个现有问题 | 修：多栏并排时引用跳错书；单值超过 1 MiB 静默存不进去。各自单独一个提交 | 设计方 |

## 9. 分工

- **纯函数模块与单测**（`learning.ts`、`tests/learning.test.mjs`）：交给本机 Codex（`gpt-6.2-astra`）实现，完成后由 Opus 独立审查。
- **提示词、界面、接进 `workspace.ts` 与 `AiPane.vue`、最终取舍**：设计方。
- **收尾**：全部完成后由 Opus 扫一遍界面文案和提示，删掉过度解释。

