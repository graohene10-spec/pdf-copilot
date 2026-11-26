/**
 * 学习模式让读者在对话里摸底、规划路线，再逐个要点学习。
 * 对话可能被裁剪，所以路线、进度与待答题随会话保存。解析和状态推进只依赖传入的数据。
 */
export type LearningOptions = { scope: string, pages?: [number, number], goal: string, quiz: 'choice' | 'open' }
export type Quiz = { index: number, node?: string, kind: 'probe' | 'predict' | 'check', question: string, options?: string[], answer: number[] | string, why: string }
export type PlanNode = { id: string, title: string, page?: number, /** 读者要这一个讲快些还是讲细些。 */ pace?: 'fast' | 'slow' }
export type Plan = { nodes: PlanNode[], edges: [string, string][] }
export type Level = { goal: string, strands: { topic: string, holds: string, breaks: string, untested: boolean }[] }
export type Mark = { node: string, passed: boolean, statement?: string }
export type SourceRef = { page: number, line?: number, rect?: unknown, text: string }
export type QuizAnswer = { picked?: number[], text?: string, sure?: 0 | 1 | 2 | 3, thinking?: string, dontKnow?: boolean, skipped?: boolean }
type Progress = { passed: boolean, statement?: string, messageIds: string[], sources: SourceRef[] }
type Pending = { messageId: string, index: number, node?: string }
export type LearningState = { options: LearningOptions, phase: 'setup' | 'probe' | 'plan' | 'teach' | 'done', level?: Level, plan?: Plan, current?: string, progress: Record<string, Progress>, pending?: Pending, repairs: number }
export type LearningEvent = { type: 'start' } | { type: 'assistant', messageId: string, content: string, sources: SourceRef[] } | { type: 'answer', messageId: string, quiz: Quiz, answer: QuizAnswer } | { type: 'accept-plan' }
export type MapNode = { id: string, title: string, statement: string, page?: number, sources: SourceRef[], conversationId: string, at: number }
export type BookMap = { nodes: MapNode[], edges: [string, string][] }
type BlockError = { block: string, index: number, message: string }
type ParsedLearning = { quizzes: Quiz[], plan?: Plan, level?: Level, marks: Mark[], errors: BlockError[], writing: boolean }

function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason)
}

function record(raw: unknown): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), '需要一个对象')
  return raw as Record<string, unknown>
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const pageNumber = (value: unknown): value is number => integer(value) && value >= 1
const hasNode = (plan: Plan, id: string) => plan.nodes.some(node => node.id === id)

function nodeId(value: unknown): string {
  check(nonempty(value), '缺少节点 node')
  // 模型常把 id 里的字母写成大写：不为这个多补发一轮。
  return value.toLowerCase()
}

function readQuiz(raw: unknown, index: number): Quiz {
  const { kind, question, node, options, answer, why = '' } = record(raw)
  check(kind === 'probe' || kind === 'predict' || kind === 'check', '题型 kind 无效')
  check(nonempty(question), '题干 question 不能为空')
  check(typeof why === 'string', '解析 why 必须是文字')
  const base = { index, question, why, ...(kind === 'probe' ? {} : { node: nodeId(node) }) }
  if (options === undefined) {
    check(nonempty(answer), '自述题的参考答案不能为空')
    return { ...base, kind, answer }
  }
  check(Array.isArray(options) && options.length >= 2 && options.every(item => typeof item === 'string'), '选择题至少需要两个文字选项')
  check(Array.isArray(answer) && answer.length && answer.every(i => integer(i) && i >= 0 && i < options.length), 'answer 必须是非空的有效选项下标数组')
  return { ...base, kind, options, answer }
}

function addEdge(edges: [string, string][], edge: [string, string]): boolean {
  const [from, to] = edge
  if (edges.some(([a, b]) => a === from && b === to)) return true
  // 终点已经能走回起点时，添上这条边就会闭环。
  const reachable = new Set([to])
  for (const id of reachable) {
    if (id === from) return false
    for (const [a, b] of edges) if (a === id) reachable.add(b)
  }
  edges.push(edge)
  return true
}

