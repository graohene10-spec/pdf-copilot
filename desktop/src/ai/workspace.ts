import { reactive, ref, shallowReactive, markRaw } from 'vue'
import { loadAiSettings, loadApiKey } from './settings.mjs'
import { RequestScheduler } from './request-scheduler.mjs'
import { library } from '../sdk'
import { recordUsage } from './usage'
import { compactLimit, compactionPrompt, estimateTokens, fullness, handoff, liveTokens, splitForCompaction } from './compaction'
export { estimateTokens }
import { SUMMARY_READING, summaryDraft, summaryInstructions, summaryContinues, lastSummaryOptions, readSwitches, MAX_SUMMARY_ROUNDS, type SummaryState, type SummaryOptions } from './summary'
import { MEMORY_VERSION, memory, defaultMemoryMode, forgetConversation, memorize, memoryInstructions, memoryMode, memoryReady, rememberMemoryMode, retagMemory, type MemoryMode } from './memory'

export type Usage = { input?: number; output?: number; reasoning?: number; estimated: boolean }
export type Message = {
  id: string; role: 'user' | 'assistant'; content: string; reasoning?: string; sources: any[]; images?: string[]; failed?: boolean
  /** 应用替读者发的一问（分多次写总结时的「继续」）：照常带给模型，对话栏里不显示。 */
  auto?: boolean
  /** Live progress of an answer: wall-clock timing, token use and the current activity line. */
  startedAt?: number; firstTokenAt?: number; finishedAt?: number; usage?: Usage; activity?: string; stopped?: boolean
  /** How a question was asked, so it can be regenerated or edited the same way. */
  ask?: { includeDocument: boolean; selectionOnly?: boolean; page?: number; text?: string }
  /** 钉住的提问在右侧导航刻度旁多一个圆点。 */
  pinned?: boolean
  /** /compress 之后：被压缩进摘要的消息仍显示，但不再随请求发出；summary 是那条摘要。 */
  compressed?: boolean; summary?: boolean
  /** 摘录卡片：读者用 Ctrl+↓ / → / ← 从回答里带过来的一段文字（self 本对话、main 来自主对话、side 来自附属对话），随之后的提问一起发出。 */
  note?: 'self' | 'main' | 'side'
  /** 随这个问题一起发出的摘录（在输入框里攒的引用片段）。 */
  excerpts?: Excerpt[]
}
/** 读者用 Ctrl+↓ / → / ← 从回答里摘出的一段文字，先放进输入框，随下一个问题发出。 */
export type Excerpt = { id: string; text: string; from: 'self' | 'main' | 'side' }
type Request = { controller: AbortController; phase: string }
export type ChatState = {
  id: string; documentId: string; title: string; createdAt: number; updatedAt: number
  messages: Message[]; draft: string; status: string; error: boolean; includeDocument: boolean; includeSelection: boolean; request: Request | null; scrollTop: number
  /** A branch remembers where it split off. */
  branchOf?: { conversationId: string; title: string }
  /** 侧边对话：挂在一段主对话旁边，不出现在对话记录里，跟主对话一起保存、一起删除。 */
  sideOf?: string
  /** 侧边对话开始时主对话的上下文快照：之后主对话再说什么，侧边看不到，要读者自己带过去。 */
  inherited?: { role: 'user' | 'assistant'; content: string }[]
  /** 输入框里还没发出去的摘录。 */
  excerpts?: Excerpt[]
  /** 这段对话记不记进「记忆」（读者学过什么）。默认记；false 是读者关掉了。 */
  /** 这段对话用哪种记忆：只留在本书、所有书共用、不用。没写是共用（老对话），false 是不用（老写法）。 */
  memory?: MemoryMode | false
  /** 总结对话：系统提示词换成总结那一套，助手把文档写进草稿面板。见 summary.ts。 */
  summary?: SummaryState
}
type DocumentChats = { list: ChatState[]; activeId: string; loaded: boolean; loading?: Promise<void> }

const documents = shallowReactive(new Map<string, DocumentChats>())
const scheduler = new RequestScheduler(loadAiSettings().requestLimits)
export const taskSummary = reactive({ running: 0, queued: 0, limits: scheduler.queue.limits })
scheduler.subscribe((value: any) => Object.assign(taskSummary, value))

const STORAGE_PREFIX = 'ai.conversations.v1.'
const MAX_STORED_CONVERSATIONS = 40
const MAX_MESSAGES = 200
/** 输入框里一次最多附上的图片数。 */
export const MAX_ATTACHMENTS = 6
// 输入框里已经确认要发的图片：粘贴、拖进来的，还有点过「留住」的截图。按文档记，发出后清掉。
const composerImages = reactive(new Map<string, string[]>())
export function pendingImages(key: string) { return composerImages.get(key) || [] }
export function setPendingImages(key: string, images: string[]) { if (images.length) composerImages.set(key, images.slice(0, MAX_ATTACHMENTS)); else composerImages.delete(key) }
/** 留住一张截图：之后再截图是新增一张，不会把它换掉。满了或已经有了返回 false。 */
export function keepImage(key: string, image: string) {
  const list = pendingImages(key)
  if (!image || list.includes(image) || list.length >= MAX_ATTACHMENTS) return false
  composerImages.set(key, [...list, image]); return true
}

