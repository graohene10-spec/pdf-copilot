<script setup lang="ts">
// AI 设置分两步：先把要用的服务连上（各家的 API Key、本机 Codex 的登录），再给每个功能挑一个模型。
import { ref, reactive, computed, onBeforeUnmount } from 'vue'
import { PROVIDERS, PROTOCOLS, getProvider } from '../ai/providers.mjs'
import { nativeModelInventory, codexCheck, checkCodex } from '../ai/native-models'
import { loadAiSettings, loadApiKey, saveAiSettings, saveCredential, supportsFast, TRANSLATION_DEFAULTS, EXPLAIN_DEFAULTS, VISUAL_DEFAULTS, ASK_DEFAULTS } from '../ai/settings.mjs'
import { concreteChoice } from '../ai/translate-model'
import { codexTimings } from '../ai/native.mjs'
import { DOCUMENT_LIMIT_FIELDS } from '../../../extension/common/document-limits.mjs'
import { apiOrigin } from '../../../extension/common/settings.js'
import { normalizeRequestLimits } from '../../../extension/common/request-queue.mjs'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ saved: [value: any]; close: [] }>()
const settings = ref<any>(loadAiSettings())
const main = settings.value
// 以前翻译、快速解释可以「跟着」别的功能走；现在每个功能各选各的，先把跟着的那一份抄过来。
const tr0 = { ...TRANSLATION_DEFAULTS, ...(main.translation || {}) }
if (tr0.share) Object.assign(tr0, { share: false, provider: main.provider, baseUrl: main.baseUrl, protocol: main.protocol })
const ex0 = { ...EXPLAIN_DEFAULTS, ...(main.explain || {}) }
if (ex0.share !== 'own') { const from = ex0.share === 'translation' ? tr0 : main; Object.assign(ex0, { share: 'own', provider: from.provider, baseUrl: from.baseUrl, protocol: from.protocol }) }
main.translation = tr0; main.explain = ex0
main.visual = { ...VISUAL_DEFAULTS, ...(main.visual || {}) }
main.ask = { ...ASK_DEFAULTS, ...(main.ask || {}) }
// 每家服务的地址和协议各记一份，功能只管选哪一家。
const connections = reactive<Record<string, { baseUrl: string; protocol: string }>>({})
for (const item of PROVIDERS as any[]) connections[item.id] = { baseUrl: main.connections?.[item.id]?.baseUrl || item.baseUrl || '', protocol: main.connections?.[item.id]?.protocol || item.protocol || 'chat' }
for (const used of [main, tr0, ex0, ...(main.visual.share === 'own' ? [main.visual] : []), ...(main.ask.share === 'own' ? [main.ask] : [])]) if (used.provider && used.provider !== 'codex' && used.baseUrl && connections[used.provider]) Object.assign(connections[used.provider]!, { baseUrl: used.baseUrl, protocol: used.protocol || connections[used.provider]!.protocol })
const keys = reactive<Record<string, string>>({})
const keyEdited = new Set<string>()
const status = ref('')
const error = ref(false)
const saving = ref(false)
const refreshing = computed(() => codexCheck.state === 'checking')
const keysLoading = ref(true)
const edited = ref(false)
function markEdited() { edited.value = true }
const nativeModels = nativeModelInventory
const codexStatus = computed(() => codexCheck.text)
// 最近几次 Codex 提问各阶段的耗时（只有数字、模型名和引擎版本）：慢的时候看得出慢在建会话、提交还是等模型。
const timings = ref<any[]>(codexTimings())
const seconds = (ms: number) => ms < 0 ? '—' : `${(ms / 1000).toFixed(1)} 秒`
const timingLine = computed(() => {
  const last = timings.value[0]
  if (!last) return ''
  const bridge = last.bridge || {}
  return `最近一次 ${last.model || '默认模型'}${last.speed ? ` · ${last.speed}` : ''}${bridge.transport === 'http' ? ' · HTTP 直连' : ''}：首字 ${seconds(last.answerMs)}（${bridge.prepared ? '会话已备好' : `建会话 ${seconds(bridge.threadMs ?? -1)}`}，提交到出字 ${seconds(bridge.answerMs >= 0 && bridge.turnMs >= 0 ? bridge.answerMs - bridge.turnMs : -1)}），共 ${seconds(last.totalMs)}`
})
const timingCopied = ref(false)
async function copyTimings() {
  timings.value = codexTimings()
  try { await navigator.clipboard.writeText(JSON.stringify(timings.value, null, 1)); timingCopied.value = true; setTimeout(() => { timingCopied.value = false }, 1600) } catch { /* 剪贴板不可用 */ }
}
const codexReady = computed(() => nativeModels.value.length > 0)
let disposed = false
void Promise.all((PROVIDERS as any[]).filter(item => item.id !== 'codex').map(async item => { try { const value = await loadApiKey(item.id); if (!keyEdited.has(item.id)) keys[item.id] = value || '' } catch { keys[item.id] ||= '' } })).finally(() => { keysLoading.value = false })
const local = (id: string) => id === 'custom' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(connections[id]?.baseUrl || '')
const connected = (id: string) => id === 'codex' ? codexReady.value : Boolean(keys[id]) || local(id)
// 检查是全应用共用的一件事（启动时已经自动跑过一次）；这里只管查完后把用 Codex 的那几格落到实际的模型上。
async function refreshNative() {
  if (disposed) return
  if (await checkCodex() && !disposed) for (const slot of slots) if (slot.target.provider === 'codex') settle(slot)
}
onBeforeUnmount(() => { disposed = true })

