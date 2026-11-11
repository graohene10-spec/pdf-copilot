<script setup lang="ts">
// 左侧的翻译栏：像阅读助手一样的一列，译文按卡片从上往下排，底下可以直接输入要翻译的文字。
// 与阅读助手共用外壳的主题样式（.ai-pane），内部元素用 tp- 前缀，互不干扰。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { renderMarkdown } from '../ai/render'
import ModelPicker from './ModelPicker.vue'
import { getProvider, getNativeModels } from '../ai/providers.mjs'
import { nativeModelInventory, registerNativeModelInventory } from '../ai/native-models'
import { concreteChoice, lowestEffort } from '../ai/translate-model'
import { loadAiSettings, translationSettings, saveTranslationChoice, supportsFast } from '../ai/settings.mjs'
import { warmNative } from '../ai/native.mjs'
import { warmTranslation } from '../ai/complete'
import { translator, translate, stopTranslation, removeTranslation, clearTranslations, credential, saveCredential, TARGETS, ENGINES, type Translation } from '../ai/translate'

defineProps<{ shortcut?: string }>()
const emit = defineEmits<{ close: []; settings: [] }>()
const draft = ref('')
const list = ref<HTMLElement>()
const field = ref<HTMLTextAreaElement>()
const copied = ref('')
const LABEL: Record<string, string> = { zh: '中文', en: 'English', ja: '日本語' }
const ENGINE_LABEL: Record<string, string> = { google: '谷歌', 'google-api': '谷歌云', youdao: '有道', ai: 'AI' }
const ENGINE_TIP: Record<string, string> = { google: '谷歌免密钥接口：最快，但共用的代理 IP 常被谷歌限流', 'google-api': '谷歌云 Cloud Translation：用自己的 API 密钥，稳定（每月前 50 万字符免费）', youdao: '有道智云：需要应用 ID 与密钥，国内直连', ai: 'AI 翻译：较慢，公式与术语更讲究；服务商在 设置 → AI → 翻译用的 AI' }
// AI 翻译自己的模型、思考强度与 Fast（服务商默认与阅读助手共用）。
const aiSettings = ref<any>(translationSettings(loadAiSettings()))
const aiPicker = ref(false)
const EFFORT_NAME: Record<string, string> = { none: '不思考', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '极致' }
// 模型只列具体的模型，没有「自动」：用哪个、什么强度都写在标签上。
const aiModels = computed<any[]>(() => {
  const list: any[] = (aiSettings.value.provider === 'codex' ? nativeModelInventory.value : getProvider(aiSettings.value.provider)?.models || []).filter((item: any) => item.id)
  const current = aiSettings.value.model || ''
  return [...(current && !list.some(item => item.id === current) ? [{ id: current, name: current }] : []), ...list]
})
const listed = (id: string) => (aiSettings.value.provider === 'codex' ? nativeModelInventory.value : getProvider(aiSettings.value.provider)?.models || []).some((item: any) => item.id === id)
// 没选过（或 Codex 的模型已不在本机列表里）：换成具体的默认模型与最低强度，并记下来。
function settleChoice() {
  const choice = concreteChoice(aiModels.value.filter(item => item.id !== aiSettings.value.model || listed(item.id)), aiSettings.value.model || '', aiSettings.value.effort || '', getProvider(aiSettings.value.provider)?.defaultModel, aiSettings.value.provider !== 'codex')
  if (choice.model && (choice.model !== aiSettings.value.model || choice.effort !== aiSettings.value.effort)) { saveTranslationChoice(choice); aiSettings.value = translationSettings(loadAiSettings()) }
}
async function loadCodexModels() {
  if (aiSettings.value.provider !== 'codex' || nativeModelInventory.value.some((item: any) => item.id)) return
  try { registerNativeModelInventory(await getNativeModels()) } catch { /* 读不到就等用户在设置里检查登录 */ }
}
watch(() => translator.engine, async engine => {
  if (engine !== 'ai') { aiPicker.value = false; return }
  aiSettings.value = translationSettings(loadAiSettings())
  if (aiSettings.value.provider === 'codex') { void warmNative(); await loadCodexModels() }
  else warmTranslation()
  settleChoice()
}, { immediate: true })
// 翻译栏开着的时候保持连接是热的：隔一阵补一次握手（内部限流，每 4 分钟至多一次）。
function keepWarm() { if (translator.engine === 'ai') warmTranslation() }
const warmTimer = setInterval(keepWarm, 60_000)
onBeforeUnmount(() => clearInterval(warmTimer))
watch(() => nativeModelInventory.value, () => { if (translator.engine === 'ai') settleChoice() })
const aiLabel = computed(() => {
  const model = aiModels.value.find(item => item.id === aiSettings.value.model)
  return [getProvider(aiSettings.value.provider)?.name || aiSettings.value.provider, model?.name || aiSettings.value.model || '未选模型', EFFORT_NAME[aiSettings.value.effort]].filter(Boolean).join(' · ')
})
// 翻译用的是 Codex 时提醒一次：Codex 翻译慢，建议换成国产大模型。关掉后不再出现。
const HINT_KEY = 'kaizhi.translate.codexHint.v1'
const hintDismissed = ref((() => { try { return localStorage.getItem(HINT_KEY) === '1' } catch { return false } })())
const codexHint = computed(() => translator.engine === 'ai' && aiSettings.value.provider === 'codex' && !hintDismissed.value)
function dismissHint() { hintDismissed.value = true; try { localStorage.setItem(HINT_KEY, '1') } catch { /* 只在这次有效 */ } }
function openAiSettings() { dismissHint(); emit('settings') }
const aiFast = computed(() => supportsFast(aiSettings.value.provider) ? Boolean(aiSettings.value.fast) : undefined)
function chooseAi(patch: Record<string, unknown>) {
  if ('model' in patch) { const model = aiModels.value.find(item => item.id === patch.model); if (model?.efforts && !model.efforts.includes(aiSettings.value.effort)) patch.effort = lowestEffort(model) }
  saveTranslationChoice(patch); aiSettings.value = translationSettings(loadAiSettings())
}
// 谷歌云 / 有道需要密钥：选了而还没填时，底部展开一张小表单。
const keyed = computed(() => translator.engine === 'google-api' || translator.engine === 'youdao' ? translator.engine : null)
const keyReady = ref(false)
const keyForm = ref(false)
const field1 = ref('')
const field2 = ref('')
const savingKey = ref(false)
async function checkKey() { const engine = keyed.value; keyReady.value = engine ? Boolean(await credential(engine)) : false; keyForm.value = Boolean(engine) && !keyReady.value }
watch(keyed, () => { field1.value = ''; field2.value = ''; void checkKey() }, { immediate: true })
const canSave = computed(() => keyed.value === 'youdao' ? Boolean(field1.value.trim() && field2.value.trim()) : Boolean(field1.value.trim()))
async function saveKey() {
  const engine = keyed.value
  if (!engine || !canSave.value) return
  savingKey.value = true
  try { await saveCredential(engine, engine === 'youdao' ? `${field1.value.trim()}\n${field2.value.trim()}` : field1.value); field1.value = ''; field2.value = ''; keyReady.value = true; keyForm.value = false } finally { savingKey.value = false }
}