function readSummary(value: any): SummaryState | undefined {
  if (!value || typeof value !== 'object' || !value.options) return undefined
  const options = lastSummaryOptions()
  for (const key of ['scope', 'length', 'structure', 'tone', 'language', 'focus'] as const) options[key] = typeof value.options[key] === 'string' ? value.options[key].slice(0, key === 'scope' ? 1200 : 400) : ''
  readSwitches(options, value.options)
  return { options, started: value.started !== false, savedId: typeof value.savedId === 'string' ? value.savedId : undefined, rounds: Number(value.rounds) || 0 }
}
function blank(documentId: string): ChatState {
  const now = Date.now()
  return reactive({ id: crypto.randomUUID(), documentId, title: '', createdAt: now, updatedAt: now, messages: [], draft: '', status: '', error: false, includeDocument: true, includeSelection: false, request: null, scrollTop: 0, ...(defaultMemoryMode() === 'all' ? {} : { memory: defaultMemoryMode() }) }) as ChatState
}
function chats(documentId: string): DocumentChats {
  let entry = documents.get(documentId)
  if (!entry) {
    const first = blank(documentId)
    entry = reactive({ list: [first], activeId: first.id, loaded: false }) as DocumentChats
    documents.set(documentId, entry)
  }
  return entry
}
/** The conversation the document's assistant currently shows (created on demand). */
export function chatState(documentId: string, conversationId?: string): ChatState {
  const entry = chats(documentId)
  return entry.list.find(item => item.id === (conversationId || entry.activeId)) || entry.list[0]
}
export function conversations(documentId: string): ChatState[] {
  return chats(documentId).list.filter(item => !item.sideOf).sort((a, b) => b.updatedAt - a.updatedAt)
}
/** 一段主对话的侧边对话；create 时没有就新建一段（不切换当前对话）。 */
export function sideConversation(documentId: string, mainId: string, create = false): ChatState | undefined {
  const entry = chats(documentId)
  let side = entry.list.find(item => item.sideOf === mainId)
  if (!side && create) {
    side = blank(documentId)
    const main = entry.list.find(item => item.id === mainId)
    side.sideOf = mainId; side.includeDocument = main?.includeDocument ?? true
    side.inherited = main ? inheritedContext(main) : []
    entry.list.push(side)
  }
  return side
}
/** 主对话此刻的上下文（压缩过的部分只带摘要），最多 12 条、约 30000 字。 */
function inheritedContext(main: ChatState) {
  const kept: { role: 'user' | 'assistant'; content: string }[] = []
  let chars = 0
  for (const message of [...main.messages].reverse()) {
    if (message.compressed || (message.failed && !message.content) || !message.content) continue
    const content = wireText(message)
    if (kept.length >= 12 || chars + content.length > 30000) break
    kept.unshift({ role: message.summary || message.note ? 'user' : message.role, content }); chars += content.length
  }
  return kept
}
const NOTE_LABEL = { self: '读者从这段对话里摘出来、要接着讨论的片段', main: '读者从主对话带过来的片段', side: '读者从附属对话带回来的片段' } as const
/** 一条消息发给模型时的文字：摘要、摘录卡片带上说明。 */
function wireText(message: Message) {
  if (message.summary) return `[更早的对话已压缩。下面是当时的交接摘要，接着它继续，不要向读者提起这份摘要]\n${message.content}`
  if (message.note) return `[${NOTE_LABEL[message.note]}]\n${message.content}`
  return message.content + excerptText(message.excerpts)
}
// 总结对话里，以前各轮写的文档不逐份带给模型（改一次就多一份，很快超出上限、被截掉）：
// 每轮的文档块换成一句占位，最新的整份草稿随这一问带一次。
const withoutDrafts = (text: string) => text.replace(/<summary-(doc|add|edit)>[\s\S]*?(?:<\/summary-\1>|$)/g, '[这一轮把内容写进了草稿]')
function excerptText(excerpts: Excerpt[] | undefined) {
  return excerpts?.length ? excerpts.map(item => `\n\n[${NOTE_LABEL[item.from]}]\n${item.text}`).join('') : ''
}
/** 把一段摘录放进对话的输入框（不发请求）；下一个问题会带上它。 */
export function addExcerpt(documentId: string, conversationId: string, text: string, from: Excerpt['from']) {
  const state = chatState(documentId, conversationId)
  const content = text.trim().slice(0, 8000)
  if (!content) return null
  const excerpt: Excerpt = { id: crypto.randomUUID(), text: content, from }
  state.excerpts = [...(state.excerpts || []), excerpt].slice(-8)
  return excerpt
}
export function removeExcerpt(documentId: string, conversationId: string, excerptId: string) {
  const state = chatState(documentId, conversationId)
  state.excerpts = (state.excerpts || []).filter(item => item.id !== excerptId)
}
/** 放一张摘录卡片进对话（不发请求）；之后的提问会一起带上它。 */
export function addNote(documentId: string, conversationId: string, text: string, from: 'self' | 'main' | 'side') {
  const state = chatState(documentId, conversationId)
  const content = text.trim().slice(0, 8000)
  if (!content) return null
  const note: Message = { id: crypto.randomUUID(), role: 'user', content, sources: [], note: from }
  state.messages.push(note)
  state.updatedAt = Date.now()
  schedulePersist(documentId)
  return note
}
export function removeMessage(documentId: string, conversationId: string, messageId: string) {
  const state = chatState(documentId, conversationId)
  const index = state.messages.findIndex(item => item.id === messageId)
  if (index >= 0) { state.messages.splice(index, 1); schedulePersist(documentId) }
}
export function activeConversationId(documentId: string) { return chats(documentId).activeId }
export function selectConversation(documentId: string, conversationId: string) {
  const entry = chats(documentId)
  if (!entry.list.some(item => item.id === conversationId)) return
  if (entry.activeId !== conversationId) flushMemory(documentId, entry.activeId)
  entry.activeId = conversationId
}
/** Start a fresh conversation, reusing an untouched empty one. */
export function newConversation(documentId: string): ChatState {
  const entry = chats(documentId)
  flushMemory(documentId, entry.activeId)
  const empty = entry.list.find(item => !item.sideOf && !item.messages.length && !item.request)
  if (empty) { entry.activeId = empty.id; empty.updatedAt = Date.now(); return empty }
  const conversation = blank(documentId)
  entry.list.push(conversation); entry.activeId = conversation.id
  return conversation
}
/** 开一段总结对话：先停在设置表格上，读者点了开始才发第一句。总结不读也不写记忆。 */
export function newSummaryConversation(documentId: string): ChatState {
  const entry = chats(documentId)
  flushMemory(documentId, entry.activeId)
  let conversation = entry.list.find(item => !item.sideOf && !item.messages.length && !item.request)
  if (!conversation) { conversation = blank(documentId); entry.list.push(conversation) }
  conversation.summary = { options: lastSummaryOptions(), started: false }
  conversation.memory = 'off'; conversation.updatedAt = Date.now()
  entry.activeId = conversation.id
  return conversation
}
/** 还没开始的总结对话改回普通对话。 */
export function cancelSummary(documentId: string, conversationId: string) {
  const conversation = chats(documentId).list.find(item => item.id === conversationId)
  if (!conversation?.summary || conversation.messages.length) return
  conversation.summary = undefined
  const mode = defaultMemoryMode(); conversation.memory = mode === 'all' ? undefined : mode
}
export function deleteConversation(documentId: string, conversationId: string) {
  const entry = chats(documentId)
  const conversation = entry.list.find(item => item.id === conversationId)
  if (!conversation) return
  conversation.request?.controller.abort()
  for (const side of entry.list.filter(item => item.sideOf === conversationId)) side.request?.controller.abort()
  entry.list = entry.list.filter(item => item !== conversation && item.sideOf !== conversationId)
  if (!entry.list.some(item => !item.sideOf)) entry.list.push(blank(documentId))
  if (entry.activeId === conversationId) entry.activeId = entry.list.filter(item => !item.sideOf).sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id
  // 对话删了，它记下的东西也一起忘掉。
  clearTimeout(memoryTimers.get(conversationId)); memoryTimers.delete(conversationId)
  forgetConversation(conversationId)
  schedulePersist(documentId)
}
export function renameConversation(documentId: string, conversationId: string, title: string) {
  const conversation = chats(documentId).list.find(item => item.id === conversationId)
  const next = title.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!conversation || !next) return
  conversation.title = next
  retagMemory(conversationId, { title: next })
  schedulePersist(documentId)
}
/** 这段对话用哪种记忆。改成「不用」时把它已经记下的也忘掉；在「本书」和「全局」之间改，已有的记录跟着换地方。 */
export function setConversationMemory(documentId: string, conversationId: string, mode: MemoryMode) {
  const conversation = chats(documentId).list.find(item => item.id === conversationId)
  if (!conversation) return
  conversation.memory = mode === 'all' ? undefined : mode
  if (mode === 'off') { clearTimeout(memoryTimers.get(conversationId)); memoryTimers.delete(conversationId); forgetConversation(conversationId) }
  else { retagMemory(conversationId, { scope: mode }); scheduleMemory(conversation, 1500) }
  // 还没开始问的新对话上选的，就是下一段新对话的默认值。
  if (!conversation.messages.length) rememberMemoryMode(mode)
  schedulePersist(documentId)
}
/** 管理界面删除前留底：一段对话连同它的附属对话。 */
export function conversationBundle(documentId: string, conversationId: string): ChatState[] {
  return chats(documentId).list.filter(item => item.id === conversationId || item.sideOf === conversationId)
}
/** 撤销删除：把留底的对话放回这本书名下。 */
export function restoreConversations(documentId: string, items: ChatState[]) {
  const entry = chats(documentId), known = new Set(entry.list.map(item => item.id))
  for (const item of items) if (!known.has(item.id)) { item.documentId = documentId; item.request = null; entry.list.push(item) }
  schedulePersist(documentId)
}
/** 现在就把一段对话整理进记忆（管理界面里「整理还没整理的对话」）。 */
export function memorizeNow(documentId: string, conversationId: string): Promise<void> {
  const conversation = chats(documentId).list.find(item => item.id === conversationId)
  if (!conversation || conversation.sideOf || memoryMode(conversation) === 'off' || conversation.request) return Promise.resolve()
  return memorize(conversation, conversationBooks[documentId]?.title || '', memoryTurns(conversation))
}
/** 把一段对话（连同它的附属对话）挪到另一本书名下。正在回答的不能挪。 */
export async function moveConversation(fromId: string, conversationId: string, to: { id: string; title: string; kind: string }): Promise<boolean> {
  if (fromId === to.id) return false
  await Promise.all([loadConversations(fromId), loadConversations(to.id)])
  const from = chats(fromId), target = chats(to.id)
  const moved = from.list.filter(item => item.id === conversationId || item.sideOf === conversationId)
  if (!moved.some(item => item.id === conversationId) || moved.some(item => item.request)) return false
  from.list = from.list.filter(item => !moved.includes(item))
  if (!from.list.some(item => !item.sideOf)) from.list.push(blank(fromId))
  if (!from.list.some(item => item.id === from.activeId)) from.activeId = from.list.filter(item => !item.sideOf).sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id
  for (const item of moved) { item.documentId = to.id; target.list.push(item) }
  rememberBook(to)
  retagMemory(conversationId, { documentId: to.id, documentTitle: to.title })
  flushPersist(fromId); flushPersist(to.id)
  return true
}

