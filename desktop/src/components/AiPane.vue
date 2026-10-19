<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
import 'katex/dist/katex.min.css'
import { getProvider, getNativeModels, getNativeStatus } from '../ai/providers.mjs'
import { nativeModelInventory, registerNativeModelInventory } from '../ai/native-models'
import { chatState, sendChat, stopChat, configureRequests, taskSummary, conversations, activeConversationId, selectConversation, newConversation, deleteConversation, loadConversations, conversationTokens, contextWindow, branchConversation, resendQuestion, watchConversation, allConversations, type Message, type ChatState } from '../ai/workspace'
import { renderMarkdown, renderDiagrams } from '../ai/render'
import { loadAiSettings, saveModelChoice } from '../ai/settings.mjs'
import { useSettings } from '../settings'
import AppIcon from './AppIcon.vue'
import AssistantMark from './AssistantMark.vue'
import { greetingFor, placeholderFor, thinkingVerb, SPINNER_FRAMES } from '../ai/greeting'
import { predictQuestion, predictionKey } from '../ai/predict'
const ModelPicker = defineAsyncComponent(() => import('./ModelPicker.vue'))

const props = defineProps<{ document: { id: string; title: string; kind: string }; context: any; sendShortcut?: string; consumeCapture?: (value: { documentId: string; selection: any }) => void; conversationId?: string; draggable?: boolean
  /** Other documents on screen beside this one (side-by-side), to switch which one the assistant reads. */
  alternatives?: { id: string; title: string }[]
  /** Every library document, for the history of all conversations. */
  library?: { id: string; title: string }[] }>()
const emit = defineEmits<{ jump: [value: { page: number; rect?: any; line?: number }]; close: []; settings: []; error: [value: string]; clearSelection: []; conversation: [id: string]; grab: [event: PointerEvent]; switchDocument: [id: string]; openConversation: [value: { documentId: string; conversationId: string }] }>()
const settings = ref<any>(loadAiSettings())
// A window that follows the active tab may carry a conversation id from the previous document;
// only an id that belongs to this document is honoured.
const ownConversation = (documentId: string, id?: string) => id && conversations(documentId).some(item => item.id === id) ? id : activeConversationId(documentId)
const conversationId = ref(ownConversation(props.document.id, props.conversationId))
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
const avatar = computed(() => preferences.value.assistant.avatar)
// 每段对话的问候与占位语各固定一句，切换对话或新建时再随机挑；占位语每问一次换一句。
const seed = (text: string) => { let hash = 0; for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return (hash % 9973) / 9973 }
const greeting = computed(() => greetingFor(new Date(), seed(state.value.id), preferences.value.assistant.greeting.style, preferences.value.assistant.greeting.custom))
const placeholder = computed(() => placeholderFor(seed(`${state.value.id}:${messages.value.length}`)))
const dark = computed(() => document.documentElement.dataset.theme === 'dark' || effectiveAppearance.value.theme === 'dark')

// ---- Conversations -------------------------------------------------------
const historyOpen = ref(false)
// 对话记录：本文档 / 全部文档。全部文档按时间排，点别的文档的对话会打开那份文档。
const historyScope = ref<'document' | 'all'>('document')
const everything = ref<ChatState[]>([])
const loadingAll = ref(false)
const titles = computed(() => new Map((props.library || []).map(item => [item.id, item.title.replace(/\.(pdf|md|markdown)$/i, '')])))
async function showAll() {
  historyScope.value = 'all'
  loadingAll.value = true
  try { everything.value = await allConversations((props.library || []).map(item => item.id)) } finally { loadingAll.value = false }
}
function openAny(item: ChatState) {
  historyOpen.value = false
  if (item.documentId === props.document.id) useConversation(item.id)
  else emit('openConversation', { documentId: item.documentId, conversationId: item.id })
}
watch(historyOpen, open => { if (!open) historyScope.value = 'document' })
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
// ---- Regenerate, branch and edit ----------------------------------------
const pane = ref<HTMLElement>()
let unwatch: (() => void) | undefined
// 正在屏幕上的对话答完不需要提示；藏起来（去了文档库、窗口最小化）时才提示。
watch(() => state.value.id, id => { unwatch?.(); unwatch = watchConversation(id, () => !!pane.value?.offsetParent && document.visibilityState === 'visible') }, { immediate: true })
const editing = ref<string | null>(null)
const editText = ref('')
const editor = ref<HTMLTextAreaElement[]>([])
function startEdit(message: Message) { editing.value = message.id; editText.value = message.content; void nextTick(() => { const field = editor.value[0]; field?.focus(); field?.setSelectionRange(field.value.length, field.value.length) }) }
function cancelEdit() { editing.value = null }
function resend(message: Message, question: string) {
  follow = true
  const id = resendQuestion({ ...props.document }, state.value.id, message.id, question, () => emit('settings'))
  if (id && id !== state.value.id) useConversation(id)
}
function submitEdit(message: Message) {
  const text = editText.value.trim()
  editing.value = null
  if (text && text !== message.content.trim()) resend(message, text)
}
function editKeydown(event: KeyboardEvent, message: Message) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelEdit() }
  else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submitEdit(message) }
}
function questionOf(answer: Message) { const index = messages.value.indexOf(answer); return messages.value.slice(0, index).reverse().find(item => item.role === 'user') }
function regenerate(answer: Message) { const question = questionOf(answer); if (question) resend(question, question.content) }
function branchFrom(message: Message) { useConversation(branchConversation(props.document.id, state.value.id, message.id).id) }
const isLastAnswer = (message: Message) => message === messages.value.at(-1)
const lastQuestionId = computed(() => [...messages.value].reverse().find(item => item.role === 'user')?.id)

watch(() => props.document.id, id => {
  rememberScroll()
  conversationId.value = ownConversation(id, props.conversationId)
  settings.value = loadAiSettings()
  historyOpen.value = false; pickerOpen.value = false
  void loadConversations(id).then(() => { if (id === props.document.id) conversationId.value = ownConversation(id, props.conversationId) })
  void nextTick(restoreScroll)
}, { flush: 'sync' })
watch(() => props.conversationId, id => { if (id) conversationId.value = ownConversation(props.document.id, id) })
// 跟随标签的窗口显示文档当前的对话；别处（例如答完提示）切换了对话时跟着切换。
watch(() => activeConversationId(props.document.id), id => { if (!props.conversationId && id !== conversationId.value) { rememberScroll(); conversationId.value = id; void nextTick(restoreScroll) } })

