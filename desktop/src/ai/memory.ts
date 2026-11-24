/**
 * 记忆：读者在阅读助手里学过什么。
 *
 * 每段对话各有一份记录（几行「学了哪个概念、掌握得怎样」），由小模型在对话告一段落后整理出来；
 * 对话删掉，它的记录跟着删掉。之后提问时，这些记录随请求带给模型，只用来判断讲解的起点和深度。
 * 快速解释、翻译不读也不写这份记忆。
 *
 * 每条记忆都记在它那本书名下，「本书」是「全局」的一部分：
 * - 本书（book）：只用这本书里记下的；
 * - 全局（all）：所有书里记下的加在一起（这本书的排在前面）；
 * - 不用（off）：既不读也不写。
 */
import { reactive } from 'vue'
import { library } from '../sdk'

export type MemoryMode = 'book' | 'all' | 'off'
/** 一段对话用哪种记忆。老数据：没写是全局，false 是不用。 */
export const memoryMode = (conversation: { memory?: unknown }): MemoryMode => conversation.memory === false || conversation.memory === 'off' ? 'off' : conversation.memory === 'book' ? 'book' : 'all'
// 新对话默认用哪种：跟着上一次选的走，第一次是「本书」。
const MODE_KEY = 'ai.memory.mode'
export function defaultMemoryMode(): MemoryMode { try { const value = localStorage.getItem(MODE_KEY); return value === 'all' || value === 'off' ? value : 'book' } catch { return 'book' } }
export function rememberMemoryMode(mode: MemoryMode) { try { localStorage.setItem(MODE_KEY, mode) } catch { /* 只在这次有效 */ } }
export type MemoryEntry = { documentId: string; documentTitle: string; title: string; at: number; items: string[]; /** 整理时这段对话有多少条消息。 */ count: number; v?: number; /** 只留在本书，还是所有书共用。老记录没有这一项，算共用。 */ scope?: 'book' | 'all' }
const KEY = 'ai.memory.v1'
const MAX_ITEMS = 5
export const memory = reactive<{ entries: Record<string, MemoryEntry>; ready: boolean }>({ entries: {}, ready: false })
const loaded: Promise<void> = (async () => {
  try {
    const value = JSON.parse(await library.getSetting(KEY) || '{}')
    for (const [id, entry] of Object.entries<any>(value?.entries || {})) {
      if (!entry || !Array.isArray(entry.items)) continue
      memory.entries[id] = { documentId: String(entry.documentId || ''), documentTitle: String(entry.documentTitle || ''), title: String(entry.title || ''), at: Number(entry.at) || 0, count: Number(entry.count) || 0, ...(Number(entry.v) ? { v: Number(entry.v) } : {}), ...(entry.scope === 'book' ? { scope: 'book' as const } : {}), items: entry.items.filter((item: unknown) => typeof item === 'string' && item.trim()).slice(0, MAX_ITEMS) }
    }
  } catch { /* 读不到就从空的开始 */ }
  // 以前各段对话各记各的，同一件事会记好几遍：打开时先清一遍。
  try { let removed = 0; for (const id of new Set(Object.values(memory.entries).map(entry => entry.documentId))) removed += tidy(id); if (removed) persist() } catch { /* 清不了就留着 */ }
  memory.ready = true
})()
export const memoryReady = () => loaded
let timer = 0
function persist() { clearTimeout(timer); timer = window.setTimeout(() => { void library.setSetting(KEY, JSON.stringify({ entries: memory.entries })).catch(() => { /* 存不进去就只留在这次 */ }) }, 300) }