// ---- 有对话的书：书从文档库移除以后，对话和记忆还在，靠这份名单认得它们原来属于哪本书 ----
const BOOKS_KEY = 'ai.conversations.books.v1'
export type BookRecord = { title: string; kind: string; at: number }
export const conversationBooks = reactive<Record<string, BookRecord>>({})
export const booksReady: Promise<void> = (async () => {
  try {
    const value = JSON.parse(await library.getSetting(BOOKS_KEY) || '{}')
    for (const [id, book] of Object.entries<any>(value || {})) if (book && typeof book.title === 'string' && !conversationBooks[id]) conversationBooks[id] = { title: book.title, kind: String(book.kind || 'pdf'), at: Number(book.at) || 0 }
  } catch { /* 没有名单 */ }
})()
let booksTimer: ReturnType<typeof setTimeout> | undefined
function saveBooks() { clearTimeout(booksTimer); booksTimer = setTimeout(() => { void booksReady.then(() => library.setSetting(BOOKS_KEY, JSON.stringify(conversationBooks))).catch(() => {}) }, 400) }
export function rememberBook(descriptor: { id: string; title: string; kind: string }) {
  const known = conversationBooks[descriptor.id]
  if (known && known.title === descriptor.title && known.kind === descriptor.kind) return
  conversationBooks[descriptor.id] = { title: descriptor.title, kind: descriptor.kind, at: known?.at || Date.now() }
  saveBooks()
}
export function forgetBook(documentId: string) { if (conversationBooks[documentId]) { delete conversationBooks[documentId]; saveBooks() } }

