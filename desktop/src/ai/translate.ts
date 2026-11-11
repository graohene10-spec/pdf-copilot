/**
 * 机翻：选中文字后右键「机翻」或按 Ctrl+T，左侧的翻译栏里给出译文，按卡片排列，最近 40 条存在本机。
 * 默认用 AI 翻译（公式术语更讲究）；也可以换成谷歌（免 key、很快）、谷歌云或有道智云。
 */
import { reactive, watch } from 'vue'
import { loadAiSettings, translationSettings } from './settings.mjs'

export type TranslateTarget = 'auto' | 'zh' | 'en' | 'ja'
export const TARGETS: { value: TranslateTarget; label: string }[] = [{ value: 'auto', label: '自动' }, { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, { value: 'ja', label: '日本語' }]
const NAMES: Record<Exclude<TranslateTarget, 'auto'>, string> = { zh: '简体中文', en: 'English', ja: '日本語' }
export type TranslateEngine = 'google' | 'google-api' | 'youdao' | 'ai'
export const ENGINES: { value: TranslateEngine; label: string }[] = [{ value: 'google', label: '谷歌' }, { value: 'google-api', label: '谷歌云' }, { value: 'youdao', label: '有道' }, { value: 'ai', label: 'AI' }]
export type Translation = { id: string; source: string; result: string; target: Exclude<TranslateTarget, 'auto'>; engine?: TranslateEngine; status: 'running' | 'done' | 'error'; error?: string; at: number
  /** 免密钥谷歌失败、自动改用已配好的服务时记下原因。 */
  fallback?: string
  /** 从发出到译完用了多久（毫秒）。 */
  ms?: number
  /** AI 翻译用的服务商、模型与强度；用来判断同一段文字是不是已经用同一套翻过。 */
  via?: string
  /** 译文取自刚才翻过的同一段文字，没有再请求一次。 */
  cached?: boolean }

const STORAGE_KEY = 'kaizhi.translate.v1'
const KEEP = 40
function load(): { items: Translation[]; target: TranslateTarget; engine: TranslateEngine; auto: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const items = Array.isArray(value.items) ? value.items.filter((item: any) => item && typeof item.source === 'string' && typeof item.result === 'string').map((item: any) => ({ ...item, status: item.status === 'running' ? 'error' : item.status, error: item.status === 'running' ? '上次关闭时还没翻完' : item.error })) : []
    return { items, target: TARGETS.some(item => item.value === value.target) ? value.target : 'auto', engine: ENGINES.some(item => item.value === value.engine) ? value.engine : 'ai', auto: value.auto === true }
  } catch { return { items: [], target: 'auto', engine: 'ai', auto: false } }
}
const stored = load()
export const translator = reactive({ open: false, items: stored.items as Translation[], target: stored.target as TranslateTarget, engine: stored.engine as TranslateEngine,
  /** 翻译模式：选中文字后自动翻译，译文显示在鼠标旁。 */
  auto: stored.auto })
watch(() => [translator.items.map(item => item.status + item.result.length).join(), translator.target, translator.engine, translator.auto], () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ target: translator.target, engine: translator.engine, auto: translator.auto, items: translator.items.filter(item => item.status !== 'running').slice(-KEEP) })) } catch { /* 存不下就只留在内存里 */ }
})

/** PDF 选中的文字每行都断开：段内换行接起来（中文直接接，西文补一个空格），空行保留为分段。 */
export function tidySource(text: string) {
  return text.replace(/\r/g, '').split(/\n\s*\n/).map(block => block.split('\n').map(line => line.trim()).filter(Boolean).reduce((all, line) => {
    if (!all) return line
    if (all.endsWith('-') && /^[a-z]/.test(line)) return all.slice(0, -1) + line
    return /[　-鿿＀-￯]$/.test(all) || /^[　-鿿＀-￯]/.test(line) ? all + line : `${all} ${line}`
  }, '')).filter(Boolean).join('\n\n').trim()
}
/** 自动：原文以中日文为主就译成英文，否则译成中文。 */
export function resolveTarget(text: string, target: TranslateTarget): Exclude<TranslateTarget, 'auto'> {
  if (target !== 'auto') return target
  const cjk = text.match(/[぀-ヿ㐀-鿿]/g)?.length || 0, letters = text.match(/[A-Za-z぀-ヿ㐀-鿿]/g)?.length || 1
  return cjk / letters > .3 ? 'en' : 'zh'
}
export function translationPrompt(text: string, target: Exclude<TranslateTarget, 'auto'>) {
  return `你是专业的学术翻译。把下面的文字翻译成${NAMES[target]}。只输出译文：保留段落、列表与 LaTeX 公式（$...$）原样，术语译准；专有名词第一次出现时可在括号里附上原文。不要解释，不要加引号。\n\n${text}`
}