function readPlan(raw: unknown): Plan {
  const data = record(raw)
  check(Array.isArray(data.nodes) && data.nodes.length >= 3 && data.nodes.length <= 15, '路线图需要 3 到 15 个节点')
  const ids = new Set<string>()
  const nodes = Array.from(data.nodes, item => {
    const { id: given, title, page } = record(item)
    const id = typeof given === 'string' ? given.toLowerCase() : given
    check(typeof id === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id), '节点 id 只能由小写字母、数字和分隔用的连字符组成')
    check(!ids.has(id), `节点 id「${id}」重复`)
    check(nonempty(title), `节点「${id}」缺少标题`)
    check(page === undefined || pageNumber(page), `节点「${id}」的页码无效`)
    ids.add(id)
    const { pace } = record(item)
    return { id, title, ...(page === undefined ? {} : { page }), ...(pace === 'fast' || pace === 'slow' ? { pace: pace as 'fast' | 'slow' } : {}) }
  })
  check(Array.isArray(data.edges), '缺少依赖边数组 edges')
  const edges: [string, string][] = []
  for (const edge of data.edges) {
    check(Array.isArray(edge) && edge.length === 2, '每条边需要起点和终点')
    const [from, to] = edge.map(end => typeof end === 'string' ? end.toLowerCase() : end)
    check(ids.has(from) && ids.has(to), '边的端点不在路线图中')
    check(from !== to, `节点「${from}」不能指向自己`)
    check(addEdge(edges, [from, to]), '路线图的依赖关系有环')
  }
  return { nodes, edges }
}

function readLevel(raw: unknown): Level {
  const { goal, strands } = record(raw)
  check(nonempty(goal), '摸底结论缺少目标 goal')
  check(Array.isArray(strands) && strands.length, '至少需要一条摸底结论')
  return { goal, strands: Array.from(strands, item => {
    const { topic, holds = '', breaks = '', untested = false } = record(item)
    check(nonempty(topic) && typeof holds === 'string' && typeof breaks === 'string' && typeof untested === 'boolean', '摸底分项需要主题，holds 和 breaks 须为文字，untested 须为布尔值')
    return { topic, holds, breaks, untested }
  }) }
}

function readMark(raw: unknown): Mark {
  const data = record(raw)
  const node = nodeId(data.node)
  const { passed, statement } = data
  check(typeof passed === 'boolean', 'passed 必须是布尔值')
  check(statement === undefined || typeof statement === 'string', 'statement 必须是文字')
  return { node, passed, ...(statement === undefined ? {} : { statement }) }
}

function* learningBlocks(content: string) {
  let open: { marker: string, block: string, start: number, from: number } | undefined
  // 普通围栏里也可能有题目示例，必须先等外层围栏结束。
  for (const match of content.matchAll(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r\n|\n|\r|$)/gm)) {
    const [, marker, info] = match
    if (!open) {
      if (marker[0] === '`' && info.includes('`')) continue
      open = { marker, block: info.trim().split(/\s+/, 1)[0].toLowerCase(), start: match.index!, from: match.index! + match[0].length }
    } else if (marker.startsWith(open.marker) && !info.trim()) {
      if (open.block.startsWith('learn-')) yield { ...open, to: match.index!, closed: true }
      open = undefined
    }
  }
  if (open?.block.startsWith('learn-')) yield { ...open, to: content.length, closed: false }
}

function parseBlocks(content: string, plan?: Plan) {
  const parsed: ParsedLearning = { quizzes: [], marks: [], errors: [], writing: false }
  const items: (BlockError | { block: string, index: number, value: Quiz | Mark })[] = []
  const counts: Record<string, number> = {}
  for (const { block, from, to, closed } of learningBlocks(content)) {
    if (!closed) {
      parsed.writing = true
      break
    }
    if (!['learn-quiz', 'learn-plan', 'learn-level', 'learn-mark'].includes(block)) continue
    const index = counts[block] ?? 0
    counts[block] = index + 1
    try {
      const data = JSON.parse(content.slice(from, to))
      switch (block) {
        case 'learn-quiz': items.push({ block, index, value: readQuiz(data, index) })
          break
        case 'learn-plan': parsed.plan = readPlan(data)
          break
        case 'learn-level': parsed.level = readLevel(data)
          break
        case 'learn-mark': items.push({ block, index, value: readMark(data) })
          break
      }
    } catch (error) {
      const message = error instanceof Error && !(error instanceof SyntaxError) ? error.message : 'JSON 格式不正确'
      items.push({ block, index, message })
    }
  }
  const route = parsed.plan ?? plan
  const steps: (Quiz | Mark)[] = []
  // 改图可以写在题目之后，节点要等整条回答的路线确定后才有意义。
  for (const item of items) {
    if ('message' in item) {
      parsed.errors.push(item)
      continue
    }
    const { block, index, value } = item
    if (value.node && route && !hasNode(route, value.node)) {
      parsed.errors.push({ block, index, message: `路线图中没有节点「${value.node}」` })
      continue
    }
    steps.push(value)
    if ('kind' in value) parsed.quizzes.push(value)
    else parsed.marks.push(value)
  }
  return { parsed, steps }
}

