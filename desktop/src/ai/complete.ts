/**
 * 一次性的模型调用（翻译、/btw、/compress）：读当前 AI 设置，流式返回文字，并把用量记进账本。
 * fast：用小而快的模型（与问题预判相同的选择），翻译这类不需要深思的事用它。
 */
import { loadAiSettings, loadApiKey } from './settings.mjs'
import { fastModel } from './predict'
import { estimateTokens } from './workspace'
import { recordUsage, type UsageKind } from './usage'

export type CompleteOptions = { kind: UsageKind; messages: { role: 'user' | 'assistant' | 'system'; content: string }[]; fast?: boolean; signal: AbortSignal; onDelta?: (text: string, all: string) => void }

export async function complete(options: CompleteOptions): Promise<string> {
  const settings: any = loadAiSettings()
  const apiKey = settings.provider === 'codex' ? '' : await loadApiKey(settings.provider)
  const keyless = settings.provider === 'custom' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(settings.baseUrl || '')
  if (settings.provider !== 'codex' && !apiKey && !keyless) throw new Error('请先在设置里连接 AI 服务。')
  options.signal.throwIfAborted()
  const choice = options.fast ? fastModel(settings) : { model: settings.model || '', effort: settings.effort || '' }
  const { streamChat } = await import('./providers.mjs')
  let text = '', reported: { input?: number; output?: number; reasoning?: number } | undefined
  const started = Date.now()
  try {
    await streamChat({ ...settings, ...choice, apiKey, signal: options.signal, messages: options.messages,
      onDelta: (delta: string) => { text += delta; options.onDelta?.(delta, text) },
      onUsage: (usage: { input?: number; output?: number; reasoning?: number }) => { reported = { input: (reported?.input || 0) + (usage.input || 0), output: (reported?.output || 0) + (usage.output || 0), reasoning: (reported?.reasoning || 0) + (usage.reasoning || 0) } } })
  } finally {
    recordUsage({ kind: options.kind, provider: settings.provider, model: choice.model || settings.model || '', ms: Date.now() - started, estimated: !reported,
      input: reported?.input ?? estimateTokens(options.messages.map(item => item.content).join('\n')), output: reported?.output ?? estimateTokens(text), reasoning: reported?.reasoning || 0 })
  }
  return text
}