// ---- 记忆：对话告一段落后，整理出读者学了什么 ----
/** 分支是从第几条消息之后分出去的：和原对话开头相同的那一段。 */
export function forkPoint(branch: ChatState, source: ChatState | undefined): number {
  if (!source) return 0
  let at = 0
  while (at < branch.messages.length && at < source.messages.length && branch.messages[at]!.role === source.messages[at]!.role && branch.messages[at]!.content === source.messages[at]!.content) at++
  return at
}
const memoryTurns = (conversation: ChatState) => {
  // 分支里抄过来的那段已经在原对话里整理过，只看分出去以后的。
  const from = conversation.branchOf ? forkPoint(conversation, chats(conversation.documentId).list.find(item => item.id === conversation.branchOf!.conversationId)) : 0
  return conversation.messages.slice(from).filter(message => !message.note && !message.summary && message.content && !(message.failed && message.role === 'assistant')).map(message => ({ role: message.role, content: message.content }))
}
/** 正在后台整理第几段 / 共几段；空着就是没在整理。 */
export const organizing = ref('')
const triedBacklog = new Set<string>()
/**
 * 把还没整理进记忆的对话（或者用旧办法整理的）在后台补上。应用打开后自己跑，不用读者去点；
 * 每段对话这次打开应用只试一回。
 */
export async function organizeBacklog(): Promise<void> {
  if (organizing.value) return
  await booksReady; await memoryReady()
  const ids = Object.keys(conversationBooks)
  await Promise.all(ids.map(id => loadConversations(id).catch(() => {})))
  const list = ids.flatMap(id => chats(id).list).filter(talk => !talk.sideOf && !talk.summary && memoryMode(talk) !== 'off' && !talk.request && talk.messages.length >= 2 && memory.entries[talk.id]?.v !== MEMORY_VERSION && !triedBacklog.has(talk.id))
  if (!list.length) return
  // 旧的在前：新对话记下的以后覆盖旧对话里说同一件事的。
  list.sort((a, b) => a.updatedAt - b.updatedAt)
  let done = 0
  try {
    for (const talk of list) {
      triedBacklog.add(talk.id); organizing.value = `${++done} / ${list.length}`
      await memorize(talk, conversationBooks[talk.documentId]?.title || '', memoryTurns(talk)).catch(() => {})
    }
  } finally { organizing.value = '' }
}
if (typeof window !== 'undefined') setTimeout(() => { void organizeBacklog() }, 12000)
const memoryTimers = new Map<string, ReturnType<typeof setTimeout>>()
function runMemory(conversation: ChatState) {
  if (conversation.sideOf || memoryMode(conversation) === 'off' || conversation.request) return
  void memorize(conversation, conversationBooks[conversation.documentId]?.title || '', memoryTurns(conversation))
}
/** 答完之后过一会儿再整理：接着追问的话，等这一串问完一起整理。 */
function scheduleMemory(conversation: ChatState, delay = 40000) {
  if (conversation.sideOf || memoryMode(conversation) === 'off') return
  clearTimeout(memoryTimers.get(conversation.id))
  memoryTimers.set(conversation.id, setTimeout(() => { memoryTimers.delete(conversation.id); runMemory(conversation) }, delay))
}
/** 离开一段对话（换一段、新开一段、关掉）时，等着整理的马上整理。 */
function flushMemory(documentId: string, conversationId?: string) {
  for (const conversation of documents.get(documentId)?.list || []) {
    if (conversationId && conversation.id !== conversationId) continue
    if (!memoryTimers.has(conversation.id)) continue
    clearTimeout(memoryTimers.get(conversation.id)); memoryTimers.delete(conversation.id)
    runMemory(conversation)
  }
}
/** Copy a conversation up to (and including) one message into a new conversation and show it. */
export function branchConversation(documentId: string, conversationId: string, uptoMessageId: string | null): ChatState {
  const entry = chats(documentId)
  const source = entry.list.find(item => item.id === conversationId)
  const branch = blank(documentId)
  if (source) {
    const end = uptoMessageId ? source.messages.findIndex(message => message.id === uptoMessageId) + 1 : 0
    branch.messages = source.messages.slice(0, Math.max(0, end)).map(message => ({ ...JSON.parse(JSON.stringify({ ...message, images: undefined, activity: undefined })), id: crypto.randomUUID(), images: message.images ? [...message.images] : undefined }))
    branch.title = source.title ? `${source.title.replace(/ · 分支$/, '')} · 分支` : ''
    branch.branchOf = { conversationId: source.id, title: source.title || '新对话' }
    branch.includeDocument = source.includeDocument
  }
  entry.list.push(branch); entry.activeId = branch.id
  schedulePersist(documentId)
  return branch
}

/** /btw 的一问一答。 */
export type AsideTurn = { question: string; answer: string; startedAt: number; finishedAt?: number }
/** 把 /btw 里聊的搬进正式对话：另起一段主对话（new）、接在这段对话后面（append），或放进它的附属对话（side）。 */
export function adoptTurns(documentId: string, conversationId: string, target: 'new' | 'append' | 'side', turns: AsideTurn[]): ChatState {
  const state = target === 'new' ? newConversation(documentId) : target === 'side' ? sideConversation(documentId, conversationId, true)! : chatState(documentId, conversationId)
  for (const turn of turns) {
    if (!turn.answer) continue
    state.messages.push({ id: crypto.randomUUID(), role: 'user', content: turn.question, sources: [] })
    state.messages.push({ id: crypto.randomUUID(), role: 'assistant', content: turn.answer, sources: [], startedAt: turn.startedAt, finishedAt: turn.finishedAt || Date.now() })
  }
  if (!state.title && !state.sideOf && turns[0]) state.title = titleFrom(turns[0].question)
  state.updatedAt = Date.now()
  schedulePersist(documentId)
  return state
}

// ---- Finished-answer notices for conversations nobody is looking at --------
export type Notice = { id: string; documentId: string; conversationId: string; title: string; documentTitle: string; at: number }
export const notices = reactive<Notice[]>([])
const watching = new Map<string, Set<() => boolean>>()
/** A pane showing a conversation registers it; answers finishing while it is on screen need no notice. */
export function watchConversation(conversationId: string, onScreen: () => boolean) {
  const set = watching.get(conversationId) || new Set<() => boolean>()
  set.add(onScreen); watching.set(conversationId, set)
  return () => { set.delete(onScreen); if (!set.size) watching.delete(conversationId) }
}
export function dismissNotice(id: string) { const index = notices.findIndex(item => item.id === id); if (index >= 0) notices.splice(index, 1) }
function noticeFinished(state: ChatState, documentTitle: string) {
  // 侧边对话就在主对话旁边，答完不另外提示。
  if (state.sideOf || [...(watching.get(state.id) || [])].some(onScreen => onScreen())) return
  notices.push({ id: crypto.randomUUID(), documentId: state.documentId, conversationId: state.id, title: state.title || '新对话', documentTitle, at: Date.now() })
  if (notices.length > 4) notices.splice(0, notices.length - 4)
}

