<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
import 'katex/dist/katex.min.css'
import { getProvider, getNativeModels, getNativeStatus } from '../ai/providers.mjs'
import { nativeModelInventory, registerNativeModelInventory } from '../ai/native-models'
import { chatState, sendChat, stopChat, configureRequests, taskSummary, conversations, activeConversationId, selectConversation, newConversation, deleteConversation, loadConversations, conversationTokens, contextWindow, estimateTokens, type Message } from '../ai/workspace'
import { renderMarkdown, renderDiagrams } from '../ai/render'
import { loadAiSettings, saveModelChoice } from '../ai/settings.mjs'
import { useSettings } from '../settings'
import AppIcon from './AppIcon.vue'
const ModelPicker = defineAsyncComponent(() => import('./ModelPicker.vue'))

const props = defineProps<{ document: { id: string; title: string; kind: string }; context: any; sendShortcut?: string; consumeCapture?: (value: { documentId: string; selection: any }) => void; conversationId?: string; draggable?: boolean }>()
const emit = defineEmits<{ jump: [value: { page: number; rect?: any; line?: number }]; close: []; settings: []; error: [value: string]; clearSelection: []; conversation: [id: string]; grab: [event: PointerEvent] }>()
const settings = ref<any>(loadAiSettings())
const conversationId = ref(props.conversationId || activeConversationId(props.document.id))
const state = computed(() => chatState(props.document.id, conversationId.value))
const messages = computed(() => state.value.messages)
const prompt = computed({ get: () => state.value.draft, set: value => { state.value.draft = value } })
const busy = computed(() => Boolean(state.value.request))
const errorText = computed(() => state.value.error ? state.value.status : '')
// 只给读屏软件的进度播报；界面上用思考气泡与回答尾部表达同样的状态。
const liveStatus = computed(() => {
  if (errorText.value) return errorText.value
  const last = messages.value.at(-1)
  if (!last || last.role !== 'assistant') return ''
  if (busy.value && !last.finishedAt) return last.activity || '正在回答'
  return last.stopped ? '回答已停止，已收到的内容保留。' : last.failed ? '' : '回答完成。'
})
const includeDocument = computed({ get: () => state.value.includeDocument, set: value => { state.value.includeDocument = value } })
const includeSelection = computed({ get: () => state.value.includeSelection, set: value => { state.value.includeSelection = value } })
const title = computed(() => state.value.title || '新对话')
const history = computed(() => conversations(props.document.id).filter(item => item.messages.length || item.id === conversationId.value))
const messageList = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
const selected = computed(() => props.context?.selection || {})
const hasSelection = computed(() => Boolean(selected.value.text || selected.value.image))
const { preferences, effectiveAppearance } = useSettings()
const suggestions = computed(() => preferences.value.assistant.quickPrompts)
const dark = computed(() => document.documentElement.dataset.theme === 'dark' || effectiveAppearance.value.theme === 'dark')

// ---- Conversations -------------------------------------------------------
const historyOpen = ref(false)
function useConversation(id: string) {
  conversationId.value = id
  if (!props.conversationId) selectConversation(props.document.id, id)
  emit('conversation', id)
  historyOpen.value = false
  void nextTick(() => { restoreScroll(); input.value?.focus() })
}
function startConversation() {
  const fresh = newConversation(props.document.id)
  useConversation(fresh.id)
}
function removeConversation(id: string) {
  deleteConversation(props.document.id, id)
  if (id === conversationId.value) useConversation(activeConversationId(props.document.id))
}
function relative(time: number) {
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const date = new Date(time)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}
watch(() => props.document.id, id => {
  rememberScroll()
  conversationId.value = props.conversationId || activeConversationId(id)
  settings.value = loadAiSettings()
  historyOpen.value = false; pickerOpen.value = false
  void loadConversations(id).then(() => { if (id === props.document.id && !props.conversationId) conversationId.value = activeConversationId(id) })
  void nextTick(restoreScroll)
}, { flush: 'sync' })
watch(() => props.conversationId, id => { if (id) conversationId.value = id })