export function forgetConversation(conversationId: string) { if (memory.entries[conversationId]) { delete memory.entries[conversationId]; persist() } }
export function forgetItem(conversationId: string, index: number) {
  const entry = memory.entries[conversationId]
  if (!entry) return
  entry.items.splice(index, 1)
  persist()
}
/** 读者自己改一条的写法。 */
export function editItem(conversationId: string, index: number, text: string) {
  const entry = memory.entries[conversationId], next = text.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!entry || !next || entry.items[index] === undefined) return
  entry.items[index] = next
  persist()
}
/** 把一条挪到另一条前面（可以跨对话）。toIndex 等于那段对话的条数就是放到最后。 */
export function moveItem(fromId: string, fromIndex: number, toId: string, toIndex: number) {
  const from = memory.entries[fromId], to = memory.entries[toId]
  if (!from || !to || from.items[fromIndex] === undefined) return
  const [item] = from.items.splice(fromIndex, 1)
  to.items.splice(fromId === toId && toIndex > fromIndex ? toIndex - 1 : toIndex, 0, item!)
  if (!from.items.length) delete memory.entries[fromId]
  persist()
}
/** 撤销用：整份记忆的副本，和把它放回去。 */
export const snapshotMemory = (): Record<string, MemoryEntry> => JSON.parse(JSON.stringify(memory.entries))
export function replaceMemory(entries: Record<string, MemoryEntry>) {
  for (const id of Object.keys(memory.entries)) delete memory.entries[id]
  Object.assign(memory.entries, JSON.parse(JSON.stringify(entries)))
  persist()
}
/** 读者用一句话让助手改记忆（合并、改掌握情况、删掉某一类、调顺序）。只改给它看的这些条目，不新增内容。 */
export function revisePrompt(instruction: string, rows: { n: number; book: string; text: string }[]) {
  return [
    '下面是阅读助手记下的读者学习记录，每条前面是编号，括号里是哪本书。',
    `读者的要求：${instruction}`,
    '按要求修改这份记录，然后只输出一个 JSON 数组，不要任何别的话，也不要放进代码块：[{"id": 编号, "text": "这一条现在的写法"}]',
    '- 要求没有涉及的条目原样保留，照抄进数组；',
    '- 要删掉的条目不要出现在数组里；把几条合并成一条时，留其中一个编号，其余的不出现；',
    '- 每条一句话，不超过 50 个字；开头方括号里的类别（偏好、背景、进度、难点、已会）保留；',
    '- 不要添加记录里没有的内容，不要推测读者的身份和水平；',
    '- 数组里的先后就是之后显示的先后。',
    '\n记录：',
    ...rows.map(row => `${row.n}（《${row.book}》）${row.text}`),
  ].join('\n')
}
export function parseRevision(text: string, count: number): { id: number; text: string }[] | null {
  const start = text.indexOf('['), end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const list = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(list)) return null
    const seen = new Set<number>(), out: { id: number; text: string }[] = []
    for (const item of list) {
      const id = Number(item?.id), value = typeof item?.text === 'string' ? item.text.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
      if (!Number.isInteger(id) || id < 1 || id > count || seen.has(id) || !value) continue
      seen.add(id); out.push({ id, text: value })
    }
    return out
  } catch { return null }
}
/** 让助手按一句话改记忆。only 给了就只改这本书的。返回改了、删了几条。 */
export async function reviseMemory(instruction: string, signal: AbortSignal, only?: string) {
  await loaded
  const rows: { n: number; id: string; index: number; book: string; text: string }[] = []
  for (const [id, entry] of Object.entries(memory.entries).sort(([, a], [, b]) => b.at - a.at)) if (!only || entry.documentId === only) entry.items.forEach((text, index) => rows.push({ n: rows.length + 1, id, index, book: entry.documentTitle || '已移除的文档', text }))
  if (!rows.length) throw new Error('还没有记忆可以改。')
  const { complete } = await import('./complete')
  const result = parseRevision(await complete({ kind: 'memory', signal, messages: [{ role: 'user', content: revisePrompt(instruction.slice(0, 500), rows) }] }), rows.length)
  if (!result) throw new Error('助手没有按格式回话，记忆没有动。再试一次，或者换个说法。')
  // 每段对话的条目按助手给的先后重排；没出现的就是删掉了。
  const next = new Map<string, string[]>()
  let changed = 0
  for (const item of result) { const row = rows[item.id - 1]!; if (item.text !== row.text) changed++; next.set(row.id, [...(next.get(row.id) || []), item.text]) }
  const removed = rows.length - result.length
  for (const id of new Set(rows.map(row => row.id))) { const items = next.get(id); if (items?.length) memory.entries[id]!.items = items; else delete memory.entries[id] }
  persist()
  return { changed, removed }
}
/** 对话换了书、改了名：记录跟着改。 */
/** 撤销用：把一段对话的记忆原样放回去。 */
export function restoreMemory(conversationId: string, entry: MemoryEntry) { memory.entries[conversationId] = entry; persist() }
export function retagMemory(conversationId: string, patch: Partial<Pick<MemoryEntry, 'documentId' | 'documentTitle' | 'title' | 'scope'>>) {
  const entry = memory.entries[conversationId]
  if (entry) { Object.assign(entry, patch); persist() }
}

