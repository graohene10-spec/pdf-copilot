<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { renderMessage } from '../../../extension/chat/math.mjs'
import { getProvider } from '../ai/providers.mjs'
import { chatState, sendChat, stopChat, configureRequests, taskSummary, type Message } from '../ai/workspace'
import { loadAiSettings, saveModelChoice } from '../ai/settings.mjs'
import { useSettings } from '../settings'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ document: { id: string; title: string; kind: string }; context: any; sendShortcut?: string; consumeCapture?: (value: { documentId: string; selection: any }) => void }>()
const emit = defineEmits<{ jump: [value: { page: number; rect?: any; line?: number }]; close: []; settings: []; error: [value: string]; clearSelection: [] }>()
const settings = ref<any>(loadAiSettings())
const state = shallowRef(chatState(props.document.id))
const messages = computed(() => state.value.messages)
const prompt = computed({ get: () => state.value.draft, set: value => { state.value.draft = value } })
const busy = computed(() => Boolean(state.value.request))
const status = computed(() => state.value.status)
const statusError = computed(() => state.value.error)
const includeDocument = computed({ get: () => state.value.includeDocument, set: value => { state.value.includeDocument = value } })
const includeSelection = computed({ get: () => state.value.includeSelection, set: value => { state.value.includeSelection = value } })
const messageList = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
let renderFrame = 0
const providerSummary = computed(() => `${getProvider(settings.value.provider)?.name || 'AI'} · ${settings.value.model || '默认模型'}`)
const selected = computed(() => props.context?.selection || {})
const hasSelection = computed(() => Boolean(selected.value.text || selected.value.image))
const { preferences } = useSettings()
const suggestions = computed(() => preferences.value.assistant.quickPrompts)
// Quick model / effort picker beside Send. It writes only these two fields;
// keys, endpoints and limits stay in Settings → AI.
const EFFORT_LABELS: Record<string, string> = { none: '不思考', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '极高' }
const pickerOpen = ref(false)
const pickerHost = ref<HTMLElement>()
const pickerButton = ref<HTMLButtonElement>()
const pickerModels = computed<{ id: string; name: string; efforts?: string[]; defaultEffort?: string }[]>(() => {
  const list: any[] = getProvider(settings.value.provider)?.models || []
  const current = settings.value.model || ''
  const extra = settings.value.provider === 'codex' && !list.some(item => !item.id) ? [{ id: '', name: '模型默认' }] : []
  const custom = current && !list.some(item => item.id === current) ? [{ id: current, name: current }] : []
  return [...extra, ...custom, ...list]
})
const currentModel = computed(() => pickerModels.value.find(item => item.id === (settings.value.model || '')))
const pickerEfforts = computed(() => ['', ...(currentModel.value?.efforts || ['none', 'low', 'medium', 'high', 'xhigh', 'max']).filter(Boolean)])
const modelLabel = computed(() => currentModel.value?.name || settings.value.model || '默认模型')
const effortLabel = (value: string) => value ? EFFORT_LABELS[value] || value : '默认'
function commitChoice(model: string, effort: string) {
  saveModelChoice(model, effort)
  settings.value = loadAiSettings()
}
function chooseModel(id: string) {
  const model = pickerModels.value.find(item => item.id === id)
  let effort = settings.value.effort || ''
  if (effort && model?.efforts && !model.efforts.includes(effort)) effort = model.defaultEffort || ''
  commitChoice(id, effort)
}
function chooseEffort(value: string) { commitChoice(settings.value.model || '', value) }
function closePicker(returnFocus = false) {
  pickerOpen.value = false
  if (returnFocus) pickerButton.value?.focus()
}
function togglePicker() {
  pickerOpen.value = !pickerOpen.value
  if (pickerOpen.value) void nextTick(() => pickerHost.value?.querySelector<HTMLElement>('.model-menu [aria-pressed="true"]')?.focus())
}
function pickerOutside(event: PointerEvent) {
  if (event.target instanceof Node && !pickerHost.value?.contains(event.target)) closePicker()
}
watch(pickerOpen, open => {
  if (open) document.addEventListener('pointerdown', pickerOutside, true)
  else document.removeEventListener('pointerdown', pickerOutside, true)
})
watch(busy, value => { if (value) closePicker() })
function moreSettings() { closePicker(); emit('settings') }
function restoreScroll() { if (messageList.value) messageList.value.scrollTop = state.value.scrollTop }
watch(() => props.document.id, (id) => {
  rememberScroll()
  state.value = chatState(id)
  settings.value = loadAiSettings()
  void nextTick(() => { if (id === props.document.id) restoreScroll() })
}, { flush: 'sync' })
watch(() => props.context?.selection, selection => { includeSelection.value = Boolean(selection?.text || selection?.image) }, { immediate: true })
function rememberScroll() { if (messageList.value) state.value.scrollTop = messageList.value.scrollTop }
watch(() => [props.document.id, messages.value.at(-1)?.id, messages.value.at(-1)?.content], (value, previous) => { if (value[0] === previous[0]) scheduleScroll() })
onMounted(restoreScroll)
function focusPrompt() { void nextTick(() => input.value?.focus()) }
function jump(source: any) { emit('jump', { page: source.page, rect: source.rect, ...(source.line ? { line: source.line } : {}) }) }
function renderAnswer(element: HTMLElement, message: Message) {
  renderMessage(element, message.content, katex)
  const sourceMap = new Map(message.sources.map(source => [source.sourceId, source]))
  if (!sourceMap.size) return
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes: Node[] = []
  while (walker.nextNode()) if (!(walker.currentNode.parentElement?.closest('.message-code,.message-math,button'))) nodes.push(walker.currentNode)
  for (const node of nodes) {
    const text = node.textContent || '', pattern = /\[(S[a-zA-Z0-9]+-\d+)\]/g, fragment = document.createDocumentFragment()
    let match: RegExpExecArray | null, last = 0
    while ((match = pattern.exec(text))) {
      const source: any = sourceMap.get(match[1]); if (!source) continue
      fragment.append(document.createTextNode(text.slice(last, match.index)))
      const button = document.createElement('button')
      button.className = 'inline-citation'; button.textContent = source.line ? `第 ${source.line} 行` : `第 ${source.page} 页`; button.dataset.tip = source.text
      button.onclick = () => jump(source); fragment.append(button); last = pattern.lastIndex
    }
    if (last) { fragment.append(document.createTextNode(text.slice(last))); node.parentNode?.replaceChild(fragment, node) }
  }
}
const vAnswer = { mounted: (el: HTMLElement, binding: any) => renderAnswer(el, binding.value), updated: (el: HTMLElement, binding: any) => renderAnswer(el, binding.value) }
function scroll() { nextTick(() => { if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight }) }
function scheduleScroll() { if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; scroll() }) }
function stop() { stopChat(props.document.id) }
function clear() { if (!busy.value) { state.value.messages = []; state.value.draft = ''; state.value.status = '' } }
function applySettings(value: any) { settings.value = value; configureRequests(value); state.value.status = 'AI 设置已保存。'; state.value.error = false }
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text) } catch { state.value.status = '复制失败，请手动选择文字。'; state.value.error = true }
}
function send(question?: string) {
  const id = props.document.id
  const selection = props.context?.selection
  const usesImage = includeSelection.value && Boolean(selection?.image)
  const consumeCapture = props.consumeCapture
  return sendChat({ ...props.document }, { ...props.context }, () => { if (id === props.document.id) emit('settings') }, () => {
    // The request can be accepted after this pane closes or switches files.
    if (usesImage) consumeCapture?.({ documentId: id, selection })
  }, question)
}
onBeforeUnmount(() => { rememberScroll(); if (renderFrame) cancelAnimationFrame(renderFrame); document.removeEventListener('pointerdown', pickerOutside, true) })
defineExpose({ send, stop, applySettings, focusPrompt })
</script>