export function chatPhase(documentId: string) {
  const entry = documents.get(documentId)
  return entry?.list.find(item => item.request)?.request?.phase || ''
}
/** 钉住或取消钉住一问，跟着对话一起保存。 */
export function pinMessage(documentId: string, conversationId: string, messageId: string, pinned: boolean) {
  const message = chatState(documentId, conversationId).messages.find(item => item.id === messageId)
  if (!message) return
  message.pinned = pinned || undefined
  schedulePersist(documentId)
}
export function configureRequests(settings: any) { scheduler.configure(settings.requestLimits) }
export function stopChat(documentId: string, conversationId?: string) {
  const entry = documents.get(documentId)
  if (!entry) return
  const target = conversationId ? entry.list.find(item => item.id === conversationId) : (entry.list.find(item => item.id === entry.activeId && item.request) || entry.list.find(item => item.request))
  if (!target?.request) return
  target.request.controller.abort()
  target.status = ''; target.error = false
}
export function closeChat(documentId: string) {
  const entry = documents.get(documentId)
  if (!entry) return
  for (const item of entry.list) item.request?.controller.abort()
  flushMemory(documentId)
  flushPersist(documentId)
  documents.delete(documentId)
}
export function closeAllChats() { for (const id of [...documents.keys()]) closeChat(id) }

// ---- Persistence: conversations survive restarts, without screenshots. ----
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
function serialize(entry: DocumentChats) {
  const mains = entry.list.filter(item => !item.sideOf && item.messages.length).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_STORED_CONVERSATIONS)
  const kept = new Set(mains.map(item => item.id))
  const sides = entry.list.filter(item => item.sideOf && kept.has(item.sideOf) && item.messages.length)
  return JSON.stringify({ activeId: entry.activeId, list: [...mains, ...sides].map(item => ({
    id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, branchOf: item.branchOf, sideOf: item.sideOf, inherited: item.inherited, memory: item.memory, summary: item.summary,
    messages: item.messages.filter(message => !message.failed || message.content).slice(-MAX_MESSAGES).map(({ images: _images, activity: _activity, ...message }) => ({ ...message, content: message.content.slice(0, 60000), reasoning: message.reasoning?.slice(0, 20000), sources: message.sources.slice(0, 24).map(source => ({ ...source, text: String(source.text || '').slice(0, 600) })) })),
  })) })
}
function flushPersist(documentId: string) {
  clearTimeout(persistTimers.get(documentId)); persistTimers.delete(documentId)
  const entry = documents.get(documentId)
  if (!entry?.loaded) return
  void library.setSetting(STORAGE_PREFIX + documentId, serialize(entry)).catch(() => {})
}
function schedulePersist(documentId: string) {
  clearTimeout(persistTimers.get(documentId))
  persistTimers.set(documentId, setTimeout(() => flushPersist(documentId), 500))
}
/** 从搜索结果点进一段对话：要滚到哪条消息。显示这段对话的助手窗口看到后滚过去，然后清掉。 */
export const revealTarget = ref<{ conversationId: string; messageId: string; at: number } | null>(null)
/** Every conversation with messages across the given documents, newest first (loads saved ones on demand). */
export async function allConversations(documentIds: string[]): Promise<ChatState[]> {
  await Promise.all(documentIds.map(id => loadConversations(id)))
  return documentIds.flatMap(id => chats(id).list.filter(item => !item.sideOf && item.messages.length)).sort((a, b) => b.updatedAt - a.updatedAt)
}
/** Load saved conversations once per document; the live ones stay in front. */
export function loadConversations(documentId: string): Promise<void> {
  const entry = chats(documentId)
  if (entry.loaded) return Promise.resolve()
  entry.loading ||= (async () => {
    try {
      const raw = await library.getSetting(STORAGE_PREFIX + documentId)
      const stored = raw ? JSON.parse(raw) : null
      const known = new Set(entry.list.map(item => item.id))
      for (const item of Array.isArray(stored?.list) ? stored.list : []) {
        if (!item || typeof item.id !== 'string' || known.has(item.id) || !Array.isArray(item.messages)) continue
        const conversation = blank(documentId)
        Object.assign(conversation, { id: item.id, title: String(item.title || ''), memory: item.memory === false || item.memory === 'off' ? 'off' : item.memory === 'book' ? 'book' : undefined, summary: readSummary(item.summary), sideOf: typeof item.sideOf === 'string' ? item.sideOf : undefined, inherited: Array.isArray(item.inherited) ? item.inherited.filter((entry: any) => entry && typeof entry.content === 'string' && (entry.role === 'user' || entry.role === 'assistant')) : undefined, branchOf: item.branchOf && typeof item.branchOf.conversationId === 'string' ? { conversationId: item.branchOf.conversationId, title: String(item.branchOf.title || '') } : undefined, createdAt: Number(item.createdAt) || Date.now(), updatedAt: Number(item.updatedAt) || Date.now(),
          messages: item.messages.filter((message: any) => message && (message.role === 'user' || message.role === 'assistant')).map((message: any) => ({ ...message, content: String(message.content || ''), sources: Array.isArray(message.sources) ? message.sources : [] })) })
        entry.list.push(conversation)
      }
      // Reopen the conversation last used for this document if nothing has started yet.
      const current = entry.list.find(item => item.id === entry.activeId)
      if (current && !current.messages.length && stored?.activeId && entry.list.some(item => item.id === stored.activeId && !item.sideOf)) {
        entry.activeId = stored.activeId
        entry.list = entry.list.filter(item => item !== current)
      }
    } catch { /* A damaged history never blocks a new conversation. */ }
    entry.loaded = true
  })()
  return entry.loading
}