/** 记忆的写法版本：换了提取方式以后，旧版整理的对话在后台重新整理一遍。 */
export const MEMORY_VERSION = 2
/**
 * 整理用的提示词。做法参照 mem0 的事实提取：只从读者自己说的话里提取以后还用得上的事实，
 * 和已有的记忆对照后决定新增、改写还是不动；问过一次不等于不会。
 */
export function memoryPrompt(documentTitle: string, transcript: string, previous: string[], elsewhere: string[] = []) {
  return [
    `你在替一位阅读助手维护它对读者的长期记忆。下面是读者和助手围绕《${documentTitle}》的一段对话。从中提取以后陪这位读者读书时还用得上的事实。`,
    '值得记的只有这几类，每条前面用方括号标出类别：',
    '- [偏好] 读者对讲解方式、语言、格式、详略明确提过的要求。例：[偏好] 英文原文要先用中文讲大意，再给例子',
    '- [背景] 读者自己说出的基础、专业、读这本书的目的。例：[背景] 学过线性代数，为了准备抽象代数考试',
    '- [进度] 读到哪里、做完了哪些题、约好接下来看什么。例：[进度] 第 1 章读完，做了习题 1.40–1.52',
    '- [难点] 读者明确表示没懂、同一处追问了两次以上，或者自己做错的地方；写出具体卡在哪一步。例：[难点] 分不清「对运算封闭」和「对逆元封闭」，以为有限子集的结论对无限集也成立',
    '- [已会] 读者自己正确复述、做对，或明说已经明白的内容。',
    '规则：',
    '- 主要依据读者说的话；助手讲了什么不算读者的事实。',
    '- 读者只是问了一次某个概念，不算难点，也不用记。不要把问过的概念逐条列出来。',
    '- 不要推测。读者没说过的身份、水平、情绪一律不写；不记姓名、联系方式等个人信息。',
    `- 宁少勿滥：最多 ${MAX_ITEMS} 条，通常 0–3 条，每条一句话、不超过 50 个字，写成离开这段对话也看得懂的完整句子。`,
    '- 没有值得记的就只回复「无」。这很常见。',
    '输出：每行一条，以「- 」开头，不要别的话。',
    previous.length ? `\n这段对话此前记下的（在它的基础上更新：仍然成立的照抄，变了的改写，不成立的去掉，再加上新的）：\n${previous.map(item => `- ${item}`).join('\n')}` : '',
    elsewhere.length ? `\n这位读者别处已经记过的（已经有的不要重复；情况变了，就照原来的说法写出现在的情况，它会替换旧的那条）：\n${elsewhere.map(item => `- ${item}`).join('\n')}` : '',
    `\n对话：\n"""\n${transcript}\n"""`,
  ].filter(Boolean).join('\n')
}
export function parseMemory(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => /^[-·•*]\s*\S/.test(line)).map(line => line.replace(/^[-·•*]\s*/, '').slice(0, 80)).filter(line => line !== '无').slice(0, MAX_ITEMS)
}