// 新译文出现、或正在翻译的那条变长时，滚到底部。
watch(() => [translator.items.length, translator.items.at(-1)?.result.length], () => {
  void nextTick(() => { const element = list.value; if (element) element.scrollTop = element.scrollHeight })
}, { immediate: true })

function submit() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  void translate(text)
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') }
}
async function copy(item: Translation) {
  try { await navigator.clipboard.writeText(item.result); copied.value = item.id; setTimeout(() => { if (copied.value === item.id) copied.value = '' }, 1400) } catch { /* 剪贴板不可用时什么也不做 */ }
}
function again(item: Translation) { void translate(item.source, translator.target, true) }
function focus() { void nextTick(() => field.value?.focus()) }
defineExpose({ focus })
</script>

<template>
  <aside class="ai-pane translate-pane" role="complementary" aria-label="翻译" @pointerenter="keepWarm" @focusin="keepWarm">
    <header class="tp-header">
      <span class="tp-title"><AppIcon name="translate" :size="17" />翻译</span>
      <div class="tp-targets" role="radiogroup" aria-label="译成">
        <button v-for="item in TARGETS" :key="item.value" type="button" role="radio" :aria-checked="translator.target === item.value" :class="{ on: translator.target === item.value }" @click="translator.target = item.value">{{ item.label }}</button>
      </div>
      <button type="button" class="tp-icon" :disabled="!translator.items.length" aria-label="清空翻译记录" data-tip="清空翻译记录" @click="clearTranslations"><AppIcon name="trash" :size="15" /></button>
      <button type="button" class="tp-icon" aria-label="关闭翻译栏" data-tip="关闭翻译栏" :data-tip-key="shortcut" @click="emit('close')"><AppIcon name="close" :size="15" /></button>
    </header>

    <div ref="list" class="tp-list" data-glass-still>
      <div v-if="!translator.items.length" class="tp-empty">
        <AppIcon name="translate" :size="34" />
        <p>在文档里选中一段文字，右键选「机翻」<template v-if="shortcut">，或按 <kbd>{{ shortcut }}</kbd></template>。</p>
        <p class="tp-muted">也可以把文字粘贴到下面的输入框里。</p>
      </div>
      <article v-for="item in translator.items" :key="item.id" class="tp-card" :class="item.status">
        <p class="tp-source" :title="item.source">{{ item.source }}</p>
        <div class="tp-arrow" aria-hidden="true"><span>{{ item.engine ? `${ENGINE_LABEL[item.engine]} · ` : '' }}{{ LABEL[item.target] }}{{ item.cached ? ' · 刚翻过' : item.ms && item.status === 'done' ? ` · ${(item.ms / 1000).toFixed(1)}s` : '' }}</span></div>
        <div v-if="item.result" class="tp-result" v-html="renderMarkdown(item.result)"></div>
        <p v-else-if="item.status === 'running'" class="tp-pending"><span class="tp-dot"></span><span class="tp-dot"></span><span class="tp-dot"></span></p>
        <p v-if="item.status === 'error'" class="tp-error">{{ item.error || '翻译失败' }}</p>
        <p v-if="item.fallback" class="tp-fallback" :data-tip="item.fallback">谷歌免密钥接口没成功，已改用{{ ENGINE_LABEL[item.engine || ''] }}</p>
        <div class="tp-actions">
          <button v-if="item.status === 'running'" type="button" class="tp-icon" aria-label="停止" data-tip="停止" @click="stopTranslation(item.id)"><AppIcon name="stop" :size="14" /></button>
          <template v-else>
            <button type="button" class="tp-icon" :disabled="!item.result" :aria-label="copied === item.id ? '已复制' : '复制译文'" :data-tip="copied === item.id ? '已复制' : '复制译文'" @click="copy(item)"><AppIcon :name="copied === item.id ? 'check' : 'copy'" :size="14" /></button>
            <button type="button" class="tp-icon" aria-label="重新翻译" data-tip="按当前语言重新翻译" @click="again(item)"><AppIcon name="retry" :size="14" /></button>
          </template>
          <button type="button" class="tp-icon" aria-label="删除这条" data-tip="删除这条" @click="removeTranslation(item.id)"><AppIcon name="close" :size="14" /></button>
        </div>
      </article>
    </div>

    <div class="tp-engine">
      <span>翻译服务</span>
      <div class="tp-targets" role="radiogroup" aria-label="翻译服务">
        <button v-for="item in ENGINES" :key="item.value" type="button" role="radio" :aria-checked="translator.engine === item.value" :class="{ on: translator.engine === item.value }" :data-tip="ENGINE_TIP[item.value]" @click="translator.engine = item.value">{{ item.label }}</button>
      </div>
      <button type="button" class="tp-auto" role="switch" :aria-checked="translator.auto" :class="{ on: translator.auto }" data-tip="选中文字后自动翻译，译文显示在鼠标旁" @click="translator.auto = !translator.auto"><i aria-hidden="true"></i>翻译模式</button>
      <button v-if="keyed && keyReady" type="button" class="tp-link" @click="keyForm = !keyForm">{{ keyForm ? '收起' : '更换密钥' }}</button>
    </div>
    <Transition name="tp-hint"><p v-if="codexHint" class="tp-hint" role="note">Codex 翻译较慢，建议换成 DeepSeek、Kimi 等国产大模型。<button type="button" class="tp-link" @click="openAiSettings">去设置</button><button type="button" class="tp-hint-close" aria-label="不再提醒" data-tip="不再提醒" @click="dismissHint"><AppIcon name="close" :size="11" /></button></p></Transition>
    <div v-if="translator.engine === 'ai'" class="tp-ai">
      <button type="button" class="tp-ai-chip" :aria-expanded="aiPicker" aria-label="翻译用的模型、思考强度与 Fast" @click="aiPicker = !aiPicker"><span>{{ aiLabel }}</span><AppIcon v-if="aiFast" name="bolt" :size="11" class="tp-ai-fast" /><AppIcon name="down" :size="11" /></button>
      <ModelPicker v-if="aiPicker" :model="aiSettings.model || ''" :effort="aiSettings.effort || ''" :models="aiModels" :fast="aiFast" no-default @model="id => chooseAi({ model: id })" @effort="value => chooseAi({ effort: value })" @fast="value => chooseAi({ fast: value })" @close="aiPicker = false" />
    </div>
    <form v-if="keyed && keyForm" class="tp-keys" :class="{ single: keyed === 'google-api' }" @submit.prevent="saveKey">
      <p v-if="keyed === 'google-api'">在 Google Cloud 控制台启用 Cloud Translation API，创建一个 API 密钥填在这里。密钥加密保存在本机。</p>
      <p v-else>在有道智云（ai.youdao.com）创建应用并开通「文本翻译」，填应用 ID 和应用密钥。密钥加密保存在本机。</p>
      <input v-model="field1" :type="keyed === 'google-api' ? 'password' : 'text'" :placeholder="keyed === 'google-api' ? 'API 密钥' : '应用 ID'" :aria-label="keyed === 'google-api' ? '谷歌云 API 密钥' : '有道应用 ID'" autocomplete="off" />
      <input v-if="keyed === 'youdao'" v-model="field2" type="password" placeholder="应用密钥" aria-label="有道应用密钥" autocomplete="off" />
      <button type="submit" :disabled="savingKey || !canSave">保存</button>
    </form>
    <form class="tp-composer" @submit.prevent="submit">
      <textarea ref="field" v-model="draft" rows="3" placeholder="输入或粘贴要翻译的文字，回车翻译" aria-label="要翻译的文字" @keydown="keydown"></textarea>
      <button type="submit" class="tp-send" :disabled="!draft.trim()" aria-label="开始翻译" data-tip="翻译（回车）"><AppIcon name="arrow-up" :size="16" /></button>
    </form>
  </aside>