// ---- Live timing and the thinking line -------------------------------------
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
// 120ms 一帧：用时数字与 Claude Code 式的星标一起走。
watch(busy, value => {
  clearInterval(ticker); ticker = undefined
  if (value) ticker = setInterval(() => { now.value = Date.now() }, 120)
  now.value = Date.now()
}, { immediate: true })
const spinner = computed(() => SPINNER_FRAMES[Math.floor(now.value / 120) % SPINNER_FRAMES.length])
// 进度里只保留有信息量的状态（排队、读文档、查原文）；「思考中 / 正在回答」由英文动词表达。
const GENERIC_ACTIVITY = /^(思考中|正在回答|准备上下文|AI 思考中)$/
function activityNote(message: Message) { const text = message.activity || ''; return GENERIC_ACTIVITY.test(text) ? '' : text }
const live = (message: Message) => Boolean(busy.value && message === messages.value.at(-1) && message.role === 'assistant' && !message.finishedAt)
// 用时按整秒走，小数位跳得太快反而分心。
function seconds(ms: number) { return ms < 60000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s` }
function count(value?: number) { return !value ? '0' : value < 1000 ? String(value) : `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k` }
function elapsed(message: Message) { return seconds((message.finishedAt || now.value) - (message.startedAt || now.value)) }
function thinkingTime(message: Message) { return seconds((message.firstTokenAt || message.finishedAt || now.value) - (message.startedAt || now.value)) }
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
// 滚动、导航条刷新等也会触发指令更新；只有回答本身变了才重绘，图示不会反复重画。
const renderedKeys = new WeakMap<HTMLElement, string>()
const answerKey = (message: Message) => `${message.content.length}:${message.content.slice(-24)}:${message.finishedAt || 0}:${message.sources.length}:${dark.value}`
function renderAnswer(element: HTMLElement, message: Message) {
  renderedKeys.set(element, answerKey(message))
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
  updated: (el: HTMLElement, binding: any) => { if (renderedKeys.get(el) !== answerKey(binding.value)) scheduleRender(el, binding.value) },
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
// 右侧导航条代替滚动条：细滑块表示当前视口，刻度是每一轮提问。
const thumb = ref({ top: 0, height: 1, visible: false })
function updateRail() {
  const list = messageList.value
  if (!list) return
  const height = Math.max(1, list.scrollHeight)
  thumb.value = { top: list.scrollTop / height, height: Math.min(1, list.clientHeight / height), visible: list.scrollHeight > list.clientHeight + 4 }
  const users = [...list.querySelectorAll<HTMLElement>('.ai-message.user')]
  if (users.length < 2) { marks.value = []; return }
  const view = list.scrollTop + list.clientHeight / 3
  let current = -1
  users.forEach((element, index) => { if (element.offsetTop <= view) current = index })
  marks.value = users.map((element, index) => {
    const message = messages.value.find(item => item.id === element.dataset.id)
    const answer = messages.value[messages.value.indexOf(message!) + 1]
    return { id: element.dataset.id || '', top: element.offsetTop / height, text: message?.content || '', answer: plainText(answer?.content || '').slice(0, 140), current: index === current }
  })
}
// 预览里不显示 Markdown、公式与引用标记的源码。
function plainText(source: string) {
  return source.replace(/```[\s\S]*?```/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' [公式] ').replace(/\$([^$\n]+)\$/g, '$1').replace(/\[S[\w-]+\]/g, '').replace(/[#>*_`|~]+/g, '').replace(/\s+/g, ' ').trim()
}
function goToMark(mark: Mark) {
  follow = false
  hoverMark.value = null
  messageList.value?.querySelector<HTMLElement>(`.ai-message.user[data-id="${CSS.escape(mark.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
let railDrag: { offset: number; rail: HTMLElement } | undefined
function railRatio(event: PointerEvent, rail: HTMLElement) { const box = rail.getBoundingClientRect(); return (event.clientY - box.top - 8) / Math.max(1, box.height - 16) }
function railDown(event: PointerEvent) {
  if ((event.target as Element).closest('.rail-mark') || event.button !== 0) return
  const rail = event.currentTarget as HTMLElement, list = messageList.value
  if (!list) return
  event.preventDefault()
  const ratio = railRatio(event, rail)
  // 点在滑块上就拖动；点在空白处先跳过去，再继续拖。
  const onThumb = ratio >= thumb.value.top && ratio <= thumb.value.top + thumb.value.height
  if (!onThumb) list.scrollTop = (ratio - thumb.value.height / 2) * list.scrollHeight
  railDrag = { offset: onThumb ? ratio - thumb.value.top : thumb.value.height / 2, rail }
  follow = false
  rail.setPointerCapture(event.pointerId)
}
function railMove(event: PointerEvent) {
  if (!railDrag || !messageList.value) return
  messageList.value.scrollTop = (railRatio(event, railDrag.rail) - railDrag.offset) * messageList.value.scrollHeight
}
function railUp() { railDrag = undefined }
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
// 模型与强度抽屉第一次拉开后保持挂载，收起时才有回弹动画。
const drawerMounted = ref(false)
const pickerHost = ref<HTMLElement>()
const composerField = ref<HTMLElement>()
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
function pickerOutside(event: PointerEvent) { if (event.target instanceof Node && !composerField.value?.contains(event.target)) pickerOpen.value = false }
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
    drawerMounted.value = true
    window.addEventListener('keydown', strayEscape, true)
    document.addEventListener('pointerdown', pickerOutside, true)
    if (settings.value.provider === 'codex' && !nativeModelInventory.value.length) void refreshPickerModels()
  } else {
    document.removeEventListener('pointerdown', pickerOutside, true)
    window.removeEventListener('keydown', strayEscape, true)
    pickerRequest?.abort(); pickerRequest = undefined; pickerLoading.value = false
  }
})
watch(busy, value => { if (value) pickerOpen.value = false })
function drawerEscape(event: KeyboardEvent) { if (!pickerOpen.value || event.defaultPrevented) return; event.preventDefault(); event.stopPropagation(); closePicker() }
// 抽屉里的按钮在读取模型时会暂时禁用，焦点随之落回页面：这时 Esc 仍然收起抽屉。
function strayEscape(event: KeyboardEvent) { if (event.key === 'Escape' && (document.activeElement === document.body || !document.activeElement)) drawerEscape(event) }
function closePicker() { pickerOpen.value = false; void nextTick(() => pickerHost.value?.querySelector<HTMLElement>('.model-picker')?.focus()) }
function historyOutside(event: PointerEvent) { if (!(event.target as Element)?.closest?.('.history-host')) historyOpen.value = false }
watch(historyOpen, open => { if (open) document.addEventListener('pointerdown', historyOutside, true); else document.removeEventListener('pointerdown', historyOutside, true) })

watch(() => props.context?.selection, selection => { includeSelection.value = Boolean(selection?.text || selection?.image) }, { immediate: true })
function focusPrompt() { void nextTick(() => input.value?.focus()) }
function stop() { stopChat(props.document.id, state.value.id) }
function applySettings(value: any) { settings.value = value; configureRequests(value) }
function keydown(event: KeyboardEvent) {
  const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229
  if (preferences.value.assistant.predictQuestions && prediction.value && !prompt.value) {
    // Tab 或回车：采用预判的问题，放进输入框里可以再改；发送仍用发送键。
    if ((event.key === 'Tab' || event.key === 'Enter') && plain) { event.preventDefault(); prompt.value = prediction.value; return }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissed = predictionKey(predictContext()); prediction.value = ''; return }
  }
  if (event.key === 'Enter' && plain && !props.sendShortcut) { event.preventDefault(); void send() }
}
function send(question?: string) {
  // 输入框空着而有预判的问题时，按发送键直接发送它。
  if (preferences.value.assistant.predictQuestions && question === undefined && !prompt.value.trim() && prediction.value) question = prediction.value
  const id = props.document.id
  const selection = props.context?.selection
  const usesImage = includeSelection.value && Boolean(selection?.image)
  const consumeCapture = props.consumeCapture
  follow = true
  return sendChat({ ...props.document }, { ...props.context }, () => { if (id === props.document.id) emit('settings') }, () => {
    // The request can be accepted after this pane closes or switches files.
    if (usesImage) consumeCapture?.({ documentId: id, selection })
  }, question, { conversationId: state.value.id })
}
// ---- Predicted next question --------------------------------------------------
const prediction = ref('')
let predicting: AbortController | undefined
let predictTimer: ReturnType<typeof setTimeout> | undefined
let dismissed = ''
watch(() => preferences.value.assistant.predictQuestions, enabled => {
  if (enabled) return
  clearTimeout(predictTimer); predicting?.abort(); predicting = undefined
  prediction.value = ''; dismissed = ''
}, { flush: 'sync' })
function predictContext() {
  return { document: { ...props.document }, page: props.context?.page || 1, includePage: includeDocument.value, selection: selected.value.text || '', history: messages.value.filter(item => item.content && !item.failed).map(item => ({ role: item.role, content: item.content })) }
}
// 只有真正的上下文——已经有对话，或选中了文字——才预判；空白的新对话不猜。输入、发送、换页都会取消在途请求。
const predictable = computed(() => preferences.value.assistant.predictQuestions && !busy.value && !prompt.value && (Boolean(selected.value.text) || messages.value.some(item => item.content && !item.failed)))
// 「Tab / Enter 采用」只在前三次出现预判时提示，之后只留淡色的问题本身。
const HINT_KEY = 'kaizhi.predictionHints.v1'
const showHint = ref(false)
watch(prediction, (value, previous) => {
  if (!value) { showHint.value = false; return }
  if (previous) return
  let shown = 3
  try { shown = Number(localStorage.getItem(HINT_KEY)) || 0 } catch { /* 读不到计数时不再提示 */ }
  showHint.value = shown < 3
  if (showHint.value) try { localStorage.setItem(HINT_KEY, String(shown + 1)) } catch { /* 私有窗口等情况下只是多提示一次 */ }
})
watch(() => [predictable.value, state.value.id, props.document.id, props.context?.page, selected.value.text, messages.value.length, messages.value.at(-1)?.finishedAt] as const, () => {
  clearTimeout(predictTimer); predicting?.abort(); predicting = undefined
  const context = predictContext(), key = predictionKey(context)
  if (!predictable.value) { if (prompt.value || busy.value) prediction.value = ''; return }
  if (key === dismissed) return
  prediction.value = ''
  predictTimer = setTimeout(() => {
    const request = new AbortController(); predicting = request
    predictQuestion(context, request.signal).then(question => { if (predicting === request && !request.signal.aborted && preferences.value.assistant.predictQuestions && !prompt.value && !busy.value) prediction.value = question }).catch(() => {}).finally(() => { if (predicting === request) predicting = undefined })
  }, 700)
}, { immediate: true })
onMounted(() => {
  void loadConversations(props.document.id).then(() => { conversationId.value = ownConversation(props.document.id, props.conversationId) })
  restoreScroll()
  observer = new ResizeObserver(() => updateRail())
  if (messageList.value) observer.observe(messageList.value)
})
onBeforeUnmount(() => { unwatch?.(); rememberScroll(); clearInterval(ticker); clearTimeout(predictTimer); predicting?.abort(); observer?.disconnect(); if (renderFrame) cancelAnimationFrame(renderFrame); pickerRequest?.abort(); document.removeEventListener('pointerdown', pickerOutside, true); window.removeEventListener('keydown', strayEscape, true); document.removeEventListener('pointerdown', historyOutside, true) })
defineExpose({ send, stop, applySettings, focusPrompt, newConversation: startConversation })
</script>

<template>
  <aside ref="pane" class="ai-pane" aria-label="AI 阅读助手">
    <header class="ai-header" :class="{ draggable }" @pointerdown.self="draggable && emit('grab', $event)">
      <span v-if="draggable" class="drag-grip" data-tip="拖动调整位置" aria-hidden="true" @pointerdown.stop="emit('grab', $event)"><AppIcon name="grip" :size="14" /></span>
      <div class="history-host">
        <button class="conversation-title" :aria-expanded="historyOpen" aria-label="对话记录" data-tip="对话记录" @click="historyOpen = !historyOpen"><span class="title-text">{{ title }}</span><small>{{ document.title }}</small></button>
        <Transition name="history-pop">
          <div v-if="historyOpen" class="history-menu" role="dialog" aria-label="对话记录">
            <button class="history-new" @click="startConversation"><AppIcon name="compose" :size="15" />新对话</button>
            <div v-if="alternatives?.length" class="history-switch"><p class="history-label">助手正在读</p><button class="current" disabled>{{ document.title }}</button><button v-for="item in alternatives" :key="item.id" @click="historyOpen = false; emit('switchDocument', item.id)">改读 {{ item.title }}</button></div>
            <div class="history-scope" role="tablist" aria-label="对话范围"><button role="tab" :aria-selected="historyScope === 'document'" @click="historyScope = 'document'">这份文档</button><button role="tab" :aria-selected="historyScope === 'all'" @click="showAll">全部文档</button></div>
            <div v-if="historyScope === 'all'" class="history-list">
              <p v-if="loadingAll" class="history-empty">正在读取…</p>
              <div v-for="item in everything" v-else :key="item.id" class="history-item" :class="{ current: item.id === conversationId }">
                <button class="history-open" @click="openAny(item)"><span><AppIcon v-if="item.branchOf" name="branch" :size="12" class="branch-mark" />{{ item.title || '新对话' }}</span><small>{{ titles.get(item.documentId) || '已移除的文档' }} · {{ relative(item.updatedAt) }}</small></button>
              </div>
              <p v-if="!loadingAll && !everything.length" class="history-empty">还没有对话。</p>
            </div>
            <div v-else class="history-list">
              <div v-for="item in history" :key="item.id" class="history-item" :class="{ current: item.id === conversationId }">
                <button class="history-open" @click="useConversation(item.id)"><span><AppIcon v-if="item.branchOf" name="branch" :size="12" class="branch-mark" />{{ item.title || '新对话' }}</span><small>{{ relative(item.updatedAt) }} · {{ Math.ceil(item.messages.length / 2) }} 问<template v-if="item.request"> · 回答中</template></small></button>
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
      <div ref="messageList" class="ai-messages" @scroll="onScroll" @click="answerClick">
        <div v-if="!messages.length" class="ai-welcome">
          <AssistantMark :kind="avatar.kind" :image="avatar.image" :size="56" class="ai-welcome-mark" />
          <h2 class="ai-welcome-lead" :lang="greeting.lang === 'zh' ? 'zh-CN' : 'en'">{{ greeting.text }}</h2>
        </div>
        <article v-for="message in messages" :key="message.id" class="ai-message" :class="message.role" :data-id="message.id">
          <template v-if="message.role === 'user'">
            <div v-if="editing === message.id" class="question-editor">
              <textarea ref="editor" v-model="editText" rows="3" aria-label="编辑问题" @keydown="editKeydown($event, message)" />
              <div class="editor-actions"><button class="frost-button" @click="cancelEdit">取消</button><button class="frost-button primary" :disabled="!editText.trim()" @click="submitEdit(message)">发送</button></div>
            </div>
            <template v-else>
              <div class="user-question">{{ message.content }}</div>
              <div class="question-actions"><button class="meta-button" :disabled="busy && message.id === lastQuestionId" aria-label="编辑问题" data-tip="编辑后重新回答" @click="startEdit(message)"><AppIcon name="edit" :size="13" /></button><button class="meta-button" aria-label="复制问题" data-tip="复制" @click="copy(message.content)"><AppIcon name="copy" :size="13" /></button></div>
            </template>
          </template>
          <template v-else>
            <button v-if="live(message) || message.reasoning" class="thinking" :class="{ live: live(message), open: expanded.has(message.id) }" :aria-expanded="expanded.has(message.id)" @click="toggleReasoning(message.id)">
              <span class="thinking-star" aria-hidden="true">{{ live(message) ? spinner : '✻' }}</span>
              <span class="thinking-label">{{ live(message) ? `${thinkingVerb(message.id)}…` : `Thought for ${thinkingTime(message)}` }}</span>
              <span v-if="live(message)" class="thinking-meta">{{ elapsed(message) }}<template v-if="activityNote(message)"> · {{ activityNote(message) }}</template></span>
              <AppIcon v-if="message.reasoning" class="thinking-chevron" name="down" :size="12" />
            </button>
            <p v-if="live(message) && !expanded.has(message.id) && lastThought(message)" class="thinking-direction">{{ lastThought(message) }}</p>
            <div v-if="message.reasoning && expanded.has(message.id)" class="reasoning-body">{{ message.reasoning }}</div>
            <div v-if="message.content" v-answer="message" class="answer-body" />
            <details v-if="message.sources.length" class="source-list"><summary>参考原文 · {{ message.sources.length }} 段</summary><button v-for="source in message.sources" :key="source.sourceId" @click="jump(source)"><span>{{ source.line ? `第 ${source.line} 行` : `第 ${source.page} 页` }}</span><small>{{ source.text }}</small></button></details>
            <div v-if="!live(message)" class="answer-meta">
              <button v-if="message.content" class="meta-button" aria-label="复制回答" data-tip="复制回答" @click="copy(message.content)"><AppIcon name="copy" :size="13" /></button>
              <button class="meta-button" :disabled="busy && isLastAnswer(message)" aria-label="重新生成" :data-tip="isLastAnswer(message) ? '重新生成' : '在新分支中重新生成'" @click="regenerate(message)"><AppIcon name="retry" :size="13" /></button>
              <button class="meta-button" aria-label="从这里分支" data-tip="从这里开一个分支对话" @click="branchFrom(message)"><AppIcon name="branch" :size="13" /></button>
              <span v-if="message.stopped" class="meta-flag">已停止</span>
              <span v-else-if="message.failed" class="meta-flag error">未完成</span>
            </div>
          </template>
        </article>
        <p v-if="errorText" class="ai-error">{{ errorText }}</p>
        <p class="ai-status" role="status" aria-live="polite">{{ liveStatus }}</p>
      </div>
      <div v-show="thumb.visible" class="scroll-rail" :class="{ marked: marks.length }" aria-label="问题导航" @pointerdown="railDown" @pointermove="railMove" @pointerup="railUp" @pointercancel="railUp">
        <span class="rail-thumb" :style="{ top: `calc(8px + ${thumb.top} * (100% - 16px))`, height: `calc(${thumb.height} * (100% - 16px))` }" aria-hidden="true" />
        <button v-for="mark in marks" :key="mark.id" class="rail-mark" :class="{ current: mark.current }" :style="{ top: `calc(8px + ${mark.top} * (100% - 16px))` }" :aria-label="`跳到问题：${mark.text.slice(0, 30)}`" @click="goToMark(mark)" @pointerenter="hoverMark = mark" @pointerleave="hoverMark = null" @focus="hoverMark = mark" @blur="hoverMark = null" />
      </div>
      <Transition name="rail-pop"><div v-if="hoverMark" class="rail-preview" :style="{ top: `clamp(52px, calc(8px + ${hoverMark.top} * (100% - 16px)), calc(100% - 52px))` }"><strong>{{ hoverMark.text }}</strong><p v-if="hoverMark.answer">{{ hoverMark.answer }}</p></div></Transition>
    </div>

    <div class="ai-composer">
      <div ref="composerField" class="composer-field" :class="{ busy, expanded: pickerOpen }" @keydown.esc="drawerEscape">
        <div class="composer-resize" role="separator" aria-orientation="horizontal" aria-label="拖动调整输入框高度" data-tip="拖动调整高度，双击恢复" @pointerdown="startResize" @pointermove="resize" @pointerup="endResize" @pointercancel="endResize" @dblclick="resetResize" />
        <div v-if="hasSelection" class="ai-selection-context">
          <label class="selection-chip" :class="{ off: !includeSelection }"><input v-model="includeSelection" type="checkbox" :disabled="busy" :aria-label="selected.image ? `使用第 ${selected.page} 页截图` : '使用所选文字'" /><img v-if="selected.image" :src="selected.image" alt="选取的截图预览" /><span v-else class="selection-text">{{ selected.text.slice(0, 80) }}</span><small>{{ selected.image ? `第 ${selected.page} 页截图` : '所选文字' }}</small></label>
          <button class="chip-remove" data-tip="清除选区" aria-label="清除选区" @click="emit('clearSelection')"><AppIcon name="close" :size="11" /></button>
        </div>
        <div class="prompt-box">
          <textarea ref="input" v-model="prompt" :style="{ height: `${composerHeight}px` }" :placeholder="prediction ? '' : placeholder" aria-label="向 AI 提问" :aria-describedby="prediction ? `prediction-${state.id}` : undefined" @keydown="keydown" />
          <!-- 预判的问题：像 Claude Code 一样以淡色出现在空输入框里，按 Tab 或回车采用。 -->
          <p v-if="prediction && !prompt" :id="`prediction-${state.id}`" class="prompt-ghost"><span>{{ prediction }}</span><template v-if="showHint"><kbd>Tab</kbd><small>/</small><kbd>Enter</kbd><small>采用</small></template><span v-else class="visually-hidden">，按 Tab 或回车采用</span></p>
        </div>
        <div class="composer-actions">
          <label class="context-switch" :class="{ on: includeDocument }" :data-tip="includeDocument ? '已开启：提问时附带当前页与文档检索' : '已关闭：只发送问题与选区'"><input v-model="includeDocument" type="checkbox" role="switch" :disabled="busy" aria-label="当前页上下文与文档检索" /><span class="context-glyph" aria-hidden="true"><AppIcon name="book" :size="14" /><i class="context-slash" /></span><span class="context-label">文档上下文</span></label>
          <span class="composer-space" />
          <span class="context-ring" :data-tip="`上下文约 ${count(contextUsed)} / ${count(contextLimit)} tokens`" aria-hidden="true" :style="{ '--ratio': contextRatio }"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" /><circle class="ring-value" cx="10" cy="10" r="7.5" pathLength="100" /></svg></span>
          <div ref="pickerHost" class="model-picker-host">
            <button type="button" class="model-picker" :disabled="busy" :aria-expanded="pickerOpen" :aria-controls="`model-drawer-${state.id}`" aria-label="选择模型与思考强度" data-tip="模型与思考强度" @click="pickerOpen = !pickerOpen"><span class="picker-model">{{ modelLabel }}</span><span class="picker-effort">{{ EFFORT_LABELS[settings.effort || ''] || settings.effort }}</span><AppIcon name="down" :size="12" class="picker-chevron" /></button>
          </div>
          <button v-if="busy" class="send-button stop" aria-label="停止" data-tip="停止回答" @click="stop"><span class="stop-square" /></button>
          <button v-else class="send-button" :disabled="!prompt.trim()" aria-label="发送" data-tip="发送" :data-tip-key="sendShortcut || 'Enter'" @click="send()"><AppIcon name="arrow-up" :size="17" /></button>
        </div>
        <!-- 点模型按钮时，输入栏下沿顺势拉长，露出模型与思考强度；再点一次或按 Esc 收回。 -->
        <div :id="`model-drawer-${state.id}`" class="composer-drawer" :class="{ open: pickerOpen }" :inert="!pickerOpen || undefined">
          <ModelPicker v-if="drawerMounted" :model="settings.model || ''" :effort="settings.effort || ''" :models="pickerModels" :loading="pickerLoading" :error="pickerError" :can-refresh="settings.provider === 'codex'" @model="chooseModel" @effort="chooseEffort" @refresh="refreshPickerModels" @close="closePicker" />
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 阅读助手：与侧栏同一种液态玻璃。文字颜色由 glass-contrast 按身后图片调成深或浅（--ink/--secondary/--muted）；
   控件是磨砂的扁平玻璃，输入栏是浮在底板上的一片薄玻璃，两者之间只有很轻的分隔。 */
.ai-pane{--ink:var(--surface-ink);--control-ink:var(--ink);--secondary:var(--surface-secondary);--muted:var(--surface-muted);
  --frost:color-mix(in srgb,var(--glass-light) 70%,transparent);--frost-hover:color-mix(in srgb,var(--glass-light) 100%,transparent);--hairline:color-mix(in srgb,var(--ink) 11%,transparent);
  --bar-glass:color-mix(in srgb,var(--glass-light) 78%,transparent);
  display:flex;flex-direction:column;height:100%;min-width:0;width:100%;background-color:var(--glass-3);background-image:var(--glass-sheen);--lens-blur:var(--glass-3-blur);--lens-saturate:var(--glass-sat);-webkit-backdrop-filter:var(--refraction, var(--glass-filter-3));backdrop-filter:var(--refraction, var(--glass-filter-3));border:1px solid var(--glass-outline);border-radius:var(--r-xl);box-shadow:var(--shadow-pane),var(--glass-edge);color:var(--ink);overflow:hidden;font-family:var(--font-ui)}
button{font:inherit;cursor:pointer;color:var(--ink)}
button:disabled{opacity:.4;cursor:default}
/* 磨砂扁平玻璃按钮：一层薄雾与一道细高光，没有投影。助手面板本身已做背景模糊，内部不再嵌套 backdrop-filter，
   这样弹出的模型卡片、对话记录能透过面板模糊下面的内容。 */
.frost-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--hairline);border-radius:var(--r-control);background:var(--frost);box-shadow:inset 0 1px 0 var(--glass-rim-soft);font-size:12px;font-weight:600;color:var(--ink)}
.frost-button:hover:not(:disabled){background:var(--frost-hover)}
.frost-button.primary{background:color-mix(in srgb,var(--accent) 82%,transparent);border-color:transparent;color:var(--accent-on,#fff)}
.frost-button.primary:hover:not(:disabled){background:var(--accent)}
/* 深色底图上（浅色字）面板用烟灰玻璃而不是发白的乳白玻璃；浅色底图上仍是白玻璃。 */
.ai-pane[data-glass-ink='light']{background-color:rgb(14 18 24 / max(calc(.22 + var(--glass-a3) * .55), var(--glass-floor, 0)));--frost:rgb(255 255 255 / .09);--frost-hover:rgb(255 255 255 / .16);--bar-glass:rgb(255 255 255 / .1);--hairline:rgb(255 255 255 / .12)}
/* 头部：浮在面板上的一条独立玻璃条，带一点高度，与下面的对话区分开。 */
.ai-header{position:relative;z-index:8;display:flex;align-items:center;gap:4px;flex-shrink:0;height:48px;margin:8px 8px 0;padding:0 6px 0 8px;border:1px solid var(--hairline);border-radius:var(--r-lg);background:var(--bar-glass);box-shadow:inset 0 1px 0 var(--glass-rim-soft),0 8px 22px -14px rgb(0 0 0 / .45)}
.ai-header.draggable{cursor:grab}
.drag-grip{display:grid;place-items:center;width:18px;height:30px;margin-right:-2px;border-radius:6px;color:var(--muted);cursor:grab;opacity:.6}
.drag-grip:hover{background:var(--frost);opacity:1}
.history-host{position:relative;flex:1;min-width:0}
.conversation-title{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;max-width:100%;height:40px;padding:0 10px;border:0;border-radius:var(--r-control);background:none;box-shadow:none;text-align:left}
.conversation-title:hover,.conversation-title[aria-expanded='true']{background:var(--frost)}
.title-text{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:700;letter-spacing:.1px}
.conversation-title small{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--muted)}
.header-button{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:var(--r-control);background:none;box-shadow:none;color:var(--secondary)}
.header-button:hover:not(:disabled){background:var(--frost);border-color:var(--hairline);color:var(--ink)}
.task-summary{flex:0 0 auto;padding:3px 8px;border-radius:var(--r-xs);background:var(--frost);font-size:10.5px;font-weight:600;color:var(--secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
/* 弹出的对话记录与问题预览：更厚的弹层玻璃。 */
.history-menu,.rail-preview{--ink:var(--surface-ink);--secondary:var(--surface-secondary);--muted:var(--surface-muted);background-color:var(--popup-glass);background-image:var(--popup-sheen);--lens-blur:var(--popup-blur);--lens-saturate:var(--glass-sat);-webkit-backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));border:1px solid var(--glass-outline);box-shadow:0 16px 40px -16px rgb(0 0 0 / .32),var(--glass-edge);color:var(--ink)}
.history-menu{position:absolute;left:0;top:calc(100% + 6px);z-index:30;width:min(300px,calc(100vw - 40px));max-height:min(420px,60vh);display:flex;flex-direction:column;padding:6px;border-radius:var(--r-lg);transform-origin:20px 0}
.history-new{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:0;border-radius:var(--r-control);background:color-mix(in srgb,var(--ink) 6%,transparent);box-shadow:none;font-size:13px;font-weight:600}
.history-new:hover{background:color-mix(in srgb,var(--ink) 10%,transparent)}
.history-label{margin:12px 10px 6px;font-size:11px;font-weight:600;color:var(--muted)}
.history-scope{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin:8px 0 4px;padding:2px;border-radius:var(--r-control);background:color-mix(in srgb,var(--ink) 6%,transparent)}
.history-scope button{height:28px;padding:0;border:0;border-radius:calc(var(--r-control) - 2px);background:none;box-shadow:none;font-size:12px;font-weight:600;color:var(--muted)}
.history-scope button[aria-selected='true']{background:var(--popup-glass);color:var(--ink);box-shadow:0 1px 3px rgb(0 0 0 / .1)}
.history-switch{display:flex;flex-wrap:wrap;gap:4px;padding:0 4px}
.history-switch .history-label{width:100%;margin:10px 6px 2px}
.history-switch button{max-width:100%;height:28px;padding:0 10px;border:1px solid var(--hairline);border-radius:var(--r-sm);background:none;box-shadow:none;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history-switch button.current{opacity:1;background:color-mix(in srgb,var(--ink) 8%,transparent);font-weight:600}
.history-switch button:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 6%,transparent)}
.history-list{overflow:auto;min-height:0;scrollbar-width:none}
.history-item{position:relative;display:flex;align-items:center;border-radius:var(--r-control)}
.history-item:hover{background:color-mix(in srgb,var(--ink) 5%,transparent)}
.history-item.current{background:color-mix(in srgb,var(--ink) 9%,transparent)}
.history-open{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 12px;border:0;background:none;box-shadow:none;text-align:left}
.history-open span{display:flex;align-items:center;gap:5px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:550}
.branch-mark{flex-shrink:0;color:var(--muted)}
.history-open small{font-size:10.5px;color:var(--muted)}
.history-delete{display:grid;place-items:center;width:28px;height:28px;margin-right:6px;padding:0;border:0;border-radius:var(--r-sm);background:none;box-shadow:none;color:var(--muted);opacity:0}
.history-item:hover .history-delete,.history-delete:focus-visible{opacity:1}
.history-delete:hover{background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger)}
.history-empty{margin:10px;font-size:12px;color:var(--muted)}
.history-pop-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-snappy)}
.history-pop-leave-active{transition:opacity var(--dur-1) var(--ease-out),transform var(--dur-1) var(--ease-out)}
.history-pop-enter-from,.history-pop-leave-to{opacity:0;transform:translateY(-6px) scale(.95)}
/* 消息区；原生滚动条隐藏，右侧导航条代替。 */
.ai-body{position:relative;flex:1;min-height:0;display:flex}
.ai-messages{flex:1;min-width:0;overflow:auto;padding:18px 26px 8px 18px;scrollbar-width:none;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%)}
.ai-messages::-webkit-scrollbar{display:none}
.scroll-rail{position:absolute;right:3px;top:6px;bottom:6px;width:14px;z-index:5;cursor:default;touch-action:none}
.rail-thumb{position:absolute;right:5px;width:3px;min-height:18px;border-radius:2px;background:color-mix(in srgb,var(--ink) 18%,transparent);transition:width var(--dur-2) var(--spring-snappy),right var(--dur-2) var(--spring-snappy),background var(--dur-1) var(--ease-soft)}
.scroll-rail:hover .rail-thumb{right:4px;width:5px;background:color-mix(in srgb,var(--ink) 28%,transparent)}
.rail-mark{position:absolute;right:2px;width:9px;height:2px;padding:0;border:0;border-radius:1px;background:color-mix(in srgb,var(--ink) 40%,transparent);box-shadow:none;transform:translateY(-50%);transition:width var(--dur-2) var(--spring-snappy),background var(--dur-1) var(--ease-soft)}
.rail-mark::before{content:'';position:absolute;inset:-5px -3px}
.rail-mark:hover,.rail-mark:focus-visible{width:13px;background:var(--ink);outline:none}
.rail-mark.current{width:12px;background:var(--accent)}
.rail-preview{position:absolute;right:22px;z-index:6;width:min(260px,calc(100% - 44px));padding:10px 12px;border-radius:var(--r-md);transform:translateY(-50%);pointer-events:none}
.rail-preview strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12.5px;font-weight:600;line-height:1.5}
.rail-preview p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin:6px 0 0;font-size:11.5px;line-height:1.55;color:var(--muted)}
.rail-pop-enter-active{transition:opacity var(--dur-1) var(--ease-out),translate var(--dur-2) var(--spring-snappy)}
.rail-pop-leave-active{transition:opacity var(--dur-1) var(--ease-out)}
.rail-pop-enter-from,.rail-pop-leave-to{opacity:0;translate:6px 0}
.ai-welcome{display:flex;flex-direction:column;align-items:center;text-align:center;padding:8vh 6px 8px;animation:zg-rise-in var(--dur-bounce) var(--spring-snappy) both}
.ai-welcome-mark{margin-bottom:16px;animation:zg-pop-in var(--dur-bounce) var(--spring-bouncy) both}
/* 问候固定用内置的 Anthropic Serif（不随阅读字体设置变化），像 Claude 的「Good afternoon」；
   古诗没有对应的西文字形，退到宋体 / 思源宋体，仍是衬线。 */
.ai-welcome-lead{max-width:100%;margin:0;font-family:'Anthropic Serif','Source Han Serif SC','Noto Serif CJK SC','Noto Serif SC','Songti SC','STSong','SimSun',serif;font-size:27px;font-weight:400;line-height:1.35;letter-spacing:-.012em;text-wrap:balance;font-optical-sizing:auto}
.ai-welcome-lead:lang(zh-CN){font-size:22px;letter-spacing:.06em;line-height:1.6}
.ai-message{margin-bottom:22px;animation:zg-rise-in var(--dur-3) var(--ease-out) both}
.ai-message.user{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.user-question{max-width:88%;padding:9px 14px;border-radius:var(--r-lg) var(--r-lg) var(--r-xs) var(--r-lg);background:color-mix(in srgb,var(--ink) 9%,transparent);border:1px solid var(--hairline);font-size:13.5px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}
.question-actions{display:flex;gap:2px;opacity:0;transition:opacity var(--dur-2) var(--ease-out)}
.ai-message.user:hover .question-actions,.question-actions:focus-within{opacity:1}
.question-editor{width:min(100%,520px);padding:8px;border-radius:var(--r-lg);background:color-mix(in srgb,var(--ink) 7%,transparent);border:1px solid var(--hairline);animation:zg-pop-in var(--dur-3) var(--spring-snappy) both}
.question-editor textarea{min-height:64px;padding:6px 8px;border-radius:var(--r-sm)}
.editor-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}
/* 思考：Claude Code 式的转动星标 + 随机英文动词 + 用时，文字有流光；展开看完整思路。 */
.thinking{display:inline-flex;align-items:center;gap:7px;max-width:100%;height:28px;padding:0 10px 0 8px;margin-bottom:6px;border:0;border-radius:var(--r-control);background:none;box-shadow:none;font-size:12px;color:var(--muted)}
.thinking:hover{background:var(--frost);color:var(--secondary)}
.thinking-star{display:grid;place-items:center;width:14px;font-size:14px;line-height:1;color:#d97757;font-family:'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2',var(--font-ui)}
.thinking-label{font-weight:600;white-space:nowrap}
.thinking.live .thinking-label{--shimmer-base:color-mix(in srgb,var(--muted) 72%,transparent);background:linear-gradient(90deg,var(--shimmer-base) 0%,var(--shimmer-base) 38%,var(--ink) 47%,var(--ink) 53%,var(--shimmer-base) 62%,var(--shimmer-base) 100%);background-size:300% 100%;background-position:100% 0;-webkit-background-clip:text;background-clip:text;color:transparent;animation:think-shimmer 2s linear infinite}
/* Codex 式流光：一道亮带从文字左侧扫到右侧（背景图是文字的 3 倍宽，位置 100% → 0% 让亮带自左向右穿过）。 */
@keyframes think-shimmer{from{background-position:100% 0}to{background-position:0% 0}}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.thinking-meta{font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.thinking-chevron{opacity:.55;transition:transform var(--dur-3) var(--spring-snappy)}
.thinking.open .thinking-chevron{transform:rotate(180deg)}
.thinking-direction{margin:-2px 0 8px 10px;padding-left:12px;border-left:2px solid var(--hairline);font-size:12px;line-height:1.6;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:zg-fade-in var(--dur-2) var(--ease-out)}
.reasoning-body{margin:0 0 10px 10px;padding:2px 0 2px 12px;border-left:2px solid var(--hairline);font-size:12px;line-height:1.75;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;scrollbar-width:thin}
/* 回答正文：衬线正文（Anthropic Serif 一类），表格与代码参照 Claude 的排法。 */
.answer-body{font-size:14.5px;line-height:1.75;overflow-wrap:anywhere;font-family:var(--font-reading);letter-spacing:.005em}
.answer-body :deep(>:first-child){margin-top:0}
.answer-body :deep(>:last-child){margin-bottom:0}
.answer-body :deep(p){margin:0 0 .85em}
.answer-body :deep(h1),.answer-body :deep(h2),.answer-body :deep(h3),.answer-body :deep(h4){font-family:var(--font-reading);line-height:1.35;margin:1.2em 0 .5em;font-weight:650}
.answer-body :deep(h1){font-size:1.3em}
.answer-body :deep(h2){font-size:1.18em}
.answer-body :deep(h3){font-size:1.06em}
.answer-body :deep(h4){font-size:1em}
.answer-body :deep(ul),.answer-body :deep(ol){margin:0 0 .85em;padding-left:1.4em}
.answer-body :deep(li){margin:.25em 0}
.answer-body :deep(li>p){margin:0}
.answer-body :deep(blockquote){margin:0 0 .85em;padding:.1em 0 .1em .9em;border-left:3px solid var(--hairline);color:var(--secondary)}
.answer-body :deep(hr){border:0;border-top:1px solid var(--hairline);margin:1.4em 0}
.answer-body :deep(a){color:var(--ink);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--ink) 35%,transparent);text-underline-offset:3px}
.answer-body :deep(strong){font-weight:650}
.answer-body :deep(code){font-family:var(--font-mono);font-size:.84em;padding:.12em .38em;border-radius:5px;background:color-mix(in srgb,var(--ink) 8%,transparent);border:1px solid var(--hairline)}
.answer-body :deep(.answer-code-block){--ink:var(--surface-ink);margin:0 0 1em;border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden;background:var(--surface-2);color:var(--surface-ink)}
.answer-body :deep(.answer-code-head){display:flex;align-items:center;justify-content:space-between;height:30px;padding:0 6px 0 12px;font-family:var(--font-ui);font-size:11px;color:var(--surface-muted);border-bottom:1px solid var(--line-soft)}
.answer-body :deep(.answer-copy){height:22px;padding:0 8px;border:0;border-radius:6px;background:none;box-shadow:none;font-size:11px;color:var(--surface-muted)}
.answer-body :deep(.answer-copy:hover){background:var(--fill-3);color:var(--surface-ink)}
.answer-body :deep(pre.answer-code){margin:0;padding:10px 12px;overflow:auto;font-size:12px;line-height:1.6;scrollbar-width:thin}
.answer-body :deep(pre.answer-code code){padding:0;border:0;background:none;font-size:inherit}
/* 表格：外框圆角细线、表头浅底、只有横线，与 Claude 的回答一致。 */
.answer-body :deep(.answer-table){overflow:auto;margin:.2em 0 1em;border:1px solid var(--hairline);border-radius:var(--r-md);scrollbar-width:thin}
.answer-body :deep(table){border-collapse:collapse;min-width:100%;font-family:var(--font-reading);font-size:13.5px;font-variant-numeric:tabular-nums}
.answer-body :deep(th),.answer-body :deep(td){padding:9px 14px;border-bottom:1px solid var(--hairline);text-align:left;vertical-align:top}
.answer-body :deep(th){background:color-mix(in srgb,var(--ink) 5%,transparent);font-weight:500;color:var(--secondary)}
.answer-body :deep(tr:last-child td){border-bottom:0}
.answer-body :deep(.answer-diagram){margin:0 0 1em;padding:12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface);color:var(--surface-ink);overflow:auto;text-align:center}
.answer-body :deep(.answer-diagram.rendered svg){max-width:100%;height:auto}
.answer-body :deep(.answer-diagram figcaption){font-size:11px;color:var(--surface-muted);margin-top:6px}
.answer-body :deep(.answer-diagram pre){text-align:left;margin:0;font-size:12px}
.answer-body :deep(.markdown-math){overflow-x:auto;overflow-y:hidden;margin:0 0 .85em}
.answer-body :deep(.katex){font-size:1.06em}
/* 引用：中性小标签。 */
.answer-body :deep(.inline-citation){display:inline-flex;align-items:center;height:20px;margin:0 2px;padding:0 7px;border:1px solid var(--hairline);border-radius:var(--r-xs);background:var(--frost);box-shadow:none;font-family:var(--font-ui);font-size:11px;font-weight:600;color:var(--secondary);vertical-align:1px}
.answer-body :deep(.inline-citation:hover){background:var(--frost-hover);color:var(--ink)}
.source-list{margin:8px 0 4px;font-size:12px}
.source-list summary{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--r-control);cursor:pointer;color:var(--secondary);font-weight:600;list-style:none}
.source-list summary::-webkit-details-marker{display:none}
.source-list summary::before{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform var(--dur-3) var(--spring-snappy)}
.source-list[open] summary::before{transform:rotate(45deg)}
.source-list summary:hover{background:var(--frost)}
.source-list button{display:block;width:100%;margin-top:6px;padding:8px 11px;border:1px solid var(--hairline);border-radius:var(--r-md);background:var(--frost);box-shadow:none;text-align:left}
.source-list button:hover{background:var(--frost-hover)}
.source-list span{font-size:11px;font-weight:650;color:var(--ink)}
.source-list small{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:3px;font-size:11.5px;line-height:1.6;color:var(--muted)}
.answer-meta{display:flex;align-items:center;gap:2px;min-height:28px;margin-top:6px;font-size:11px;color:var(--muted);opacity:.75;transition:opacity var(--dur-2) var(--ease-out)}
.ai-message:hover .answer-meta,.answer-meta:focus-within{opacity:1}
.meta-button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:var(--r-sm);background:none;box-shadow:none;color:var(--muted)}
.meta-button:hover:not(:disabled){background:var(--frost);border-color:var(--hairline);color:var(--ink)}
.meta-flag{margin-left:4px;padding:1px 7px;border-radius:var(--r-xs);background:var(--frost);font-weight:600}
.meta-flag.error{background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger)}
.ai-status{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.ai-error{margin:0 0 12px;padding:9px 12px;border-radius:var(--r-md);background:color-mix(in srgb,var(--danger) 12%,transparent);border:1px solid color-mix(in srgb,var(--danger) 25%,transparent);font-size:12px;line-height:1.6;color:var(--danger);overflow-wrap:anywhere}
/* 输入栏：一片薄玻璃，只用细边与内高光与底板分开，没有厚重投影。 */
.ai-composer{flex-shrink:0;padding:6px 10px 10px;container:composer / inline-size}
/* 输入栏很窄时（最小窗口）芯片才允许省略文字；平时完整显示「文档上下文」，由模型按钮先让出宽度。 */
@container composer (max-width: 300px){.context-switch{flex-shrink:1}}
@container composer (max-width: 250px){.context-label{display:none}.context-switch{padding:0 7px}}
.composer-field{position:relative;border:1px solid var(--hairline);border-radius:var(--r-lg);background:var(--bar-glass);box-shadow:inset 0 1px 0 var(--glass-rim-soft),0 1px 2px rgb(0 0 0 / .04);transition:border-color var(--dur-2) var(--ease-out),background var(--dur-2) var(--ease-out)}
.composer-field:focus-within{border-color:color-mix(in srgb,var(--ink) 24%,transparent)}
.composer-resize{position:absolute;left:50%;top:-6px;width:56px;height:12px;margin-left:-28px;cursor:ns-resize;z-index:2;touch-action:none}
.composer-resize::after{content:'';position:absolute;left:18px;right:18px;top:4px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--ink) 25%,transparent);opacity:0;transition:opacity var(--dur-2) var(--ease-out)}
.composer-field:hover .composer-resize::after,.composer-resize:active::after{opacity:1}
textarea{box-sizing:border-box;display:block;width:100%;min-height:52px;max-height:none;padding:12px 14px 4px;resize:none;border:0;border-radius:var(--r-lg) var(--r-lg) 0 0;background:transparent;box-shadow:none;color:var(--ink);font:inherit;font-family:var(--font-ui);font-size:13.5px;line-height:1.65;outline:none}
textarea:hover:not(:focus),textarea:focus{background:transparent;border:0;box-shadow:none}
textarea::placeholder{color:var(--muted);font-family:'Anthropic Serif','Source Han Serif SC','Noto Serif CJK SC','Songti SC','SimSun',var(--font-ui);letter-spacing:.02em}
.prompt-box{position:relative}
/* 预判的问题：与占位语同位置的一行淡字，末尾是按键提示。 */
.prompt-ghost{position:absolute;left:14px;right:14px;top:12px;margin:0;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 6px;font-size:13.5px;line-height:1.65;color:var(--muted);pointer-events:none;animation:zg-fade-in var(--dur-2) var(--ease-out)}
.prompt-ghost span{color:color-mix(in srgb,var(--ink) 52%,transparent)}
.prompt-ghost kbd{padding:0 5px;border:1px solid var(--hairline);border-radius:5px;background:var(--frost);font:600 10.5px/16px var(--font-ui);color:var(--secondary)}
.prompt-ghost small{font-size:11px;margin-right:4px}
.ai-selection-context{display:flex;align-items:flex-start;gap:6px;padding:10px 10px 0}
.selection-chip{display:flex;align-items:center;gap:8px;min-width:0;max-width:calc(100% - 28px);padding:4px 10px 4px 4px;border:1px solid var(--hairline);border-radius:var(--r-md);background:var(--frost);cursor:pointer;transition:opacity var(--dur-2) var(--ease-out)}
.selection-chip.off{opacity:.45}
.selection-chip input{position:absolute;opacity:0;pointer-events:none}
.selection-chip:focus-within{box-shadow:0 0 0 2px var(--accent-ring)}
.selection-chip img{width:44px;height:34px;border-radius:var(--r-sm);object-fit:cover;flex-shrink:0;background:#fff}
.selection-text{min-width:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:6px;font-size:12px}
.selection-chip small{flex-shrink:0;font-size:11px;color:var(--muted)}
.chip-remove{display:grid;place-items:center;width:22px;height:22px;margin-top:8px;padding:0;border:0;border-radius:var(--r-xs);background:var(--frost);box-shadow:none}
.chip-remove:hover{background:var(--frost-hover)}
.composer-actions{display:flex;align-items:center;gap:6px;min-width:0;padding:4px 8px 8px}
.composer-space{flex:1}
/* 文档上下文：芯片里带一枚小开关。开 = 实心墨色胶囊、圆点在右；关 = 空心描边、圆点在左。
   墨色跟随 glass-contrast 的深浅判断，所以浅色底图上是深色实心，深色底图上是浅色实心，都一眼可辨。 */
/* 文档上下文：一枚圆角方块开关（与其他控件一样偏方）。关闭时是安静的描边小书本，图标上划一道斜线；开启时整枚胶囊带上主色的玻璃底，
   书本与文字变成主色，斜线收起。深色、浅色主题和深浅字色的玻璃上都用同一套主色。 */
.context-switch{--context-on:var(--accent);position:relative;display:inline-flex;align-items:center;gap:6px;min-width:0;flex-shrink:0;height:30px;padding:0 11px 0 9px;border:1px solid transparent;border-radius:var(--r-control);background:transparent;font-size:12px;font-weight:550;color:var(--muted);cursor:pointer;white-space:nowrap;transition:background var(--dur-2) var(--ease-out),border-color var(--dur-2) var(--ease-out),color var(--dur-2) var(--ease-out),box-shadow var(--dur-2) var(--ease-out),transform var(--dur-press) var(--spring-press)}
.context-switch input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.context-switch:hover{background:var(--frost);color:var(--secondary)}
.context-switch:active{transform:scale(.96)}
.context-switch.on{border-color:color-mix(in srgb,var(--context-on) 34%,transparent);background:color-mix(in srgb,var(--context-on) 15%,transparent);color:var(--context-on);font-weight:650;box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 35%,transparent),0 3px 10px -6px color-mix(in srgb,var(--context-on) 70%,transparent)}
.context-switch.on:hover{background:color-mix(in srgb,var(--context-on) 21%,transparent)}
.context-switch:focus-within{box-shadow:0 0 0 2px var(--accent-ring)}
.context-glyph{position:relative;display:grid;place-items:center;flex-shrink:0;width:16px;height:16px;pointer-events:none}
.context-glyph svg{transition:transform var(--dur-bounce) var(--spring-bouncy)}
.context-switch.on .context-glyph svg{transform:scale(1.08)}
.context-slash{position:absolute;left:50%;top:50%;width:19px;height:1.6px;margin:-.8px 0 0 -9.5px;border-radius:2px;background:currentColor;box-shadow:0 0 0 1.2px var(--bar-glass);transform:rotate(-45deg) scaleX(1);transition:transform var(--dur-3) var(--spring-snappy),opacity var(--dur-2) var(--ease-out)}
.context-switch.on .context-slash{opacity:0;transform:rotate(-45deg) scaleX(0)}
.context-label{min-width:0;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
/* 玻璃按身后的明暗换成相反字色时，主色也换成对应的深浅，保证开启状态读得清楚。 */
:root:not([data-theme='dark']) .ai-pane[data-glass-ink='light'] .context-switch{--context-on:color-mix(in srgb,var(--accent) 45%,#fff)}
:root[data-theme='dark'] .ai-pane[data-glass-ink='dark'] .context-switch{--context-on:color-mix(in srgb,var(--accent) 60%,#000)}
.context-ring{--ratio:0;display:grid;place-items:center;width:24px;height:24px;flex-shrink:0}
.context-ring svg{width:18px;height:18px;rotate:-90deg}
.context-ring circle{fill:none;stroke:color-mix(in srgb,var(--ink) 14%,transparent);stroke-width:2.6}
.context-ring .ring-value{stroke:var(--secondary);stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:calc(100 - var(--ratio) * 100);transition:stroke-dashoffset var(--dur-smooth) var(--spring-smooth)}
.model-picker-host{position:relative;min-width:0;display:flex}
.model-picker{display:flex;align-items:center;gap:6px;min-width:64px;max-width:190px;flex-shrink:1;height:30px;padding:0 9px 0 11px;border:1px solid transparent;border-radius:var(--r-control);background:none;box-shadow:none;font-size:12px;color:var(--secondary)}
.model-picker:hover:not(:disabled),.model-picker[aria-expanded='true']{background:var(--frost);border-color:var(--hairline);color:var(--ink)}
.picker-model{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.picker-effort{flex:0 0 auto;font-weight:500;color:var(--muted)}
.picker-chevron{flex:0 0 auto;opacity:.55;transition:transform var(--dur-3) var(--spring-snappy)}
.model-picker[aria-expanded='true'] .picker-chevron{transform:rotate(180deg)}
.send-button{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;border:1px solid transparent;border-radius:var(--r-control);background:color-mix(in srgb,var(--accent) 84%,transparent);box-shadow:inset 0 1px 0 rgb(255 255 255 / .25);color:var(--accent-on,#fff);transition:transform var(--dur-press) var(--spring-press),opacity var(--dur-1) var(--ease-soft),background var(--dur-1) var(--ease-soft)}
.send-button:hover:not(:disabled){background:var(--accent);color:var(--accent-on,#fff);transform:scale(1.05)}
.send-button:active:not(:disabled){transform:scale(.94)}
.send-button:disabled{background:var(--frost);border-color:var(--hairline);color:var(--muted);box-shadow:none;opacity:1}
.send-button.stop{background:var(--frost-hover);border-color:var(--hairline);color:var(--ink)}
.stop-square{width:10px;height:10px;border-radius:2px;background:currentColor}
/* 模型与强度抽屉：高度从 0 弹到内容高度（interpolate-size 让 auto 也能过渡），内容随之从上方滑入、淡入。 */
.composer-drawer{interpolate-size:allow-keywords;height:0;overflow:hidden;padding:0 8px;opacity:0;transition:height var(--dur-bounce) var(--spring-snappy),opacity var(--dur-2) var(--ease-out)}
.composer-drawer.open{height:auto;opacity:1}
.composer-drawer>*{translate:0 -10px;transition:translate var(--dur-bounce) var(--spring-snappy)}
.composer-drawer.open>*{translate:0 0}
.composer-drawer:not(.open){visibility:hidden;transition:height var(--dur-spring) var(--spring-snappy),opacity var(--dur-1) var(--ease-out),visibility 0s linear var(--dur-spring)}
@media(prefers-reduced-motion:reduce){.composer-drawer,.composer-drawer>*{transition:none}}
@media(prefers-reduced-motion:reduce){.ai-message,.thinking-label,.question-editor,.prompt-ghost{animation:none!important}}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more){.ai-messages{-webkit-mask-image:none;mask-image:none}}
</style>