// ---- 每个功能用哪个模型 ----
type Slot = { id: string; label: string; note: string; target: any; follow?: boolean }
const slots: Slot[] = [
  { id: 'assistant', label: '阅读助手', note: '对话、框选提问、/btw', target: main },
  { id: 'translation', label: '翻译', note: '划词翻译、翻译窗口', target: main.translation },
  { id: 'explain', label: '快速解释', note: '中键解释、深入 / 简化 / 举例', target: main.explain },
  { id: 'visual', label: '可视化讲解', note: '快速解释里的 Intelligent UI', target: main.visual, follow: true },
  { id: 'ask', label: '自由提问', note: '双击解释卡片的标题提问', target: main.ask, follow: true },
]
const following = (slot: Slot) => Boolean(slot.follow) && slot.target.share === 'assistant'
const modelsOf = (id: string): any[] => id === 'codex' ? nativeModels.value : (getProvider(id) as any)?.models || []
const effortsOf = (slot: Slot): string[] => (modelsOf(slot.target.provider).find(item => item.id === slot.target.model)?.efforts || (slot.target.provider === 'kimi' || slot.target.provider === 'qwen' ? [] : ['none', 'low', 'medium', 'high'])).filter(Boolean)
const EFFORT: Record<string, string> = { none: '不思考', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', minimal: '极低', ultra: '极高' }
/** 模型空着、或思考强度不是这个模型支持的：补成一个具体的选择。阅读助手取模型自己的默认强度，其余取最低档（要快）。 */
// Codex 的速度档：每个模型自己列出有哪些（有的没有超快，有的一档都没有）；选的那档这个模型没有就按标准。
const TIER: Record<string, string> = { priority: '快速（约 1.5 倍，用量更多）', fast: '快速（约 1.5 倍，用量更多）', ultrafast: '超快（最快，用量最多）', flex: '省额度（慢一些）' }
const tiersOf = (slot: Slot): any[] => slot.target.provider === 'codex' ? modelsOf('codex').find(item => item.id === slot.target.model)?.tiers || [] : []
const tierOf = (slot: Slot) => { const want = slot.target.tier || (slot.target.fast ? 'priority' : ''); return tiersOf(slot).some(item => item.id === want) ? want : '' }
function setTier(slot: Slot, id: string) { slot.target.tier = id; slot.target.fast = id !== '' }
function settle(slot: Slot) {
  const target = slot.target, info: any = getProvider(target.provider), list = modelsOf(target.provider).filter(item => item.id)
  if (!list.length) return
  if (slot.id === 'assistant') {
    if (!target.model) target.model = info?.defaultModel || list[0].id
    const chosen = list.find(item => item.id === target.model)
    if (chosen && target.effort && !chosen.efforts.includes(target.effort)) target.effort = chosen.defaultEffort || ''
    return
  }
  Object.assign(target, concreteChoice(list, target.model, target.effort, info?.defaultModel, target.provider !== 'codex'))
}
function chooseProvider(slot: Slot, value: string) {
  if (slot.follow) slot.target.share = value === '' ? 'assistant' : 'own'
  if (!value) return
  Object.assign(slot.target, { provider: value, model: '', effort: '' })
  if (value === 'codex' && !nativeModels.value.length && (globalThis as any).__TAURI_INTERNALS__) void refreshNative()
  settle(slot)
}
for (const slot of slots) if (!following(slot)) settle(slot)
// 打开设置时还没有 Codex 的模型名单（启动时的检查还在跑，或者没跑过）：接着查，不用手点。
if (!nativeModels.value.length && (globalThis as any).__TAURI_INTERNALS__) void refreshNative()

const requestFields = [
  { key: 'concurrent', label: '同时运行的提问', min: 1, max: 4 },
  { key: 'codex', label: '其中 Codex 同时运行数', min: 1, max: 2 },
  { key: 'queued', label: '最多等待的提问', min: 0, max: 16 },
]
async function save() {
  saving.value = true; status.value = ''; error.value = false
  try {
    if (keysLoading.value) throw new Error('正在读取 AI 配置，请稍后保存。')
    for (const slot of slots) {
      if (following(slot)) continue
      const target = slot.target
      if (target.provider !== 'codex') {
        Object.assign(target, { baseUrl: connections[target.provider]?.baseUrl || '', protocol: connections[target.provider]?.protocol || 'chat' })
        try { apiOrigin(target.baseUrl) } catch (cause: any) { throw new Error(`${(getProvider(target.provider) as any)?.name || target.provider} 的 API 地址不对：${cause?.message || cause}`) }
        if (!String(target.model || '').trim()) throw new Error(`请给「${slot.label}」填一个模型。`)
      }
    }
    for (const field of requestFields) {
      const value = settings.value.requestLimits[field.key]
      if (!Number.isInteger(value) || value < field.min || value > field.max) throw new Error(`${field.label}须为 ${field.min}–${field.max} 的整数。`)
    }
    settings.value.requestLimits = normalizeRequestLimits(settings.value.requestLimits)
    settings.value.connections = JSON.parse(JSON.stringify(connections))
    for (const id of keyEdited) if (id !== main.provider) await saveCredential(id, keys[id] || '')
    await saveAiSettings(settings.value, main.provider === 'codex' ? '' : keys[main.provider] || '')
    keyEdited.clear(); edited.value = false
    const saved = { ...settings.value }
    emit('saved', saved)
    return saved
  } catch (cause: any) { status.value = cause?.message || String(cause); error.value = true; return null }
  finally { saving.value = false }
}
defineExpose({ save, hasChanges: () => edited.value })
</script>

<template>
  <section class="ai-settings" :class="{ embedded }" aria-label="AI 设置" @input="markEdited" @change="markEdited">
    <div v-if="!embedded" class="settings-heading"><strong>AI 设置</strong><button class="text-button" @click="emit('close')">返回</button></div>
    <h4 class="step"><i>1</i>连接服务</h4>
    <div class="links">
      <details v-for="item in (PROVIDERS as any[])" :key="item.id" class="link" :class="{ on: connected(item.id) }">
        <summary><i class="link-dot" aria-hidden="true"></i><b>{{ item.name }}</b><small>{{ item.id === 'codex' ? (codexReady ? '已登录' : refreshing ? '检查中…' : codexCheck.state === 'failed' ? '连接失败' : '未检查') : keys[item.id] ? '已填 API Key' : local(item.id) ? '本机服务' : '未连接' }}</small></summary>
        <template v-if="item.id === 'codex'">
          <button class="secondary-button" :disabled="refreshing" data-tip="使用本机已登录的 Codex 桌面版或 CLI，无需 API Key" @click="refreshNative">{{ refreshing ? '检查中…' : '检查登录并读取模型' }}</button>
          <p v-if="codexStatus" class="settings-note">{{ codexStatus }}</p>
          <p v-if="timingLine" class="settings-note">{{ timingLine }} <button type="button" class="text-button" @click="copyTimings">{{ timingCopied ? '已复制' : '复制最近 12 次' }}</button></p>
        </template>
        <template v-else>
          <label>API Key<input v-model="keys[item.id]" :aria-label="`${item.name} API Key`" type="password" autocomplete="off" :placeholder="item.custom ? '加密保存在本机；本机服务可留空' : '加密保存在本机'" @input="keyEdited.add(item.id)" /></label>
          <label v-if="item.custom">接口协议<select v-model="connections[item.id]!.protocol" aria-label="接口协议"><option v-for="protocol in PROTOCOLS" :key="protocol.id" :value="protocol.id">{{ protocol.name }}</option></select></label>
          <label>API 地址<input v-model="connections[item.id]!.baseUrl" :aria-label="`${item.name} API 地址`" type="url" :placeholder="item.custom ? 'https://openrouter.ai/api/v1 或 http://localhost:11434/v1' : item.baseUrl" /></label>
        </template>
      </details>
    </div>
    <label class="check"><input v-model="settings.rememberKey" type="checkbox" /> 在这台电脑记住阅读助手的 API Key</label>
    <h4 class="step"><i>2</i>每个功能用哪个模型</h4>
    <div class="slots">
      <div v-for="slot in slots" :key="slot.id" class="slot">
        <p class="slot-name"><b>{{ slot.label }}</b><small>{{ slot.note }}</small></p>
        <label>服务<select :value="following(slot) ? '' : slot.target.provider" :aria-label="`${slot.label}用的服务`" @change="chooseProvider(slot, ($event.target as HTMLSelectElement).value)">
          <option v-if="slot.follow" value="">跟阅读助手一样</option>
          <option v-for="item in (PROVIDERS as any[])" :key="item.id" :value="item.id">{{ item.name }}{{ connected(item.id) ? '' : '（未连接）' }}</option>
        </select></label>
        <template v-if="!following(slot)">
          <label>模型<select v-if="slot.target.provider === 'codex'" v-model="slot.target.model" :aria-label="`${slot.label}模型`" :disabled="refreshing" @change="settle(slot)"><option v-if="slot.target.model && !modelsOf('codex').some(item => item.id === slot.target.model)" :value="slot.target.model">{{ slot.target.model }}</option><option v-for="item in modelsOf('codex').filter(item => item.id)" :key="item.id" :value="item.id">{{ item.name || item.id }}</option></select><input v-else v-model="slot.target.model" :aria-label="`${slot.label}模型`" :list="`models-${slot.id}`" placeholder="模型名称" @change="settle(slot)" /></label>
          <datalist :id="`models-${slot.id}`"><option v-for="item in modelsOf(slot.target.provider)" :key="item.id" :value="item.id">{{ item.name }}</option></datalist>
          <label v-if="effortsOf(slot).length">思考强度<select v-model="slot.target.effort" :aria-label="`${slot.label}思考强度`"><option v-if="slot.id === 'assistant'" value="">模型默认</option><option v-for="item in effortsOf(slot)" :key="item" :value="item">{{ EFFORT[item] || item }}</option></select></label>
          <label v-if="tiersOf(slot).length">速度<select :value="tierOf(slot)" :aria-label="`${slot.label}响应速度`" @change="setTier(slot, ($event.target as HTMLSelectElement).value)"><option value="">标准</option><option v-for="item in tiersOf(slot)" :key="item.id" :value="item.id">{{ TIER[item.id] || item.name || item.id }}</option></select></label>
          <label v-else-if="supportsFast(slot.target.provider)" class="check"><input v-model="slot.target.fast" type="checkbox" /> Fast：更快出字，额度消耗更多</label>
        </template>
      </div>
    </div>
    <details class="limit-settings"><summary>每题读取文档上限</summary><label v-for="field in DOCUMENT_LIMIT_FIELDS" :key="field.key">{{ field.label }}<input v-model.number="settings.documentLimits[field.key]" type="number" :min="field.min" :max="field.max" :step="field.step || 1" /></label></details>
    <details class="limit-settings"><summary>同时提问上限</summary><label v-for="field in requestFields" :key="field.key">{{ field.label }}<input v-model.number="settings.requestLimits[field.key]" type="number" :min="field.min" :max="field.max" :aria-label="field.label" /></label><p class="settings-note">切换标签或收起助手后继续回答；关闭文件标签会停止该文件的提问。</p></details>
    <p v-if="status" class="settings-status" :class="{ error }" role="status">{{ status }}</p>
    <button v-if="!embedded" class="primary-button" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
  </section>
</template>

<style scoped>
.ai-settings.embedded{position:relative;padding:14px 16px 16px;height:auto;border-radius:var(--r-lg);background-color:color-mix(in srgb,var(--glass-2) 60%,var(--fill-4));background-image:var(--glass-sheen);box-shadow:var(--glass-control-edge)}
.ai-settings{padding:20px;display:flex;flex-direction:column;gap:14px;overflow:auto;height:100%;box-sizing:border-box}
label{font-size:12px;font-weight:550;display:flex;flex-direction:column;gap:7px;color:var(--secondary)}
input:not([type='checkbox']),select{font:inherit;font-size:13px;color:var(--control-ink);height:38px;padding:7px 14px;min-width:0}
select{padding-right:34px}
button{font:inherit;cursor:pointer;color:var(--control-ink)}
.check{flex-direction:row-reverse;justify-content:space-between;align-items:center;font-size:12.5px;cursor:pointer}
.check input{margin:0}
.settings-note{font-size:11.5px;line-height:1.7;color:var(--muted);margin:0}
.text-button{border:0;background:none;box-shadow:none;color:var(--accent);padding:4px 10px}
.text-button:hover:not(:disabled){background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent)}
.primary-button,.secondary-button{height:38px;border:1px solid var(--glass-outline);border-radius:var(--r-control);padding:8px 16px;background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink);font-weight:600}
.secondary-button{align-self:flex-start}
.secondary-button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.primary-button{background-color:var(--accent-glass);background-image:var(--glass-tint-sheen);border-color:transparent;color:var(--accent-on)}
.primary-button:hover:not(:disabled){background-color:var(--accent-glass-hover);color:var(--accent-on)}
.settings-status{font-size:12px;line-height:1.6;margin:0;color:var(--muted);overflow-wrap:anywhere}
.error{color:var(--danger)}
.limit-settings{font-size:12.5px;color:var(--secondary);border-top:1px solid var(--separator);padding-top:4px}
.limit-settings summary{cursor:pointer;display:flex;align-items:center;justify-content:space-between;min-height:40px;padding:6px 4px;border-radius:var(--r-sm);color:var(--control-ink);font-weight:550;list-style:none;transition:background-color var(--dur-1) var(--ease-soft)}
.limit-settings summary::-webkit-details-marker{display:none}
.limit-settings summary::after{content:'›';font-size:17px;line-height:1;color:var(--muted);transition:transform var(--dur-bounce) var(--spring-snappy)}
.limit-settings[open] summary::after{transform:rotate(90deg)}
.limit-settings summary:hover{background-color:var(--control-hover);color:var(--control-ink)}
.limit-settings label{margin:10px 0}
button:disabled{opacity:.5;cursor:wait}

