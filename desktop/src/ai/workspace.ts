import { reactive, shallowReactive, markRaw } from 'vue'
import { loadAiSettings, loadApiKey } from './settings.mjs'
import { RequestScheduler } from './request-scheduler.mjs'
import { library } from '../sdk'
import { recordUsage } from './usage'

export type Usage = { input?: number; output?: number; reasoning?: number; estimated: boolean }
export type Message = {
  id: string; role: 'user' | 'assistant'; content: string; reasoning?: string; sources: any[]; images?: string[]; failed?: boolean
  /** Live progress of an answer: wall-clock timing, token use and the current activity line. */
  startedAt?: number; firstTokenAt?: number; finishedAt?: number; usage?: Usage; activity?: string; stopped?: boolean
  /** How a question was asked, so it can be regenerated or edited the same way. */
  ask?: { includeDocument: boolean; selectionOnly?: boolean; page?: number; text?: string; quote?: string }
  /** 钉住的提问在右侧导航刻度旁多一个圆点。 */
  pinned?: boolean
  /** /compress 之后：被压缩进摘要的消息仍显示，但不再随请求发出；summary 是那条摘要。 */
  compressed?: boolean; summary?: boolean
}
type Request = { controller: AbortController; phase: string }
export type ChatState = {
  id: string; documentId: string; title: string; createdAt: number; updatedAt: number
  messages: Message[]; draft: string; status: string; error: boolean; includeDocument: boolean; includeSelection: boolean; request: Request | null; scrollTop: number
  /** A branch remembers where it split off. */
  branchOf?: { conversationId: string; title: string }
  /** 侧边对话：挂在一段主对话旁边，不出现在对话记录里，跟主对话一起保存、一起删除。 */
  sideOf?: string
}
type DocumentChats = { list: ChatState[]; activeId: string; loaded: boolean; loading?: Promise<void> }

const documents = shallowReactive(new Map<string, DocumentChats>())
const scheduler = new RequestScheduler(loadAiSettings().requestLimits)
export const taskSummary = reactive({ running: 0, queued: 0, limits: scheduler.queue.limits })
scheduler.subscribe((value: any) => Object.assign(taskSummary, value))

const STORAGE_PREFIX = 'ai.conversations.v1.'
const MAX_STORED_CONVERSATIONS = 40
const MAX_MESSAGES = 60
/** 输入框里一次最多附上的图片数。 */
export const MAX_ATTACHMENTS = 4