/** 从一条回答里取出四种块。没写完的块（流式途中）不算错，writing 为 true。 */
export function parseLearning(content: string, plan?: Plan): ParsedLearning {
  return parseBlocks(content, plan).parsed
}

/** 抹掉题目的 answer 和 why，移除末尾未闭合的题块，供侧边对话继承、复制、摘录使用。 */
export function withoutAnswers(content: string): string {
  let output = '', last = 0
  for (const { block, start, from, to, closed } of learningBlocks(content)) {
    if (block !== 'learn-quiz') continue
    if (!closed) return output + content.slice(last, start)
    const body = content.slice(from, to)
    try {
      const data = record(JSON.parse(body))
      delete data.answer
      delete data.why
      output += content.slice(last, from) + body.replace(body.trim(), () => JSON.stringify(data))
      last = to
    } catch { /* 格式错误的块还要留给读者看原文。 */ }
  }
  return output + content.slice(last)
}

/** 选项的显示顺序：返回原始下标的排列。同一个 seed 永远同一个结果。 */
export function shuffledOrder(seed: string, count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i)
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619)
  for (let i = order.length - 1; i > 0; i--) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0
    const other = Math.floor(hash / 0x100000000 * (i + 1))
    const saved = order[i]
    order[i] = order[other]
    order[other] = saved
  }
  return order
}

/** 选择题判分：选中的原始下标集合与答案完全相等。 */
export function gradeChoice(quiz: Quiz, picked: number[]): boolean {
  const expected = quiz.answer
  return !!quiz.options && Array.isArray(expected) && expected.every(i => picked.includes(i)) && picked.every(i => expected.includes(i))
}

/** 作答发给模型的文本：只有读者新增的信息。 */
export function answerText(quiz: Quiz, answer: QuizAnswer): string {
  if (answer.skipped) return '我跳过这道题。'
  const lines: string[] = []
  if (answer.dontKnow) lines.push('我不知道。')
  else if (quiz.options) {
    const picked = answer.picked ?? []
    const labels = picked.map(i => quiz.options![i])
    lines.push(picked.length ? `我选了${labels.join('、')}。` : '我没有选择选项。', gradeChoice(quiz, picked) ? '答对了。' : '答错了。')
    if (answer.sure !== undefined) lines.push(`把握程度：${['蒙的', '不太确定', '比较确定', '确定'][answer.sure]}。`)
  } else if (answer.text?.trim()) lines.push(answer.text.trim())
  if (answer.thinking?.trim()) lines.push(`我的想法：${answer.thinking.trim()}`)
  return lines.join('\n') || '（没有作答）'
}

function limitedSources(sources: SourceRef[]): SourceRef[] {
  const kept: SourceRef[] = []
  for (let i = sources.length - 1; i >= 0 && kept.length < 4; i--) {
    const source = sources[i]
    const text = [...source.text].slice(0, 300).join('')
    if (!kept.some(s => s.page === source.page && s.line === source.line && s.text === text)) kept.unshift({ ...source, text })
  }
  return kept
}

