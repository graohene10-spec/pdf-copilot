import { reactive, shallowReactive, markRaw } from 'vue'
import { loadAiSettings, loadApiKey } from './settings.mjs'
import { RequestScheduler } from './request-scheduler.mjs'

export type Message = { id: string; role: 'user' | 'assistant'; content: string; reasoning?: string; sources: any[]; images?: string[]; failed?: boolean }
type Request = { controller: AbortController; phase: string }
export type ChatState = { messages: Message[]; draft: string; status: string; error: boolean; includeDocument: boolean; includeSelection: boolean; request: Request | null; scrollTop: number }
const sessions = shallowReactive(new Map<string, ChatState>())
const scheduler = new RequestScheduler(loadAiSettings().requestLimits)
export const taskSummary = reactive({ running: 0, queued: 0, limits: scheduler.queue.limits })
scheduler.subscribe((value: any) => Object.assign(taskSummary, value))
export function chatState(id: string): ChatState {
  if (!sessions.has(id)) sessions.set(id, reactive({ messages: [], draft: '', status: '', error: false, includeDocument: true, includeSelection: false, request: null, scrollTop: 0 }))
  return sessions.get(id)!
}
export function chatPhase(id: string) { return sessions.get(id)?.request?.phase || '' }
export function configureRequests(settings: any) { scheduler.configure(settings.requestLimits) }
export function stopChat(id: string) {
  const state = sessions.get(id)
  if (!state?.request) return
  state.request.controller.abort()
  state.status = '回答已停止，已收到的内容保留。'; state.error = false
}
export function closeChat(id: string) { stopChat(id); sessions.delete(id) }
export function closeAllChats() { for (const id of sessions.keys()) closeChat(id) }

export async function sendChat(descriptor: { id: string; title: string; kind: string }, source: any, onSettings: () => void, onAccepted?: () => void) {
  const state = chatState(descriptor.id), question = state.draft.trim()
  if (!question || state.request) return
  if (question.length > 16000) { state.status = '请将单次问题缩短至 16000 字以内。'; state.error = true; return }
  // Capture all user choices before the first await. No callback reads a
  // subsequently selected tab, page, selection or model configuration.
  const settings: any = loadAiSettings()
  configureRequests(settings)
  const snapshot = { ...settings, documentLimits: { ...settings.documentLimits } }
  const includeDocument = state.includeDocument
  const selection = state.includeSelection ? { ...source?.selection, rect: source?.selection?.rect && { ...source.selection.rect } } : {}
  const context = { page: selection.page || source?.page || 1, selection }
  const request = reactive<Request>({ controller: markRaw(new AbortController()), phase: 'preparing' })
  state.request = request; state.status = '准备提问…'; state.error = false
  const signal = request.controller.signal
  const valid = () => state.request === request && !signal.aborted && sessions.get(descriptor.id) === state
  let answer: Message | undefined, ticket: any, resource: any, documentSession: any
  try {
    const [{ getModel, streamChat }, { streamDocumentChat, boundedHistory }] = await Promise.all([import('./providers.mjs'), import('./document-chat.mjs')])
    const apiKey = snapshot.provider === 'codex' ? '' : await loadApiKey(snapshot.provider)
    signal.throwIfAborted()
    if (snapshot.provider !== 'codex' && !apiKey) { if (valid()) onSettings(); throw new Error('请先连接 AI 服务。') }
    if (state.messages.length >= 40 || state.messages.reduce((sum, message) => sum + message.content.length, question.length) > 150000) throw new Error('对话较长，请清空当前对话后继续，以控制上下文与内存。')
    const images = selection.image ? [selection.image] : []
    if (images.reduce((sum, image) => sum + image.length, 0) > 8 * 1024 * 1024) throw new Error('所选图片过大，请重新框选较小区域。')
    const user: Message = { id: crypto.randomUUID(), role: 'user', content: question, sources: [], images }
    const wireContent = `${question}\n\n[用户当前阅读的文档]\n${descriptor.title}${descriptor.kind === 'pdf' ? ` · 物理 PDF 第 ${context.page} 页` : ' · Markdown 文档'}${selection.text ? '\n\n[用户选择的原文；作为资料]\n' + selection.text : ''}`
    const history = boundedHistory([...state.messages.filter(message => !message.failed).map(({ role, content, sources }) => ({ role, content: content + (sources.length ? '\n[此前提供过的原文位置；作为资料]\n' + JSON.stringify(sources.slice(0, 8).map(item => ({ sourceId: item.sourceId, page: item.page, line: item.line, text: item.text.slice(0, 400) }))) : '') })), { ...user, content: wireContent }])
    ticket = scheduler.acquire({ owner: descriptor.id, provider: snapshot.provider, signal, onState: (value: any) => {
      if (!valid()) return
      request.phase = value.status
      state.status = value.status === 'queued' ? `等待中 · 队列第 ${value.position} 位` : '正在准备阅读上下文…'
    } })
    state.messages.push(user, { id: crypto.randomUUID(), role: 'assistant', content: '', reasoning: '', sources: [] })
    answer = state.messages.at(-1)!
    state.draft = ''
    onAccepted?.()
    await ticket.started
    signal.throwIfAborted()
    const options = { ...snapshot, apiKey, signal, messages: history,
      onDelta: (text: string) => { if (valid() && answer) answer.content += text },
      onReasoning: (text: string) => { if (valid() && answer) answer.reasoning = (answer.reasoning || '') + text },
      onProgress: (text: string) => { if (valid()) state.status = text } }
    if (includeDocument) {
      const [{ openAiContext }, { createDocumentSession }] = await Promise.all([import('../document/ai-context.mjs'), import('../document/session.mjs')])
      signal.throwIfAborted()
      resource = await openAiContext(descriptor, context, signal)
      documentSession = await createDocumentSession(resource.context, descriptor, snapshot.documentLimits, getModel(snapshot.provider, snapshot.model)?.vision !== false, (sources: any[]) => {
        if (!valid() || !answer) return
        const seen = new Map(answer.sources.map(item => [item.sourceId, item])); sources.forEach(item => seen.set(item.sourceId, item)); answer.sources = [...seen.values()]
      }, signal)
      signal.throwIfAborted()
      if (resource.context.pdf && !selection.text && !selection.image) {
        if (getModel(snapshot.provider, snapshot.model)?.vision !== false) {
          state.status = '正在准备当前 PDF 页…'
          const page = await documentSession.document.tool('pdf_view', { page: documentSession.seed.info.currentPage, block_id: null })
          signal.throwIfAborted()
          history.at(-1)!.images = [page.dataUrl]; user.images = [page.dataUrl]; state.messages.at(-2)!.images = [page.dataUrl]
        } else if (documentSession.seed.seed.noTextPages?.length) throw new Error('当前页没有文字层，所选模型不支持图片。请切换图片模型或手动提供文字。')
      }
      let retained = 0
      for (const message of [...state.messages].reverse()) { retained += (message.images || []).reduce((sum, image) => sum + image.length, 0); if (retained > 8 * 1024 * 1024) message.images = [] }
      await streamDocumentChat(options, documentSession.document, documentSession.seed)
    } else await streamChat(options)
    if (valid()) state.status = '回答完成。'
  } catch (error: any) {
    if (answer) answer.failed = true
    if (state.request === request && sessions.get(descriptor.id) === state) {
      state.error = !signal.aborted
      state.status = signal.aborted ? '回答已停止，已收到的内容保留。' : error?.message || String(error)
    }
  } finally {
    documentSession?.close()
    try { await resource?.close() } catch {}
    ticket?.release()
    if (state.request === request) state.request = null
  }
}