<template>
  <aside class="ai-pane" aria-label="AI 阅读助手">
      <div class="model-bar"><span class="model-summary" :data-tip="providerSummary">{{ providerSummary }}</span><span v-if="taskSummary.running || taskSummary.queued" class="task-summary" :data-tip="`同时最多 ${taskSummary.limits.concurrent} 题，Codex ${taskSummary.limits.codex} 题`">{{ taskSummary.running }} 运行<template v-if="taskSummary.queued"> · {{ taskSummary.queued }} 等待</template></span><button class="secondary-action model-change" data-tip="AI 设置" data-glass-interactive :disabled="busy" @click="emit('settings')">更改</button><button class="close-assistant" data-tip="关闭阅读助手" aria-label="关闭阅读助手" data-glass-interactive @click="emit('close')">×</button></div>
      <div ref="messageList" class="ai-messages" aria-live="polite" @scroll="rememberScroll">
        <div v-if="!messages.length" class="ai-welcome"><div class="ai-welcome-mark" aria-hidden="true"><AppIcon name="sparkle" :size="26" /></div><p class="ai-welcome-lead">关于这份文档，想了解什么？</p><p>可询问当前内容，也可选取文字或框选图表。</p><div class="suggestions"><button v-for="(suggestion, index) in suggestions" :key="index" :data-tip="suggestion.question" :disabled="busy" @click="send(suggestion.question)">{{ suggestion.label }}</button></div></div>
        <article v-for="message in messages" :key="message.id" class="ai-message" :class="message.role">
          <div class="message-label"><strong>{{ message.role === 'user' ? '你' : '阅读助手' }}</strong><button v-if="message.content" @click="copy(message.content)">复制</button></div>
          <details v-if="message.reasoning" class="reasoning"><summary>思考过程</summary><p>{{ message.reasoning }}</p></details>
          <div v-if="message.role === 'assistant'" v-answer="message" class="answer-body" />
          <p v-else class="user-question">{{ message.content }}</p>
          <details v-if="message.sources.length" class="source-list"><summary>参考原文 · {{ message.sources.length }} 段</summary><button v-for="source in message.sources" :key="source.sourceId" @click="jump(source)"><span>{{ source.line ? `第 ${source.line} 行` : `第 ${source.page} 页` }}</span><small>{{ source.text }}</small></button></details>
        </article>
      </div>
      <div class="ai-composer">
        <div v-if="hasSelection" class="ai-selection-context"><div class="context-heading"><label><input v-model="includeSelection" type="checkbox" :disabled="busy" />{{ selected.image ? `使用第 ${selected.page} 页截图` : '使用所选文字' }}</label><button class="reset-button" @click="emit('clearSelection')" data-tip="清除选区" aria-label="清除选区">×</button></div><p v-if="selected.text">{{ selected.text.slice(0, 140) }}</p><img v-if="selected.image" :src="selected.image" alt="选取的截图预览" /></div>
        <label class="document-context"><input v-model="includeDocument" type="checkbox" :disabled="busy" /> 当前页上下文与文档检索</label>
        <div class="composer-field">
        <textarea ref="input" v-model="prompt" rows="3" placeholder="询问这份文档…" aria-label="向 AI 提问" />
        <div class="composer-actions">
          <button class="reset-button secondary-action clear-conversation" aria-label="清空对话" data-tip="清空对话" data-glass-interactive :disabled="busy || !messages.length" @click="clear"><AppIcon name="trash" :size="16" /></button>
          <div ref="pickerHost" class="model-picker-host">
            <button ref="pickerButton" type="button" class="model-picker" :disabled="busy" aria-haspopup="dialog" :aria-expanded="pickerOpen" aria-label="选择模型与思考强度" data-tip="模型与思考强度" @click="togglePicker"><span class="picker-model">{{ modelLabel }}</span><span class="picker-effort">{{ effortLabel(settings.effort || '') }}</span><AppIcon name="down" :size="12" class="picker-chevron" /></button>
            <Transition name="picker">
              <div v-if="pickerOpen" class="model-menu" role="dialog" aria-label="模型与思考强度" @keydown.esc.stop.prevent="closePicker(true)">
                <p class="menu-label">模型</p>
                <div class="menu-models">
                  <button v-for="item in pickerModels" :key="item.id || 'default'" type="button" :aria-pressed="item.id === (settings.model || '')" @click="chooseModel(item.id)"><span>{{ item.name || item.id }}</span><AppIcon v-if="item.id === (settings.model || '')" name="check" :size="14" /></button>
                </div>
                <p class="menu-label">思考强度</p>
                <div class="menu-efforts">
                  <button v-for="value in pickerEfforts" :key="value || 'default'" type="button" :aria-pressed="value === (settings.effort || '')" @click="chooseEffort(value)">{{ effortLabel(value) }}</button>
                </div>
                <button type="button" class="menu-more" @click="moreSettings">服务商、密钥与预算…</button>
              </div>
            </Transition>
          </div>
          <button v-if="busy" class="send-button stop" data-tip="停止回答" @click="stop">停止</button>
          <button v-else class="send-button" :disabled="!prompt.trim()" data-tip="发送" :data-tip-key="sendShortcut || undefined" @click="send()">发送 ↑</button>
        </div>
        </div>
        <p v-if="status" class="ai-status" :class="{ error: statusError }" role="status">{{ status }}</p>
      </div>
  </aside>
