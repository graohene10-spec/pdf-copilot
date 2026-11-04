/**
 * 机翻：选中文字后右键「机翻」或按 Ctrl+T，左侧的翻译栏里给出译文，按卡片排列，最近 40 条存在本机。
 * 默认用谷歌翻译（免 key、很快）；也可以换成有道智云（应用 ID + 密钥），或让 AI 模型翻译（慢一些，公式术语更讲究）。
 */
import { reactive, watch } from 'vue'

export type TranslateTarget = 'auto' | 'zh' | 'en' | 'ja'
export const TARGETS: { value: TranslateTarget; label: string }[] = [{ value: 'auto', label: '自动' }, { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, { value: 'ja', label: '日本語' }]
const NAMES: Record<Exclude<TranslateTarget, 'auto'>, string> = { zh: '简体中文', en: 'English', ja: '日本語' }
export type TranslateEngine = 'google' | 'google-api' | 'youdao' | 'ai'
export const ENGINES: { value: TranslateEngine; label: string }[] = [{ value: 'google', label: '谷歌' }, { value: 'google-api', label: '谷歌云' }, { value: 'youdao', label: '有道' }, { value: 'ai', label: 'AI' }]
export type Translation = { id: string; source: string; result: string; target: Exclude<TranslateTarget, 'auto'>; engine?: TranslateEngine; status: 'running' | 'done' | 'error'; error?: string; at: number
  /** 免密钥谷歌失败、自动改用已配好的服务时记下原因。 */
  fallback?: string }

const STORAGE_KEY = 'kaizhi.translate.v1'
const KEEP = 40
function load(): { items: Translation[]; target: TranslateTarget; engine: TranslateEngine } {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const items = Array.isArray(value.items) ? value.items.filter((item: any) => item && typeof item.source === 'string' && typeof item.result === 'string').map((item: any) => ({ ...item, status: item.status === 'running' ? 'error' : item.status, error: item.status === 'running' ? '上次关闭时还没翻完' : item.error })) : []
    return { items, target: TARGETS.some(item => item.value === value.target) ? value.target : 'auto', engine: ENGINES.some(item => item.value === value.engine) ? value.engine : 'google' }
  } catch { return { items: [], target: 'auto', engine: 'google' } }
}
const stored = load()
export const translator = reactive({ open: false, items: stored.items as Translation[], target: stored.target as TranslateTarget, engine: stored.engine as TranslateEngine })
watch(() => [translator.items.map(item => item.status + item.result.length).join(), translator.target, translator.engine], () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ target: translator.target, engine: translator.engine, items: translator.items.filter(item => item.status !== 'running').slice(-KEEP) })) } catch { /* 存不下就只留在内存里 */ }
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
export async function translate(text: string, target = translator.target): Promise<void> {
  const source = tidySource(text).slice(0, 8000)
  if (!source) return
  translator.open = true
  const engine = translator.engine
  const item = reactive<Translation>({ id: crypto.randomUUID(), source, result: '', target: resolveTarget(source, target), engine, status: 'running', at: Date.now() })
  translator.items.push(item)
  if (translator.items.length > KEEP) translator.items.splice(0, translator.items.length - KEEP)
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
  } finally { controllers.delete(item.id) }
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
