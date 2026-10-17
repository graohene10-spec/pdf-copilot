<script setup lang="ts">
import { ref, shallowRef, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent, toRaw } from 'vue'
import { library, isDesktop, importDroppedDocuments } from './sdk'
import type { Doc } from './sdk/types'
import AppIcon from './components/AppIcon.vue'
import FileTabs from './components/FileTabs.vue'
import CaptureQuickPrompt from './components/CaptureQuickPrompt.vue'
import { chatPhase, chatState, sendChat, closeChat, closeAllChats, configureRequests, stopChat } from './ai/workspace'
import { forgetPassword, forgetAllPasswords } from './document/passwords.mjs'
import { useSettings, matchShortcut, matchWheelShortcut, shortcutFromEvent, shortcutLabel } from './settings'
import { retainReaderEntries } from './reader/cache-policy.mjs'
import { installGlassContrast } from './ui/glass-contrast'
import { floatLeavingPanel, restoreLeavingPanel } from './ui/panel-transition'
import { useFullscreen } from './ui/fullscreen'
import { vLiquidSelection } from './ui/liquid-selection'
const PdfReader = defineAsyncComponent(() => import('./components/PdfReader.vue'))
const MarkdownReader = defineAsyncComponent(() => import('./components/MarkdownReader.vue'))
const AiPane = defineAsyncComponent(() => import('./components/AiPane.vue'))
const SettingsDialog = defineAsyncComponent(() => import('./components/SettingsDialog.vue'))
const SplitPicker = defineAsyncComponent(() => import('./components/SplitPicker.vue'))
const { preferences, effectiveAppearance, load: loadPreferences, save: savePreferences } = useSettings()

const documents = ref<Doc[]>([])
type CaptureFrame = { left: number; top: number; width: number; height: number }
type DocumentSelection = { text: string; page: number; image?: string; rect?: any; captureFrame?: CaptureFrame }
type OpenTab = { doc: Doc; view?: any; selection?: DocumentSelection }
const tabs = ref<OpenTab[]>([])
const active = ref<Doc | null>(null)
const currentTab = computed(() => tabs.value.find(tab => tab.doc.id === active.value?.id))
const fileTabs = computed(() => tabs.value.map(tab => ({ id: tab.doc.id, name: tab.doc.name, kind: tab.doc.kind, phase: chatPhase(tab.doc.id), beside: splitIds.value.length > 1 && splitIds.value.includes(tab.doc.id) })))
/* 并排阅读：splitIds 为并排显示的文件（含当前焦点），少于两份即为单栏。焦点栏就是 active。 */
const MAX_PANES = 3
const splitIds = ref<string[]>([])
const paneIds = computed(() => splitIds.value.length > 1 ? splitIds.value : active.value ? [active.value.id] : [])
const splitView = computed(() => paneIds.value.length > 1)
function paneVisible(id: string) { return splitIds.value.length > 1 ? splitIds.value.includes(id) : active.value?.id === id }
function visibleReaders() { return paneIds.value.map(id => readerInstances.get(id)).filter(Boolean) }
function pdfOnScreen() { return paneIds.value.some(id => tabs.value.find(tab => tab.doc.id === id)?.doc.kind === 'pdf') }
const splitPicker = ref<{ left: number; top: number; right: number; bottom: number }>()
const enteringPane = ref<string>()
let enteringTimer: ReturnType<typeof setTimeout> | undefined
const splitCandidates = computed(() => {
  const shown = new Set(paneIds.value)
  const open = tabs.value.filter(tab => !shown.has(tab.doc.id)).map(tab => ({ id: tab.doc.id, name: tab.doc.name, kind: tab.doc.kind, open: true }))
  const library = [...documents.value].filter(doc => !shown.has(doc.id) && !tabs.value.some(tab => tab.doc.id === doc.id)).sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt)).map(doc => ({ id: doc.id, name: doc.name, kind: doc.kind, open: false }))
  return [...open, ...library]
})
/* 阅读位置胶囊：翻页或保存后展开约两秒，随后收成一颗进度环。 */
const pillAwake = reactive<Record<string, boolean>>({})
const pillSaved = reactive<Record<string, boolean>>({})
const pillTimers = new Map<string, ReturnType<typeof setTimeout>>()
function wakePill(id: string, saved = false) {
  pillAwake[id] = true
  if (saved) pillSaved[id] = true
  clearTimeout(pillTimers.get(id))
  pillTimers.set(id, setTimeout(() => { pillAwake[id] = false; pillSaved[id] = false; pillTimers.delete(id) }, saved ? 1600 : 2200))
}
function tabDoc(id: string) { return tabs.value.find(tab => tab.doc.id === id)?.doc }
type ReaderEntry = { id: string; doc: Doc; size: number; bytes: Uint8Array; view?: any; events: Record<string, (...args: any[]) => void> }
const readerCache = shallowRef<ReaderEntry[]>([])
const readerInstances = new Map<string, any>()
const pendingReads = new Map<string, Promise<Uint8Array>>()
const selectionAction = ref<{ left: number; top: number }>()
const selection = shallowRef<DocumentSelection>()
type CaptureQuick = { documentId: string; selection: DocumentSelection; frame: CaptureFrame; pending: boolean; status: string; ownedRequest?: ReturnType<typeof chatState>['request'] }
const captureQuick = shallowRef<CaptureQuick>()
let captureQuickFrame = 0
let captureQuickResize: ResizeObserver | undefined
let captureQuickMutation: MutationObserver | undefined
const captureQuickBusy = computed(() => Boolean(captureQuick.value && (captureQuick.value.pending || chatState(captureQuick.value.documentId).request)))
const captureQuickStatus = computed(() => captureQuick.value?.status || (captureQuick.value && chatState(captureQuick.value.documentId).request ? '这份文档已有问题正在处理，可点继续查看。' : ''))
const reader = ref<any>()
const assistant = ref<any>()
let focusAssistantPending = false
const settingsOpen = ref(false)
const settingsTab = ref<'appearance' | 'reading' | 'shortcuts' | 'ai'>('appearance')
const fitRequest = ref(0)
const query = ref('')
const category = ref('all')
const tagFilter = ref('')
const display = ref<'grid' | 'list'>('grid')
const loading = ref(true)
const importing = ref(false)
const draggingFiles = ref(false)
const opening = ref(false)
const aiOpen = ref(false)
const sidebarOpen = ref(true)
const detailsOpen = ref(false)
const removeTarget = ref<Doc | null>(null)
const theme = ref('light')
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const tagInput = ref('')
const toast = ref('')
const search = ref<HTMLInputElement>()
let focusSearchPending = false
let findPendingDocument: string | undefined
let toastTimer: ReturnType<typeof setTimeout>
let queryTimer: ReturnType<typeof setTimeout>
let progressTimer: ReturnType<typeof setTimeout>
let openEpoch = 0
let listEpoch = 0
const pendingProgress = new Map<string, Partial<Doc>>()
const progressWrites = new Map<string, Promise<void>>()
const indexTimers = new Map<string, ReturnType<typeof setTimeout>>()

const tags = computed(() => [...new Set(documents.value.flatMap(doc => doc.tags))].sort())
const starredCount = computed(() => documents.value.filter(doc => doc.starred).length)
const visibleDocuments = computed(() => {
  let list = [...documents.value]
  if (category.value === 'starred') list = list.filter(doc => doc.starred)
  if (category.value === 'recent') list = list.filter(doc => doc.lastOpenedAt)
  if (tagFilter.value) list = list.filter(doc => doc.tags.includes(tagFilter.value))
  return list.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt))
})
const currentTitle = computed(() => tagFilter.value || (category.value === 'starred' ? '我的收藏' : category.value === 'recent' ? '最近阅读' : '文档库'))
const aiDocument = computed(() => active.value ? { id: active.value.id, title: active.value.name, kind: active.value.kind } : null)
const aiContext = computed(() => ({ page: active.value?.page || 1, selection: selection.value }))
const totalPages = computed(() => documents.value.filter(doc => doc.kind === 'pdf' && doc.lastOpenedAt).reduce((sum, doc) => sum + (doc.pageCount || 0), 0))