// ---- Token estimates and model context windows. ----
/** Rough token count: CJK characters ≈ 1 token each, other text ≈ 4 characters per token. */
export function contextWindow(provider: string, model: string): number {
  const id = `${provider}:${model}`.toLowerCase()
  if (id.includes('deepseek')) return 128_000
  if (/gpt-5|gpt-6|codex/.test(id)) return 400_000
  return 200_000
}
/** Tokens the next request carries from this conversation. */
export const conversationTokens = (state: ChatState): number => Math.min(liveTokens(state.messages), compactLimit()) + estimateTokens(state.draft)
function titleFrom(question: string) {
  const line = question.replace(/\s+/g, ' ').trim()
  return line.length > 28 ? line.slice(0, 27) + '…' : line
}

// selectionOnly: a quick capture question sends just the question and the selected region.
type SendOptions = { /** 应用自己替读者发的（分多次写总结时的「继续」）：对话栏里不显示这一问。 */ auto?: boolean; /** 重新回答：新的问答换掉这个问题和它原来的回答，前后的对话不动。 */ replace?: string; conversationId?: string; includeDocument?: boolean; includeSelection?: boolean; selectionOnly?: boolean; images?: string[]; attachments?: string[]; excerpts?: Excerpt[] }
export async function sendChat(descriptor: { id: string; title: string; kind: string }, source: any, onSettings: () => void, onAccepted?: () => void, explicitQuestion?: string, sendOptions: SendOptions = {}) {
  const state = chatState(descriptor.id, sendOptions.conversationId), question = (explicitQuestion ?? state.draft).trim()
  if (!question || state.request) return
  if (question.length > 16000) { state.status = '请将单次问题缩短至 16000 字以内。'; state.error = true; return }
  // Capture all user choices before the first await. No callback reads a
  // subsequently selected tab, page, selection or model configuration.
  const settings: any = loadAiSettings()
  configureRequests(settings)
  const snapshot = { ...settings, documentLimits: { ...settings.documentLimits } }
  // 总结要把整个范围读过才能写：每题的阅读预算放到上限（平时每题只读八页左右，一章都读不完）。
  if (state.summary) Object.assign(snapshot.documentLimits, SUMMARY_READING)
  const includeDocument = sendOptions.includeDocument ?? state.includeDocument
  const includeSelection = sendOptions.includeSelection ?? state.includeSelection
  // 输入框里攒的摘录随这个问题发出；重新回答时用原问题带过的那几段。
  const excerpts = (sendOptions.excerpts ?? state.excerpts ?? []).map(item => ({ ...item }))
  const pendingExcerpts = sendOptions.excerpts ? [] : excerpts.map(item => item.id)
  const selection = sendOptions.images?.length ? { image: sendOptions.images[0], page: source?.page, text: source?.selection?.text } : includeSelection ? { ...source?.selection, rect: source?.selection?.rect && { ...source.selection.rect } } : {}
  const context = { page: selection.page || source?.page || 1, selection }
  const request = reactive<Request>({ controller: markRaw(new AbortController()), phase: 'preparing' })
  state.request = request; state.status = ''; state.error = false
  const signal = request.controller.signal
  const entry = chats(descriptor.id)
  const valid = () => state.request === request && !signal.aborted && entry.list.includes(state)
  let answer: Message | undefined, ticket: any, resource: any, documentSession: any, again = false
  const activity = (text: string) => { if (valid() && answer) answer.activity = text }
  try {
    const [{ getModel, streamChat }, { streamDocumentChat, boundedHistory }] = await Promise.all([import('./providers.mjs'), import('./document-chat.mjs')])
    const apiKey = snapshot.provider === 'codex' ? '' : await loadApiKey(snapshot.provider)
    signal.throwIfAborted()
    // A local OpenAI-compatible server (Ollama, LM Studio) behind 自定义接口 needs no key.
    const keyless = snapshot.provider === 'custom' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(snapshot.baseUrl || '')
    if (snapshot.provider !== 'codex' && !apiKey && !keyless) { if (valid()) onSettings(); throw new Error('请先连接 AI 服务。') }
    // 框选截图在前，输入框里粘贴或添加的图片随后。
    const attached = (sendOptions.attachments || []).slice(0, MAX_ATTACHMENTS)
    // 同一张图只发一次（同一块地方截了两遍）。
    const images = [...new Set([...(selection.image ? [selection.image] : []), ...attached])]
    if (images.reduce((sum, image) => sum + image.length, 0) > 8 * 1024 * 1024) throw new Error('图片总量太大，请减少几张或换小一点的图片。')
    // 以前留下的长对话：发问时就已经到量，这一问照常发，同时在后台压缩。
    if (!state.summary && !sendOptions.replace && fullness(state.messages) >= 1) void compressConversation(descriptor, state.id, '', false)
    const user: Message = { id: crypto.randomUUID(), role: 'user', content: question, sources: [], images, ...(sendOptions.auto ? { auto: true } : {}), ...(excerpts.length ? { excerpts } : {}), ask: { includeDocument, selectionOnly: sendOptions.selectionOnly, page: context.page, text: selection.text ? String(selection.text).slice(0, 20000) : undefined } }
    const wireContent = sendOptions.selectionOnly
      ? `${question}${excerptText(excerpts)}${selection.text ? '\n\n[用户选中的内容]\n' + selection.text : ''}${selection.image ? '\n\n[附图是用户在文档里框选的区域，问题针对它]' : ''}${attached.length ? `\n\n[用户附上了 ${attached.length} 张图片]` : ''}`
      : `${question}${excerptText(excerpts)}\n\n[用户当前阅读的文档]\n${descriptor.title}${descriptor.kind === 'pdf' ? ` · 物理 PDF 第 ${context.page} 页` : ' · Markdown 文档'}${selection.text ? '\n\n[用户选中的内容]\n' + selection.text : ''}${attached.length ? `\n\n[用户附上了 ${attached.length} 张图片]` : ''}${state.sideOf ? '\n\n[这是挂在主对话旁边的附属对话（侧边对话）]' : ''}`
    const draft = state.summary ? summaryDraft(state.messages).text : ''
    const draftNow = draft ? `\n\n[草稿面板里现在的文档全文；要修改就在它的基础上改]\n${draft.slice(0, 60000)}` : ''
    // 重新回答中间的某一问：只把它之前的对话带给模型。
    const before = sendOptions.replace ? state.messages.findIndex(message => message.id === sendOptions.replace) : -1
    const history = boundedHistory(compactLimit(), [...(state.inherited || []).map(item => ({ role: item.role, content: `[主对话里的内容（开启附属对话时）]\n${item.content}` })), ...(before < 0 ? state.messages : state.messages.slice(0, before)).filter(message => !message.failed && !message.compressed).map(message => message.summary || message.note ? { role: 'user', content: wireText(message) } : ({ role: message.role, content: (state.summary && message.role === 'assistant' ? withoutDrafts(wireText(message)) : wireText(message)) + (message.sources.length ? '\n[此前查到的相关位置]\n' + JSON.stringify(message.sources.slice(0, 8).map(item => ({ sourceId: item.sourceId, page: item.page, line: item.line, text: item.text.slice(0, 400) }))) : '') })), { ...user, content: wireContent + draftNow }])
    // The scheduler reports the first queue position before the answer bubble exists.
    let waiting = ''
    ticket = scheduler.acquire({ owner: `${descriptor.id}:${state.id}`, provider: snapshot.provider, signal, onState: (value: any) => {
      if (!valid()) return
      request.phase = value.status
      waiting = value.status === 'queued' ? `等待中 · 队列第 ${value.position} 位` : '准备上下文'
      activity(waiting)
    } })
    const startedAt = Date.now()
    if (pendingExcerpts.length) state.excerpts = (state.excerpts || []).filter(item => !pendingExcerpts.includes(item.id))
    const fresh: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', reasoning: '', sources: [], startedAt, activity: waiting || '准备上下文', usage: { estimated: true, input: estimateTokens(history.map(item => item.content).join('\n')) } }
    // 原来那一问在哪：从它到下一个问题之前（它的回答）整段换掉；找不到就照常接在最后。
    let at = sendOptions.replace ? state.messages.findIndex(message => message.id === sendOptions.replace) : -1, end = at + 1
    while (at >= 0 && end < state.messages.length && !(state.messages[end].role === 'user' && !state.messages[end].note)) end++
    if (at < 0) at = end = state.messages.length
    state.messages.splice(at, end - at, user, fresh)
    const asked = state.messages[at]
    answer = state.messages[at + 1]
    if (!state.title) state.title = titleFrom(question)
    rememberBook(descriptor)
    state.updatedAt = startedAt
    if (entry.activeId !== state.id && !sendOptions.conversationId) entry.activeId = state.id
    // Immediate suggestions are independent of the user's unfinished question.
    // A normal send also preserves any new draft typed while preparing the request.
    if (explicitQuestion === undefined && state.draft.trim() === question) state.draft = ''
    onAccepted?.()
    await ticket.started
    signal.throwIfAborted()
    activity('思考中')
    const output = () => { if (answer?.usage?.estimated) answer.usage.output = estimateTokens(answer.content) + estimateTokens(answer.reasoning || '') }
    const { UI_INSTRUCTIONS } = await import('./intelligent-ui')
    // 读者的学习记录（记忆）：只给主对话和它的附属对话，用来定讲解的深浅。
    await memoryReady()
    const owner = state.sideOf ? chats(state.documentId).list.find(item => item.id === state.sideOf) || state : state
    const remembered = memoryInstructions({ id: owner.id, documentId: descriptor.id, mode: memoryMode(owner) })
    // 总结对话用自己的一套提示词，不带学习记录；Intelligent UI 的写法只在读者打开时给。
    const extraInstructions = state.summary ? summaryInstructions(descriptor.title, state.summary.options, state.summary.options.ui ? UI_INSTRUCTIONS.document : '') : UI_INSTRUCTIONS.assistant + (remembered ? '\n\n' + remembered : '')
    const options = { ...snapshot, apiKey, signal, messages: history, historyTokens: compactLimit(), extraInstructions,
      onDelta: (text: string) => { if (valid() && answer) { answer.firstTokenAt ||= Date.now(); answer.content += text; answer.activity = '正在回答'; output() } },
      onReasoning: (text: string) => { if (valid() && answer) { answer.reasoning = (answer.reasoning || '') + text; answer.activity = '思考中'; output() } },
      onProgress: (text: string) => activity(text.replace(/[…。]+$/, '')),
      // Tool rounds report usage per request; a document answer adds them up.
      onUsage: (usage: { input?: number; output?: number; reasoning?: number }) => {
        if (!valid() || !answer) return
        const previous = answer.usage?.estimated === false ? answer.usage : { estimated: false }
        answer.usage = { estimated: false, input: (previous.input || 0) + (usage.input || 0), output: (previous.output || 0) + (usage.output || 0), reasoning: (previous.reasoning || 0) + (usage.reasoning || 0) }
      } }
    if (includeDocument) {
      const [{ openAiContext }, { createDocumentSession }] = await Promise.all([import('../document/ai-context.mjs'), import('../document/session.mjs')])
      signal.throwIfAborted()
      activity('读取文档')
      resource = await openAiContext(descriptor, context, signal)
      documentSession = await createDocumentSession(resource.context, descriptor, snapshot.documentLimits, getModel(snapshot.provider, snapshot.model)?.vision !== false, (sources: any[]) => {
        if (!valid() || !answer) return
        const seen = new Map(answer.sources.map(item => [item.sourceId, item])); sources.forEach(item => seen.set(item.sourceId, item)); answer.sources = [...seen.values()]
        answer.activity = `查阅文档 · ${answer.sources.length} 段`
      }, signal)
      signal.throwIfAborted()
      // 普通提问先把当前页的图带上；总结要读的是整个范围，由助手自己用工具去翻，不带这一页。
      if (resource.context.pdf && !selection.text && !selection.image && !state.summary) {
        if (getModel(snapshot.provider, snapshot.model)?.vision !== false) {
          activity('查看当前页')
          const page = await documentSession.document.tool('pdf_view', { page: documentSession.seed.info.currentPage, block_id: null })
          signal.throwIfAborted()
          history.at(-1)!.images = [page.dataUrl]; user.images = [page.dataUrl]; asked.images = [page.dataUrl]
        } else if (documentSession.seed.seed.noTextPages?.length) throw new Error('当前页没有文字层，所选模型不支持图片。请切换图片模型或手动提供文字。')
      }
      let retained = 0
      for (const message of [...state.messages].reverse()) { retained += (message.images || []).reduce((sum, image) => sum + image.length, 0); if (retained > 8 * 1024 * 1024) message.images = [] }
      activity('思考中')
      await streamDocumentChat(options, documentSession.document, documentSession.seed)
    } else await streamChat(options)
    if (valid()) {
      state.status = ''
      // 分多次写的总结：这一段写完、后面还有，就自己接着发「继续」，直到写完、出错或读者按停止。
      const summary = state.summary
      if ((summary?.options.multi || summary?.options.complete) && answer && summaryContinues(answer.content) && (summary.rounds || 0) < MAX_SUMMARY_ROUNDS) { summary.rounds = (summary.rounds || 0) + 1; again = true }
      else { noticeFinished(state, descriptor.title); scheduleMemory(state) }
    }
  } catch (error: any) {
    if (answer) { answer.failed = true; answer.stopped = signal.aborted }
    if (state.request === request && entry.list.includes(state)) {
      state.error = !signal.aborted
      state.status = signal.aborted ? '' : error?.message || String(error)
    }
  } finally {
    if (answer) {
      answer.finishedAt = Date.now(); answer.activity = ''; state.updatedAt = answer.finishedAt
      // 上下文到量了：后台压缩，不挡下一问。
      if (!state.summary && fullness(state.messages) >= 1) void compressConversation(descriptor, state.id, '', false)
      if (answer.usage) recordUsage({ kind: state.sideOf ? 'side' : 'chat', provider: snapshot.provider, model: snapshot.model || '', ms: answer.finishedAt - (answer.startedAt || answer.finishedAt), estimated: answer.usage.estimated, input: answer.usage.input || 0, output: answer.usage.output || 0, reasoning: answer.usage.reasoning || 0 })
    }
    documentSession?.close()
    try { await resource?.close() } catch {}
    ticket?.release()
    if (state.request === request) state.request = null
    schedulePersist(descriptor.id)
  }
  if (again && !state.request && entry.list.includes(state)) void sendChat(descriptor, source, onSettings, undefined, '继续', { conversationId: state.id, includeSelection: false, auto: true })
}