type Turn = { role: 'user' | 'assistant'; content: string }
/** 一条记录说的是哪件事：去掉末尾的掌握情况和标点空白，用来认出「同一件事记了两遍」。 */
export const topicOf = (item: string) => item.replace(/^\[[^\]]{1,4}\]\s*/, '').replace(/[，,。；;：:、\s]*(已弄懂|问过还不熟|反复卡住)[。.\s]*$/, '').replace(/[\s，,。；;：:、「」《》()（）]/g, '').toLowerCase()
/**
 * 一本书里说同一件事的记录只留一条：留最新整理的那段对话里的（keep 给了就以它为准）。
 * 不问模型，只认「去掉掌握情况后一字不差」或者一条完全包含另一条。返回删了几条。
 */
export function tidy(documentId: string, keep?: string): number {
  const entries = Object.entries(memory.entries).filter(([, entry]) => entry.documentId === documentId)
    .sort(([a, x], [b, y]) => Number(b === keep) - Number(a === keep) || y.at - x.at)
  const seen: string[] = []
  let removed = 0
  for (const [id, entry] of entries) {
    const kept = entry.items.filter(item => {
      const topic = topicOf(item)
      if (topic.length < 4) return true
      if (seen.some(other => other === topic || (Math.min(other.length, topic.length) >= 8 && (other.includes(topic) || topic.includes(other))))) { removed++; return false }
      seen.push(topic); return true
    })
    if (kept.length !== entry.items.length) entry.items = kept
  }
  return removed
}
// 条目多了以后自动合并：每本书一天最多一次，在后台做，失败了就算了。
const MERGE_KEY = 'ai.memory.merged', MERGE_OVER = 12, DAY = 86400000
const merging = new Set<string>()
export async function consolidate(documentId: string, force = false) {
  const count = Object.values(memory.entries).filter(entry => entry.documentId === documentId).reduce((sum, entry) => sum + entry.items.length, 0)
  if (merging.has(documentId) || count < (force ? 4 : MERGE_OVER)) return
  let stamps: Record<string, number> = {}
  try { stamps = JSON.parse(localStorage.getItem(MERGE_KEY) || '{}') || {} } catch { /* 当作没合并过 */ }
  if (!force && Date.now() - (stamps[documentId] || 0) < DAY) return
  merging.add(documentId)
  const controller = new AbortController(), limit = window.setTimeout(() => controller.abort(), 90000)
  try {
    await reviseMemory('把说同一个概念、同一种方法的几条合并成一条，掌握情况取其中最新的那个（列表里越靠前越新）；彼此无关的条目原样保留，不要为了少而硬并。', controller.signal, documentId)
    stamps[documentId] = Date.now()
    try { localStorage.setItem(MERGE_KEY, JSON.stringify(stamps)) } catch { /* 下次再合并一遍也无妨 */ }
  } catch { /* 没合并成：下次整理时再试 */ }
  finally { clearTimeout(limit); merging.delete(documentId) }
}
const running = new Set<string>()
/**
 * 把一段对话整理进记忆。消息数没变就不重复整理；整理失败不影响对话，下次再试。
 * turns 只要正式的问答（不含失败的、已压缩的）。
 */
