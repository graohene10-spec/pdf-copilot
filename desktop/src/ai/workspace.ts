import { reactive, shallowReactive, markRaw } from 'vue'
import { loadAiSettings, loadApiKey } from './settings.mjs'
import { RequestScheduler } from './request-scheduler.mjs'
import { library } from '../sdk'

export type Usage = { input?: number; output?: number; reasoning?: number; estimated: boolean }
export type Message = {
  id: string; role: 'user' | 'assistant'; content: string; reasoning?: string; sources: any[]; images?: string[]; failed?: boolean
  /** Live progress of an answer: wall-clock timing, token use and the current activity line. */
  startedAt?: number; firstTokenAt?: number; finishedAt?: number; usage?: Usage; activity?: string; stopped?: boolean
}
type Request = { controller: AbortController; phase: string }
export type ChatState = {
  id: string; documentId: string; title: string; createdAt: number; updatedAt: number
  messages: Message[]; draft: string; status: string; error: boolean; includeDocument: boolean; includeSelection: boolean; request: Request | null; scrollTop: number
}
type DocumentChats = { list: ChatState[]; activeId: string; loaded: boolean; loading?: Promise<void> }

const documents = shallowReactive(new Map<string, DocumentChats>())
const scheduler = new RequestScheduler(loadAiSettings().requestLimits)
export const taskSummary = reactive({ running: 0, queued: 0, limits: scheduler.queue.limits })
scheduler.subscribe((value: any) => Object.assign(taskSummary, value))

const STORAGE_PREFIX = 'ai.conversations.v1.'
const MAX_STORED_CONVERSATIONS = 40
const MAX_MESSAGES = 60

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
  return [...chats(documentId).list].sort((a, b) => b.updatedAt - a.updatedAt)
}
export function activeConversationId(documentId: string) { return chats(documentId).activeId }
export function selectConversation(documentId: string, conversationId: string) {
  const entry = chats(documentId)
  if (entry.list.some(item => item.id === conversationId)) entry.activeId = conversationId
}
/** Start a fresh conversation, reusing an untouched empty one. */
export function newConversation(documentId: string): ChatState {
  const entry = chats(documentId)
  const empty = entry.list.find(item => !item.messages.length && !item.request)
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
  entry.list = entry.list.filter(item => item !== conversation)
  if (!entry.list.length) entry.list.push(blank(documentId))
  if (entry.activeId === conversationId) entry.activeId = [...entry.list].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
  schedulePersist(documentId)
}
export function chatPhase(documentId: string) {
  const entry = documents.get(documentId)
  return entry?.list.find(item => item.request)?.request?.phase || ''
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
  return JSON.stringify({ activeId: entry.activeId, list: entry.list.filter(item => item.messages.length).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_STORED_CONVERSATIONS).map(item => ({
    id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt,
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
        Object.assign(conversation, { id: item.id, title: String(item.title || ''), createdAt: Number(item.createdAt) || Date.now(), updatedAt: Number(item.updatedAt) || Date.now(),
          messages: item.messages.filter((message: any) => message && (message.role === 'user' || message.role === 'assistant')).map((message: any) => ({ ...message, content: String(message.content || ''), sources: Array.isArray(message.sources) ? message.sources : [] })) })
        entry.list.push(conversation)
      }
      // Reopen the conversation last used for this document if nothing has started yet.
      const current = entry.list.find(item => item.id === entry.activeId)
      if (current && !current.messages.length && stored?.activeId && entry.list.some(item => item.id === stored.activeId)) {
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
    if (message.failed && !message.content) continue
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

type SendOptions = { conversationId?: string; includeDocument?: boolean; includeSelection?: boolean }
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
  const selection = includeSelection ? { ...source?.selection, rect: source?.selection?.rect && { ...source.selection.rect } } : {}
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
    if (snapshot.provider !== 'codex' && !apiKey) { if (valid()) onSettings(); throw new Error('请先连接 AI 服务。') }
    if (state.messages.length >= MAX_MESSAGES || state.messages.reduce((sum, message) => sum + message.content.length, question.length) > 150000) throw new Error('这段对话已经很长，请新建对话继续，以控制上下文与内存。')
    const images = selection.image ? [selection.image] : []
    if (images.reduce((sum, image) => sum + image.length, 0) > 8 * 1024 * 1024) throw new Error('所选图片过大，请重新框选较小区域。')
    const user: Message = { id: crypto.randomUUID(), role: 'user', content: question, sources: [], images }
    // Without document context the request carries only the question and what the user selected.
    const wireContent = includeDocument
      ? `${question}\n\n[用户当前阅读的文档]\n${descriptor.title}${descriptor.kind === 'pdf' ? ` · 物理 PDF 第 ${context.page} 页` : ' · Markdown 文档'}${selection.text ? '\n\n[用户选择的原文；作为资料]\n' + selection.text : ''}`
      : `${question}${selection.text ? '\n\n[用户选择的原文；作为资料]\n' + selection.text : ''}${selection.image ? '\n\n[附图是用户在文档中框选的区域，只针对该区域回答]' : ''}`
    const history = boundedHistory([...state.messages.filter(message => !message.failed).map(({ role, content, sources }) => ({ role, content: content + (sources.length ? '\n[此前提供过的原文位置；作为资料]\n' + JSON.stringify(sources.slice(0, 8).map(item => ({ sourceId: item.sourceId, page: item.page, line: item.line, text: item.text.slice(0, 400) }))) : '') })), { ...user, content: wireContent }])
    // The scheduler reports the first queue position before the answer bubble exists.
    let waiting = ''
    ticket = scheduler.acquire({ owner: descriptor.id, provider: snapshot.provider, signal, onState: (value: any) => {
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
        answer.activity = `查阅原文 · ${answer.sources.length} 段`
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
    if (valid()) state.status = ''
  } catch (error: any) {
    if (answer) { answer.failed = true; answer.stopped = signal.aborted }
    if (state.request === request && entry.list.includes(state)) {
      state.error = !signal.aborted
      state.status = signal.aborted ? '' : error?.message || String(error)
    }
  } finally {
    if (answer) { answer.finishedAt = Date.now(); answer.activity = ''; state.updatedAt = answer.finishedAt }
    documentSession?.close()
    try { await resource?.close() } catch {}
    ticket?.release()
    if (state.request === request) state.request = null
    schedulePersist(descriptor.id)
  }
}