/**
 * Ask a question of the conversation again — regenerating an answer or sending an edited question.
 * The latest question is replaced in place; an earlier one continues in a new branch so nothing is lost.
 * Returns the conversation that carries the new answer.
 */
export function resendQuestion(descriptor: { id: string; title: string; kind: string }, conversationId: string, userMessageId: string, question: string, onSettings: () => void, /** 总结对话改了那张表：新的设置。 */ summaryOptions?: SummaryOptions): string | undefined {
  const state = chatState(descriptor.id, conversationId)
  const index = state.messages.findIndex(message => message.id === userMessageId)
  const user = state.messages[index]
  if (!user || user.role !== 'user' || !question.trim()) return
  const lastUser = state.messages.map(message => message.role === 'user' && !message.note ? 'user' : '').lastIndexOf('user')
  // 原样重新生成：就在原处换掉那条回答，后面的对话留着。改了问题再问中间的一问，后面的对话已经对不上，才另开分支。
  const inPlace = index === lastUser || question.trim() === user.content.trim()
  if (inPlace && state.request) return
  const target = inPlace ? state : branchConversation(descriptor.id, state.id, index > 0 ? state.messages[index - 1].id : null)
  if (inPlace) { state.status = ''; state.error = false }
  // 总结对话：另开的分支仍然是总结对话；从头重写时把续写的轮数清零，改过的设置放到要用的那一段对话上。
  if (state.summary) {
    if (!inPlace) { target.summary = { options: { ...state.summary.options }, started: true }; target.memory = 'off' }
    if (index === 0) target.summary!.rounds = 0
    if (summaryOptions) Object.assign(target.summary!.options, summaryOptions)
  }
  const ask = user.ask
  void sendChat(descriptor, { page: ask?.page || 1, selection: ask?.text ? { text: ask.text, page: ask.page } : {} }, onSettings, undefined, question.trim(), {
    conversationId: target.id, replace: inPlace ? user.id : undefined, includeDocument: ask?.includeDocument ?? target.includeDocument, includeSelection: Boolean(ask?.text), selectionOnly: ask?.selectionOnly, images: user.images?.length ? [user.images[0]!] : undefined, attachments: user.images?.slice(1), excerpts: user.excerpts || [],
  })
  return target.id
}