// ---- Live timing and token counts -----------------------------------------
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
watch(busy, value => {
  clearInterval(ticker); ticker = undefined
  if (value) ticker = setInterval(() => { now.value = Date.now() }, 200)
  now.value = Date.now()
}, { immediate: true })
const live = (message: Message) => Boolean(busy.value && message === messages.value.at(-1) && message.role === 'assistant' && !message.finishedAt)
function seconds(ms: number) { return ms < 60000 ? `${Math.max(0, ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` }
function count(value?: number) { return !value ? '0' : value < 1000 ? String(value) : `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k` }
function elapsed(message: Message) { return seconds((message.finishedAt || now.value) - (message.startedAt || now.value)) }
function thinkingTime(message: Message) { return seconds((message.firstTokenAt || message.finishedAt || now.value) - (message.startedAt || now.value)) }
function outputTokens(message: Message) { return message.usage?.output ?? (estimateTokens(message.content) + estimateTokens(message.reasoning || '')) }
function lastThought(message: Message) {
  const lines = (message.reasoning || '').trim().split(/\n+/).filter(Boolean)
  return lines.at(-1)?.replace(/^[#*\-\s]+/, '').slice(0, 160) || ''
}
const expanded = ref(new Set<string>())
function toggleReasoning(id: string) { const next = new Set(expanded.value); if (next.has(id)) next.delete(id); else next.add(id); expanded.value = next }
const contextUsed = computed(() => conversationTokens(state.value))
const contextLimit = computed(() => contextWindow(settings.value.provider, settings.value.model || ''))
const contextRatio = computed(() => Math.min(1, contextUsed.value / Math.max(1, contextLimit.value)))

// ---- Answer rendering ----------------------------------------------------
function jump(source: any) { emit('jump', { page: source.page, rect: source.rect, ...(source.line ? { line: source.line } : {}) }) }
const renderTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()
function renderAnswer(element: HTMLElement, message: Message) {
  element.innerHTML = renderMarkdown(message.content)
  const sourceMap = new Map(message.sources.map(source => [source.sourceId, source]))
  if (sourceMap.size) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes: Node[] = []
    while (walker.nextNode()) if (!(walker.currentNode.parentElement?.closest('pre,code,.katex,button'))) nodes.push(walker.currentNode)
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
  if (message.finishedAt) void renderDiagrams(element, dark.value)
}
// Streaming answers re-render at most every 90ms; markdown and KaTeX stay cheap.
function scheduleRender(element: HTMLElement, message: Message) {
  if (message.finishedAt || !renderTimers.has(element)) {
    clearTimeout(renderTimers.get(element)); renderTimers.delete(element)
    renderAnswer(element, message)
    if (!message.finishedAt) renderTimers.set(element, setTimeout(() => { renderTimers.delete(element); renderAnswer(element, message) }, 90))
    return
  }
}
const vAnswer = {
  mounted: (el: HTMLElement, binding: any) => renderAnswer(el, binding.value),
  updated: (el: HTMLElement, binding: any) => scheduleRender(el, binding.value),
  beforeUnmount: (el: HTMLElement) => { clearTimeout(renderTimers.get(el)); renderTimers.delete(el) },
}
function answerClick(event: MouseEvent) {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-copy]')
  if (!button) return
  const code = button.closest('.answer-code-block')?.querySelector('code')?.textContent || ''
  void copy(code).then(ok => { if (ok) { button.textContent = '已复制'; setTimeout(() => { button.textContent = '复制' }, 1400) } })
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch { state.value.status = '复制失败，请手动选择文字。'; state.value.error = true; return false }
}

// ---- Scrolling and the question navigator ---------------------------------
let renderFrame = 0
function restoreScroll() { if (messageList.value) messageList.value.scrollTop = state.value.scrollTop }
function rememberScroll() { if (messageList.value) state.value.scrollTop = messageList.value.scrollTop; updateRail() }
function nearBottom() { const list = messageList.value; return !list || list.scrollHeight - list.scrollTop - list.clientHeight < 80 }
let follow = true
function scroll() { void nextTick(() => { if (messageList.value && follow) messageList.value.scrollTop = messageList.value.scrollHeight; updateRail() }) }
function scheduleScroll() { if (!renderFrame) renderFrame = requestAnimationFrame(() => { renderFrame = 0; scroll() }) }
watch(() => [conversationId.value, messages.value.length, messages.value.at(-1)?.content, messages.value.at(-1)?.reasoning], (value, previous) => {
  if (value[0] !== previous?.[0]) return
  if (value[1] !== previous?.[1]) follow = true
  scheduleScroll()
})
function onScroll() { follow = nearBottom(); rememberScroll() }
type Mark = { id: string; top: number; text: string; answer: string; current: boolean }
const marks = ref<Mark[]>([])
const hoverMark = ref<Mark | null>(null)
function updateRail() {
  const list = messageList.value
  if (!list) return
  const height = Math.max(1, list.scrollHeight)
  const users = [...list.querySelectorAll<HTMLElement>('.ai-message.user')]
  if (users.length < 2) { marks.value = []; return }
  const view = list.scrollTop + list.clientHeight / 3
  let current = -1
  users.forEach((element, index) => { if (element.offsetTop <= view) current = index })
  marks.value = users.map((element, index) => {
    const message = messages.value.find(item => item.id === element.dataset.id)
    const answer = messages.value[messages.value.indexOf(message!) + 1]
    return { id: element.dataset.id || '', top: element.offsetTop / height, text: message?.content || '', answer: answer?.content.replace(/\s+/g, ' ').slice(0, 120) || '', current: index === current }
  })
}
function goToMark(mark: Mark) {
  follow = false
  messageList.value?.querySelector<HTMLElement>(`.ai-message.user[data-id="${CSS.escape(mark.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
let observer: ResizeObserver | undefined

// ---- Composer: resizable field, context switch, model card -----------------
const COMPOSER_KEY = 'kaizhi.composer.height'
const composerHeight = ref(Number(localStorage.getItem(COMPOSER_KEY)) || 76)
let resizeStart: { y: number; height: number } | undefined
function startResize(event: PointerEvent) {
  resizeStart = { y: event.clientY, height: composerHeight.value }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function resize(event: PointerEvent) {
  if (!resizeStart) return
  const limit = Math.max(120, (messageList.value?.parentElement?.clientHeight || 600) * .6)
  composerHeight.value = Math.round(Math.min(limit, Math.max(52, resizeStart.height + resizeStart.y - event.clientY)))
}
function endResize() { if (!resizeStart) return; resizeStart = undefined; try { localStorage.setItem(COMPOSER_KEY, String(composerHeight.value)) } catch {} }
function resetResize() { composerHeight.value = 76; try { localStorage.removeItem(COMPOSER_KEY) } catch {} }
const EFFORT_LABELS: Record<string, string> = { '': '默认', none: '不思考', minimal: '极简', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极致' }
const pickerOpen = ref(false)
const pickerHost = ref<HTMLElement>()
const pickerLoading = ref(false)
const pickerError = ref('')
let pickerRequest: AbortController | undefined
const pickerModels = computed<{ id: string; name: string; efforts?: string[]; defaultEffort?: string }[]>(() => {
  const list: any[] = settings.value.provider === 'codex' ? nativeModelInventory.value : getProvider(settings.value.provider)?.models || []
  const current = settings.value.model || ''
  const extra = settings.value.provider === 'codex' && !list.some(item => !item.id) ? [{ id: '', name: '模型默认' }] : []
  const custom = current && !list.some(item => item.id === current) ? [{ id: current, name: current }] : []
  return [...extra, ...custom, ...list]
})
const modelLabel = computed(() => pickerModels.value.find(item => item.id === (settings.value.model || ''))?.name || settings.value.model || '默认模型')
function commitChoice(model: string, effort: string) { saveModelChoice(model, effort); settings.value = loadAiSettings() }
function chooseModel(id: string) {
  const model = pickerModels.value.find(item => item.id === id)
  let effort = settings.value.effort || ''
  if (effort && model?.efforts && !model.efforts.includes(effort)) effort = model.defaultEffort || ''
  commitChoice(id, effort)
}
function chooseEffort(value: string) { commitChoice(settings.value.model || '', value) }
function pickerOutside(event: PointerEvent) { if (event.target instanceof Node && !pickerHost.value?.contains(event.target)) pickerOpen.value = false }
async function refreshPickerModels() {
  if (pickerLoading.value || settings.value.provider !== 'codex') return
  pickerError.value = ''
  if (!(globalThis as any).__TAURI_INTERNALS__) { pickerError.value = '完整模型列表需在 Windows 桌面版中读取。'; return }
  const request = new AbortController()
  pickerRequest = request; pickerLoading.value = true
  try {
    const info: any = await getNativeStatus(request.signal)
    if (!info.compatible || !info.loggedIn) throw new Error(info.diagnostic || (info.loggedIn === false ? 'Codex 尚未登录。请先在 Codex 中登录。' : '未找到可用 Codex。'))
    const list: any[] = await getNativeModels(request.signal)
    if (request.signal.aborted || pickerRequest !== request) return
    registerNativeModelInventory(list)
    if (!list.length) pickerError.value = '未读取到可用模型，可重新读取或打开 AI 设置。'
  } catch (cause: any) {
    if (!request.signal.aborted && pickerRequest === request) pickerError.value = cause?.message || String(cause)
  } finally { if (pickerRequest === request) { pickerRequest = undefined; pickerLoading.value = false } }
}
watch(pickerOpen, open => {
  if (open) {
    document.addEventListener('pointerdown', pickerOutside, true)
    if (settings.value.provider === 'codex' && !nativeModelInventory.value.length) void refreshPickerModels()
  } else {
    document.removeEventListener('pointerdown', pickerOutside, true)
    pickerRequest?.abort(); pickerRequest = undefined; pickerLoading.value = false
  }
})
watch(busy, value => { if (value) pickerOpen.value = false })
function moreSettings() { pickerOpen.value = false; emit('settings') }
function closePicker() { pickerOpen.value = false; void nextTick(() => pickerHost.value?.querySelector<HTMLElement>('.model-picker')?.focus()) }
function historyOutside(event: PointerEvent) { if (!(event.target as Element)?.closest?.('.history-host')) historyOpen.value = false }
watch(historyOpen, open => { if (open) document.addEventListener('pointerdown', historyOutside, true); else document.removeEventListener('pointerdown', historyOutside, true) })

watch(() => props.context?.selection, selection => { includeSelection.value = Boolean(selection?.text || selection?.image) }, { immediate: true })
function focusPrompt() { void nextTick(() => input.value?.focus()) }
function stop() { stopChat(props.document.id, conversationId.value) }
function applySettings(value: any) { settings.value = value; configureRequests(value) }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229 && !props.sendShortcut) { event.preventDefault(); void send() }
}
function send(question?: string) {
  const id = props.document.id
  const selection = props.context?.selection
  const usesImage = includeSelection.value && Boolean(selection?.image)
  const consumeCapture = props.consumeCapture
  follow = true
  return sendChat({ ...props.document }, { ...props.context }, () => { if (id === props.document.id) emit('settings') }, () => {
    // The request can be accepted after this pane closes or switches files.
    if (usesImage) consumeCapture?.({ documentId: id, selection })
  }, question, { conversationId: conversationId.value })
}
onMounted(() => {
  void loadConversations(props.document.id).then(() => { if (!props.conversationId) conversationId.value = activeConversationId(props.document.id) })
  restoreScroll()
  observer = new ResizeObserver(() => updateRail())
  if (messageList.value) observer.observe(messageList.value)
})
onBeforeUnmount(() => { rememberScroll(); clearInterval(ticker); observer?.disconnect(); if (renderFrame) cancelAnimationFrame(renderFrame); pickerRequest?.abort(); document.removeEventListener('pointerdown', pickerOutside, true); document.removeEventListener('pointerdown', historyOutside, true) })
defineExpose({ send, stop, applySettings, focusPrompt, newConversation: startConversation })
</script>

<template>
  <aside class="ai-pane" aria-label="AI 阅读助手">
    <header class="ai-header" :class="{ draggable }" @pointerdown.self="draggable && emit('grab', $event)">
      <span v-if="draggable" class="drag-grip" data-tip="拖动调整位置" aria-hidden="true" @pointerdown.stop="emit('grab', $event)"><AppIcon name="grip" :size="14" /></span>
      <div class="history-host">
        <button class="conversation-title" :aria-expanded="historyOpen" aria-label="对话记录" data-tip="对话记录" @click="historyOpen = !historyOpen"><span class="title-text">{{ title }}</span><small>{{ document.title }}</small></button>
        <Transition name="history-pop">
          <div v-if="historyOpen" class="history-menu" role="dialog" aria-label="对话记录">
            <button class="history-new" @click="startConversation"><AppIcon name="compose" :size="15" />新对话</button>
            <p class="history-label">这份文档的对话</p>
            <div class="history-list">
              <div v-for="item in history" :key="item.id" class="history-item" :class="{ current: item.id === conversationId }">
                <button class="history-open" @click="useConversation(item.id)"><span>{{ item.title || '新对话' }}</span><small>{{ relative(item.updatedAt) }} · {{ Math.ceil(item.messages.length / 2) }} 问<template v-if="item.request"> · 回答中</template></small></button>
                <button v-if="item.messages.length" class="history-delete" :aria-label="`删除对话 ${item.title}`" data-tip="删除这段对话" @click.stop="removeConversation(item.id)"><AppIcon name="trash" :size="13" /></button>
              </div>
              <p v-if="!history.length" class="history-empty">还没有对话。</p>
            </div>
          </div>
        </Transition>
      </div>
      <span v-if="taskSummary.running || taskSummary.queued" class="task-summary" :data-tip="`同时最多 ${taskSummary.limits.concurrent} 题，Codex ${taskSummary.limits.codex} 题`">{{ taskSummary.running }} 运行<template v-if="taskSummary.queued"> · {{ taskSummary.queued }} 等待</template></span>
      <button class="header-button" aria-label="新对话" data-tip="新对话" :disabled="!messages.length" @click="startConversation"><AppIcon name="compose" :size="16" /></button>
      <button class="header-button close-assistant" data-tip="关闭阅读助手" aria-label="关闭阅读助手" @click="emit('close')"><AppIcon name="close" :size="15" /></button>
    </header>

    <div class="ai-body">
      <div v-if="marks.length" class="question-rail" aria-label="问题导航">
        <button v-for="mark in marks" :key="mark.id" class="rail-mark" :class="{ current: mark.current }" :style="{ top: `calc(${mark.top} * (100% - 24px) + 12px)` }" :aria-label="`跳到问题：${mark.text.slice(0, 30)}`" @click="goToMark(mark)" @pointerenter="hoverMark = mark" @pointerleave="hoverMark = null" @focus="hoverMark = mark" @blur="hoverMark = null" />
        <Transition name="rail-pop"><div v-if="hoverMark" class="rail-preview" :style="{ top: `calc(${hoverMark.top} * (100% - 24px) + 12px)` }"><strong>{{ hoverMark.text }}</strong><p v-if="hoverMark.answer">{{ hoverMark.answer }}</p></div></Transition>
      </div>
      <div ref="messageList" class="ai-messages" @scroll="onScroll" @click="answerClick">
        <div v-if="!messages.length" class="ai-welcome">
          <div class="ai-welcome-mark" aria-hidden="true"><AppIcon name="sparkle" :size="24" /></div>
          <p class="ai-welcome-lead">关于这份文档，想了解什么？</p>
          <p>可以直接提问，也可以选取文字或框选图表。</p>
          <div class="suggestions"><button v-for="(suggestion, index) in suggestions" :key="index" :data-tip="suggestion.question" :disabled="busy" @click="send(suggestion.question)">{{ suggestion.label }}</button></div>
        </div>
        <article v-for="message in messages" :key="message.id" class="ai-message" :class="message.role" :data-id="message.id">
          <template v-if="message.role === 'user'">
            <div class="user-question">{{ message.content }}</div>
          </template>
          <template v-else>
            <button v-if="live(message) || message.reasoning" class="thinking" :class="{ live: live(message), open: expanded.has(message.id) }" :aria-expanded="expanded.has(message.id)" @click="toggleReasoning(message.id)">
              <span class="thinking-star" aria-hidden="true"><AppIcon name="sparkle" :size="13" /></span>
              <span class="thinking-label">{{ live(message) ? (message.activity || '思考中') : `已思考 ${thinkingTime(message)}` }}</span>
              <span class="thinking-meta">{{ live(message) ? elapsed(message) : '' }}<template v-if="live(message)"> · {{ message.usage?.estimated === false ? '' : '约 ' }}{{ count(outputTokens(message)) }} tokens</template></span>
              <AppIcon v-if="message.reasoning" class="thinking-chevron" name="down" :size="12" />
            </button>
            <p v-if="live(message) && !expanded.has(message.id) && lastThought(message)" class="thinking-direction">{{ lastThought(message) }}</p>
            <div v-if="message.reasoning && expanded.has(message.id)" class="reasoning-body">{{ message.reasoning }}</div>
            <div v-if="message.content" v-answer="message" class="answer-body" />
            <details v-if="message.sources.length" class="source-list"><summary>参考原文 · {{ message.sources.length }} 段</summary><button v-for="source in message.sources" :key="source.sourceId" @click="jump(source)"><span>{{ source.line ? `第 ${source.line} 行` : `第 ${source.page} 页` }}</span><small>{{ source.text }}</small></button></details>
            <div v-if="!live(message)" class="answer-meta">
              <button v-if="message.content" class="meta-button" aria-label="复制回答" data-tip="复制回答" @click="copy(message.content)"><AppIcon name="copy" :size="13" /></button>
              <span v-if="message.stopped" class="meta-flag">已停止</span>
              <span v-else-if="message.failed" class="meta-flag error">未完成</span>
              <span v-if="message.startedAt && message.finishedAt" class="meta-text" :data-tip="message.usage?.estimated === false ? '服务返回的用量' : '按字数估算的用量'">{{ elapsed(message) }}<template v-if="message.usage?.input"> · 输入 {{ message.usage.estimated ? '约 ' : '' }}{{ count(message.usage.input) }}</template> · 输出 {{ message.usage?.estimated === false ? '' : '约 ' }}{{ count(outputTokens(message)) }} tokens</span>
            </div>
          </template>
        </article>
        <p v-if="errorText" class="ai-error">{{ errorText }}</p>
        <p class="ai-status" role="status" aria-live="polite">{{ liveStatus }}</p>
      </div>
    </div>

    <div class="ai-composer">
      <div class="composer-field" :class="{ busy }">
        <div class="composer-resize" role="separator" aria-orientation="horizontal" aria-label="拖动调整输入框高度" data-tip="拖动调整高度，双击恢复" @pointerdown="startResize" @pointermove="resize" @pointerup="endResize" @pointercancel="endResize" @dblclick="resetResize" />
        <div v-if="hasSelection" class="ai-selection-context">
          <label class="selection-chip" :class="{ off: !includeSelection }"><input v-model="includeSelection" type="checkbox" :disabled="busy" :aria-label="selected.image ? `使用第 ${selected.page} 页截图` : '使用所选文字'" /><img v-if="selected.image" :src="selected.image" alt="选取的截图预览" /><span v-else class="selection-text">{{ selected.text.slice(0, 80) }}</span><small>{{ selected.image ? `第 ${selected.page} 页截图` : '所选文字' }}</small></label>
          <button class="chip-remove" data-tip="清除选区" aria-label="清除选区" @click="emit('clearSelection')"><AppIcon name="close" :size="11" /></button>
        </div>
        <textarea ref="input" v-model="prompt" :style="{ height: `${composerHeight}px` }" placeholder="询问这份文档…" aria-label="向 AI 提问" @keydown="keydown" />
        <div class="composer-actions">
          <label class="context-switch" :class="{ on: includeDocument }" data-tip="提问时附带当前页与文档检索"><input v-model="includeDocument" type="checkbox" :disabled="busy" aria-label="当前页上下文与文档检索" /><AppIcon name="book" :size="14" /><span>文档上下文</span></label>
          <span class="composer-space" />
          <span class="context-ring" :data-tip="`上下文约 ${count(contextUsed)} / ${count(contextLimit)} tokens`" aria-hidden="true" :style="{ '--ratio': contextRatio }"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" /><circle class="ring-value" cx="10" cy="10" r="7.5" pathLength="100" /></svg></span>
          <div ref="pickerHost" class="model-picker-host">
            <button type="button" class="model-picker" :disabled="busy" aria-haspopup="dialog" :aria-expanded="pickerOpen" aria-label="选择模型与思考强度" data-tip="模型与思考强度" @click="pickerOpen = !pickerOpen"><span class="picker-model">{{ modelLabel }}</span><span class="picker-effort">{{ EFFORT_LABELS[settings.effort || ''] || settings.effort }}</span><AppIcon name="down" :size="12" class="picker-chevron" /></button>
            <Transition name="picker"><ModelPicker v-if="pickerOpen" :model="settings.model || ''" :effort="settings.effort || ''" :models="pickerModels" :loading="pickerLoading" :error="pickerError" :can-refresh="settings.provider === 'codex'" @model="chooseModel" @effort="chooseEffort" @refresh="refreshPickerModels" @more="moreSettings" @close="closePicker" /></Transition>
          </div>
          <button v-if="busy" class="send-button stop" aria-label="停止" data-tip="停止回答" @click="stop"><span class="stop-square" /></button>
          <button v-else class="send-button" :disabled="!prompt.trim()" aria-label="发送" data-tip="发送" :data-tip-key="sendShortcut || 'Enter'" @click="send()"><AppIcon name="arrow-up" :size="17" /></button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 阅读助手：一块厚实的面板。文字区用接近实底的材质，任何底板图片上都看得清。 */
.ai-pane{--ink:var(--surface-ink);--control-ink:var(--surface-ink);--secondary:var(--surface-secondary);--muted:var(--surface-muted);display:flex;flex-direction:column;height:100%;min-width:0;width:100%;background-color:var(--panel-solid);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));border:1px solid var(--glass-outline);border-radius:var(--r-xl);box-shadow:var(--shadow-pane),var(--glass-edge);color:var(--surface-ink);overflow:hidden;font-family:var(--font-ui)}
button{font:inherit;cursor:pointer;color:var(--surface-ink)}
button:disabled{opacity:.4;cursor:default}
/* 头部：当前对话标题（点开是对话记录）、新对话与关闭。 */
.ai-header{display:flex;align-items:center;gap:4px;flex-shrink:0;height:54px;padding:0 8px 0 10px;border-bottom:1px solid var(--line-soft)}
.ai-header.draggable{cursor:grab}
.drag-grip{display:grid;place-items:center;width:18px;height:30px;margin-right:-2px;border-radius:6px;color:var(--surface-muted);cursor:grab;opacity:.6}
.drag-grip:hover{background:var(--fill-3);opacity:1}
.history-host{position:relative;flex:1;min-width:0}
.conversation-title{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;max-width:100%;height:42px;padding:0 10px;border:0;border-radius:12px;background:none;box-shadow:none;text-align:left}
.conversation-title:hover,.conversation-title[aria-expanded='true']{background:var(--fill-3)}
.title-text{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:650;letter-spacing:.1px}
.conversation-title small{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--surface-muted)}
.header-button{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;padding:0;border:0;border-radius:11px;background:none;box-shadow:none;color:var(--surface-secondary)}
.header-button:hover:not(:disabled){background:var(--fill-3);color:var(--surface-ink)}
.task-summary{flex:0 0 auto;padding:3px 8px;border-radius:999px;background:var(--fill-3);font-size:10.5px;font-weight:600;color:var(--surface-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.history-menu{position:absolute;left:0;top:calc(100% + 6px);z-index:30;width:min(300px,calc(100vw - 40px));max-height:min(420px,60vh);display:flex;flex-direction:column;padding:8px;border-radius:18px;background:var(--surface);border:1px solid var(--line);box-shadow:0 18px 48px -14px rgb(0 0 0 / .35);transform-origin:20px 0}
.history-new{display:flex;align-items:center;gap:8px;height:38px;padding:0 12px;border:0;border-radius:12px;background:var(--fill-4);box-shadow:none;font-size:13px;font-weight:600}
.history-new:hover{background:var(--fill-3)}
.history-label{margin:12px 10px 6px;font-size:11px;font-weight:600;color:var(--surface-muted)}
.history-list{overflow:auto;min-height:0;scrollbar-width:thin}
.history-item{position:relative;display:flex;align-items:center;border-radius:12px}
.history-item:hover,.history-item.current{background:var(--fill-4)}
.history-item.current{background:var(--fill-3)}
.history-open{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 12px;border:0;background:none;box-shadow:none;text-align:left}
.history-open span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:550}
.history-open small{font-size:10.5px;color:var(--surface-muted)}
.history-delete{display:grid;place-items:center;width:28px;height:28px;margin-right:6px;padding:0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--surface-muted);opacity:0}
.history-item:hover .history-delete,.history-delete:focus-visible{opacity:1}
.history-delete:hover{background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger)}
.history-empty{margin:10px;font-size:12px;color:var(--surface-muted)}
.history-pop-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-snappy)}
.history-pop-leave-active{transition:opacity var(--dur-1) var(--ease-out),transform var(--dur-1) var(--ease-out)}
.history-pop-enter-from,.history-pop-leave-to{opacity:0;transform:translateY(-6px) scale(.95)}
/* 消息区与左侧问题导航条。 */
.ai-body{position:relative;flex:1;min-height:0;display:flex}
.ai-messages{flex:1;min-width:0;overflow:auto;padding:18px 18px 8px 26px;scrollbar-width:thin;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%)}
.question-rail{position:absolute;left:4px;top:0;bottom:0;width:16px;z-index:5}
.rail-mark{position:absolute;left:2px;width:10px;height:3px;padding:0;border:0;border-radius:2px;background:color-mix(in srgb,var(--surface-ink) 22%,transparent);box-shadow:none;transform:translateY(-50%);transition:width var(--dur-2) var(--spring-snappy),background var(--dur-1) var(--ease-soft)}
.rail-mark::before{content:'';position:absolute;inset:-5px -4px}
.rail-mark:hover,.rail-mark:focus-visible{width:14px;background:var(--surface-ink)}
.rail-mark.current{width:14px;background:color-mix(in srgb,var(--surface-ink) 70%,transparent)}
.rail-preview{position:absolute;left:22px;z-index:6;width:min(250px,calc(100% - 10px));padding:10px 12px;border-radius:14px;background:var(--surface);border:1px solid var(--line);box-shadow:0 14px 34px -12px rgb(0 0 0 / .3);transform:translateY(-50%);pointer-events:none}
.rail-preview strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12.5px;font-weight:600;line-height:1.5}
.rail-preview p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:6px 0 0;font-size:11.5px;line-height:1.55;color:var(--surface-muted)}
.rail-pop-enter-active,.rail-pop-leave-active{transition:opacity var(--dur-1) var(--ease-out)}
.rail-pop-enter-from,.rail-pop-leave-to{opacity:0}
.ai-welcome{display:flex;flex-direction:column;align-items:center;text-align:center;padding:8vh 6px 8px;animation:zg-rise-in var(--dur-bounce) var(--spring-snappy) both}
.ai-welcome-mark{display:grid;place-items:center;width:48px;height:48px;margin-bottom:14px;border-radius:15px;color:var(--brand-ink);background:var(--brand-solid);animation:zg-pop-in var(--dur-bounce) var(--spring-bouncy) both}
.ai-welcome-lead{font-family:var(--font-display);font-size:16px;font-weight:650;margin:0 0 6px}
.ai-welcome p{font-size:12.5px;line-height:1.8;color:var(--surface-muted);margin:0}
.suggestions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:20px}
.suggestions button{max-width:100%;height:34px;padding:0 14px;border:1px solid var(--line);border-radius:999px;background:var(--surface);box-shadow:none;font-size:12.5px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.suggestions button:hover:not(:disabled){background:var(--fill-4);border-color:var(--line-strong)}
.ai-message{margin-bottom:22px;animation:zg-rise-in var(--dur-3) var(--ease-out) both}
.ai-message.user{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.user-question{max-width:88%;padding:9px 14px;border-radius:18px 18px 6px 18px;background:var(--fill-3);font-size:13.5px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}
/* 思考：一行「思考中 · 用时 · token」，文字有流光；展开看完整思路。 */
.thinking{display:inline-flex;align-items:center;gap:7px;max-width:100%;height:28px;padding:0 10px 0 8px;margin-bottom:6px;border:0;border-radius:999px;background:none;box-shadow:none;font-size:12px;color:var(--surface-muted)}
.thinking:hover{background:var(--fill-4);color:var(--surface-secondary)}
.thinking-star{display:grid;place-items:center;color:var(--accent)}
.thinking.live .thinking-star{animation:think-pulse 1.4s var(--ease-soft) infinite}
@keyframes think-pulse{0%,100%{opacity:.45;transform:scale(.88) rotate(0)}50%{opacity:1;transform:scale(1.08) rotate(20deg)}}
.thinking-label{font-weight:600;white-space:nowrap}
.thinking.live .thinking-label{background:linear-gradient(90deg,var(--surface-muted) 0%,var(--surface-muted) 35%,var(--surface-ink) 50%,var(--surface-muted) 65%,var(--surface-muted) 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:think-shimmer 1.8s linear infinite}
@keyframes think-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}
.thinking-meta{font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.thinking-chevron{opacity:.55;transition:transform var(--dur-3) var(--spring-snappy)}
.thinking.open .thinking-chevron{transform:rotate(180deg)}
.thinking-direction{margin:-2px 0 8px 10px;padding-left:12px;border-left:2px solid var(--line);font-size:12px;line-height:1.6;color:var(--surface-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:zg-fade-in var(--dur-2) var(--ease-out)}
.reasoning-body{margin:0 0 10px 10px;padding:2px 0 2px 12px;border-left:2px solid var(--line);font-size:12px;line-height:1.75;color:var(--surface-muted);white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;scrollbar-width:thin}
/* 回答正文：完整 Markdown。 */
.answer-body{font-size:13.5px;line-height:1.8;overflow-wrap:anywhere;font-family:var(--font-reading)}
.answer-body :deep(>:first-child){margin-top:0}
.answer-body :deep(>:last-child){margin-bottom:0}
.answer-body :deep(p){margin:0 0 .75em}
.answer-body :deep(h1),.answer-body :deep(h2),.answer-body :deep(h3),.answer-body :deep(h4){font-family:var(--font-display);line-height:1.4;margin:1.1em 0 .5em;font-weight:700}
.answer-body :deep(h1){font-size:1.3em}
.answer-body :deep(h2){font-size:1.18em}
.answer-body :deep(h3){font-size:1.06em}
.answer-body :deep(h4){font-size:1em}
.answer-body :deep(ul),.answer-body :deep(ol){margin:0 0 .75em;padding-left:1.4em}
.answer-body :deep(li){margin:.2em 0}
.answer-body :deep(li>p){margin:0}
.answer-body :deep(blockquote){margin:0 0 .8em;padding:.1em 0 .1em .9em;border-left:3px solid var(--line-strong);color:var(--surface-secondary)}
.answer-body :deep(hr){border:0;border-top:1px solid var(--line);margin:1.2em 0}
.answer-body :deep(a){color:var(--surface-ink);text-decoration:underline;text-decoration-color:var(--line-strong);text-underline-offset:3px}
.answer-body :deep(strong){font-weight:650}
.answer-body :deep(code){font-family:var(--font-mono);font-size:.88em;padding:.12em .4em;border-radius:6px;background:var(--fill-3)}
.answer-body :deep(.answer-code-block){margin:0 0 .9em;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--surface-2)}
.answer-body :deep(.answer-code-head){display:flex;align-items:center;justify-content:space-between;height:30px;padding:0 6px 0 12px;font-size:11px;color:var(--surface-muted);border-bottom:1px solid var(--line-soft)}
.answer-body :deep(.answer-copy){height:22px;padding:0 8px;border:0;border-radius:6px;background:none;box-shadow:none;font-size:11px;color:var(--surface-muted)}
.answer-body :deep(.answer-copy:hover){background:var(--fill-3);color:var(--surface-ink)}
.answer-body :deep(pre.answer-code){margin:0;padding:10px 12px;overflow:auto;font-size:12px;line-height:1.6;scrollbar-width:thin}
.answer-body :deep(pre.answer-code code){padding:0;background:none;font-size:inherit}
.answer-body :deep(.answer-table){overflow:auto;margin:0 0 .9em;border:1px solid var(--line);border-radius:10px;scrollbar-width:thin}
.answer-body :deep(table){border-collapse:collapse;min-width:100%;font-size:12.5px}
.answer-body :deep(th),.answer-body :deep(td){padding:6px 10px;border-bottom:1px solid var(--line-soft);text-align:left;vertical-align:top}
.answer-body :deep(th){background:var(--fill-4);font-weight:650}
.answer-body :deep(tr:last-child td){border-bottom:0}
.answer-body :deep(.answer-diagram){margin:0 0 .9em;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:auto;text-align:center}
.answer-body :deep(.answer-diagram.rendered svg){max-width:100%;height:auto}
.answer-body :deep(.answer-diagram figcaption){font-size:11px;color:var(--surface-muted);margin-top:6px}
.answer-body :deep(.answer-diagram pre){text-align:left;margin:0;font-size:12px}
.answer-body :deep(.markdown-math){overflow:auto;margin:0 0 .8em}
.answer-body :deep(.katex){font-size:1.08em}
/* 引用：中性灰小标签，在任何底色上都清楚。 */
.answer-body :deep(.inline-citation){display:inline-flex;align-items:center;height:20px;margin:0 2px;padding:0 7px;border:1px solid var(--line);border-radius:6px;background:var(--surface-2);box-shadow:none;font-size:11px;font-weight:600;color:var(--surface-secondary);vertical-align:1px}
.answer-body :deep(.inline-citation:hover){background:var(--fill-3);color:var(--surface-ink)}
.source-list{margin:8px 0 4px;font-size:12px}
.source-list summary{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;cursor:pointer;color:var(--surface-secondary);font-weight:600;list-style:none}
.source-list summary::-webkit-details-marker{display:none}
.source-list summary::before{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform var(--dur-3) var(--spring-snappy)}
.source-list[open] summary::before{transform:rotate(45deg)}
.source-list summary:hover{background:var(--fill-4)}
.source-list button{display:block;width:100%;margin-top:6px;padding:8px 11px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:none;text-align:left}
.source-list button:hover{background:var(--surface-2)}
.source-list span{font-size:11px;font-weight:650;color:var(--surface-ink)}
.source-list small{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:3px;font-size:11.5px;line-height:1.6;color:var(--surface-muted)}
.answer-meta{display:flex;align-items:center;gap:6px;min-height:26px;margin-top:6px;font-size:11px;color:var(--surface-muted)}
.meta-button{display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--surface-muted)}
.meta-button:hover{background:var(--fill-3);color:var(--surface-ink)}
.meta-flag{padding:1px 7px;border-radius:999px;background:var(--fill-3);font-weight:600}
.meta-flag.error{background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger)}
.meta-text{font-variant-numeric:tabular-nums;opacity:.85}
.ai-status{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.ai-error{margin:0 0 12px;padding:9px 12px;border-radius:12px;background:color-mix(in srgb,var(--danger) 10%,var(--surface));border:1px solid color-mix(in srgb,var(--danger) 25%,transparent);font-size:12px;line-height:1.6;color:var(--danger);overflow-wrap:anywhere}
/* 输入框：一整块圆角输入区，顶边可拖拽调高。 */
.ai-composer{flex-shrink:0;padding:8px 12px 12px}
.composer-field{position:relative;border:1px solid var(--line);border-radius:20px;background:var(--surface);box-shadow:0 1px 2px rgb(0 0 0 / .04),0 6px 20px -12px rgb(0 0 0 / .25);transition:border-color var(--dur-2) var(--ease-out),box-shadow var(--dur-2) var(--ease-out)}
.composer-field:focus-within{border-color:var(--line-strong);box-shadow:0 0 0 3px var(--fill-3),0 6px 20px -12px rgb(0 0 0 / .25)}
.composer-resize{position:absolute;left:50%;top:-6px;width:56px;height:12px;margin-left:-28px;cursor:ns-resize;z-index:2;touch-action:none}
.composer-resize::after{content:'';position:absolute;left:18px;right:18px;top:4px;height:4px;border-radius:999px;background:var(--line-strong);opacity:0;transition:opacity var(--dur-2) var(--ease-out)}
.composer-field:hover .composer-resize::after,.composer-resize:active::after{opacity:1}
textarea{box-sizing:border-box;display:block;width:100%;min-height:52px;max-height:none;padding:12px 14px 4px;resize:none;border:0;border-radius:20px 20px 0 0;background:transparent;box-shadow:none;color:var(--surface-ink);font:inherit;font-family:var(--font-ui);font-size:13.5px;line-height:1.65;outline:none}
textarea:hover:not(:focus),textarea:focus{background:transparent;border:0;box-shadow:none}
textarea::placeholder{color:var(--surface-muted)}
.ai-selection-context{display:flex;align-items:flex-start;gap:6px;padding:10px 10px 0}
.selection-chip{display:flex;align-items:center;gap:8px;min-width:0;max-width:calc(100% - 28px);padding:4px 10px 4px 4px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);cursor:pointer;transition:opacity var(--dur-2) var(--ease-out)}
.selection-chip.off{opacity:.45}
.selection-chip input{position:absolute;opacity:0;pointer-events:none}
.selection-chip:focus-within{box-shadow:0 0 0 2px var(--accent-ring)}
.selection-chip img{width:44px;height:34px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#fff}
.selection-text{min-width:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:6px;font-size:12px}
.selection-chip small{flex-shrink:0;font-size:11px;color:var(--surface-muted)}
.chip-remove{display:grid;place-items:center;width:22px;height:22px;margin-top:8px;padding:0;border:0;border-radius:50%;background:var(--fill-3);box-shadow:none}
.chip-remove:hover{background:var(--fill-2)}
.composer-actions{display:flex;align-items:center;gap:6px;min-width:0;padding:4px 8px 8px}
.composer-space{flex:1}
.context-switch{position:relative;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px 0 9px;border:1px solid var(--line);border-radius:999px;font-size:12px;font-weight:550;color:var(--surface-muted);cursor:pointer;white-space:nowrap;transition:background var(--dur-1) var(--ease-soft),color var(--dur-1) var(--ease-soft),border-color var(--dur-1) var(--ease-soft)}
.context-switch input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.context-switch:hover{background:var(--fill-4)}
.context-switch.on{background:var(--fill-3);border-color:transparent;color:var(--surface-ink)}
.context-switch:focus-within{box-shadow:0 0 0 2px var(--accent-ring)}
.context-ring{--ratio:0;display:grid;place-items:center;width:24px;height:24px;flex-shrink:0}
.context-ring svg{width:18px;height:18px;rotate:-90deg}
.context-ring circle{fill:none;stroke:var(--fill-1);stroke-width:2.6}
.context-ring .ring-value{stroke:var(--surface-secondary);stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:calc(100 - var(--ratio) * 100);transition:stroke-dashoffset var(--dur-smooth) var(--spring-smooth)}
.model-picker-host{position:relative;min-width:0;display:flex}
.model-picker{display:flex;align-items:center;gap:6px;min-width:0;max-width:190px;height:30px;padding:0 9px 0 11px;border:0;border-radius:999px;background:none;box-shadow:none;font-size:12px;color:var(--surface-secondary)}
.model-picker:hover:not(:disabled),.model-picker[aria-expanded='true']{background:var(--fill-3);color:var(--surface-ink)}
.picker-model{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.picker-effort{flex:0 0 auto;font-weight:500;color:var(--surface-muted)}
.picker-chevron{flex:0 0 auto;opacity:.55;transition:transform var(--dur-3) var(--spring-snappy)}
.model-picker[aria-expanded='true'] .picker-chevron{transform:rotate(180deg)}
.send-button{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;border:0;border-radius:50%;background:var(--surface-ink);box-shadow:none;color:var(--surface);transition:transform var(--dur-press) var(--spring-press),opacity var(--dur-1) var(--ease-soft)}
.send-button:hover:not(:disabled){background:var(--surface-ink);color:var(--surface);transform:scale(1.06)}
.send-button:active:not(:disabled){transform:scale(.94)}
.send-button:disabled{background:var(--fill-2);color:var(--surface-muted);opacity:1}
.stop-square{width:11px;height:11px;border-radius:3px;background:currentColor}
.picker-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-snappy)}
.picker-leave-active{transition:opacity var(--dur-1) var(--ease-out),transform var(--dur-1) var(--ease-out)}
.picker-enter-from,.picker-leave-to{opacity:0;transform:translateY(8px) scale(.94)}
@media(prefers-reduced-motion:reduce){.ai-message,.thinking-star,.thinking-label{animation:none!important}}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more){.ai-messages{-webkit-mask-image:none;mask-image:none}}
</style>