</template>

<style scoped>
.translate-pane{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;background-color:var(--glass-3);background-image:var(--glass-sheen);-webkit-backdrop-filter:var(--glass-filter-3);backdrop-filter:var(--glass-filter-3);border:1px solid var(--glass-outline);border-radius:var(--r-xl);box-shadow:var(--shadow-pane),var(--glass-edge);color:var(--ink);overflow:hidden;font-family:var(--font-ui)}
.tp-header{display:flex;align-items:center;gap:6px;height:52px;padding:0 10px 0 16px;border-bottom:.5px solid var(--hairline,var(--line-soft));flex-shrink:0}
.tp-title{display:inline-flex;align-items:center;gap:7px;font-weight:650;font-size:14px;margin-right:auto;white-space:nowrap}
.tp-targets{display:flex;gap:2px;padding:2px;border-radius:var(--r-control);background:color-mix(in srgb,var(--surface-ink) 6%,transparent)}
.tp-targets button{height:24px;padding:0 8px;border:0;border-radius:calc(var(--r-control) - 2px);background:none;box-shadow:none;font-size:11.5px;color:var(--secondary);white-space:nowrap}
.tp-targets button.on{background:var(--surface);color:var(--surface-ink);box-shadow:0 1px 2px rgb(0 0 0 / .12)}
.tp-ai{padding:0 12px 6px}
.tp-auto{display:inline-flex;align-items:center;gap:6px;margin-left:auto;height:24px;padding:0 8px 0 6px;border:0;border-radius:999px;background:transparent;color:var(--secondary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
.tp-auto i{position:relative;width:24px;height:14px;border-radius:999px;background:var(--fill-1);transition:background var(--dur-2) var(--ease-out)}
.tp-auto i::after{content:'';position:absolute;left:2px;top:2px;width:10px;height:10px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / .3);transition:translate var(--dur-2) var(--spring-snappy)}
.tp-auto.on{color:var(--control-ink)}
.tp-auto.on i{background:var(--accent)}
.tp-auto.on i::after{translate:10px 0}
/* 小气泡：尖角朝下指向下面的模型标签。 */
.tp-hint{position:relative;display:flex;align-items:center;gap:6px;margin:4px 12px 8px;padding:7px 8px 7px 11px;border-radius:10px;background:color-mix(in srgb,var(--accent) 12%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);color:var(--surface-ink);font-size:12px;line-height:1.45}
.tp-hint::after{content:'';position:absolute;left:22px;bottom:-6px;width:10px;height:10px;background:inherit;border-right:inherit;border-bottom:inherit;rotate:45deg;border-radius:0 0 3px 0}
.tp-hint .tp-link{flex:none;margin-left:auto}
.tp-hint-close{display:grid;place-items:center;flex:none;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:none;box-shadow:none;color:var(--muted)}
.tp-hint-close:hover{background:color-mix(in srgb,var(--surface-ink) 8%,transparent);color:var(--ink)}
.tp-hint-enter-active{transition:opacity var(--dur-2) var(--ease-soft),translate var(--dur-3) var(--spring-snappy)}
.tp-hint-leave-active{transition:opacity var(--dur-1) var(--ease-soft)}
.tp-hint-enter-from{opacity:0;translate:0 6px}.tp-hint-leave-to{opacity:0}
.tp-ai-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;height:24px;padding:0 8px;border:0;border-radius:var(--r-sm);background:color-mix(in srgb,var(--surface-ink) 6%,transparent);box-shadow:none;color:var(--secondary);font-size:11.5px}
.tp-ai-chip span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tp-ai-chip:hover{color:var(--ink)}
.tp-ai-fast{color:var(--accent)}
.tp-icon{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--secondary)}
.tp-icon:hover:not(:disabled){background:color-mix(in srgb,var(--surface-ink) 8%,transparent);color:var(--ink)}
.tp-icon:disabled{opacity:.4}
.tp-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px 14px 6px;scrollbar-width:thin;will-change:transform}
.tp-empty{display:grid;justify-items:center;gap:8px;margin-top:22vh;padding:0 18px;text-align:center;color:var(--secondary);font-size:13px;line-height:1.6}
.tp-empty p{margin:0}
.tp-muted{color:var(--muted)}
.tp-empty kbd{padding:1px 5px;border-radius:5px;background:color-mix(in srgb,var(--surface-ink) 8%,transparent);font-size:11px}
.tp-card{position:relative;margin-bottom:12px;padding:11px 13px 8px;border-radius:12px;background:color-mix(in srgb,var(--surface) 72%,transparent);border:.5px solid var(--line-soft);animation:tp-in var(--dur-3) var(--spring-snappy) backwards}
@keyframes tp-in{from{opacity:0;translate:0 10px;scale:.98}}
.tp-source{margin:0;color:var(--secondary);font-size:12.5px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.tp-arrow{display:flex;align-items:center;gap:8px;margin:7px 0 5px;color:var(--muted);font-size:10.5px;letter-spacing:.04em}
.tp-arrow::before,.tp-arrow::after{content:'';flex:1;height:.5px;background:var(--line-soft)}
.tp-result{font-family:var(--font-answer,var(--font-reading));font-size:14.5px;line-height:1.7;overflow-wrap:anywhere}
.tp-result :deep(p){margin:0 0 .6em}
.tp-result :deep(>:last-child){margin-bottom:0}
.tp-pending{display:flex;gap:5px;margin:6px 0 2px}
.tp-dot{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:tp-blink 1.1s ease-in-out infinite}
.tp-dot:nth-child(2){animation-delay:.15s}.tp-dot:nth-child(3){animation-delay:.3s}
@keyframes tp-blink{0%,100%{opacity:.25}50%{opacity:1}}
.tp-error{margin:4px 0 0;color:var(--danger);font-size:12px}
.tp-actions{display:flex;justify-content:flex-end;gap:2px;margin-top:4px;opacity:.55;transition:opacity var(--dur-1) var(--ease-soft)}
.tp-card:hover .tp-actions,.tp-card:focus-within .tp-actions{opacity:1}
.tp-actions .tp-icon{width:26px;height:24px}
.tp-engine{display:flex;align-items:center;gap:8px;flex-shrink:0;margin:6px 12px 0;color:var(--muted);font-size:11.5px}
.tp-link{margin-left:auto;padding:0;border:0;background:none;box-shadow:none;color:var(--secondary);font-size:11.5px;text-decoration:underline;text-underline-offset:2px}
.tp-keys{display:grid;grid-template-columns:1fr 1fr auto;gap:6px;flex-shrink:0;margin:8px 12px 0;padding:10px;border-radius:12px;background:color-mix(in srgb,var(--surface) 70%,transparent);border:.5px solid var(--line-soft)}
.tp-keys.single{grid-template-columns:1fr auto}
.tp-fallback{margin:6px 0 0;color:var(--muted);font-size:11px}
.tp-keys p{grid-column:1/-1;margin:0 0 2px;color:var(--secondary);font-size:11.5px;line-height:1.5}
.tp-keys input{min-width:0;height:30px;padding:0 8px;border-radius:8px;border:.5px solid var(--line-soft);background:var(--surface);color:inherit;font:inherit;font-size:12.5px}
.tp-keys button{height:30px;padding:0 12px;border-radius:8px;border:0;background:var(--surface-ink);color:var(--surface);box-shadow:none;font-size:12.5px}
.tp-keys button:disabled{opacity:.4}
.tp-composer{position:relative;flex-shrink:0;margin:8px 12px 12px;border-radius:14px;border:.5px solid var(--line-soft);background:color-mix(in srgb,var(--surface) 80%,transparent)}
.tp-composer textarea{display:block;width:100%;min-height:64px;max-height:180px;padding:10px 44px 10px 12px;border:0;background:none;resize:none;color:inherit;font:inherit;font-size:13.5px;line-height:1.55;outline:none}
.tp-send{position:absolute;right:8px;bottom:8px;display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:var(--surface-ink);color:var(--surface);box-shadow:none}
.tp-send:disabled{opacity:.3}
@media(prefers-reduced-motion:reduce){.tp-card,.tp-dot{animation:none}}
</style>