/** 状态机。事件之外不改任何东西，返回新对象。 */
export function advanceLearning(state: LearningState, event: LearningEvent): LearningState {
  const progress = { ...state.progress }
  const next = { ...state, progress }
  function update(node: string, passed: boolean, statement?: string) {
    if (!next.plan || !hasNode(next.plan, node)) return
    const old = Object.hasOwn(progress, node) ? progress[node] : { messageIds: [], sources: [] }
    const entry: Progress = { ...old, passed }
    if (statement !== undefined) entry.statement = statement
    if (event.type === 'assistant') {
      if (!entry.messageIds.includes(event.messageId)) entry.messageIds = [...entry.messageIds, event.messageId]
      entry.sources = limitedSources([...entry.sources, ...event.sources])
    }
    progress[node] = entry
    if (!passed) next.current = node
    else if (next.current === node) delete next.current
  }

  if (event.type === 'start') {
    if (state.phase === 'setup') next.phase = 'probe'
  } else if (event.type === 'accept-plan') {
    if (state.phase === 'plan' && state.plan) next.phase = 'teach'
  } else if (event.type === 'assistant') {
    const { parsed, steps } = parseBlocks(event.content, state.plan)
    if (parsed.level && state.phase === 'probe') {
      next.level = parsed.level
      next.phase = 'plan'
    }
    if (parsed.plan) {
      next.plan = parsed.plan
      for (const id of Object.keys(progress)) if (!hasNode(parsed.plan, id)) delete progress[id]
      if (next.current && !hasNode(parsed.plan, next.current)) delete next.current
      if (next.pending?.node && !hasNode(parsed.plan, next.pending.node)) delete next.pending
    }
    for (const step of steps) {
      if ('passed' in step) update(step.node, step.passed, step.statement)
      else {
        if (step.node) update(step.node, progress[step.node]?.passed ?? false)
        next.pending = { messageId: event.messageId, index: step.index, ...(step.node ? { node: step.node } : {}) }
      }
    }
  } else {
    const { messageId, quiz, answer } = event
    if (next.pending?.messageId === messageId && next.pending.index === quiz.index) delete next.pending
    if (quiz.kind === 'check' && quiz.node && !answer.skipped && !answer.dontKnow && gradeChoice(quiz, answer.picked ?? [])) {
      update(quiz.node, true)
    }
  }
  if (next.plan && (next.phase === 'teach' || next.phase === 'done')) {
    next.phase = next.plan.nodes.every(node => progress[node.id]?.passed) ? 'done' : 'teach'
  }
  return next
}

/** 回答写完后，应用要不要替读者自动补发一句，请规划路线、修正坏块或两者一起。没有就返回 null。 */
export function followUp(before: LearningState, after: LearningState, content: string): string | null {
  const parsed = parseLearning(content, before.plan)
  const errors = parsed.errors.map(e => `第 ${e.index + 1} 个 ${e.block}（${e.message}）`)
  if (parsed.writing) errors.push('最后一个块没有写完')
  const planRequest = after.phase === 'plan' && !after.plan ? '请规划路线并用 learn-plan 块给出' : ''
  if (errors.length) {
    if (before.repairs >= 2) return null
    const details = errors.join('、')
    return planRequest ? `请重写这些块：${details}，同时${planRequest}。` : `请只重写这些块：${details}。`
  }
  return planRequest ? planRequest + '。' : null
}

/** 记录本轮已经补发的修正请求，以限制自动重试次数。 */
export function repaired(state: LearningState): LearningState {
  return { ...state, repairs: state.repairs + 1 }
}

/** 一轮结束后清零计数，让下一轮可以重新请求修正。 */
export function settled(state: LearningState): LearningState {
  return { ...state, repairs: 0 }
}

const phases = { setup: '设定', probe: '摸底', plan: '规划路线', teach: '带读', done: '收尾' }

/** 每次请求附在问题后面的状态说明。 */
export function learningContext(state: LearningState): string {
  const { scope, pages, goal } = state.options
  const lines = [
    `范围：${scope || (pages ? '' : '读者当前读到的位置附近')}${pages ? `（第 ${pages.join('–')} 页）` : ''}`,
    `目标：${goal || '未填写'}`,
    `当前阶段：${phases[state.phase]}`
  ]
  if (state.level) {
    lines.push(`摸底目标：${state.level.goal}`)
    for (const strand of state.level.strands) {
      lines.push(`${strand.topic}：${strand.untested ? '未测' : `已掌握：${strand.holds}；薄弱处：${strand.breaks}`}`)
    }
  }
  if (state.plan) {
    for (const { id, title, page, pace } of state.plan.nodes) {
      const status = state.progress[id]?.passed ? '已通过' : id === state.current ? '正在学' : Object.hasOwn(state.progress, id) ? '讲过未通过' : '没到'
      lines.push(`${id} ${title}${page ? `（第 ${page} 页）` : ''}：${status}${pace === 'fast' ? '，快讲' : pace === 'slow' ? '，细讲' : ''}`)
    }
    lines.push(`依赖：${state.plan.edges.map(edge => edge.join(' → ')).join('、') || '无'}`)
  }
  return lines.join('\n')
}

