/**
 * 预判读者的下一个问题（像 Codex / Claude Code 的输入建议）：输入框空着、且有上下文时，
 * 让一个小而快的模型读一下当前页、选区和最近的对话，给出一句最可能的问题。
 * 结果按上下文缓存；任何新输入、发送或上下文变化都会取消在途请求。
 */
import { loadAiSettings, loadApiKey } from './settings.mjs'
import { nativeModelInventory } from './native-models.ts'

export type PredictContext = {
  document: { id: string; title: string; kind: string }
  page: number
  /** 文档上下文开关关着时不读当前页原文，只用选区和对话。 */
  includePage?: boolean
  selection?: string
  history: { role: string; content: string }[]
}

const cache = new Map<string, string>()
const remember = (key: string, value: string) => { cache.delete(key); cache.set(key, value); if (cache.size > 60) cache.delete(cache.keys().next().value!) }

// 小模型：DeepSeek 用 Flash、OpenAI 用 Mini，都关闭思考；Codex 用当前模型的最低思考强度。
export function fastModel(settings: any): { model: string; effort: string } {
  if (settings.provider === 'deepseek') return { model: 'deepseek-flash', effort: 'none' }
  if (settings.provider === 'openai') return { model: 'gpt-5.4-mini', effort: 'none' }
  const efforts: string[] = nativeModelInventory.value.find((item: any) => item.id === (settings.model || ''))?.efforts || []
  return { model: settings.model || '', effort: ['none', 'minimal', 'low'].find(item => efforts.includes(item)) || '' }
}

// 阅读位置的原文：同一份文档只打开一次，空闲 90 秒后释放。
let source: { id: string; pdf?: any; text?: string; close: () => Promise<void> | void; timer?: ReturnType<typeof setTimeout> } | undefined
async function pageText(document: PredictContext['document'], page: number) {
  if (source?.id !== document.id) {
    const previous = source; source = undefined
    void previous?.close()
    const { openAiContext } = await import('../document/ai-context.mjs')
    const resource = await openAiContext(document, { page }, new AbortController().signal)
    source = { id: document.id, pdf: resource.context.pdf, text: resource.context.text, close: resource.close }
  }
  const current = source!
  clearTimeout(current.timer)
  current.timer = setTimeout(() => { if (source === current) { source = undefined; void current.close() } }, 90_000)
  if (current.text !== undefined) return current.text.split('\n').slice(Math.max(0, page - 1), page + 80).join('\n').slice(0, 1800)
  const proxy = await current.pdf.getPage(Math.min(Math.max(1, page), current.pdf.numPages))
  const content = await proxy.getTextContent()
  return content.items.map((item: any) => item.str || '').join(' ').replace(/\s+/g, ' ').trim().slice(0, 1800)
}

/** Keeps the first line of the reply as a single question; drops quotes, numbering and labels. */
export function cleanQuestion(text: string) {
  const line = text.replace(/\r/g, '').split('\n').map(item => item.trim()).find(Boolean) || ''
  const question = line.replace(/^(问题|预测|question)\s*[:：]\s*/i, '').replace(/^[-*•\d.、)\s]+/, '').replace(/^["“'‘「『]+|["”'’」』]+$/g, '').trim()
  return question.length > 120 ? '' : question
}

export function predictionKey(context: PredictContext) {
  const last = context.history.at(-1)
  return [context.document.id, context.page, context.includePage === false ? 'no-page' : 'page', (context.selection || '').slice(0, 160), context.history.length, last?.content.length || 0].join('|')
}

export async function predictQuestion(context: PredictContext, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const key = predictionKey(context)
  if (cache.has(key)) return cache.get(key)!
  const settings: any = loadAiSettings()
  const apiKey = settings.provider === 'codex' ? '' : await loadApiKey(settings.provider)
  if (settings.provider !== 'codex' && !apiKey) return ''
  signal.throwIfAborted()
  const text = context.includePage === false ? '' : await pageText(context.document, context.page).catch(() => '')
  signal.throwIfAborted()
  const recent = context.history.slice(-4).map(item => `${item.role === 'user' ? '读者' : '助手'}：${item.content.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')
  const prompt = [
    '请预判这位读者接下来最可能向阅读助手提出的一个问题。只输出这个问题本身：一句话、具体、不超过 40 个字，使用读者使用的语言；不要解释、编号或引号。',
    `[文档] 《${context.document.title}》${context.document.kind === 'pdf' ? ` 第 ${context.page} 页` : ''}`,
    text && `[当前阅读位置的原文节选]\n${text}`,
    context.selection && `[读者选中的文字]\n${context.selection.slice(0, 800)}`,
    recent && `[最近的对话]\n${recent}`,
  ].filter(Boolean).join('\n\n')
  const { streamChat } = await import('./providers.mjs')
  signal.throwIfAborted()
  let reply = ''
  const local = new AbortController()
  const stop = () => local.abort()
  signal.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(stop, 25_000)
  try {
    await streamChat({ ...settings, ...fastModel(settings), apiKey, signal: local.signal, messages: [{ role: 'user', content: prompt }],
      onDelta: (delta: string) => { reply += delta; if (reply.length > 200 || reply.includes('\n')) local.abort() } })
  } catch (error) {
    // 读到第一行后主动停下也算成功；其他失败（没网、额度）就不显示建议。
    if (!reply || signal.aborted) throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', stop) }
  signal.throwIfAborted()
  const question = cleanQuestion(reply)
  if (question) remember(key, question)
  return question
}
