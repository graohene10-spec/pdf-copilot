<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { PROVIDERS, getProvider, getNativeModels, getNativeStatus } from '../ai/providers.mjs'
import { nativeModelInventory, registerNativeModelInventory } from '../ai/native-models'
import { loadAiSettings, loadApiKey, saveAiSettings } from '../ai/settings.mjs'
import { DOCUMENT_LIMIT_FIELDS } from '../../../extension/common/document-limits.mjs'
import { apiOrigin } from '../../../extension/common/settings.js'
import { normalizeRequestLimits } from '../../../extension/common/request-queue.mjs'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ saved: [value: any]; close: [] }>()
const settings = ref<any>(loadAiSettings())
const key = ref('')
const status = ref('')
const error = ref(false)
const saving = ref(false)
const refreshing = ref(false)
const keyLoading = ref(false)
const edited = ref(false)
function markEdited() { edited.value = true }
const nativeModels = nativeModelInventory
const provider = computed<any>(() => getProvider(settings.value.provider))
const models = computed<any[]>(() => settings.value.provider === 'codex' ? nativeModels.value : provider.value?.models || [])
const model = computed<any>(() => models.value.find(item => item.id === settings.value.model))
const hasStoredModel = computed(() => Boolean(settings.value.model) && !models.value.some(item => item.id === settings.value.model))
const requestFields = [
  { key: 'concurrent', label: '同时运行的提问', min: 1, max: 4 },
  { key: 'codex', label: '其中 Codex 同时运行数', min: 1, max: 2 },
  { key: 'queued', label: '最多等待的提问', min: 0, max: 16 },
]
const efforts = computed<string[]>(() => model.value?.efforts || ['', 'none', 'low', 'medium', 'high', 'xhigh', 'max'])
let keyEpoch = 0
let disposed = false
let modelRequest: AbortController | undefined
watch(() => settings.value.provider, async (value, previous) => {
  if (previous) {
    const next: any = getProvider(value)
    settings.value.baseUrl = next?.baseUrl || ''
    settings.value.model = next?.defaultModel || next?.models[0]?.id || ''
    settings.value.effort = next?.models[0]?.defaultEffort || ''
  }
  const epoch = ++keyEpoch
  keyLoading.value = true
  key.value = ''
  if (value === 'codex' && !nativeModels.value.length && (globalThis as any).__TAURI_INTERNALS__) void refreshNative()
  try { const result = await loadApiKey(value); if (epoch === keyEpoch) key.value = result }
  catch (cause: any) { status.value = cause?.message || String(cause); error.value = true }
  finally { if (epoch === keyEpoch) keyLoading.value = false }
}, { immediate: true })
watch(model, value => {
  if (value && !value.efforts.includes(settings.value.effort)) settings.value.effort = value.defaultEffort || ''
})
async function refreshNative() {
  if (refreshing.value || disposed) return
  const request = new AbortController()
  modelRequest = request
  refreshing.value = true; error.value = false; status.value = '正在检查本机 Codex…'
  try {
    const info: any = await getNativeStatus(request.signal)
    if (!info.compatible || !info.loggedIn) throw new Error(info.diagnostic || (info.loggedIn === false ? 'Codex 尚未登录。请先在 Codex 中登录。' : '未找到可用 Codex。'))
    const list: any[] = await getNativeModels(request.signal)
    if (disposed || request.signal.aborted) return
    registerNativeModelInventory(list)
    if (!settings.value.model && list.length) { settings.value.model = list[0].id; settings.value.effort = list[0].defaultEffort || '' }
    if (settings.value.provider === 'codex') status.value = `Codex ${info.version} · 已登录 · ${list.length} 个模型`
  } catch (cause: any) { if (!disposed && !request.signal.aborted && settings.value.provider === 'codex') { status.value = cause?.message || String(cause); error.value = true } }
  finally { if (modelRequest === request) { modelRequest = undefined; refreshing.value = false } }
}
onBeforeUnmount(() => { disposed = true; keyEpoch++; modelRequest?.abort() })
async function save() {
  saving.value = true; status.value = ''; error.value = false
  try {
    if (keyLoading.value) throw new Error('正在读取 AI 配置，请稍后保存。')
    if (settings.value.provider !== 'codex') {
      apiOrigin(settings.value.baseUrl)
      if (!settings.value.model.trim()) throw new Error('请填写模型名称。')
    }
    for (const field of requestFields) {
      const value = settings.value.requestLimits[field.key]
      if (!Number.isInteger(value) || value < field.min || value > field.max) throw new Error(`${field.label}须为 ${field.min}–${field.max} 的整数。`)
    }
    settings.value.requestLimits = normalizeRequestLimits(settings.value.requestLimits)
    await saveAiSettings(settings.value, key.value)
    edited.value = false
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
    <label>服务商<select v-model="settings.provider" aria-label="服务商"><option v-for="item in PROVIDERS" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
    <template v-if="settings.provider !== 'codex'">
      <label>API 地址<input v-model="settings.baseUrl" aria-label="API 地址" type="url" placeholder="https://api.example.com/v1" /></label>
      <label>API Key<input v-model="key" aria-label="API Key" type="password" autocomplete="off" placeholder="仅供所选服务商使用" /></label>
      <label class="check"><input v-model="settings.rememberKey" type="checkbox" /> 在这台电脑记住密钥</label>
      <p class="settings-note">桌面版使用 Windows 加密保存。浏览器预览的密钥只保留在本次页面会话。</p>
    </template>
    <template v-else>
      <p class="settings-note">沿用本机 Codex 的登录，无需填写 API Key。需要已安装并登录 Codex CLI。</p>
      <button class="secondary-button" :disabled="refreshing" @click="refreshNative">{{ refreshing ? '检查中…' : '检查登录并读取模型' }}</button>
    </template>
    <label>模型<select v-if="settings.provider === 'codex'" v-model="settings.model" aria-label="模型" :disabled="refreshing"><option value="">模型默认</option><option v-if="hasStoredModel" :value="settings.model">当前设置：{{ settings.model }}</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name || item.id }}</option></select><input v-else v-model="settings.model" aria-label="模型" list="ai-model-list" placeholder="模型默认或自定义名称" /></label>
    <datalist v-if="settings.provider !== 'codex'" id="ai-model-list"><option v-for="item in models" :key="item.id" :value="item.id">{{ item.name }}</option></datalist>
    <label>思考强度<select v-model="settings.effort" aria-label="思考强度"><option value="">模型默认</option><option v-for="item in efforts.filter(Boolean)" :key="item" :value="item">{{ ({ none:'不思考',low:'低',medium:'中',high:'高',xhigh:'很高',max:'最高',minimal:'极低',ultra:'极高' } as any)[item] || item }}</option></select></label>
    <details class="limit-settings"><summary>每题阅读预算</summary><label v-for="field in DOCUMENT_LIMIT_FIELDS" :key="field.key">{{ field.label }}<input v-model.number="settings.documentLimits[field.key]" type="number" :min="field.min" :max="field.max" :step="field.step || 1" /></label></details>
    <details class="limit-settings"><summary>多文件提问</summary><label v-for="field in requestFields" :key="field.key">{{ field.label }}<input v-model.number="settings.requestLimits[field.key]" type="number" :min="field.min" :max="field.max" :aria-label="field.label" /></label><p class="settings-note">切换标签或收起助手后继续回答；关闭文件标签会停止该文件的提问。</p></details>
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
</style>