const controllers = new Map<string, AbortController>()
function aiVia() { const settings: any = translationSettings(loadAiSettings()); return [settings.provider, settings.baseUrl || '', settings.model || '', settings.effort || ''].join('|') }
/** fresh：不用上次的译文，重新请求（「重新翻译」按钮）。 */
/** quiet：不打开翻译栏（翻译模式的浮窗用）；onItem：拿到这次翻译的卡片，译文会流式写进去。 */
export async function translate(text: string, target = translator.target, fresh = false, options: { quiet?: boolean; onItem?: (item: Translation) => void } = {}): Promise<void> {
  const source = tidySource(text).slice(0, 8000)
  if (!source) return
  if (!options.quiet) translator.open = true
  const engine = translator.engine
  const via = engine === 'ai' ? aiVia() : undefined
  const resolved = resolveTarget(source, target)
  // 同一段文字、同一种语言、同一套服务刚翻过：直接用上次的译文，不再等一次模型。
  const earlier = fresh ? undefined : [...translator.items].reverse().find(old => old.status === 'done' && Boolean(old.result) && !old.fallback && old.source === source && old.target === resolved && old.engine === engine && old.via === via)
  const item = reactive<Translation>({ id: crypto.randomUUID(), source, result: earlier?.result || '', target: resolved, engine, status: earlier ? 'done' : 'running', at: Date.now(), via, ...(earlier ? { cached: true } : {}) })
  translator.items.push(item)
  options.onItem?.(item)
  if (translator.items.length > KEEP) translator.items.splice(0, translator.items.length - KEEP)
  if (earlier) return
  const controller = new AbortController()
  controllers.set(item.id, controller)
  try {
    if (engine === 'ai') {
      const { complete } = await import('./complete')
      await complete({ kind: 'translate', fast: true, signal: controller.signal, messages: [{ role: 'user', content: translationPrompt(source, item.target) }], onDelta: (_delta, all) => { item.result = all } })
    } else {
      const { machineTranslate } = await import('./machine-translate')
      const run = async (which: Exclude<TranslateEngine, 'ai'>) => machineTranslate(which, source, item.target, controller.signal, await credential(which), all => { item.result = all })
      try { item.result = await run(engine) }
      catch (error: any) {
        // 免密钥谷歌被墙或被限流时，配好了谷歌云或有道就自动换过去，卡片上注明原因。
        const backup = engine === 'google' && !controller.signal.aborted ? (await credential('google-api') ? 'google-api' : await credential('youdao') ? 'youdao' : null) : null
        if (!backup) throw error
        item.fallback = error?.message || String(error)
        item.engine = backup
        item.result = await run(backup)
      }
    }
    item.status = 'done'
  } catch (error: any) {
    item.status = item.result && controller.signal.aborted ? 'done' : 'error'
    if (item.status === 'error') item.error = controller.signal.aborted ? '已停止' : error?.message || String(error)
  } finally { controllers.delete(item.id); item.ms = Date.now() - item.at }
}
export function stopTranslation(id: string) { controllers.get(id)?.abort() }
export function removeTranslation(id: string) { stopTranslation(id); const index = translator.items.findIndex(item => item.id === id); if (index >= 0) translator.items.splice(index, 1) }
export function clearTranslations() { for (const id of controllers.keys()) stopTranslation(id); translator.items.splice(0) }

/** 各翻译服务的密钥，桌面版加密保存在本机：谷歌云是 API 密钥，有道是「应用 ID\n应用密钥」。 */
export async function credential(engine: Exclude<TranslateEngine, 'ai'>): Promise<string> {
  if (engine === 'google') return ''
  const { loadApiKey } = await import('./settings.mjs')
  return (await loadApiKey(engine === 'google-api' ? 'google' : 'youdao').catch(() => '')) || ''
}
export async function saveCredential(engine: 'google-api' | 'youdao', value: string) {
  const { saveCredential: save } = await import('./settings.mjs')
  await save(engine === 'google-api' ? 'google' : 'youdao', value.trim())
}
