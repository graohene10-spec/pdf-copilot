/**
 * 一次性的模型调用（翻译、/btw、/compress）：读当前 AI 设置，流式返回文字，并把用量记进账本。
 * fast：用小而快的模型（与问题预判相同的选择），翻译这类不需要深思的事用它。
 */
import { loadAiSettings, loadApiKey, translationSettings, explainSettings } from './settings.mjs'
import { fastModel } from './predict'
import { estimateTokens } from './workspace'
import { recordUsage, type UsageKind } from './usage'
import { concreteChoice } from './translate-model'
import { nativeModelInventory, registerNativeModelInventory } from './native-models'

/** 翻译一定用具体的模型与强度：Codex 还没读过模型列表就先读一次，不把空模型交给 Codex 的默认配置。 */
async function translationChoice(settings: any, what = '翻译') {
  const { getProvider, getNativeModels } = await import('./providers.mjs')
  let models: any[] = settings.provider === 'codex' ? nativeModelInventory.value : getProvider(settings.provider)?.models || []
  if (settings.provider === 'codex' && !models.length) { models = await getNativeModels(); registerNativeModelInventory(models) }
  const choice = concreteChoice(models, settings.model || '', settings.effort || '', getProvider(settings.provider)?.defaultModel, settings.provider !== 'codex')
  if (!choice.model) throw new Error(`请先在 设置 → AI → ${what}用的 AI 里选一个模型。`)
  return choice
}

// 翻译用的连接预热：提前和服务商握手（TCP + TLS），真正翻译时直接复用，不必再等建连。
const warmed = new Map<string, number>()
const WARM_FOR = 240_000
function originOf(baseUrl: string) { try { return new URL(baseUrl).origin } catch { return '' } }
/** 只发一个不带密钥的小请求；连接留在 Rust 端的连接池里。浏览器预览里不做（跨域只会报错）。 */
export function warmTranslation() {
  if (!(globalThis as any).__TAURI_INTERNALS__) return
  const settings: any = translationSettings(loadAiSettings())
  const origin = settings.provider === 'codex' ? '' : originOf(settings.baseUrl || '')
  if (!origin || Date.now() - (warmed.get(origin) || 0) < WARM_FOR) return
  warmed.set(origin, Date.now())
  void (async () => {
    try {
      const { transportFetch } = await import('./transport.mjs')
      const response = await transportFetch(String(settings.baseUrl).replace(/\/+$/, '') + '/models', { method: 'GET', signal: AbortSignal.timeout(8000) })
      await response.text()
    } catch { warmed.delete(origin) }
  })()
}

export type CompleteOptions = { kind: UsageKind; messages: { role: 'user' | 'assistant' | 'system'; content: string }[]; fast?: boolean; signal: AbortSignal; onDelta?: (text: string, all: string) => void; onReasoning?: (text: string) => void }

export async function complete(options: CompleteOptions): Promise<string> {
  // 翻译有自己的一套（可与阅读助手共用服务商），其余沿用阅读助手的设置。
  const own = options.kind === 'translate' || options.kind === 'explain'
  const settings: any = options.kind === 'translate' ? translationSettings(loadAiSettings()) : options.kind === 'explain' ? explainSettings(loadAiSettings()) : loadAiSettings()
  const apiKey = settings.provider === 'codex' ? '' : await loadApiKey(settings.provider)
  const keyless = settings.provider === 'custom' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(settings.baseUrl || '')
  if (settings.provider !== 'codex' && !apiKey && !keyless) throw new Error('请先在设置里连接 AI 服务。')
  options.signal.throwIfAborted()
  const choice = own ? await translationChoice(settings, options.kind === 'explain' ? '快速解释' : '翻译')
    : options.fast ? fastModel(settings) : { model: settings.model || '', effort: settings.effort || '' }
  const { streamChat } = await import('./providers.mjs')
  let text = '', reported: { input?: number; output?: number; reasoning?: number } | undefined
  const started = Date.now()
  try {
    await streamChat({ ...settings, ...choice, fast: own ? settings.fast : options.fast ? false : settings.fast, apiKey, signal: options.signal, messages: options.messages,
      onDelta: (delta: string) => { text += delta; options.onDelta?.(delta, text) }, onReasoning: (delta: string) => options.onReasoning?.(delta),
      onUsage: (usage: { input?: number; output?: number; reasoning?: number }) => { reported = { input: (reported?.input || 0) + (usage.input || 0), output: (reported?.output || 0) + (usage.output || 0), reasoning: (reported?.reasoning || 0) + (usage.reasoning || 0) } } })
    // 刚用过的连接还在池里，不必马上再预热。
    if (options.kind === 'translate') { const origin = originOf(settings.baseUrl || ''); if (origin) warmed.set(origin, Date.now()) }
  } finally {
    recordUsage({ kind: options.kind, provider: settings.provider, model: choice.model || settings.model || '', ms: Date.now() - started, estimated: !reported,
      input: reported?.input ?? estimateTokens(options.messages.map(item => item.content).join('\n')), output: reported?.output ?? estimateTokens(text), reasoning: reported?.reasoning || 0 })
  }
  return text
}