function notify(message: string) { toast.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 4800) }
const { fullscreen, fullscreenPending, toggleFullscreen, exitFullscreen } = useFullscreen(isDesktop, notify)
function reason(error: any) { return error?.message || String(error) }
function size(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB` }
function date(value: number) {
  if (!value) return '尚未阅读'
  const timestamp = value < 100000000000 ? value * 1000 : value
  const day = new Date(timestamp)
  const now = new Date()
  if (day.toDateString() === now.toDateString()) return '今天'
  return `${day.getMonth() + 1} 月 ${day.getDate()} 日`
}
function progressPercent(doc: Doc) { return Math.round(Math.min(1, Math.max(0, doc.progress || 0)) * 100) }
function updateLocal(doc: Doc) {
  const open = tabs.value.find(tab => tab.doc.id === doc.id)?.doc
  const pending = pendingProgress.get(doc.id)
  // A completed database write may contain an older position than the reader.
  const current = { ...doc, ...(open ? { page: open.page, pageCount: open.pageCount, progress: open.progress, lastOpenedAt: Math.max(open.lastOpenedAt, doc.lastOpenedAt) } : {}), ...pending }
  const index = documents.value.findIndex(item => item.id === doc.id)
  if (index >= 0) documents.value[index] = current
  for (const tab of tabs.value) if (tab.doc.id === doc.id) tab.doc = current
  if (active.value?.id === doc.id) active.value = current
}
async function refresh() {
  const epoch = ++listEpoch
  try { const list = await library.list(query.value); if (epoch === listEpoch) documents.value = list }
  catch (error) { notify(`文档库加载失败：${reason(error)}`) }
  finally { loading.value = false }
}
function searchDocuments() { clearTimeout(queryTimer); queryTimer = setTimeout(refresh, 180) }
function chooseCategory(value: string) { category.value = value; tagFilter.value = ''; closeReader() }
function chooseTag(value: string) { tagFilter.value = value; category.value = 'all'; closeReader() }
async function addDocuments(load: () => Promise<Doc[]>) {
  if (importing.value) { notify('正在加入文档，请稍候。'); return }
  importing.value = true
  try {
    const imported = await load()
    if (!imported.length) return
    const changed = new Set<string>()
    for (const doc of imported) {
      const tab = tabs.value.find(tab => tab.doc.id === doc.id)
      const cached = readerCache.value.find(entry => entry.id === doc.id)
      const previous = cached?.doc || tab?.doc
      if (previous && (previous.size !== doc.size || previous.modifiedAt !== doc.modifiedAt)) {
        changed.add(doc.id)
        if (active.value?.id === doc.id) { pauseReader(); ++openEpoch; opening.value = true; selection.value = undefined; active.value = doc }
        evictReader(doc.id); pendingReads.delete(doc.id); forgetPassword(doc.id)
        clearTimeout(indexTimers.get(doc.id)); indexTimers.delete(doc.id)
        if (tab) tab.selection = undefined
      }
      if (tab) tab.doc = { ...doc, page: tab.doc.page, pageCount: tab.doc.pageCount, progress: tab.doc.progress, lastOpenedAt: Math.max(tab.doc.lastOpenedAt, doc.lastOpenedAt) }
      else tabs.value.push({ doc })
    }
    query.value = ''; await refresh()
    notify(`已加入 ${imported.length} 份文档`)
    await openDocument(imported[0], changed.has(imported[0].id))
  } catch (error) { notify(`导入失败：${reason(error)}`) }
  finally { importing.value = false }
}
function importDocuments() { return addDocuments(() => library.importDocuments()) }
function dropDocuments(files: string[] | File[]) { draggingFiles.value = false; return addDocuments(() => importDroppedDocuments(files)) }
async function flushProgress() {
  clearTimeout(progressTimer)
  const pending = [...pendingProgress]; pendingProgress.clear()
  await Promise.all(pending.map(([id, patch]) => writeReadingUpdate(id, patch, '阅读位置保存失败')))
}
function writeReadingUpdate(id: string, patch: Partial<Doc>, message: string) {
  const write = (progressWrites.get(id) || Promise.resolve()).then(async () => {
    try { updateLocal(await library.update(id, patch)); if ('page' in patch && paneVisible(id)) wakePill(id, true) }
    catch (error) { notify(`${message}：${reason(error)}`) }
  })
  progressWrites.set(id, write)
  void write.finally(() => { if (progressWrites.get(id) === write) progressWrites.delete(id) })
  return write
}
function rememberReader() {
  const tab = currentTab.value
  if (tab) { tab.view = reader.value?.getViewState?.() || tab.view; tab.selection = selection.value }
  selectionAction.value = undefined
  window.getSelection()?.removeAllRanges()
}
function pauseReader() { dismissCaptureQuick(); rememberReader(); reader.value?.suspend?.(); reader.value = undefined; findPendingDocument = undefined; clearWheelZoom() }
// 焦点移到另一栏时，原阅读器仍在屏幕上，只交出键盘与 AI 的焦点，不挂起渲染。
function leaveFocus() { dismissCaptureQuick(); rememberReader(); reader.value = undefined; findPendingDocument = undefined; clearWheelZoom() }
function bindReader(id: string, value: any) {
  if (value) readerInstances.set(id, value)
  if (active.value?.id === id) reader.value = value || undefined
}
function retainReaders(entries: ReaderEntry[], id: string) {
  const retained = retainReaderEntries(entries, id, paneIds.value)
  for (const entry of readerCache.value) if (!retained.includes(entry)) readerInstances.delete(entry.id)
  readerCache.value = retained
}
function evictReader(id: string) { readerCache.value = readerCache.value.filter(entry => entry.id !== id); readerInstances.delete(id) }
function readDocument(id: string) {
  let promise = pendingReads.get(id)
  if (!promise) {
    promise = library.read(id); pendingReads.set(id, promise)
    const current = promise
    void promise.finally(() => { if (pendingReads.get(id) === current) pendingReads.delete(id) }).catch(() => {})
  }
  return promise
}
function cacheReader(doc: Doc, bytes: Uint8Array, view: any) {
  const entry: ReaderEntry = { id: doc.id, doc, bytes, size: bytes.byteLength, view, events: {} }
  const present = () => readerCache.value.includes(entry) && tabs.value.some(tab => tab.doc.id === entry.id)
  const focused = () => present() && active.value?.id === entry.id
  const shown = () => present() && paneVisible(entry.id)
  entry.events = {
    ready: () => { if (focused()) opening.value = false },
    progress: value => { if (shown()) readingProgress(entry.id, value) },
    selection: value => { if (focused()) selectedContext(value) },
    text: value => { if (shown()) indexText(entry.id, value) },
    error: message => { if (shown()) { if (focused()) opening.value = false; notify(message) } },
    'font-size-change': value => { if (focused()) setMarkdownFontSize(value) },
  }
  return entry
}
async function openDocument(doc: Doc, reload = false) {
  if (active.value?.id === doc.id && !reload) return
  // 并排时：已在屏幕上的文件只切换焦点；其他文件替换焦点所在的一栏。
  if (!reload && splitIds.value.length > 1) {
    if (splitIds.value.includes(doc.id)) { focusPane(doc.id); return }
    const previous = active.value?.id
    splitIds.value = splitIds.value.map(id => id === previous ? doc.id : id)
  }
  return showDocument(doc, reload)
}
async function showDocument(doc: Doc, reload = false) {
  const previous = active.value?.id
  // 只有仍留在并排中的上一栏才保持渲染；否则先挂起，趁它还在页面上记下阅读位置。
  if (previous && previous !== doc.id && splitIds.value.length > 1 && splitIds.value.includes(previous)) leaveFocus()
  else pauseReader()
  const epoch = ++openEpoch
  void flushProgress()
  let tab = tabs.value.find(tab => tab.doc.id === doc.id)
  if (!tab) { tab = { doc }; tabs.value.push(tab) }
  active.value = tab.doc; selection.value = tab.selection
  opening.value = true; detailsOpen.value = false
  try {
    const cached = readerCache.value.find(entry => entry.id === doc.id)
    if (cached) retainReaders(readerCache.value, doc.id)
    else {
      const bytes = await readDocument(doc.id)
      if (epoch !== openEpoch || !tabs.value.includes(tab)) return
      retainReaders([...readerCache.value, cacheReader(tab.doc, bytes, tab.view)], doc.id)
    }
    await nextTick()
    if (epoch !== openEpoch) return
    const instance = readerInstances.get(doc.id)
    if (instance) {
      reader.value = instance
      // 并排时这一栏可能一直在屏幕上：没有挂起过就不会再发 ready。
      if (instance.isSuspended?.() === false) opening.value = false
      void instance.resume?.()
    }
    // Reading must not wait for a database write or an older position save.
    void writeReadingUpdate(doc.id, { lastOpenedAt: Date.now() }, '阅读记录更新失败')
  } catch (error) { if (epoch === openEpoch) { notify(`无法打开文档：${reason(error)}`); closeTab(doc.id) } }
}
function closeReader() { pauseReader(); ++openEpoch; void flushProgress(); splitIds.value = []; splitPicker.value = undefined; active.value = null; readerCache.value = []; readerInstances.clear(); opening.value = false; selection.value = undefined; detailsOpen.value = false; void refresh() }
function focusPane(id: string) {
  if (active.value?.id === id || !paneVisible(id)) return
  const tab = tabs.value.find(tab => tab.doc.id === id)
  if (!tab) return
  leaveFocus()
  active.value = tab.doc; selection.value = tab.selection
  const instance = readerInstances.get(id)
  if (instance) reader.value = instance
  opening.value = false
}
function pointerFocusPane(event: PointerEvent, id: string) {
  if (event.button === 0 || event.button === 1 || event.pointerType === 'touch') focusPane(id)
}
async function openBeside(id: string) {
  splitPicker.value = undefined
  const doc = tabDoc(id) || documents.value.find(item => item.id === id)
  if (!doc || !active.value) return
  if (paneVisible(doc.id)) { focusPane(doc.id); return }
  const base = paneIds.value
  if (base.length >= MAX_PANES) { notify(`最多同时并排 ${MAX_PANES} 份文档。`); return }
  if (!tabs.value.some(tab => tab.doc.id === doc.id)) tabs.value.push({ doc })
  splitIds.value = [...base, doc.id]
  enteringPane.value = doc.id; clearTimeout(enteringTimer); enteringTimer = setTimeout(() => { enteringPane.value = undefined }, 600)
  // 新栏出现时其余阅读器的宽度变化，交给各自的 ResizeObserver 重新适应。
  await showDocument(tabDoc(doc.id) || doc)
}
function closePane(id: string) {
  if (splitIds.value.length < 2 || !splitIds.value.includes(id)) return
  const index = splitIds.value.indexOf(id)
  const rest = splitIds.value.filter(item => item !== id)
  if (active.value?.id === id) focusPane(rest[Math.min(index, rest.length - 1)])
  // 在移出页面之前挂起，阅读器才能记下这一栏的滚动位置。
  const tab = tabs.value.find(tab => tab.doc.id === id), instance = readerInstances.get(id)
  if (tab) tab.view = instance?.getViewState?.() || tab.view
  instance?.suspend?.()
  splitIds.value = rest.length > 1 ? rest : []
}
function toggleSplitPicker(event?: Event) {
  if (splitPicker.value || !active.value) { splitPicker.value = undefined; return }
  const anchor = (event?.currentTarget as HTMLElement | undefined) || document.querySelector<HTMLElement>('[data-split-anchor]')
  const bounds = anchor?.getBoundingClientRect()
  splitPicker.value = bounds ? { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom } : { left: window.innerWidth - 340, top: 12, right: window.innerWidth - 12, bottom: 56 }
}
function selectTab(id: string) { const tab = tabs.value.find(tab => tab.doc.id === id); if (tab) void openDocument(tab.doc) }
function closeTab(id: string) {
  const index = tabs.value.findIndex(tab => tab.doc.id === id)
  if (index < 0) return
  const selected = active.value?.id === id
  const paneIndex = splitIds.value.length > 1 ? splitIds.value.indexOf(id) : -1
  const rest = paneIndex >= 0 ? splitIds.value.filter(item => item !== id) : []
  if (paneIndex >= 0) splitIds.value = rest.length > 1 ? rest : []
  if (selected) { pauseReader(); ++openEpoch; void flushProgress(); active.value = null; selection.value = undefined; detailsOpen.value = false; opening.value = false }
  evictReader(id)
  closeChat(id); forgetPassword(id); tabs.value.splice(index, 1)
  // 关闭并排中的焦点文件时，焦点落到相邻的一栏，其余栏保持不动。
  if (selected && rest.length) selectTab(rest[Math.min(paneIndex, rest.length - 1)])
  else if (selected && tabs.value.length) selectTab(tabs.value[Math.min(index, tabs.value.length - 1)].doc.id)
  else if (selected) closeReader()
}
function moveTab(direction: number) {
  if (!tabs.value.length) return
  const index = tabs.value.findIndex(tab => tab.doc.id === active.value?.id)
  selectTab(tabs.value[(index + direction + tabs.value.length) % tabs.value.length].doc.id)
}
function openAssistant(focus = false) {
  aiOpen.value = true; focusAssistantPending = focus
  void nextTick(() => { if (focusAssistantPending && assistant.value) { assistant.value.focusPrompt?.(); focusAssistantPending = false } })
}
function selectedContext(value: typeof selection.value) {
  dismissCaptureQuick()
  selection.value = value
  if (currentTab.value) currentTab.value.selection = value
  if (value?.image) {
    selectionAction.value = undefined
    if (preferences.value.pdf.quickAskOnCapture && active.value?.kind === 'pdf') {
      const frame = reader.value?.getCaptureFrame?.(value) || value.captureFrame
      if (frame) {
        captureQuick.value = { documentId: active.value.id, selection: value, frame, pending: false, status: '' }
        monitorCaptureQuick()
      } else notify('选区位置已变化，可在阅读助手中继续提问。')
    } else if (preferences.value.pdf.openAssistantOnCapture) openAssistant(true)
  } else if (value?.text) {
    const native = window.getSelection()
    const rect = native?.rangeCount ? native.getRangeAt(0).getBoundingClientRect() : null
    if (rect?.width) selectionAction.value = { left: Math.max(8, Math.min(window.innerWidth - 88, rect.right - 70)), top: Math.max(8, Math.min(window.innerHeight - 40, rect.bottom + 5)) }
  }
}
function dismissCaptureQuick(clear = false) {
  const current = captureQuick.value
  captureQuick.value = undefined
  if (captureQuickFrame) cancelAnimationFrame(captureQuickFrame)
  captureQuickFrame = 0
  captureQuickResize?.disconnect(); captureQuickResize = undefined
  captureQuickMutation?.disconnect(); captureQuickMutation = undefined
  if (current?.pending && current.ownedRequest && chatState(current.documentId).request === current.ownedRequest) stopChat(current.documentId)
  if (clear && current && active.value?.id === current.documentId && toRaw(selection.value) === toRaw(current.selection)) clearSelection()
}
function monitorCaptureQuick() {
  if (captureQuickFrame) cancelAnimationFrame(captureQuickFrame)
  captureQuickFrame = 0
  captureQuickResize?.disconnect(); captureQuickMutation?.disconnect()
  const check = () => {
    captureQuickFrame = 0
    const current = captureQuick.value
    if (!current) return
    if (active.value?.id !== current.documentId || toRaw(selection.value) !== toRaw(current.selection)) { dismissCaptureQuick(); return }
    // Settings covers the capture without changing the underlying attachment.
    if (!settingsOpen.value) {
      const frame = reader.value?.getCaptureFrame?.(current.selection)
      if (!frame || [frame.left, frame.top, frame.width, frame.height].some((value, index) => Math.abs(value - [current.frame.left, current.frame.top, current.frame.width, current.frame.height][index]) > .5)) { dismissCaptureQuick(); return }
    }
  }
  const schedule = () => { if (!captureQuickFrame) captureQuickFrame = requestAnimationFrame(check) }
  captureQuickResize = new ResizeObserver(schedule)
  const elements: HTMLElement[] = reader.value?.getCaptureElements?.(captureQuick.value?.selection) || []
  const slot = elements.find(element => element.matches('.page-slot'))
  for (const element of [document.querySelector('.reading-main'), ...elements]) if (element) captureQuickResize.observe(element)
  if (slot) {
    captureQuickMutation = new MutationObserver(schedule)
    captureQuickMutation.observe(slot, { childList: true, attributes: true, subtree: true, attributeFilter: ['style', 'class', 'width', 'height'] })
  }
  schedule()
}
function captureViewportChanged(event?: Event) {
  if (event?.target instanceof Element && event.target.closest('.capture-quick-actions,.settings-dialog')) return
  dismissCaptureQuick()
}
function continueCaptureQuick() { dismissCaptureQuick(); openAssistant(true) }
async function askCaptureQuick(question: string) {
  const current = captureQuick.value
  if (!current || current.pending || active.value?.id !== current.documentId) return
  const state = chatState(current.documentId)
  if (state.request) { current.status = '这份文档已有问题正在处理，可点继续查看。'; captureQuick.value = { ...current }; return }
  const doc = { id: current.documentId, title: active.value.name, kind: active.value.kind }
  const context = { page: current.selection.page, selection: current.selection }
  current.pending = true; current.status = '准备提问…'; captureQuick.value = { ...current }
  // sendChat takes its selection snapshot before its first await. Force the
  // selected screenshot for this request without changing the user's choice.
  const includeSelection = state.includeSelection
  state.includeSelection = true
  let accepted = false
  const sending = sendChat(doc, context, () => {
    if (active.value?.id === doc.id && toRaw(selection.value) === toRaw(context.selection)) openSettings('ai')
  }, () => {
    accepted = true; current.pending = false
    // Do not abort an accepted queued request when removing its capture UI.
    if (captureQuick.value?.documentId === doc.id && toRaw(captureQuick.value.selection) === toRaw(context.selection)) {
      captureQuick.value.pending = false; captureQuick.value.ownedRequest = undefined; dismissCaptureQuick()
    }
    consumeSelection({ documentId: doc.id, selection: context.selection })
    if (active.value?.id === doc.id) openAssistant()
  }, question)
  state.includeSelection = includeSelection
  if (captureQuick.value?.documentId === current.documentId) captureQuick.value.ownedRequest = state.request
  try { await sending }
  finally {
    const retained = captureQuick.value
    if (!accepted && retained?.documentId === doc.id && toRaw(retained.selection) === toRaw(context.selection)) {
      retained.pending = false; retained.ownedRequest = undefined; retained.status = state.status || '未能发送，请重试。'; captureQuick.value = { ...retained }
    }
  }
}
function selectionChanged() { if (window.getSelection()?.isCollapsed) selectionAction.value = undefined }
function dismissSelectionAction() { selectionAction.value = undefined }
async function toggleStar(doc: Doc) {
  try { updateLocal(await library.update(doc.id, { starred: !doc.starred })) }
  catch (error) { notify(reason(error)) }
}
function readingProgress(id: string, value: { page: number; pageCount: number; progress: number }) {
  const tab = tabs.value.find(tab => tab.doc.id === id)
  if (!tab || !value.pageCount) return
  if (captureQuick.value?.documentId === id && captureQuick.value.selection.page !== value.page) dismissCaptureQuick()
  const patch = { page: value.page, pageCount: value.pageCount, progress: value.progress }
  const moved = tab.doc.page !== value.page || tab.doc.pageCount !== value.pageCount
  tab.doc = { ...tab.doc, ...patch }
  if (active.value?.id === id) active.value = tab.doc
  const local = documents.value.find(doc => doc.id === id)
  if (local) Object.assign(local, patch)
  if (moved) wakePill(id)
  pendingProgress.set(id, patch)
  clearTimeout(progressTimer); progressTimer = setTimeout(flushProgress, 800)
}
function indexText(id: string, text: string) {
  clearTimeout(indexTimers.get(id))
  indexTimers.set(id, setTimeout(() => { indexTimers.delete(id); void library.index(id, text.slice(0, 2000000)).catch(error => notify(`搜索索引更新失败：${reason(error)}`)) }, 1200))
}
function clearSelection() { dismissCaptureQuick(); selection.value = undefined; selectionAction.value = undefined; if (currentTab.value) currentTab.value.selection = undefined; window.getSelection()?.removeAllRanges(); reader.value?.clearSelection?.() }
function consumeSelection(value: { documentId: string; selection: any }) {
  const tab = tabs.value.find(tab => tab.doc.id === value.documentId)
  if (!tab || toRaw(tab.selection) !== toRaw(value.selection)) return
  tab.selection = undefined
  if (active.value?.id === value.documentId && toRaw(selection.value) === toRaw(value.selection)) clearSelection()
}
function jump(value: { page?: number; rect?: any; line?: number }) { if (active.value?.kind === 'markdown') reader.value?.goToPage?.(value.line || value.page || 1); else if (value.page) reader.value?.goToPage?.(value.page, value.rect) }
async function addTag() {
  const value = tagInput.value.trim().slice(0, 40)
  if (!value || !active.value) return
  try { updateLocal(await library.update(active.value.id, { tags: [...new Set([...active.value.tags, value])] })); tagInput.value = '' }
  catch (error) { notify(reason(error)) }
}
async function removeTag(value: string) {
  if (!active.value) return
  try { updateLocal(await library.update(active.value.id, { tags: active.value.tags.filter(tag => tag !== value) })) }
  catch (error) { notify(reason(error)) }
}
async function removeDocument() {
  if (!removeTarget.value) return
  const target = removeTarget.value
  try { if (active.value?.id === target.id) rememberReader(); await flushProgress(); await progressWrites.get(target.id); clearTimeout(indexTimers.get(target.id)); indexTimers.delete(target.id); await library.remove(target.id); closeTab(target.id); removeTarget.value = null; await refresh(); notify('已从文档库移除，原文件保留。') }
  catch (error) { notify(reason(error)) }
}
let appliedBackground: string | undefined
let glassContrast: ReturnType<typeof installGlassContrast> | undefined
function applyTheme() {
  const appearance = effectiveAppearance.value
  const selected = appearance.theme
  theme.value = selected === 'system' ? (systemTheme.matches ? 'dark' : 'light') : selected
  const root = document.documentElement
  root.dataset.theme = theme.value
  root.dataset.glass = appearance.glassTransparency === 0 ? 'solid' : 'custom'
  root.style.setProperty('--glass-transparency', String(appearance.glassTransparency / 100))
  root.dataset.background = appearance.background ? 'custom' : 'default'
  root.dataset.backdrop = appearance.backdrop
  const background = appearance.background?.dataUrl
  if (background !== appliedBackground) {
    // The settings model accepts only bounded, locally encoded raster data URLs.
    if (background) root.style.setProperty('--custom-workspace-image', `url("${background}")`)
    else root.style.removeProperty('--custom-workspace-image')
    appliedBackground = background
    glassContrast?.setBackground(background ?? null)
  }
  glassContrast?.refresh()
}
async function toggleTheme(event?: MouseEvent) {
  const next = { ...preferences.value, appearance: { ...preferences.value.appearance, theme: theme.value === 'dark' ? 'light' as const : 'dark' as const } }
  const save = async () => { await savePreferences(next); await nextTick() }
  // 主题切换：新主题从按钮处以圆形扩散覆盖旧画面（视图过渡，仅快照，不重排）。
  const start = (document as any).startViewTransition?.bind(document)
  if (!start || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    try { await save() } catch (error) { notify(reason(error)) }
    return
  }
  const target = event?.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : undefined
  const x = target ? target.left + target.width / 2 : window.innerWidth - 40, y = target ? target.top + target.height / 2 : 40
  const root = document.documentElement
  root.style.setProperty('--reveal-x', `${x}px`); root.style.setProperty('--reveal-y', `${y}px`)
  root.style.setProperty('--reveal-r', `${Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))}px`)
  let failure: unknown
  // 过渡期间页面不可点击；标记在根元素上，便于界面与检查脚本等待它结束。
  root.dataset.themeTransition = 'running'
  const transition = start(async () => { try { await save() } catch (error) { failure = error } })
  try { await transition.finished } catch { /* An interrupted transition still applied the theme. */ }
  finally { delete root.dataset.themeTransition }
  if (failure) notify(reason(failure))
}
async function setDisplay(value: 'grid' | 'list') {
  try { await savePreferences({ ...preferences.value, appearance: { ...preferences.value.appearance, libraryView: value } }) }
  catch (error) { notify(reason(error)) }
}
async function setMarkdownFontSize(value: number) {
  try { await savePreferences({ ...preferences.value, markdown: { ...preferences.value.markdown, fontSize: value } }) }
  catch (error) { notify(reason(error)) }
}
/* 在 Vue 改变面板布局之前锁定阅读区的屏幕位置；新位图与最终布局一起提交。
   窄屏下右侧面板是浮层，不占阅读宽度。 */
const resizingPanels = new Map<Element, boolean>()
let fitAfterPanelResize = false
watch([sidebarOpen, aiOpen, detailsOpen], () => {
  if (pdfOnScreen() && !window.matchMedia('(max-width: 720px)').matches) for (const instance of visibleReaders()) instance.holdPanelResize?.(true)
}, { flush: 'sync' })
function paneResizeStart(element: Element, entering: boolean) {
  resizingPanels.set(element, entering)
  if (pdfOnScreen() && !window.matchMedia('(max-width: 720px)').matches) for (const instance of visibleReaders()) instance.holdPanelResize?.(true, entering)
  if (entering) restoreLeavingPanel(element)
  else floatLeavingPanel(element, element.classList.contains('app-sidebar') ? 'left' : 'right')
}
function paneResizeEnd(element: Element, cancelled = false) {
  restoreLeavingPanel(element)
  if (resizingPanels.get(element) && !cancelled) fitAfterPanelResize = true
  resizingPanels.delete(element)
  if (!resizingPanels.size) {
    if (pdfOnScreen()) {
      const targets = visibleReaders().filter(instance => instance.holdPanelResize)
      for (const target of targets) target.holdPanelResize(false, fitAfterPanelResize)
      if (!targets.length && fitAfterPanelResize) fitRequest.value++
    }
    fitAfterPanelResize = false
  }
}
function openSettings(tab: typeof settingsTab.value = 'appearance') { settingsTab.value = tab; settingsOpen.value = true }
function aiSettingsSaved(value: any) { configureRequests(value); assistant.value?.applySettings?.(value) }
function shortcut(action: keyof typeof preferences.value.shortcuts) { return shortcutLabel(preferences.value.shortcuts[action]) }
// Bound shortcuts only, for the hover tooltips (data-tip-key); disabled ones show no key.
const tipKeys = computed<Record<string, string>>(() => Object.fromEntries(Object.entries(preferences.value.shortcuts).filter(([, value]) => value).map(([action, value]) => [action, shortcutLabel(value)])))
function tipKey(action: keyof typeof preferences.value.shortcuts) { return tipKeys.value[action] || undefined }
watch(effectiveAppearance, () => { applyTheme(); display.value = effectiveAppearance.value.libraryView }, { immediate: true })
// A tab may mount its reader while several panels are still transitioning.
watch(reader, value => {
  if (active.value?.kind === 'pdf' && resizingPanels.size && !window.matchMedia('(max-width: 720px)').matches) value?.holdPanelResize?.(true)
  if (!value) splitPicker.value = undefined
  if (value && active.value?.id === findPendingDocument) { value.focusSearch?.(); findPendingDocument = undefined }
})
watch(search, value => {
  if (value && focusSearchPending) { value.focus(); focusSearchPending = false }
})
watch(settingsOpen, value => { if (!value && captureQuick.value) monitorCaptureQuick() })
watch(() => preferences.value.pdf.quickAskOnCapture, value => { if (!value) dismissCaptureQuick() })
watch(assistant, async value => {
  if (value && aiOpen.value && focusAssistantPending) { value.focusPrompt?.(); focusAssistantPending = false }
})
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') {
    if (settingsOpen.value) { settingsOpen.value = false; event.preventDefault() }
    else if (splitPicker.value) { splitPicker.value = undefined; event.preventDefault() }
    else if (captureQuick.value) { dismissCaptureQuick(true); event.preventDefault() }
    else if (removeTarget.value) { removeTarget.value = null; event.preventDefault() }
    else if (detailsOpen.value) { detailsOpen.value = false; event.preventDefault() }
    else if (reader.value?.cancelCapture?.()) event.preventDefault()
    else if (fullscreen.value) { event.preventDefault(); void exitFullscreen() }
    return
  }
  const binding = shortcutFromEvent(event)
  if (settingsOpen.value || removeTarget.value) {
    if (binding && ['Ctrl+KeyF', 'F11', preferences.value.shortcuts.find, preferences.value.shortcuts.fullscreen].includes(binding)) event.preventDefault()
    return
  }
  if (captureQuick.value) {
    if (binding || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) event.preventDefault()
    return
  }
  let action = matchShortcut(event, preferences.value)
  if (!action && active.value) {
    const candidate = matchShortcut(event, preferences.value, { scope: 'ai' })
    if (candidate === 'aiStop' || (aiOpen.value && event.target instanceof Element && event.target.closest('.ai-pane'))) action = candidate
  }
  if (!action) {
    if (binding === 'Ctrl+KeyF' || binding === 'F11') event.preventDefault()
    return
  }
  if (event.repeat && !['zoomIn', 'zoomOut', 'previousPage', 'nextPage'].includes(action)) { event.preventDefault(); return }
  if (['outline', 'fitWidth', 'zoomOut', 'zoomIn', 'previousPage', 'nextPage', 'capture', 'split'].includes(action) && !active.value) return
  if (['capture', 'fitWidth'].includes(action) && active.value?.kind !== 'pdf') return
  event.preventDefault()
  switch (action) {
    case 'import': void importDocuments(); break
    case 'fullscreen': void toggleFullscreen(); break
    case 'find':
      if (active.value) {
        if (reader.value) reader.value.focusSearch?.()
        else findPendingDocument = active.value.id
      } else search.value?.focus()
      break
    case 'search':
      focusSearchPending = true
      if (active.value) closeReader()
      else if (search.value) { search.value.focus(); focusSearchPending = false }
      break
    case 'settings': openSettings(); break
    case 'sidebar': sidebarOpen.value = !sidebarOpen.value; break
    case 'ai': if (active.value) { if (aiOpen.value) aiOpen.value = false; else openAssistant(true) }; break
    case 'nextTab': moveTab(1); break
    case 'previousTab': moveTab(-1); break
    case 'closeTab': if (active.value) closeTab(active.value.id); break
    case 'split': toggleSplitPicker(); break
    case 'outline': reader.value?.toggleOutline?.(); break
    case 'fitWidth': reader.value?.fitWidth?.(); break
    case 'zoomOut': reader.value?.zoomOut?.(); break
    case 'zoomIn': reader.value?.zoomIn?.(); break
    case 'previousPage': reader.value?.previousPage?.(); break
    case 'nextPage': reader.value?.nextPage?.(); break
    case 'capture': reader.value?.toggleCapture?.(); break
    case 'aiSend': assistant.value?.send?.(); break
    case 'aiStop': if (active.value) stopChat(active.value.id); break
  }
}
let wheelTimer: ReturnType<typeof setTimeout> | undefined
let wheelAction: 'zoomIn' | 'zoomOut' | undefined
let wheelTime = 0
function clearWheelZoom() { clearTimeout(wheelTimer); wheelTimer = undefined; wheelAction = undefined; wheelTime = 0 }
function applyWheelZoom() {
  wheelTimer = undefined
  const action = wheelAction; wheelAction = undefined
  if (!action || !active.value || !reader.value || settingsOpen.value || removeTarget.value) return
  wheelTime = performance.now(); reader.value[action]?.()
}
function wheel(event: WheelEvent) {
  if (captureQuick.value && !settingsOpen.value) { event.preventDefault(); return }
  if (!active.value || !reader.value || settingsOpen.value || removeTarget.value) return
  if (!(event.target instanceof Element) || !event.target.closest('.reading-main')) return
  const action = matchWheelShortcut(event, preferences.value)
  if (!action) return
  event.preventDefault()
  const pane = event.target.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId
  if (pane && pane !== active.value.id) focusPane(pane)
  wheelAction = action
  const elapsed = performance.now() - wheelTime
  if (elapsed >= 60) { clearTimeout(wheelTimer); applyWheelZoom() }
  else if (!wheelTimer) wheelTimer = setTimeout(applyWheelZoom, 60 - elapsed)
}
let dragDepth = 0
let stopDropListening: (() => void) | undefined
let disposed = false
function fileDrag(event: DragEvent) { return !isDesktop && [...(event.dataTransfer?.types || [])].includes('Files') }
function dragEnter(event: DragEvent) { if (fileDrag(event)) { event.preventDefault(); dragDepth++; draggingFiles.value = true } }
function dragOver(event: DragEvent) { if (fileDrag(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = importing.value ? 'none' : 'copy'; draggingFiles.value = true } }
function dragLeave(event: DragEvent) { if (fileDrag(event) && (--dragDepth <= 0 || !event.relatedTarget)) { dragDepth = 0; draggingFiles.value = false } }
function fileDrop(event: DragEvent) {
  if (!fileDrag(event)) return
  event.preventDefault(); dragDepth = 0; draggingFiles.value = false
  void dropDocuments([...(event.dataTransfer?.files || [])])
}
async function listenForFileDrop() {
  if (!isDesktop) return
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    const unlisten = await getCurrentWebview().onDragDropEvent(event => {
      if (disposed) return
      const value = event.payload
      if (value.type === 'enter') draggingFiles.value = value.paths.some(path => /\.(pdf|md|markdown)$/i.test(path))
      else if (value.type === 'leave') draggingFiles.value = false
      else if (value.type === 'drop') void dropDocuments(value.paths)
    })
    if (disposed) unlisten(); else stopDropListening = unlisten
  } catch (error) { notify(`文件拖入暂不可用：${reason(error)}`) }
}
function getReaderCacheStats() {
  return readerCache.value.map(entry => ({ id: entry.id, bytes: entry.size, active: active.value?.id === entry.id, ...readerInstances.get(entry.id)?.getCacheStats?.() }))
}
defineExpose({ reader, getReaderCacheStats })
onMounted(async () => {
  glassContrast = installGlassContrast(document.getElementById('app')!)
  glassContrast.setBackground(appliedBackground ?? null)
  document.addEventListener('keydown', keydown)
  document.addEventListener('wheel', wheel, { capture: true, passive: false })
  document.addEventListener('dragenter', dragEnter)
  document.addEventListener('dragover', dragOver)
  document.addEventListener('dragleave', dragLeave)
  document.addEventListener('drop', fileDrop)
  void listenForFileDrop()
  document.addEventListener('selectionchange', selectionChanged)
  document.addEventListener('scroll', dismissSelectionAction, true)
  document.addEventListener('scroll', captureViewportChanged, true)
  window.addEventListener('resize', dismissSelectionAction)
  window.addEventListener('resize', captureViewportChanged)
  systemTheme.addEventListener('change', applyTheme)
  try { await loadPreferences() } catch (error) { notify(`设置加载失败：${reason(error)}`) }
  await refresh()
})
onBeforeUnmount(() => { for (const timer of pillTimers.values()) clearTimeout(timer); clearTimeout(enteringTimer); disposed = true; ++openEpoch; dismissCaptureQuick(); stopDropListening?.(); clearWheelZoom(); readerInstances.clear(); glassContrast?.dispose(); document.removeEventListener('keydown', keydown); document.removeEventListener('wheel', wheel, true); document.removeEventListener('dragenter', dragEnter); document.removeEventListener('dragover', dragOver); document.removeEventListener('dragleave', dragLeave); document.removeEventListener('drop', fileDrop); document.removeEventListener('selectionchange', selectionChanged); document.removeEventListener('scroll', dismissSelectionAction, true); document.removeEventListener('scroll', captureViewportChanged, true); window.removeEventListener('resize', dismissSelectionAction); window.removeEventListener('resize', captureViewportChanged); closeAllChats(); forgetAllPasswords(); systemTheme.removeEventListener('change', applyTheme); flushProgress(); for (const timer of indexTimers.values()) clearTimeout(timer); clearTimeout(queryTimer); clearTimeout(toastTimer) })
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': !sidebarOpen, 'has-reader': active }">
    <Transition name="sidebar" @before-enter="paneResizeStart($event, true)" @before-leave="paneResizeStart($event, false)" @after-enter="paneResizeEnd" @after-leave="paneResizeEnd" @enter-cancelled="paneResizeEnd($event, true)" @leave-cancelled="paneResizeEnd($event, true)">
    <aside class="app-sidebar" v-if="sidebarOpen" data-glass-interactive="panel">
      <button class="brand" @click="chooseCategory('all')" aria-label="返回文档库"><span class="brand-symbol"><AppIcon name="book" :size="22" /></span><span>开智</span></button>
      <button class="import-button" data-tip="加入 PDF / Markdown 文档" :data-tip-key="tipKey('import')" @click="importDocuments" :disabled="importing" aria-label="加入文档"><AppIcon name="plus" :size="18" />{{ importing ? '正在导入…' : '加入文档' }}<kbd v-if="preferences.shortcuts.import">{{ shortcut('import') }}</kbd></button>
      <nav v-liquid-selection="{ radius: '12px' }" class="workspace-nav" aria-label="文档分类">
        <button :class="{ selected: category === 'all' && !tagFilter }" @click="chooseCategory('all')"><AppIcon name="library" :size="18" />全部文档<span>{{ documents.length }}</span></button>
        <button :class="{ selected: category === 'recent' }" @click="chooseCategory('recent')"><AppIcon name="clock" :size="18" />最近阅读</button>
        <button :class="{ selected: category === 'starred' }" @click="chooseCategory('starred')"><AppIcon name="star" :size="18" />我的收藏<span>{{ starredCount }}</span></button>
      </nav>
      <div class="tag-heading"><p class="sidebar-label">标签</p><AppIcon name="tag" :size="14" /></div>
      <nav v-liquid-selection="{ radius: '12px' }" class="tag-nav" aria-label="文档标签"><button v-for="tag in tags" :key="tag" :class="{ selected: tagFilter === tag }" @click="chooseTag(tag)"><span class="tag-dot"></span>{{ tag }}<span>{{ documents.filter(doc => doc.tags.includes(tag)).length }}</span></button><p v-if="!tags.length" class="tag-empty">可在文档详情中添加标签。</p></nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-bottom"><button @click="openSettings()" aria-label="设置"><AppIcon name="settings" :size="17" /><span>设置</span></button><button class="icon-button" @click="toggleTheme($event)" :data-tip="theme === 'dark' ? '切换浅色主题' : '切换深色主题'" :aria-label="theme === 'dark' ? '切换浅色主题' : '切换深色主题'"><AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="17" /></button></div>
    </aside>
    </Transition>

    <main class="app-main">
      <header class="app-topbar" :class="{ 'with-tabs': tabs.length }" data-glass-interactive="panel">
        <button class="icon-button sidebar-toggle" @click="sidebarOpen = !sidebarOpen" data-tip="显示 / 隐藏侧栏" :data-tip-key="tipKey('sidebar')" aria-label="切换侧栏" :aria-expanded="sidebarOpen"><AppIcon name="panel" :size="18" /></button>
        <FileTabs v-if="tabs.length" :tabs="fileTabs" :active-id="active?.id" @select="selectTab" @close="closeTab" @library="closeReader" />
        <span v-else class="breadcrumb">{{ currentTitle }}</span>
        <div class="topbar-actions">
          <template v-if="active"><button class="icon-button" :class="{ 'is-starred': active.starred }" @click="toggleStar(active)" data-tip="收藏文档" aria-label="收藏文档"><AppIcon name="star" :size="18" /></button><button class="icon-button" :class="{ active: detailsOpen }" @click="detailsOpen = !detailsOpen" data-tip="文档详情与标签" aria-label="文档详情与标签" :aria-expanded="detailsOpen"><AppIcon name="tag" :size="18" /></button><button class="icon-button split-toggle" data-split-anchor :class="{ active: splitPicker || splitView }" @click="toggleSplitPicker($event)" data-tip="并排阅读" :data-tip-key="tipKey('split')" aria-label="并排阅读" :aria-expanded="!!splitPicker"><AppIcon name="split" :size="18" /><span v-if="splitView" class="split-count">{{ paneIds.length }}</span></button><button class="ai-toggle" data-tip="阅读助手" :data-tip-key="tipKey('ai')" :class="{ active: aiOpen }" @click="aiOpen ? aiOpen = false : openAssistant(true)" :aria-expanded="aiOpen"><AppIcon name="sparkle" :size="17" />阅读助手</button></template>
          <button v-else class="icon-button" @click="toggleTheme" :data-tip="theme === 'dark' ? '切换浅色主题' : '切换深色主题'" :aria-label="theme === 'dark' ? '切换浅色主题' : '切换深色主题'"><AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" /></button>
          <button class="icon-button" @click="toggleFullscreen" :disabled="fullscreenPending" :aria-label="fullscreen ? '退出全屏' : '进入全屏'" :aria-pressed="fullscreen" :data-tip="fullscreen ? '退出全屏' : '进入全屏'" :data-tip-key="tipKey('fullscreen')"><AppIcon :name="fullscreen ? 'exit-fullscreen' : 'fullscreen'" :size="18" /></button>
          <button class="icon-button" @click="openSettings()" data-tip="设置" :data-tip-key="tipKey('settings')" aria-label="打开设置"><AppIcon name="settings" :size="18" /></button>
        </div>
      </header>

      <Transition name="view" mode="out-in">
      <div v-if="!active" class="library-view" key="library">
        <header class="library-header">
          <div class="library-heading"><h1>{{ currentTitle }}<span class="heading-count">{{ visibleDocuments.length }}</span></h1></div>
          <div class="library-tools">
            <div class="library-search"><AppIcon name="search" :size="17" /><input ref="search" v-model="query" @input="searchDocuments" placeholder="搜索标题、标签或已索引内容" aria-label="搜索文档" /><button v-if="query" @click="query = ''; refresh()" data-tip="清空搜索" aria-label="清空搜索"><AppIcon name="close" :size="14" /></button><kbd v-else-if="preferences.shortcuts.search">{{ shortcut('search') }}</kbd></div>
            <div v-liquid-selection class="view-switch"><button :class="{ selected: display === 'grid' }" @click="setDisplay('grid')" data-tip="卡片视图" aria-label="卡片视图"><AppIcon name="grid" :size="16" /></button><button :class="{ selected: display === 'list' }" @click="setDisplay('list')" data-tip="列表视图" aria-label="列表视图"><AppIcon name="list" :size="17" /></button></div>
          </div>
        </header>
        <div class="library-summary"><div><AppIcon name="book" :size="15" /><strong>{{ documents.length }}</strong><span>份文档</span></div><span class="summary-divider"></span><div><AppIcon name="star" :size="15" /><strong>{{ starredCount }}</strong><span>份收藏</span></div><span class="summary-divider"></span><div><AppIcon name="file" :size="15" /><strong>{{ totalPages }}</strong><span>页已打开文档</span></div><span v-if="!isDesktop" class="summary-note">浏览器预览</span></div>
        <div v-if="query || category === 'recent'" class="library-list-heading"><span>{{ query ? `搜索「${query}」` : '按最近阅读排列' }}</span></div>
        <div v-if="loading" class="library-empty"><span class="spinner"></span><p>正在读取文档库…</p></div>
        <div v-else-if="!visibleDocuments.length" class="library-empty"><div class="empty-art"><AppIcon name="book" :size="42" /></div><h2>{{ query ? '没有匹配的文档' : category === 'starred' ? '暂无收藏' : tagFilter ? '此标签下暂无文档' : '暂无文档' }}</h2><p>{{ query ? '可搜索标题、标签和已读取的文档内容。' : '点击“加入文档”添加 PDF 或 Markdown，可一次选择多个文件。' }}</p><button v-if="query" @click="query = ''; refresh()">查看全部文档</button><small>导入不会移动或修改原文件</small></div>
        <div v-else class="document-collection" :class="display">
          <article v-for="doc in visibleDocuments" :key="doc.id" class="document-card" :class="doc.kind" tabindex="0" role="button" :aria-label="`打开 ${doc.name}`" @click="openDocument(doc)" @keydown.enter="openDocument(doc)">
            <div class="document-cover"><div class="cover-lines"><i></i><i></i><i></i><i></i></div><div class="document-type-icon"><AppIcon :name="doc.kind === 'pdf' ? 'file' : 'markdown'" :size="display === 'list' ? 23 : 30" /></div><button class="card-star" :class="{ 'is-starred': doc.starred }" @click.stop="toggleStar(doc)" :data-tip="doc.starred ? '取消收藏' : '收藏文档'" :aria-label="doc.starred ? '取消收藏' : '收藏文档'"><AppIcon name="star" :size="17" /></button></div>
            <div class="document-card-body"><div class="document-card-title"><h3 :data-tip="doc.name">{{ doc.name.replace(/\.(pdf|md|markdown)$/i, '') }}</h3><span class="format-pill">{{ doc.kind === 'pdf' ? 'PDF' : 'MD' }}</span></div><p class="document-meta">{{ size(doc.size) }}<span>·</span>{{ doc.lastOpenedAt ? `阅读于 ${date(doc.lastOpenedAt)}` : `加入于 ${date(doc.addedAt)}` }}</p><div class="document-tags"><span v-for="tag in doc.tags.slice(0, 3)" :key="tag">{{ tag }}</span><span v-if="doc.tags.length > 3">+{{ doc.tags.length - 3 }}</span></div><div class="document-progress"><div><i :style="{ width: `${progressPercent(doc)}%` }"></i></div><span>{{ doc.progress ? `${progressPercent(doc)}%` : '未读' }}</span></div></div>
            <button class="card-remove icon-button" @click.stop="removeTarget = doc" data-tip="从文档库移除" aria-label="从文档库移除"><AppIcon name="trash" :size="15" /></button>
          </article>
        </div>
      </div>

      <div v-else class="reading-workspace">
        <section class="reading-main">
          <div v-if="opening && !splitView" class="reader-overlay"><span class="spinner"></span><p>正在打开 {{ active.name }}…</p></div>
          <div class="reader-panes" :class="{ split: splitView }" :style="{ '--panes': paneIds.length }">
            <section v-for="entry in readerCache" v-show="paneVisible(entry.id)" :key="entry.id" class="reader-pane" :class="{ focused: splitView && active.id === entry.id, entering: enteringPane === entry.id }" :style="{ order: paneIds.indexOf(entry.id) }" :data-pane-id="entry.id" :aria-label="splitView ? `并排阅读：${entry.doc.name}` : undefined" @pointerdown.capture="pointerFocusPane($event, entry.id)" @focusin="focusPane(entry.id)">
              <KeepAlive>
                <component v-if="paneVisible(entry.id)" :is="entry.doc.kind === 'pdf' ? PdfReader : MarkdownReader" :ref="value => bindReader(entry.id, value)" :key="entry.id" :data="entry.bytes" :document-id="entry.id" :initial-page="entry.doc.page || 1" :initial-progress="entry.doc.progress || 0" :sidebar-fit-enabled="preferences.pdf.fitOnPanelOverflow" :initial-zoom="preferences.pdf.initialZoom === 'fit-width' ? 'fit' : preferences.pdf.initialZoom / 100" :zoom-step="preferences.pdf.zoomStep / 100" :fit-request="fitRequest" :font-size="preferences.markdown.fontSize" :content-width="preferences.markdown.contentWidth" :find-shortcut="preferences.shortcuts.find ? shortcut('find') : ''" :shortcuts="tipKeys" :initial-view="entry.view" v-on="entry.events" />
              </KeepAlive>
              <div v-if="tabDoc(entry.id)" class="reading-pill" :class="{ awake: pillAwake[entry.id] || splitView, saved: pillSaved[entry.id] }" role="status" :aria-label="`阅读位置自动保存 · ${tabDoc(entry.id)!.kind === 'pdf' ? `第 ${tabDoc(entry.id)!.page || 1} / ${tabDoc(entry.id)!.pageCount || '—'} 页 · ` : ''}已读 ${progressPercent(tabDoc(entry.id)!)}%`">
                <svg class="pill-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="pill-ring-track" cx="12" cy="12" r="9" /><circle class="pill-ring-value" cx="12" cy="12" r="9" pathLength="100" :style="{ strokeDashoffset: 100 - progressPercent(tabDoc(entry.id)!) }" /></svg>
                <span class="pill-text" aria-hidden="true"><span v-if="splitView" class="pill-name">{{ entry.doc.name.replace(/\.(pdf|md|markdown)$/i, '') }}</span><span v-if="tabDoc(entry.id)!.kind === 'pdf'" class="pill-page"><b :key="tabDoc(entry.id)!.page || 1">{{ tabDoc(entry.id)!.page || 1 }}</b><i>/</i>{{ tabDoc(entry.id)!.pageCount || '—' }}</span><span v-else class="pill-page"><b :key="progressPercent(tabDoc(entry.id)!)">{{ progressPercent(tabDoc(entry.id)!) }}</b><i>%</i></span><span class="pill-saved"><AppIcon name="check" :size="11" />已保存</span></span>
                <button v-if="splitView" class="pill-close" :data-tip="`关闭这一栏`" :aria-label="`关闭并排的 ${entry.doc.name}`" @click.stop="closePane(entry.id)"><AppIcon name="close" :size="11" /></button>
              </div>
            </section>
            <section v-if="splitView && opening && !readerCache.some(entry => entry.id === active?.id)" class="reader-pane pending" :style="{ order: paneIds.indexOf(active.id) }"><div class="reader-overlay"><span class="spinner"></span><p>正在打开 {{ active.name }}…</p></div></section>
          </div>
          <div v-if="selection && !captureQuick && !aiOpen && selection.image" class="selection-context"><AppIcon name="crop" :size="16" /><span>{{ selection.image ? `已框选第 ${selection.page} 页的图表或公式` : `已选择 ${selection.text.length} 个字符` }}</span><button @click="openAssistant(true)"><AppIcon name="sparkle" :size="15" />向 AI 提问</button><button class="icon-button" @click="clearSelection" data-tip="清除选区" aria-label="清除选区"><AppIcon name="close" :size="14" /></button></div>
        </section>
        <Transition name="pane" @before-enter="paneResizeStart($event, true)" @before-leave="paneResizeStart($event, false)" @after-enter="paneResizeEnd" @after-leave="paneResizeEnd" @enter-cancelled="paneResizeEnd($event, true)" @leave-cancelled="paneResizeEnd($event, true)">
          <AiPane v-if="aiOpen && aiDocument" ref="assistant" class="pane-shell" data-glass-interactive="panel" :document="aiDocument" :context="aiContext" :send-shortcut="preferences.shortcuts.aiSend ? shortcut('aiSend') : ''" :consume-capture="consumeSelection" @settings="openSettings('ai')" @close="aiOpen = false" @jump="jump" @clear-selection="clearSelection" />
        </Transition>
        <Transition name="pane" @before-enter="paneResizeStart($event, true)" @before-leave="paneResizeStart($event, false)" @after-enter="paneResizeEnd" @after-leave="paneResizeEnd" @enter-cancelled="paneResizeEnd($event, true)" @leave-cancelled="paneResizeEnd($event, true)">
          <aside v-if="detailsOpen" class="document-details pane-shell"><div class="details-heading"><h3>文档详情</h3><button class="icon-button" @click="detailsOpen = false" data-tip="关闭文档详情" aria-label="关闭文档详情"><AppIcon name="close" :size="17" /></button></div><div class="detail-icon"><AppIcon :name="active.kind === 'pdf' ? 'file' : 'markdown'" :size="30" /></div><h4>{{ active.name }}</h4><dl><dt>格式</dt><dd>{{ active.kind === 'pdf' ? 'PDF' : 'Markdown' }}</dd><dt>文件大小</dt><dd>{{ size(active.size) }}</dd><dt>加入时间</dt><dd>{{ date(active.addedAt) }}</dd><dt>文件位置</dt><dd class="detail-path">{{ active.path }}</dd></dl><p class="eyebrow">标签</p><div class="editable-tags"><span v-for="tag in active.tags" :key="tag">{{ tag }}<button @click="removeTag(tag)" :data-tip="`移除标签 ${tag}`" :aria-label="`移除标签 ${tag}`"><AppIcon name="close" :size="12" /></button></span></div><form class="add-tag" @submit.prevent="addTag"><input v-model="tagInput" placeholder="添加标签" maxlength="40" /><button :disabled="!tagInput.trim()" data-tip="添加标签" aria-label="添加标签"><AppIcon name="plus" :size="16" /></button></form><button class="remove-document" @click="removeTarget = active"><AppIcon name="trash" :size="16" />从文档库移除</button></aside>
        </Transition>
      </div>
      </Transition>
    </main>

    <SplitPicker v-if="splitPicker && active" :anchor="splitPicker" :candidates="splitCandidates" :full="paneIds.length >= MAX_PANES" :limit="MAX_PANES" @pick="openBeside" @close="splitPicker = undefined" />
    <Transition name="capture-focus"><CaptureQuickPrompt v-if="captureQuick && !settingsOpen" :frame="captureQuick.frame" :prompts="preferences.assistant.captureQuestions" :busy="captureQuickBusy" :status="captureQuickStatus" @ask="askCaptureQuick" @continue="continueCaptureQuick" @cancel="dismissCaptureQuick(true)" /></Transition>
    <div v-if="draggingFiles" class="file-drop-overlay" aria-live="polite"><div class="file-drop-target"><AppIcon name="plus" :size="32" /><strong>加入文档库</strong><span>松开以加入 PDF / Markdown 文档</span></div></div>
    <button v-if="selectionAction && selection?.text && !aiOpen && active" class="selection-ask" :style="{ left: selectionAction.left + 'px', top: selectionAction.top + 'px' }" @mousedown.prevent @click="openAssistant(true)" aria-label="用所选文字向 AI 提问"><AppIcon name="sparkle" :size="14" />问 AI</button>
    <Transition name="toast"><div v-if="toast" class="toast-message" role="status"><span>{{ toast }}</span><button @click="toast = ''" data-tip="关闭提示" aria-label="关闭提示"><AppIcon name="close" :size="15" /></button></div></Transition>
    <Transition name="dialog">
      <div v-if="removeTarget" class="dialog-backdrop" @click.self="removeTarget = null"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-title"><div class="dialog-icon"><AppIcon name="trash" :size="24" /></div><h2 id="remove-title">从文档库移除？</h2><p>「{{ removeTarget.name }}」的阅读记录与标签会被移除，原文件仍保留在电脑上。</p><div class="dialog-actions"><button @click="removeTarget = null">取消</button><button class="danger-button" @click="removeDocument">移除文档</button></div></section></div>
    </Transition>
    <Transition name="settings-pop">
      <SettingsDialog v-if="settingsOpen" :initial-tab="settingsTab" @close="settingsOpen = false" @ai-saved="aiSettingsSaved" />
    </Transition>
  </div>
</template>