export async function memorize(conversation: { id: string; title: string; documentId: string; memory?: unknown }, documentTitle: string, turns: Turn[]) {
  await loaded
  const previous = memory.entries[conversation.id]
  if (memoryMode(conversation) === 'off') return
  const current = previous?.v === MEMORY_VERSION ? previous : undefined
  if (running.has(conversation.id) || turns.length < 2 || current?.count === turns.length) return
  running.add(conversation.id)
  const controller = new AbortController(), limit = window.setTimeout(() => controller.abort(), 60000)
  try {
    // 只看还没整理过的部分，前面带两条衔接；太长的回答截掉后半。
    const fresh = turns.slice(Math.max(0, (current?.count || 0) - 2)).slice(-40)
    const transcript = fresh.map(turn => `${turn.role === 'user' ? '读者' : '助手'}：${turn.content.slice(0, turn.role === 'user' ? 1500 : 500)}`).join('\n\n').slice(-30000)
    const { complete } = await import('./complete')
    const elsewhere = Object.entries(memory.entries).filter(([id, entry]) => id !== conversation.id && entry.documentId === conversation.documentId).flatMap(([, entry]) => entry.items).slice(0, 60)
    const items = parseMemory(await complete({ kind: 'memory', fast: true, signal: controller.signal, messages: [{ role: 'user', content: memoryPrompt(documentTitle, transcript, current?.items || [], elsewhere) }] }))
    const kept = items.length ? items : current?.items || []
    // 整理要等模型回话，这期间读者可能改了设置：按现在的来。
    const mode = memoryMode(conversation)
    // 没有值得记的也留一条空记录，免得每次都再问一遍模型。
    if (mode !== 'off') memory.entries[conversation.id] = { documentId: conversation.documentId, documentTitle, title: conversation.title, at: Date.now(), items: kept, count: turns.length, v: MEMORY_VERSION, scope: mode }
    // 同一件事只留最新的一条；条目攒多了，让助手在后台把说同一件事的合并掉。读者不用自己动手。
    tidy(conversation.documentId, conversation.id)
    persist()
    void consolidate(conversation.documentId)
  } catch { /* 没整理成：留着原来的，下次再来 */ }
  finally { clearTimeout(limit); running.delete(conversation.id) }
}

/**
 * 随提问带给模型的那段话。记录先用来定讲解的深浅；联系旧知识是允许的，但要有实质关系，
 * 防的是模型形成路径依赖：沾一点边就往记录上靠。
 * current 是正在进行的这段对话（它自己的记录不用带，内容就在上文里）；同一本书的排在前面。
 */
export function memoryInstructions(current: { id: string; documentId: string; mode?: MemoryMode }, budget = 1800): string {
  const mode = current.mode || 'all'
  if (mode === 'off') return ''
  // 本书是全局的一部分：「本书」只用这本书里记下的；「全局」是所有书记下的加在一起（这本书的排在前面）。
  const entries = Object.entries(memory.entries).filter(([id, entry]) => id !== current.id && entry.items.length && (entry.documentId === current.documentId || mode === 'all'))
    .sort(([, a], [, b]) => Number(b.documentId === current.documentId) - Number(a.documentId === current.documentId) || b.at - a.at)
  const lines: string[] = []
  let used = 0
  for (const [, entry] of entries) {
    const head = `《${entry.documentTitle || '已移除的文档'}》`
    for (const item of entry.items) {
      const line = `- ${item}（${head}）`
      if (used + line.length > budget) break
      lines.push(line); used += line.length
    }
    if (used > budget - 40) break
  }
  if (!lines.length) return ''
  return [
    '# 读者的学习记录',
    mode === 'book' ? '下面是读者以前在这本书里学过的内容，由系统自动整理，可能不全，也可能过时。' : '下面是读者以前在这个应用里学过的内容，由系统自动整理，可能不全，也可能过时。',
    lines.join('\n'),
    '[偏好] 是读者提过的要求，照做；[背景][进度] 用来定讲解的起点；[已会] 的可以直接用、不必从头解释；[难点] 用到时多铺垫一步。',
    '也可以把当前的问题和读者学过的东西联系起来，但要过一道门槛：',
    '- 只有某一条和当前的问题有实质关系时才联系：它是这个问题的前提，是同一个思想的另一种形式，或者读者上次卡住的正是这里，而且提一句确实能让这次讲得更清楚。这时自然地带上即可，不用回避。',
    '- 只是沾边的不要提：同属一个领域、出现了同一个词、勉强能做个类比，都不算。多数问题和记录里的任何一条都没有这种关系，不联系是常态，不是疏漏。',
    '- 回答的主体始终是当前的问题和当前的文档。不要为了用上这份记录而改变回答的方向，也不要顺势去回顾、复习以前的内容。',
    '- 记录和读者现在说的有出入时，以读者现在说的为准。',
  ].join('\n')
}