/** 正在压缩的对话 → 取消用的控制器。 */
export const compacting = reactive(new Map<string, AbortController>())
/**
 * 压缩：较早的问答交给模型写成交接摘要（只给模型看），最近几轮原样留下。
 * 上下文到量时自动做，/compress 或点上下文圆环可以手动做。原来的消息照常留在界面上。
 */
export async function compressConversation(descriptor: { id: string; title: string }, conversationId: string, instructions = '', manual = true): Promise<void> {
  if (compacting.has(conversationId)) return
  const state = chatState(descriptor.id, conversationId)
  const { old } = splitForCompaction(state.messages)
  if (old.filter(message => !message.summary).length < 2) { if (manual) throw new Error('对话还很短，不需要压缩。'); return }
  const controller = new AbortController(); compacting.set(conversationId, controller)
  try {
    const { complete } = await import('./complete')
    const summary = await complete({ kind: 'compress', signal: controller.signal, messages: [{ role: 'user', content: compactionPrompt(descriptor.title, old, instructions) }] })
    controller.signal.throwIfAborted()
    if (!summary.trim()) throw new Error('没有得到摘要，请稍后再试。')
    for (const message of old) message.compressed = true
    // 摘要放在留下的那几轮之前，顺序和发给模型的一致。
    const at = state.messages.indexOf(old.at(-1)!) + 1
    state.messages.splice(at, 0, { id: crypto.randomUUID(), role: 'assistant', content: handoff(summary, old), sources: [], summary: true, finishedAt: Date.now() })
    // 界面上最多留这么多条；更早的已经在摘要里。
    while (state.messages.length > MAX_MESSAGES && state.messages[0]!.compressed) state.messages.shift()
    schedulePersist(descriptor.id)
  } catch (error) {
    if (manual && !controller.signal.aborted) throw error
  } finally { compacting.delete(conversationId) }
}