.step{display:flex;align-items:baseline;gap:8px;margin:6px 0 -4px;font-size:13.5px;font-weight:650;color:var(--control-ink)}
.step i{display:grid;place-items:center;flex:none;align-self:center;width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--accent-on,#fff);font-style:normal;font-size:11.5px;font-weight:700}
.step small{font-size:11.5px;font-weight:500;color:var(--muted)}
.links{display:flex;flex-direction:column;border:1px solid var(--separator);border-radius:var(--r-md);overflow:hidden}
.link + .link{border-top:1px solid var(--separator)}
.link summary{display:flex;align-items:center;gap:9px;min-height:38px;padding:4px 12px;cursor:pointer;list-style:none;font-size:12.5px;color:var(--control-ink);transition:background-color var(--dur-1) var(--ease-soft)}
.link summary::-webkit-details-marker{display:none}
.link summary:hover{background-color:var(--control-hover)}
.link summary b{flex:1;font-weight:550}
.link summary small{font-size:11.5px;color:var(--muted)}
.link.on summary small{color:var(--accent)}
.link-dot{flex:none;width:7px;height:7px;border-radius:50%;background:color-mix(in srgb,var(--ink) 22%,transparent)}
.link.on .link-dot{background:var(--accent);box-shadow:0 0 8px color-mix(in srgb,var(--accent) 70%,transparent)}
.link[open]{padding-bottom:12px}
.link[open] > :not(summary){margin:8px 12px 0}
.slots{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.slot{display:flex;flex-direction:column;gap:9px;padding:11px 12px 12px;border:1px solid var(--separator);border-radius:var(--r-md)}
.slot-name{display:flex;align-items:baseline;gap:8px;margin:0;font-size:13px;color:var(--control-ink)}
.slot-name small{font-size:11px;color:var(--muted)}
</style>