</template>

<style scoped>
/* 阅读助手：厚玻璃面板，浮在阅读区右侧。
   玻璃只作用于面板自身，消息正文保持实底文字，对比度不打折。 */
.ai-pane{display:flex;flex-direction:column;height:100%;min-width:290px;width:368px;flex-shrink:0;background-color:var(--glass-2);background-image:var(--glass-sheen);-webkit-backdrop-filter:var(--glass-filter-2);backdrop-filter:var(--glass-filter-2);border:1px solid var(--glass-outline);border-radius:var(--r-xl);box-shadow:var(--shadow-pane),var(--glass-edge);color:var(--ink);overflow:hidden}
button{font:inherit;cursor:pointer;color:var(--control-ink)}
/* 顶部单行：模型摘要、任务数、更改与关闭。 */
.model-bar{display:flex;gap:6px;align-items:center;flex-shrink:0;padding:10px 9px 10px 15px;border-bottom:1px solid var(--separator);font-size:11.5px;color:var(--muted)}
.model-summary{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:550}
.model-bar .task-summary{flex:0 0 auto;padding:3px 7px;border:0;border-radius:var(--r-full);background:color-mix(in srgb,var(--accent) 12%,transparent);font-size:10px;font-weight:600;color:var(--accent);white-space:nowrap;font-variant-numeric:tabular-nums}
.model-bar button,.message-label button,.reset-button{font-size:11px;border:0;background:none;box-shadow:none;color:var(--control-ink);padding:0;border-radius:var(--r-full);transition:background-color var(--dur-1) var(--ease-soft)}
.model-bar button:hover:not(:disabled),.message-label button:hover:not(:disabled),.reset-button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.model-bar .close-assistant{flex:0 0 34px;width:34px;height:34px;padding:0 0 2px;border:1px solid var(--glass-outline);border-radius:50%;background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);font-size:20px;font-weight:300;line-height:20px;color:var(--control-ink)}
.model-bar .close-assistant:hover:not(:disabled){background-color:var(--control-hover);border-color:var(--glass-outline);color:var(--control-ink)}
/* 设置入口与清空动作保持完整的命中面积；选区 × 继续使用紧凑的 reset-button。 */
.model-bar .secondary-action,.composer-actions .secondary-action{flex-shrink:0;min-height:36px;padding:7px 13px;border:1px solid var(--glass-outline);border-radius:var(--r-full);background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);font-size:12px;font-weight:600;line-height:20px;color:var(--control-ink);white-space:nowrap}
.model-bar .secondary-action:hover:not(:disabled),.composer-actions .secondary-action:hover:not(:disabled){background-color:var(--control-hover);border-color:var(--glass-outline);color:var(--control-ink)}
.model-bar .secondary-action:active:not(:disabled),.composer-actions .secondary-action:active:not(:disabled){box-shadow:var(--glass-pressed-shadow)}
.ai-messages{flex:1;overflow:auto;padding:20px 18px;min-height:0;scrollbar-width:thin;
  /* iOS 27 滚动边缘：内容在面板上下沿渐隐，而不是被硬切。 */
  -webkit-mask-image:linear-gradient(180deg,transparent 0,#000 18px,#000 calc(100% - 18px),transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 18px,#000 calc(100% - 18px),transparent 100%)}
.ai-welcome{display:flex;flex-direction:column;align-items:center;text-align:center;padding:9vh 6px 8px;animation:zg-rise-in var(--dur-bounce) var(--spring-snappy) both}
/* 空对话：一枚着色玻璃徽记，下面是一句引导和三枚快捷问题胶囊。 */
.ai-welcome-mark{display:grid;place-items:center;width:58px;height:58px;margin-bottom:16px;border-radius:19px;color:var(--accent-on);background-color:var(--accent-glass);background-image:radial-gradient(circle at 30% 18%,rgb(255 255 255 / .45),transparent 58%),var(--glass-tint-sheen);box-shadow:0 14px 30px -12px color-mix(in srgb,var(--accent) 75%,transparent),inset 0 1px 0 rgb(255 255 255 / .35),inset 0 -2px 6px rgb(0 0 0 / .12)}
.ai-welcome .ai-welcome-lead{font-family:var(--font-display);font-size:16px;font-weight:650;color:var(--ink);margin:0 0 6px}
.ai-welcome p{font-size:12.5px;line-height:1.8;color:var(--muted);margin:0}
.suggestions{display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:22px;width:100%}
/* 建议是一组玻璃胶囊，与面板区分层次，同时保持可点性明确。 */
.suggestions button{max-width:100%;height:38px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:550;background-color:var(--glass-2);background-image:var(--glass-sheen);color:var(--control-ink);border:1px solid var(--glass-outline);padding:8px 16px 8px 14px;border-radius:var(--r-full);box-shadow:var(--glass-control-shadow)}
.suggestions button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.ai-message{margin-bottom:24px;animation:zg-rise-in var(--dur-bounce) var(--spring-snappy) both}
.message-label{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:11px;margin-bottom:8px;color:var(--muted)}
.message-label strong{font-weight:600}
.message-label button{height:24px;padding:0 9px;opacity:.75}
.message-label button:hover:not(:disabled){opacity:1}
.user-question,.answer-body{font-size:13.5px;line-height:1.85;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
/* 用户的问题是右侧的浅主色气泡，文字保持主题实色；助手的回答直接排在玻璃上，读起来像正文。 */
.ai-message.user{display:flex;flex-direction:column;align-items:flex-end}
.ai-message.user .message-label{flex-direction:row-reverse;width:100%}
.user .user-question{max-width:88%;padding:10px 15px;background-color:color-mix(in srgb,var(--accent-soft) 92%,transparent);background-image:var(--glass-sheen);border:1px solid color-mix(in srgb,var(--accent) 14%,transparent);border-radius:20px 20px 6px 20px;color:var(--surface-ink);text-shadow:none;box-shadow:0 6px 16px -10px color-mix(in srgb,var(--accent) 45%,transparent),inset 0 1px 0 rgb(255 255 255 / .3)}
.answer-body :deep(.inline-citation){border:0;border-radius:var(--r-full);padding:1px 8px;margin:0 2px;font-size:10.5px;background:color-mix(in srgb,var(--accent) 13%,transparent);box-shadow:none;color:var(--accent);font-weight:650;transition:background var(--dur-1) var(--ease-soft)}
.answer-body :deep(.inline-citation:hover){background:color-mix(in srgb,var(--accent) 22%,transparent);color:var(--accent)}
.answer-body :deep(.message-code){font-size:12px;border-radius:7px;background:var(--surface-3);color:var(--surface-ink);text-shadow:none;padding:2px 6px;white-space:pre-wrap;font-family:var(--font-mono)}
.answer-body :deep(pre.message-code){padding:12px 14px;overflow:auto;border-radius:var(--r-md)}
.answer-body :deep(.display-math){overflow:auto}
.answer-body :deep(.katex){font-size:1.1em}
.reasoning,.source-list{font-size:11.5px;color:var(--muted);margin:8px 0 12px}
.reasoning summary,.source-list summary{cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:var(--r-full);background:var(--fill-4);color:var(--control-ink);font-weight:550;list-style:none;transition:background-color var(--dur-1) var(--ease-soft)}
.reasoning summary::-webkit-details-marker,.source-list summary::-webkit-details-marker{display:none}
.reasoning summary::before,.source-list summary::before{content:'›';display:inline-block;font-size:14px;line-height:1;transition:transform var(--dur-bounce) var(--spring-snappy)}
.reasoning[open] summary::before,.source-list[open] summary::before{transform:rotate(90deg)}
.reasoning summary:hover,.source-list summary:hover{background-color:var(--fill-3);color:var(--control-ink)}
.reasoning p{white-space:pre-wrap;line-height:1.8;margin:10px 0 0;padding:10px 13px;border-radius:var(--r-md);background:var(--fill-4)}
.source-list button{display:block;text-align:left;border:1px solid var(--glass-outline);border-radius:var(--r-md);background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);width:100%;color:var(--control-ink);padding:10px 12px;margin-top:8px}
.source-list button:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.source-list span{font-size:11px;color:var(--accent);font-weight:650}
.source-list small{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:4px;font-size:11px;line-height:1.7}
.ai-composer{padding:10px 12px 12px;flex-shrink:0}
.document-context,.ai-selection-context label{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:8px;line-height:1.7}
.document-context{padding:0 4px 8px}
.document-context input,.ai-selection-context input{--switch-w:32px;--switch-h:19px;margin:0}
/* 输入区是一块完整的圆角输入框：文字在上，清空、快捷键与发送收在框内底部。 */
.composer-field{position:relative;border:1px solid var(--glass-outline);border-radius:22px;background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);transition:border-color var(--dur-2) var(--ease-soft),box-shadow var(--dur-2) var(--ease-soft)}
.composer-field:focus-within{border-color:color-mix(in srgb,var(--accent) 55%,transparent);box-shadow:0 0 0 4px var(--accent-ring),var(--glass-control-shadow)}
textarea{box-sizing:border-box;display:block;width:100%;resize:vertical;max-height:180px;min-height:64px;background:transparent;border:0;color:var(--control-ink);border-radius:22px 22px 0 0;font:inherit;font-size:13px;line-height:1.6;padding:12px 15px 4px;margin:0;outline:none;box-shadow:none}
textarea:hover:not(:focus),textarea:focus{background:transparent;border:0;box-shadow:none}
.composer-actions{display:flex;align-items:center;gap:8px;min-width:0;padding:4px 5px 5px 5px}
.composer-actions .clear-conversation{flex:0 0 36px;width:36px;padding:0;border-radius:50%;font-size:12px}
.composer-actions .secondary-action{border-color:transparent;background-color:var(--fill-4);background-image:none;box-shadow:none;font-weight:550}
.composer-actions .secondary-action::before{content:none}
.composer-actions .secondary-action:hover:not(:disabled){background-color:var(--fill-2);border-color:transparent}
/* 发送是一枚着色玻璃胶囊：主色染透材质，前景固定为 accent-on。 */
.send-button{flex-shrink:0;min-height:36px;white-space:nowrap;border:1px solid transparent;border-radius:var(--r-full);color:var(--accent-on);background-color:var(--accent-glass);background-image:var(--glass-tint-sheen);padding:7px 17px;font-size:12.5px;font-weight:650;box-shadow:0 6px 16px -8px color-mix(in srgb,var(--accent) 70%,transparent),inset 0 1px 0 rgb(255 255 255 / .25)}
.send-button:hover:not(:disabled){background-color:var(--accent-glass-hover);color:var(--accent-on);box-shadow:0 8px 20px -8px color-mix(in srgb,var(--accent) 80%,transparent),inset 0 1px 0 rgb(255 255 255 / .3)}
.send-button:disabled{background-color:var(--fill-2);background-image:none;color:var(--control-ink);box-shadow:none}
.send-button.stop{background-color:color-mix(in srgb,var(--danger) 16%,var(--glass-2));border-color:color-mix(in srgb,var(--danger) 30%,transparent);color:var(--control-ink);box-shadow:none}
.send-button.stop:hover:not(:disabled){background-color:color-mix(in srgb,var(--danger) 24%,var(--glass-2));color:var(--control-ink)}
button:disabled{opacity:.42;cursor:default}
/* 模型与思考强度：发送键旁的一枚胶囊，展开为向上弹出的实底菜单。菜单独占合成层：否则输入框的滚动层会被画在菜单之上。 */
.model-picker-host{position:relative;flex:1 1 auto;min-width:0;display:flex;justify-content:flex-end}
.model-picker{display:flex;align-items:center;gap:6px;max-width:100%;min-width:0;height:36px;padding:0 10px 0 12px;border:0;border-radius:var(--r-full);background:var(--fill-4);box-shadow:none;font-size:12px;color:var(--control-ink);transition:background-color var(--dur-1) var(--ease-soft)}
.model-picker:hover:not(:disabled),.model-picker[aria-expanded='true']{background:var(--fill-2)}
.picker-model{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.picker-effort{flex:0 0 auto;padding:1px 7px;border-radius:var(--r-full);background:color-mix(in srgb,var(--accent) 13%,transparent);color:var(--accent);font-size:10.5px;font-weight:650}
.picker-chevron{flex:0 0 auto;opacity:.55;transition:transform var(--dur-bounce) var(--spring-snappy)}
.model-picker[aria-expanded='true'] .picker-chevron{transform:rotate(180deg)}
.model-menu{position:absolute;right:-6px;bottom:calc(100% + 12px);z-index:20;width:min(256px,calc(100vw - 32px));max-height:min(380px,60vh);overflow:auto;padding:8px;border:1px solid var(--glass-outline);border-radius:var(--r-lg);background-color:var(--surface);background-image:var(--popup-sheen);box-shadow:var(--shadow-3),var(--glass-edge);color:var(--surface-ink);transform-origin:85% 100%;scrollbar-width:thin;will-change:transform}
.menu-label{margin:4px 8px 6px;font-size:10.5px;font-weight:600;letter-spacing:.4px;color:var(--surface-muted)}
.menu-models{display:grid;gap:1px;margin-bottom:8px}
.menu-models button{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:34px;padding:6px 10px;border:0;border-radius:10px;background:transparent;box-shadow:none;font-size:12.5px;text-align:left;color:var(--surface-ink)}
.menu-models button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.menu-models button:hover{background:var(--fill-3)}
.menu-models button[aria-pressed='true']{background:color-mix(in srgb,var(--accent) 12%,transparent);font-weight:600}
.menu-models button svg{color:var(--accent)}
.menu-efforts{display:flex;flex-wrap:wrap;gap:5px;padding:0 4px 8px}
.menu-efforts button{height:30px;padding:0 11px;border:1px solid var(--glass-outline);border-radius:var(--r-full);background:var(--fill-4);box-shadow:none;font-size:12px;color:var(--surface-ink)}
.menu-efforts button:hover{background:var(--fill-3)}
.menu-efforts button[aria-pressed='true']{background:var(--accent-glass);border-color:transparent;color:var(--accent-on);font-weight:600}
.menu-more{display:block;width:100%;margin-top:2px;padding:8px 10px;border:0;border-top:1px solid var(--separator);border-radius:0 0 10px 10px;background:transparent;box-shadow:none;text-align:left;font-size:12px;color:var(--accent)}
.menu-more:hover{background:var(--fill-4)}
.picker-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-snappy)}
.picker-leave-active{transition:opacity var(--dur-1) var(--ease-out),transform var(--dur-1) var(--ease-out)}
.picker-enter-from,.picker-leave-to{opacity:0;transform:translateY(8px) scale(.9)}
.ai-status{font-size:11px;line-height:1.6;color:var(--muted);margin:10px 2px 0;overflow-wrap:anywhere}
.ai-status.error{color:var(--danger)}
.ai-selection-context{--ink:var(--surface-ink);--control-ink:var(--surface-ink);--secondary:var(--surface-secondary);--muted:var(--surface-muted);--control-hover:color-mix(in srgb,var(--surface-ink) 7%,var(--surface-2));--glass-label-shadow:none;padding:9px 10px 10px 12px;background:var(--surface-2);color:var(--surface-ink);text-shadow:none;border:1px solid var(--line-soft);border-radius:var(--r-md);margin-bottom:10px;box-shadow:inset 0 1px 0 rgb(255 255 255 / .3)}
.ai-selection-context .reset-button{width:20px;height:20px;font-size:13px;line-height:1}
.ai-selection-context p{font-size:11px;line-height:1.6;margin:5px 0 0;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ai-selection-context img{max-height:90px;max-width:100%;object-fit:contain;margin-top:6px;border-radius:8px}
@media(prefers-reduced-motion:reduce){.ai-message{animation:none}}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more){.ai-messages{-webkit-mask-image:none;mask-image:none}}
</style>