function readSource(raw: unknown): SourceRef {
  const { page, line, rect, text } = record(raw)
  check(pageNumber(page) && (line === undefined || pageNumber(line)) && typeof text === 'string', '原文出处无效')
  return { page, text, ...(line === undefined ? {} : { line }), ...(rect === undefined ? {} : { rect }) }
}

function tryRead<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch {
    return undefined
  }
}

function readProgress(raw: unknown): Progress {
  const { passed, statement, messageIds, sources } = record(raw)
  check(typeof passed === 'boolean', '节点进度无效')
  check(statement === undefined || typeof statement === 'string', '节点小结无效')
  check(Array.isArray(messageIds) && messageIds.every(nonempty) && Array.isArray(sources), '消息或出处列表无效')
  const validSources = sources.map(source => tryRead(() => readSource(source))).filter(source => source !== undefined)
  return { passed, ...(statement === undefined ? {} : { statement }), messageIds, sources: limitedSources(validSources) }
}

function readPending(raw: unknown, plan?: Plan): Pending {
  const { messageId, index, node } = record(raw)
  check(nonempty(messageId) && integer(index) && index >= 0, '待答题位置无效')
  check(node === undefined || (nonempty(node) && (!plan || hasNode(plan, node))), '待答题节点无效')
  return { messageId, index, ...(node === undefined ? {} : { node }) }
}

/** 读盘时的清洗。设定或阶段不合法就返回 undefined，其余字段分别恢复，补发次数归零。 */
export function readLearning(raw: unknown): LearningState | undefined {
  try {
    const data = record(raw)
    const { scope, pages, goal, quiz } = record(data.options)
    check(typeof scope === 'string' && typeof goal === 'string' && (quiz === 'choice' || quiz === 'open'), '学习设定无效')
    const options: LearningOptions = { scope, goal, quiz }
    if (pages !== undefined) {
      check(Array.isArray(pages) && pages.length === 2 && pageNumber(pages[0]) && pageNumber(pages[1]) && pages[0] <= pages[1], '页码范围无效')
      options.pages = [pages[0], pages[1]]
    }
    const { phase } = data
    check(typeof phase === 'string' && Object.hasOwn(phases, phase), '学习阶段无效')
    const state: LearningState = { options, phase: phase as LearningState['phase'], repairs: 0, progress: {} }
    const level = tryRead(() => readLevel(data.level))
    if (level) state.level = level
    const plan = tryRead(() => readPlan(data.plan))
    if (plan) {
      state.plan = plan
      const current = tryRead(() => data.current)
      if (nonempty(current) && hasNode(plan, current)) state.current = current
      const progress = tryRead(() => record(data.progress))
      for (const { id } of plan.nodes) {
        const entry = tryRead(() => progress && Object.hasOwn(progress, id) ? readProgress(progress[id]) : undefined)
        if (entry) state.progress[id] = entry
      }
    }
    const pending = tryRead(() => readPending(data.pending, plan))
    if (pending) state.pending = pending
    return state
  } catch {
    return undefined
  }
}

/** 把一段学习对话里通过的节点并进这本书的要点，跳过会形成依赖环的新边。 */
export function mergeMap(map: BookMap, state: LearningState, conversationId: string, now: number): BookMap {
  const nodes = [...map.nodes]
  for (const node of state.plan?.nodes ?? []) {
    const entry = state.progress[node.id]
    if (!entry?.passed) continue
    const merged = { ...node, statement: nonempty(entry.statement) ? entry.statement : node.title, sources: entry.sources, conversationId, at: now }
    const index = nodes.findIndex(old => old.id === node.id)
    if (index < 0) nodes.push(merged)
    else nodes[index] = merged
  }
  const ids = new Set(nodes.map(node => node.id))
  const edges = map.edges.filter(([from, to]) => ids.has(from) && ids.has(to))
  for (const edge of state.plan?.edges ?? []) {
    if (ids.has(edge[0]) && ids.has(edge[1])) addEdge(edges, edge)
  }
  return { nodes, edges }
}