function blank(documentId: string): ChatState {
  const now = Date.now()
  return reactive({ id: crypto.randomUUID(), documentId, title: '', createdAt: now, updatedAt: now, messages: [], draft: '', status: '', error: false, includeDocument: true, includeSelection: false, request: null, scrollTop: 0 }) as ChatState
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
    side.sideOf = mainId; side.includeDocument = false
    entry.list.push(side)
  }
  return side
}
export function activeConversationId(documentId: string) { return chats(documentId).activeId }
export function selectConversation(documentId: string, conversationId: string) {
  const entry = chats(documentId)
  if (entry.list.some(item => item.id === conversationId)) entry.activeId = conversationId
}
/** Start a fresh conversation, reusing an untouched empty one. */
export function newConversation(documentId: string): ChatState {
  const entry = chats(documentId)
  const empty = entry.list.find(item => !item.sideOf && !item.messages.length && !item.request)
  if (empty) { entry.activeId = empty.id; empty.updatedAt = Date.now(); return empty }
  const conversation = blank(documentId)
  entry.list.push(conversation); entry.activeId = conversation.id
  return conversation
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
  schedulePersist(documentId)
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
    id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, branchOf: item.branchOf, sideOf: item.sideOf,
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
        Object.assign(conversation, { id: item.id, title: String(item.title || ''), sideOf: typeof item.sideOf === 'string' ? item.sideOf : undefined, includeDocument: typeof item.sideOf === 'string' ? false : conversation.includeDocument, branchOf: item.branchOf && typeof item.branchOf.conversationId === 'string' ? { conversationId: item.branchOf.conversationId, title: String(item.branchOf.title || '') } : undefined, createdAt: Number(item.createdAt) || Date.now(), updatedAt: Number(item.updatedAt) || Date.now(),
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
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[　-鿿가-힯＀-￯]/g)?.length || 0
  return Math.ceil(cjk + (text.length - cjk) / 4)
}
export function contextWindow(provider: string, model: string): number {
  const id = `${provider}:${model}`.toLowerCase()
  if (id.includes('deepseek')) return 128_000
  if (/gpt-5|gpt-6|codex/.test(id)) return 400_000
  return 200_000
}
/** Tokens the next request carries from this conversation (bounded like the request history). */
export function conversationTokens(state: ChatState): number {
  let chars = 0, tokens = 0, kept = 0
  for (const message of [...state.messages].reverse()) {
    if ((message.failed && !message.content) || message.compressed) continue
    if (kept >= 12 || chars + message.content.length > 40000) break
    chars += message.content.length; kept++
    tokens += estimateTokens(message.content)
  }
  return tokens + estimateTokens(state.draft)
}
function titleFrom(question: string) {
  const line = question.replace(/\s+/g, ' ').trim()
  return line.length > 28 ? line.slice(0, 27) + '…' : line
}

// selectionOnly: a quick capture question sends just the question and the selected region.
// quote：从助手回答里选出来「添加到对话」的片段，随问题一起发出，在问题气泡下面显示。
type SendOptions = { conversationId?: string; includeDocument?: boolean; includeSelection?: boolean; selectionOnly?: boolean; images?: string[]; attachments?: string[]; quote?: string }
export async function sendChat(descriptor: { id: string; title: string; kind: string }, source: any, onSettings: () => void, onAccepted?: () => void, explicitQuestion?: string, sendOptions: SendOptions = {}) {
  const state = chatState(descriptor.id, sendOptions.conversationId), question = (explicitQuestion ?? state.draft).trim()
  if (!question || state.request) return
  if (question.length > 16000) { state.status = '请将单次问题缩短至 16000 字以内。'; state.error = true; return }
  // Capture all user choices before the first await. No callback reads a
  // subsequently selected tab, page, selection or model configuration.
  const settings: any = loadAiSettings()
  configureRequests(settings)
  const snapshot = { ...settings, documentLimits: { ...settings.documentLimits } }
  const includeDocument = sendOptions.includeDocument ?? state.includeDocument
  const includeSelection = sendOptions.includeSelection ?? state.includeSelection
  const selection = sendOptions.images?.length ? { image: sendOptions.images[0], page: source?.page, text: source?.selection?.text } : includeSelection ? { ...source?.selection, rect: source?.selection?.rect && { ...source.selection.rect } } : {}
  const context = { page: selection.page || source?.page || 1, selection }
  const request = reactive<Request>({ controller: markRaw(new AbortController()), phase: 'preparing' })
  state.request = request; state.status = ''; state.error = false
  const signal = request.controller.signal
  const entry = chats(descriptor.id)
  const valid = () => state.request === request && !signal.aborted && entry.list.includes(state)
  let answer: Message | undefined, ticket: any, resource: any, documentSession: any
  const activity = (text: string) => { if (valid() && answer) answer.activity = text }
  try {
    const [{ getModel, streamChat }, { streamDocumentChat, boundedHistory }] = await Promise.all([import('./providers.mjs'), import('./document-chat.mjs')])
    const apiKey = snapshot.provider === 'codex' ? '' : await loadApiKey(snapshot.provider)
    signal.throwIfAborted()
    // A local OpenAI-compatible server (Ollama, LM Studio) behind 自定义接口 needs no key.
    const keyless = snapshot.provider === 'custom' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(snapshot.baseUrl || '')
    if (snapshot.provider !== 'codex' && !apiKey && !keyless) { if (valid()) onSettings(); throw new Error('请先连接 AI 服务。') }
    if (state.messages.length >= MAX_MESSAGES || state.messages.reduce((sum, message) => sum + message.content.length, question.length) > 150000) throw new Error('这段对话已经很长，请新建对话继续，以控制上下文与内存。')
    // 框选截图在前，输入框里粘贴或添加的图片随后。
    const attached = (sendOptions.attachments || []).slice(0, MAX_ATTACHMENTS)
    const images = [...(selection.image ? [selection.image] : []), ...attached]
    if (images.reduce((sum, image) => sum + image.length, 0) > 8 * 1024 * 1024) throw new Error('图片总量太大，请减少几张或换小一点的图片。')
    const quote = sendOptions.quote?.trim().slice(0, 12000) || undefined
    const user: Message = { id: crypto.randomUUID(), role: 'user', content: question, sources: [], images, ask: { includeDocument, selectionOnly: sendOptions.selectionOnly, page: context.page, text: selection.text ? String(selection.text).slice(0, 20000) : undefined, quote } }
    const quoted = quote ? `\n\n[读者引用的助手回答片段]\n${quote}` : ''
    const wireContent = sendOptions.selectionOnly
      ? `${question}${selection.text ? '\n\n[用户选中的内容]\n' + selection.text : ''}${selection.image ? '\n\n[附图是用户在文档里框选的区域，问题针对它]' : ''}${attached.length ? `\n\n[用户附上了 ${attached.length} 张图片]` : ''}`
      : `${question}${quoted}\n\n[用户当前阅读的文档]\n${descriptor.title}${descriptor.kind === 'pdf' ? ` · 物理 PDF 第 ${context.page} 页` : ' · Markdown 文档'}${selection.text ? '\n\n[用户选中的内容]\n' + selection.text : ''}${attached.length ? `\n\n[用户附上了 ${attached.length} 张图片]` : ''}${state.sideOf ? '\n\n[这是挂在主对话旁边的侧边对话：围绕引用的片段简短作答]' : ''}`
    const history = boundedHistory([...state.messages.filter(message => !message.failed && !message.compressed).map(({ role, content, sources, summary, ask }) => summary ? { role: 'user', content: `[此前对话的摘要，供参考]\n${content}` } : ({ role, content: content + (role === 'user' && ask?.quote ? `\n\n[读者引用的助手回答片段]\n${ask.quote}` : '') + (sources.length ? '\n[此前查到的相关位置]\n' + JSON.stringify(sources.slice(0, 8).map(item => ({ sourceId: item.sourceId, page: item.page, line: item.line, text: item.text.slice(0, 400) }))) : '') })), { ...user, content: wireContent }])
    // The scheduler reports the first queue position before the answer bubble exists.
    let waiting = ''
    ticket = scheduler.acquire({ owner: `${descriptor.id}:${state.id}`, provider: snapshot.provider, signal, onState: (value: any) => {
      if (!valid()) return
      request.phase = value.status
      waiting = value.status === 'queued' ? `等待中 · 队列第 ${value.position} 位` : '准备上下文'
      activity(waiting)
    } })
    const startedAt = Date.now()
    state.messages.push(user, { id: crypto.randomUUID(), role: 'assistant', content: '', reasoning: '', sources: [], startedAt, activity: waiting || '准备上下文', usage: { estimated: true, input: estimateTokens(history.map(item => item.content).join('\n')) } })
    answer = state.messages.at(-1)!
    if (!state.title) state.title = titleFrom(question)
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
    const options = { ...snapshot, apiKey, signal, messages: history,
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
      if (resource.context.pdf && !selection.text && !selection.image) {
        if (getModel(snapshot.provider, snapshot.model)?.vision !== false) {
          activity('查看当前页')
          const page = await documentSession.document.tool('pdf_view', { page: documentSession.seed.info.currentPage, block_id: null })
          signal.throwIfAborted()
          history.at(-1)!.images = [page.dataUrl]; user.images = [page.dataUrl]; state.messages.at(-2)!.images = [page.dataUrl]
        } else if (documentSession.seed.seed.noTextPages?.length) throw new Error('当前页没有文字层，所选模型不支持图片。请切换图片模型或手动提供文字。')
      }
      let retained = 0
      for (const message of [...state.messages].reverse()) { retained += (message.images || []).reduce((sum, image) => sum + image.length, 0); if (retained > 8 * 1024 * 1024) message.images = [] }
      activity('思考中')
      await streamDocumentChat(options, documentSession.document, documentSession.seed)
    } else await streamChat(options)
    if (valid()) { state.status = ''; noticeFinished(state, descriptor.title) }
  } catch (error: any) {
    if (answer) { answer.failed = true; answer.stopped = signal.aborted }
    if (state.request === request && entry.list.includes(state)) {
      state.error = !signal.aborted
      state.status = signal.aborted ? '' : error?.message || String(error)
    }
  } finally {
    if (answer) {
      answer.finishedAt = Date.now(); answer.activity = ''; state.updatedAt = answer.finishedAt
      if (answer.usage) recordUsage({ kind: state.sideOf ? 'side' : 'chat', provider: snapshot.provider, model: snapshot.model || '', ms: answer.finishedAt - (answer.startedAt || answer.finishedAt), estimated: answer.usage.estimated, input: answer.usage.input || 0, output: answer.usage.output || 0, reasoning: answer.usage.reasoning || 0 })
    }
    documentSession?.close()
    try { await resource?.close() } catch {}
    ticket?.release()
    if (state.request === request) state.request = null
    schedulePersist(descriptor.id)
  }
}

/**
 * Ask a question of the conversation again — regenerating an answer or sending an edited question.
 * The latest question is replaced in place; an earlier one continues in a new branch so nothing is lost.
 * Returns the conversation that carries the new answer.
 */
export function resendQuestion(descriptor: { id: string; title: string; kind: string }, conversationId: string, userMessageId: string, question: string, onSettings: () => void): string | undefined {
  const state = chatState(descriptor.id, conversationId)
  const index = state.messages.findIndex(message => message.id === userMessageId)
  const user = state.messages[index]
  if (!user || user.role !== 'user' || !question.trim()) return
  const lastUser = state.messages.map(message => message.role).lastIndexOf('user')
  let target = state
  if (index === lastUser) {
    if (state.request) return
    state.messages.splice(index)
    state.status = ''; state.error = false
  } else target = branchConversation(descriptor.id, state.id, index > 0 ? state.messages[index - 1].id : null)
  const ask = user.ask
  void sendChat(descriptor, { page: ask?.page || 1, selection: ask?.text ? { text: ask.text, page: ask.page } : {} }, onSettings, undefined, question.trim(), {
    conversationId: target.id, includeDocument: ask?.includeDocument ?? target.includeDocument, includeSelection: Boolean(ask?.text), selectionOnly: ask?.selectionOnly, images: user.images?.length ? [user.images[0]!] : undefined, attachments: user.images?.slice(1),
  })
  return target.id
}

/**
 * /compress：把这段对话里还没压缩过的问答交给模型写成一份摘要，之后的请求只带摘要和其后的消息。
 * 原来的消息仍留在界面上（标为已压缩），随时可以翻看。
 */
export async function compressConversation(descriptor: { id: string; title: string }, conversationId: string, instructions = '', signal: AbortSignal): Promise<void> {
  const state = chatState(descriptor.id, conversationId)
  const pending = state.messages.filter(message => !message.compressed && !(message.failed && !message.content))
  if (pending.filter(message => !message.summary).length < 2) throw new Error('对话还很短，不需要压缩。')
  const transcript = pending.map(message => `${message.summary ? '【此前的摘要】' : message.role === 'user' ? '读者' : '助手'}：${message.content.slice(0, 12000)}`).join('\n\n')
  const { complete } = await import('./complete')
  const summary = await complete({ kind: 'compress', signal, messages: [{ role: 'user', content: [
    `下面是读者与阅读助手围绕《${descriptor.title}》的一段对话。请把它压缩成一份简明的摘要，供之后继续对话时代替原文使用：`,
    '保留读者关心的问题、已经得出的结论、关键的定义 / 公式 / 页码引用，以及尚未解决的问题；去掉寒暄与重复。用读者使用的语言，分条列出，不超过 400 字。',
    instructions && `读者对摘要的额外要求：${instructions}`,
    `[对话]\n${transcript}`,
  ].filter(Boolean).join('\n\n') }] })
  signal.throwIfAborted()
  if (!summary.trim()) throw new Error('没有得到摘要，请稍后再试。')
  for (const message of pending) message.compressed = true
  state.messages.push({ id: crypto.randomUUID(), role: 'assistant', content: summary.trim(), sources: [], summary: true, finishedAt: Date.now() })
  state.updatedAt = Date.now()
  schedulePersist(descriptor.id)
}
