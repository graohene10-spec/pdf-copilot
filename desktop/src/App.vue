<script setup lang="ts">
import { ref, shallowRef, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent, toRaw, triggerRef } from 'vue'
import { library, isDesktop, importDroppedDocuments } from './sdk'
import type { Doc } from './sdk/types'
import AppIcon from './components/AppIcon.vue'
import FileTabs from './components/FileTabs.vue'
import CaptureQuickPrompt from './components/CaptureQuickPrompt.vue'
import { chatPhase, chatState, sendChat, closeChat, closeAllChats, configureRequests, stopChat, notices, dismissNotice, selectConversation, type Notice } from './ai/workspace'
import { forgetPassword, forgetAllPasswords } from './document/passwords.mjs'
import { useSettings, matchShortcut, matchWheelShortcut, shortcutFromEvent, shortcutLabel, UI_FONTS, READING_FONTS, SKETCH_ANSWER_FONTS, fontChoices } from './settings'
import { retainReaderEntries } from './reader/cache-policy.mjs'
import { installGlassContrast } from './ui/glass-contrast'
import { restoreLeavingPanel } from './ui/panel-transition'
import BookmarkRail from './components/BookmarkRail.vue'
import ClaudeBurst from './components/ClaudeBurst.vue'
import { nudgeGlassMotion } from './ui/glass-motion'
import { bookmarks, loadBookmarks, addBookmark, removeBookmark, clearBookmarks, renameBookmark, neighbour, type BookmarkPosition } from './library/bookmarks'
import { useFullscreen } from './ui/fullscreen'
import { vLiquidSelection } from './ui/liquid-selection'
import { useReorder } from './ui/reorder'
import { startAutoCheck, stopAutoCheck } from './ui/updater'
import { registerCustomFonts } from './ui/custom-fonts'
import { covers, loadCovers, setCover, imageCover, pageCover, type Cover } from './library/covers'
const PdfReader = defineAsyncComponent(() => import('./components/PdfReader.vue'))
const MarkdownReader = defineAsyncComponent(() => import('./components/MarkdownReader.vue'))
const AiPane = defineAsyncComponent(() => import('./components/AiPane.vue'))
const SettingsDialog = defineAsyncComponent(() => import('./components/SettingsDialog.vue'))
const SplitPicker = defineAsyncComponent(() => import('./components/SplitPicker.vue'))
const UpdateCard = defineAsyncComponent(() => import('./components/UpdateCard.vue'))
const ContextMenu = defineAsyncComponent(() => import('./components/ContextMenu.vue'))
const { preferences, effectiveAppearance, load: loadPreferences, save: savePreferences } = useSettings()

const documents = ref<Doc[]>([])
type CaptureFrame = { left: number; top: number; width: number; height: number }
type DocumentSelection = { text: string; page: number; image?: string; imagePending?: Promise<string>; rect?: any; captureFrame?: CaptureFrame }
type OpenTab = { doc: Doc; view?: any; selection?: DocumentSelection }
const tabs = ref<OpenTab[]>([])
const active = ref<Doc | null>(null)
const currentTab = computed(() => tabs.value.find(tab => tab.doc.id === active.value?.id))
const fileTabs = computed(() => tabs.value.map(tab => ({ id: tab.doc.id, name: isCopy(tab.doc.id) ? `${tab.doc.name}（${tab.doc.id.split('~')[1]}）` : tab.doc.name, kind: tab.doc.kind, phase: chatPhase(sourceId(tab.doc.id)) })))
/* 工作区布局
   - group：一组并排阅读的文档（至少两份，按显示顺序）。去文档库再回来，这一组仍在；
     点组内任一标签就整组显示，点组外标签单独显示那一份。
   - aiPanels：阅读助手窗口，可以开多个。doc 为空的跟随焦点文档，否则固定在某份文档上。
   - order：工作区里所有窗口（文档栏与助手）的左右顺序，用户拖动调整。 */
const MAX_PANES = 3
const MAX_AI_PANELS = 3
type AiPanel = { key: string; doc: string | null; conversation?: string; width: number }
const group = ref<string[]>([])
const aiPanels = ref<AiPanel[]>([])
const order = ref<string[]>([])
function inGroup(id?: string | null) { return !!id && group.value.length > 1 && group.value.includes(id) }
const paneIds = computed(() => !active.value ? [] : inGroup(active.value.id) ? group.value : [active.value.id])
const splitView = computed(() => paneIds.value.length > 1)
function paneVisible(id: string) { return paneIds.value.includes(id) }
function visibleReaders() { return paneIds.value.map(id => readerInstances.get(id)).filter(Boolean) }
function pdfOnScreen() { return paneIds.value.some(id => tabs.value.find(tab => tab.doc.id === id)?.doc.kind === 'pdf') }
const visibleAi = computed(() => !active.value ? [] : aiPanels.value.filter(panel => !panel.doc || paneVisible(panel.doc)))
// 去文档库时阅读工作区只是藏起来：文档栏与阅读助手原样留着，回来时不必重新加载。
const lastActive = ref<Doc | null>(null)
watch(active, value => { if (value) lastActive.value = value })
watch(() => tabs.value.map(tab => tab.doc.id).join(), () => { if (lastActive.value && !tabs.value.some(tab => tab.doc.id === lastActive.value!.id)) lastActive.value = tabs.value.at(-1)?.doc || null })
const stageDoc = computed(() => active.value || lastActive.value)
const stagePaneIds = computed(() => !stageDoc.value ? [] : inGroup(stageDoc.value.id) ? group.value : [stageDoc.value.id])
const stageAi = computed(() => active.value ? visibleAi.value : aiPanels.value.filter(panel => !panel.doc || stagePaneIds.value.includes(panel.doc)))
const aiOpen = computed(() => visibleAi.value.length > 0)
// 跟随标签的助手窗口：并排时在两栏之间点击不会让它来回切换；切到别的标签或组时才跟过去。
const followDoc = ref<string | null>(null)
watch(() => [stageDoc.value?.id, stagePaneIds.value.join()] as const, ([id]) => {
  if (!id) return
  if (followDoc.value && stagePaneIds.value.length > 1 && stagePaneIds.value.includes(followDoc.value)) return
  followDoc.value = id
}, { immediate: true })
function followedId(panel: AiPanel) { return panel.doc || (followDoc.value && tabDoc(followDoc.value) ? followDoc.value : stageDoc.value?.id) || '' }
// 同一本书多开的几份共用一套对话。
function aiDocument(panel: AiPanel) { const doc = tabDoc(followedId(panel)); return doc ? { id: sourceId(doc.id), title: doc.name, kind: doc.kind } : null }
/** The other documents on screen, offered in the assistant's header to switch which one it reads. */
function aiAlternatives(panel: AiPanel) { const id = followedId(panel); return panel.doc ? [] : stagePaneIds.value.filter(item => sourceId(item) !== sourceId(id)).map(item => tabDoc(item)).filter(Boolean).map(doc => ({ id: doc!.id, title: doc!.name })) }
function switchAiDocument(panel: AiPanel, id: string) { if (!panel.doc) followDoc.value = id }
const libraryIndex = computed(() => documents.value.map(doc => ({ id: doc.id, title: doc.name })))
async function openConversationAt(target: { documentId: string; conversationId: string }) {
  const shown = stagePaneIds.value.find(id => sourceId(id) === target.documentId)
  const doc = (shown && tabDoc(shown)) || tabs.value.find(tab => tab.doc.id === target.documentId)?.doc || documents.value.find(item => item.id === target.documentId)
  if (!doc) return
  selectConversation(target.documentId, target.conversationId)
  if (active.value?.id !== doc.id && !stagePaneIds.value.includes(doc.id)) await openDocument(doc)
  followDoc.value = doc.id
  const panel = aiPanels.value.find(item => item.doc === doc.id) || aiPanels.value.find(item => !item.doc)
  if (panel) { if (!panel.doc) panel.conversation = undefined } else openAssistant(true)
}
function aiContext(panel: AiPanel) {
  const id = followedId(panel)
  const tab = tabs.value.find(tab => tab.doc.id === id)
  return { page: tab?.doc.page || 1, selection: id === active.value?.id ? selection.value : tab?.selection }
}
/** Display order of the visible windows; new ones join on the right. */
const panels = computed(() => {
  const keys = [...paneIds.value.map(id => `doc:${id}`), ...visibleAi.value.map(panel => panel.key)]
  const ordered = order.value.filter(key => keys.includes(key))
  for (const key of keys) if (!ordered.includes(key)) ordered.push(key)
  return ordered
})
const multiPanel = computed(() => panels.value.length > 1)
function panelOrder(key: string) { return Math.max(0, panels.value.indexOf(key)) }
const splitPicker = ref<{ left: number; top: number; right: number; bottom: number }>()
const enteringPane = ref<string>()
let enteringTimer: ReturnType<typeof setTimeout> | undefined
const splitCandidates = computed(() => {
  const shown = new Set(paneIds.value)
  const open = tabs.value.filter(tab => !shown.has(tab.doc.id)).map(tab => ({ id: tab.doc.id, name: tab.doc.name, kind: tab.doc.kind, open: true }))
  const library = [...documents.value].filter(doc => !shown.has(doc.id) && !tabs.value.some(tab => tab.doc.id === doc.id)).sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt)).map(doc => ({ id: doc.id, name: doc.name, kind: doc.kind, open: false }))
  return [...open, ...library]
})
// Tabs of the group sit next to each other in display order, so the strip can frame them.
watch(group, value => {
  if (value.length < 2) return
  const members = value.map(id => tabs.value.find(tab => tab.doc.id === id)).filter(Boolean) as OpenTab[]
  const first = tabs.value.findIndex(tab => value.includes(tab.doc.id))
  const rest = tabs.value.filter(tab => !value.includes(tab.doc.id))
  const next = [...rest.slice(0, first), ...members, ...rest.slice(first)]
  if (next.some((tab, index) => tab !== tabs.value[index])) tabs.value = next
}, { flush: 'sync' })
/* 阅读位置胶囊：翻页或保存后展开约两秒，随后收成一颗进度环。 */
const pillAwake = reactive<Record<string, boolean>>({})
const pillTimers = new Map<string, ReturnType<typeof setTimeout>>()
function wakePill(id: string) {
  pillAwake[id] = true
  clearTimeout(pillTimers.get(id))
  pillTimers.set(id, setTimeout(() => { pillAwake[id] = false; pillTimers.delete(id) }, 2200))
}
function tabDoc(id: string) { return tabs.value.find(tab => tab.doc.id === id)?.doc }
// 同一本书再开一份时，标签用 `原编号~序号`：文件、对话、标记都按原编号共用，阅读位置各自独立、不写回文档库。
function sourceId(id: string): string; function sourceId(id: string | undefined): string | undefined
function sourceId(id: string | undefined) { return id?.split('~')[0] }
function isCopy(id: string) { return id.includes('~') }
function openCopy(id: string) {
  contextMenu.value = undefined
  const doc = tabDoc(id)
  if (!doc) return
  const source = sourceId(id)
  let number = 2
  while (tabDoc(`${source}~${number}`)) number++
  const copy = { ...doc, id: `${source}~${number}` }
  const index = tabs.value.findIndex(tab => tab.doc.id === id)
  const tab = tabs.value[index]!
  tabs.value.splice(index + 1, 0, { doc: copy, view: readerInstances.get(id)?.getViewState?.() || tab.view })
  if (active.value?.id !== id) { void openDocument(doc).then(() => openBeside(copy.id, 'right')); return }
  void openBeside(copy.id, 'right')
}
type ReaderEntry = { id: string; doc: Doc; size: number; bytes: Uint8Array; view?: any; events: Record<string, (...args: any[]) => void> }
const readerCache = shallowRef<ReaderEntry[]>([])
const readerInstances = new Map<string, any>()
const pendingReads = new Map<string, Promise<Uint8Array>>()
const selectionAction = ref<{ left: number; top: number }>()
const selection = shallowRef<DocumentSelection>()
type CaptureQuick = { documentId: string; selection: DocumentSelection; frame: CaptureFrame; pending: boolean; status: string; ownedRequest?: ReturnType<typeof chatState>['request'] }
const captureQuick = shallowRef<CaptureQuick>()
let captureQuickFrame = 0
let captureQuickMissing = 0
let captureQuickResize: ResizeObserver | undefined
let captureQuickMutation: MutationObserver | undefined
const captureQuickBusy = computed(() => Boolean(captureQuick.value && (captureQuick.value.pending || chatState(sourceId(captureQuick.value.documentId)).request)))
const captureQuickStatus = computed(() => captureQuick.value?.status || (captureQuick.value && chatState(sourceId(captureQuick.value.documentId)).request ? '这份文档已有问题正在处理，可点继续查看。' : ''))
const reader = ref<any>()
const settingsOpen = ref(false)
const settingsTab = ref<'appearance' | 'reading' | 'shortcuts' | 'ai' | 'updates'>('appearance')
const fitRequest = ref(0)
const query = ref('')
const category = ref('all')
const tagFilter = ref('')
const display = ref<'grid' | 'list'>('grid')
const loading = ref(true)
const importing = ref(false)
const draggingFiles = ref(false)
const opening = ref(false)
const sidebarOpen = ref(true)
// 全屏时把顶栏和侧栏一起收成屏幕左上角的小标签，阅读区占满整屏；点标签或按 Ctrl+B 再一起展开。
const chromeCollapsed = ref(false)
function collapseChrome() { chromeCollapsed.value = true; sidebarOpen.value = false }
function expandChrome() { chromeCollapsed.value = false; sidebarOpen.value = true }
function toggleSidebar() { if (chromeCollapsed.value) expandChrome(); else sidebarOpen.value = !sidebarOpen.value }
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
// 文档库排列：默认按最近阅读；用户拖动过后按自己排好的位置固定，新加入的文档排在最前。
const LIBRARY_ORDER_KEY = 'library.order.v1'
const libraryOrder = ref<string[]>([])
const byRecent = (a: Doc, b: Doc) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt)
// 排序方式：默认是最近阅读或自己拖好的顺序；也可以按加入时间、大小、名称、类别、阅读时间排，再点一次切换升降序。
type SortKey = 'default' | 'added' | 'size' | 'name' | 'kind' | 'read'
const SORTS: { key: SortKey; label: string }[] = [{ key: 'default', label: '默认排列' }, { key: 'added', label: '加入时间' }, { key: 'read', label: '阅读时间' }, { key: 'name', label: '文件名称' }, { key: 'size', label: '文件大小' }, { key: 'kind', label: '文件类别' }]
const readSort = () => { try { const value = JSON.parse(localStorage.getItem('kaizhi.librarySort.v1') || '{}'); return { key: SORTS.some(item => item.key === value.key) ? value.key as SortKey : 'default', descending: value.descending !== false } } catch { return { key: 'default' as SortKey, descending: true } } }
const librarySort = ref(readSort())
watch(librarySort, value => { try { localStorage.setItem('kaizhi.librarySort.v1', JSON.stringify(value)) } catch { /* 无法保存时只在本次生效 */ } }, { deep: true })
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
function sortValue(a: Doc, b: Doc, key: SortKey) {
  switch (key) {
    case 'added': return a.addedAt - b.addedAt
    case 'read': return (a.lastOpenedAt || 0) - (b.lastOpenedAt || 0)
    case 'size': return a.size - b.size
    case 'name': return collator.compare(a.name, b.name)
    case 'kind': return collator.compare(a.kind, b.kind) || collator.compare(a.name.split('.').pop() || '', b.name.split('.').pop() || '') || collator.compare(a.name, b.name)
    default: return 0
  }
}
// 排序菜单用应用自己的液态玻璃菜单，不用系统下拉框；当前那一项标出方向。
function openSortMenu(event: MouseEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const arrow = librarySort.value.descending ? '↓' : '↑'
  contextMenu.value = { x: box.left, y: box.bottom + 6, items: SORTS.map(item => ({ label: item.label, icon: item.key === librarySort.value.key ? 'check' : undefined, hint: item.key === librarySort.value.key && item.key !== 'default' ? arrow : undefined, action: () => chooseSort(item.key) })) }
}
function chooseSort(key: SortKey) {
  // Picking the active key again flips the direction; names and kinds start A→Z, the rest newest / largest first.
  if (librarySort.value.key === key && key !== 'default') librarySort.value = { key, descending: !librarySort.value.descending }
  else librarySort.value = { key, descending: !['name', 'kind'].includes(key) }
}
function arranged(list: Doc[]) {
  const { key, descending } = librarySort.value
  if (key !== 'default') return list.sort((a, b) => (descending ? -1 : 1) * sortValue(a, b, key) || byRecent(a, b))
  if (!libraryOrder.value.length || category.value === 'recent') return list.sort(byRecent)
  const rank = new Map(libraryOrder.value.map((id, index) => [id, index]))
  return list.sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1) || byRecent(a, b))
}
const visibleDocuments = computed(() => {
  let list = [...documents.value]
  if (category.value === 'starred') list = list.filter(doc => doc.starred)
  if (category.value === 'recent') list = list.filter(doc => doc.lastOpenedAt)
  if (tagFilter.value) list = list.filter(doc => doc.tags.includes(tagFilter.value))
  return arranged(list)
})
const canArrange = computed(() => !query.value && category.value !== 'recent' && librarySort.value.key === 'default' && visibleDocuments.value.length > 1)
const collection = ref<HTMLElement>()
function arrangeLibrary(visible: string[]) {
  // 只在筛选结果内调整顺序：被筛掉的文档保持原来的位置。
  const shown = new Set(visible)
  let index = 0
  libraryOrder.value = arranged([...documents.value]).map(doc => shown.has(doc.id) ? visible[index++] : doc.id)
}
function saveLibraryOrder() { void library.setSetting(LIBRARY_ORDER_KEY, JSON.stringify(libraryOrder.value)).catch(error => notify(reason(error))) }
async function loadLibraryOrder() {
  try { const parsed = JSON.parse(await library.getSetting(LIBRARY_ORDER_KEY) || '[]'); if (Array.isArray(parsed)) libraryOrder.value = parsed.filter(id => typeof id === 'string') } catch { /* 没有保存过顺序 */ }
}
function resetLibraryOrder() { libraryOrder.value = []; void library.setSetting(LIBRARY_ORDER_KEY, '[]').catch(() => {}) }
const reorderLibrary = useReorder({
  container: () => collection.value,
  ids: () => visibleDocuments.value.map(doc => doc.id),
  apply: arrangeLibrary,
  commit: saveLibraryOrder,
  enabled: () => canArrange.value,
})
const currentTitle = computed(() => tagFilter.value || (category.value === 'starred' ? '我的收藏' : category.value === 'recent' ? '最近阅读' : '文档库'))
const totalPages = computed(() => documents.value.filter(doc => doc.kind === 'pdf' && doc.lastOpenedAt).reduce((sum, doc) => sum + (doc.pageCount || 0), 0))

function notify(message: string) { toast.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 4800) }
const { fullscreen, fullscreenPending, toggleFullscreen, exitFullscreen } = useFullscreen(isDesktop, notify)
watch(fullscreen, value => { if (!value && chromeCollapsed.value) expandChrome() })
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
    else if (isCopy(tab.doc.id) && sourceId(tab.doc.id) === doc.id) tab.doc = { ...doc, id: tab.doc.id, page: tab.doc.page, pageCount: tab.doc.pageCount, progress: tab.doc.progress }
  if (active.value && sourceId(active.value.id) === doc.id) active.value = tabDoc(active.value.id) || active.value
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
  if (isCopy(id)) return Promise.resolve()
  const write = (progressWrites.get(id) || Promise.resolve()).then(async () => {
    try { updateLocal(await library.update(id, patch)); if ('page' in patch && paneVisible(id)) wakePill(id) }
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
    promise = library.read(sourceId(id)); pendingReads.set(id, promise)
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
/**
 * 从文档库打开文档用视图过渡：只在合成层对两张快照做淡入淡出，
 * 不必每一帧重算整片玻璃的背景模糊，也不受 PDF 首次解析占用主线程的影响。
 */
function switchView<T>(change: () => T): Promise<Awaited<T>> | T {
  const start = (document as any).startViewTransition?.bind(document)
  const root = document.documentElement
  if (!start || root.dataset.themeTransition || root.dataset.viewSwitch || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return change()
  root.dataset.viewSwitch = 'open'
  let result: T
  // 回调要等下一帧才执行；期间若已打开了别的文档，这次切换作废，免得把旧请求盖到新文档上。
  const epoch = openEpoch
  const transition = start(async () => { if (epoch === openEpoch) result = change(); await nextTick() })
  void transition.finished.catch(() => {}).finally(() => { delete root.dataset.viewSwitch })
  return transition.updateCallbackDone.catch(() => {}).then(() => result) as Promise<Awaited<T>>
}
async function openDocument(doc: Doc, reload = false) {
  if (active.value?.id === doc.id && !reload) return
  if (!active.value && !reload && document.querySelector('.library-view:not(.view-leave-active)')) return switchView(() => showDocument(doc))
  // 同一组里已经在屏幕上的文档：只移交焦点。
  if (!reload && inGroup(active.value?.id) && inGroup(doc.id) && readerCache.value.some(entry => entry.id === doc.id)) { focusPane(doc.id); return }
  return showDocument(doc, reload)
}
/** Suspend readers that are about to leave the screen while their DOM can still report a scroll position. */
function suspendLeaving(next: string[]) {
  for (const id of paneIds.value) {
    if (id === active.value?.id || next.includes(id)) continue
    const tab = tabs.value.find(tab => tab.doc.id === id), instance = readerInstances.get(id)
    if (tab) tab.view = instance?.getViewState?.() || tab.view
    instance?.suspend?.()
  }
}
async function showDocument(doc: Doc, reload = false) {
  const previous = active.value?.id
  const nextVisible = inGroup(doc.id) ? group.value : [doc.id]
  suspendLeaving(nextVisible)
  // 上一份文档仍留在屏幕上（同组）时只交出焦点，否则先挂起，趁它还在页面上记下阅读位置。
  if (previous && previous !== doc.id && nextVisible.includes(previous)) leaveFocus()
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
    void loadGroupReaders(epoch)
    // Reading must not wait for a database write or an older position save.
    void writeReadingUpdate(doc.id, { lastOpenedAt: Date.now() }, '阅读记录更新失败')
  } catch (error) { if (epoch === openEpoch) { notify(`无法打开文档：${reason(error)}`); closeTab(doc.id) } }
}
/** Bring the other visible documents of the group back on screen (after the library, a restart of the view…). */
async function loadGroupReaders(epoch: number) {
  for (const id of paneIds.value) {
    if (readerCache.value.some(entry => entry.id === id)) continue
    const tab = tabs.value.find(tab => tab.doc.id === id)
    if (!tab) continue
    try {
      const bytes = await readDocument(id)
      if (epoch !== openEpoch || !paneVisible(id) || readerCache.value.some(entry => entry.id === id) || !active.value) return
      retainReaders([...readerCache.value, cacheReader(tab.doc, bytes, tab.view)], active.value.id)
    } catch (error) { notify(`无法打开 ${tab.doc.name}：${reason(error)}`); removeFromGroup(id) }
  }
}
function closeReader() {
  suspendLeaving([]); pauseReader(); ++openEpoch; void flushProgress(); splitPicker.value = undefined; active.value = null; opening.value = false; selection.value = undefined; detailsOpen.value = false
  // 没有打开的文件时才真正清空工作区；否则读者与助手留在原处，回来即用。
  if (!tabs.value.length) clearWorkspace()
  void refresh()
}
function clearWorkspace() { lastActive.value = null; readerCache.value = []; readerInstances.clear() }
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
/** Put a document beside another one in the group (right of the anchor by default). */
async function openBeside(id: string, side: 'left' | 'right' = 'right', anchor?: string) {
  splitPicker.value = undefined; contextMenu.value = undefined
  const doc = tabDoc(id) || documents.value.find(item => item.id === id)
  if (!doc || !active.value) return
  if (inGroup(active.value.id) && inGroup(id)) { focusPane(id); return }
  const base = inGroup(active.value.id) ? [...group.value] : [active.value.id]
  if (base.includes(id)) return
  if (base.length >= MAX_PANES) { notify(`一组最多并排 ${MAX_PANES} 份文档。`); return }
  const pivot = anchor && base.includes(anchor) ? anchor : active.value.id
  const at = base.indexOf(pivot) + (side === 'right' ? 1 : 0)
  base.splice(at, 0, id)
  if (!tabs.value.some(tab => tab.doc.id === doc.id)) tabs.value.push({ doc })
  // The new window takes its place beside its anchor in the visible order too.
  const keys = panels.value.filter(key => key !== `doc:${id}`)
  const anchorIndex = keys.indexOf(`doc:${pivot}`)
  keys.splice(anchorIndex < 0 ? keys.length : anchorIndex + (side === 'right' ? 1 : 0), 0, `doc:${id}`)
  order.value = keys
  group.value = base
  enteringPane.value = id; clearTimeout(enteringTimer); enteringTimer = setTimeout(() => { enteringPane.value = undefined }, 600)
  // 新栏出现时其余阅读器的宽度变化，交给各自的 ResizeObserver 重新适应。
  await showDocument(tabDoc(id) || doc)
}
function removeFromGroup(id: string) {
  if (!inGroup(id)) return
  contextMenu.value = undefined
  const index = group.value.indexOf(id)
  const rest = group.value.filter(item => item !== id)
  const shown = paneVisible(id)
  if (shown && active.value?.id === id) focusPane(rest[Math.min(index, rest.length - 1)])
  if (shown) {
    // 在移出页面之前挂起，阅读器才能记下这一栏的滚动位置。
    const tab = tabs.value.find(tab => tab.doc.id === id), instance = readerInstances.get(id)
    if (tab) tab.view = instance?.getViewState?.() || tab.view
    instance?.suspend?.()
  }
  group.value = rest.length > 1 ? rest : []
}
const closePane = removeFromGroup
function ungroup() {
  contextMenu.value = undefined
  if (!active.value || !inGroup(active.value.id)) { group.value = []; return }
  suspendLeaving([active.value.id])
  group.value = []
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
  contextMenu.value = undefined
  const selected = active.value?.id === id
  const paneIndex = inGroup(id) && paneVisible(id) ? group.value.indexOf(id) : -1
  const rest = paneIndex >= 0 ? group.value.filter(item => item !== id) : []
  if (inGroup(id)) group.value = group.value.length > 2 ? group.value.filter(item => item !== id) : []
  aiPanels.value = aiPanels.value.filter(panel => panel.doc !== id)
  if (selected) { pauseReader(); ++openEpoch; void flushProgress(); active.value = null; selection.value = undefined; detailsOpen.value = false; opening.value = false }
  evictReader(id)
  // 另一份同书标签还开着时，对话与密码留给它。
  if (!tabs.value.some(tab => tab.doc.id !== id && sourceId(tab.doc.id) === sourceId(id))) { closeChat(sourceId(id)); forgetPassword(sourceId(id)) }
  tabs.value.splice(index, 1)
  // 关闭并排中的焦点文件时，焦点落到相邻的一栏，其余栏保持不动。
  if (selected && rest.length) selectTab(rest[Math.min(paneIndex, rest.length - 1)])
  else if (selected && tabs.value.length) selectTab(tabs.value[Math.min(index, tabs.value.length - 1)].doc.id)
  else if (selected) closeReader()
}
function closeOtherTabs(id: string) { for (const tab of [...tabs.value]) if (tab.doc.id !== id) closeTab(tab.doc.id) }
function moveTab(direction: number) {
  if (!tabs.value.length) return
  const index = tabs.value.findIndex(tab => tab.doc.id === active.value?.id)
  selectTab(tabs.value[(index + direction + tabs.value.length) % tabs.value.length].doc.id)
}
// ---- Bookmarks ----------------------------------------------------------------
// 每本书的书签列表（同一本书的副本共用）；右侧细条上的位置由阅读器按当前排版换算，翻页、缩放后重算。
const bookmarkTick = ref(0)
const editingBookmark = ref<string | null>(null)
watch(() => paneIds.value.join(), () => { for (const id of paneIds.value) void loadBookmarks(sourceId(id)).then(() => bookmarkTick.value++) }, { immediate: true })
function paneBookmarks(id: string) {
  void bookmarkTick.value
  const instance = readerInstances.get(id), doc = tabDoc(id)
  return (bookmarks.get(sourceId(id)) || []).map(mark => ({ id: mark.id, name: mark.name, ratio: instance?.bookmarkRatio?.(mark.position) ?? 0, hint: mark.position.page ? `第 ${mark.position.page} 页` : `${Math.round((mark.position.progress || 0) * 100)}% 处` }))
    .filter(() => !!doc)
}
function addBookmarkHere(id = active.value?.id) {
  if (!id) return
  const instance = readerInstances.get(id), position: BookmarkPosition | undefined = instance?.getBookmarkPosition?.()
  if (!position) return
  if (!addBookmark(sourceId(id), position)) { notify('这本书的书签已经很多了，请先删掉一些。'); return }
  bookmarkTick.value++
}
// 平滑滚动还没停下时再按 Ctrl + ↑ / ↓：以正在去的那个书签为当前位置，接着往下一个跳，不必等上一次滚完。
let bookmarkTarget: { id: string; ratio: number; until: number } | undefined
function jumpBookmark(id: string, markId: string) {
  const mark = bookmarks.get(sourceId(id))?.find(item => item.id === markId)
  if (!mark) return
  const instance = readerInstances.get(id)
  bookmarkTarget = instance?.bookmarkRatio ? { id, ratio: instance.bookmarkRatio(mark.position), until: performance.now() + 900 } : undefined
  if (active.value?.id !== id && paneVisible(id)) focusPane(id)
  readerInstances.get(id)?.goToBookmark?.(mark.position)
}
function stepBookmark(direction: 1 | -1) {
  const id = active.value?.id, instance = id ? readerInstances.get(id) : undefined
  if (!id || !instance?.getBookmarkPosition) return
  const here = instance.getBookmarkPosition()
  if (!here) return
  const list = (bookmarks.get(sourceId(id)) || []).map(mark => ({ id: mark.id, ratio: instance.bookmarkRatio(mark.position) }))
  const moving = bookmarkTarget && bookmarkTarget.id === id && performance.now() < bookmarkTarget.until
  const next = neighbour(list, moving ? bookmarkTarget!.ratio : instance.bookmarkRatio(here), direction)
  if (next) jumpBookmark(id, next.id)
}
function bookmarkMenu(id: string, markId: string, event: MouseEvent) {
  const source = sourceId(id), count = bookmarks.get(source)?.length || 0
  const x = event.clientX, y = event.clientY
  contextMenu.value = { x, y, items: [
    { label: '命名…', icon: 'edit', action: () => { editingBookmark.value = markId } },
    { label: '删除书签', icon: 'trash', danger: true, separator: true, action: () => { removeBookmark(source, markId); bookmarkTick.value++ } },
    ...(count > 1 ? [{ label: `删除全部 ${count} 个书签…`, icon: 'trash', danger: true, action: () => confirmClearBookmarks(source, count, x, y) }] : []),
  ] }
}
// 一次清掉整本书的书签：再确认一步，免得误点。
function confirmClearBookmarks(source: string, count: number, x: number, y: number) {
  void nextTick(() => {
    contextMenu.value = { x, y, items: [
      { label: `确定删除全部 ${count} 个书签`, icon: 'trash', danger: true, action: () => { clearBookmarks(source); bookmarkTick.value++; notify(`已删除 ${count} 个书签`) } },
      { label: '取消', icon: 'close', separator: true, action: () => {} },
    ] }
  })
}
function deleteBookmark(id: string, markId: string) { removeBookmark(sourceId(id), markId); bookmarkTick.value++ }
function finishRename(id: string, markId: string, name: string) {
  if (editingBookmark.value !== markId) return
  editingBookmark.value = null
  renameBookmark(sourceId(id), markId, name)
}
// ---- Assistant windows ------------------------------------------------------
const aiInstances = new Map<string, any>()
let focusAssistantPending: string | undefined
function bindAi(key: string, value: any) {
  if (value) aiInstances.set(key, value); else aiInstances.delete(key)
  if (value && focusAssistantPending === key) { value.focusPrompt?.(); focusAssistantPending = undefined }
}
/** The assistant window showing the focused document (a following one first). */
function focusedAssistant() {
  const id = active.value?.id
  const panel = visibleAi.value.find(panel => !panel.doc) || visibleAi.value.find(panel => panel.doc === id)
  return panel ? aiInstances.get(panel.key) : undefined
}
function assistantFor(element: EventTarget | null) {
  const key = element instanceof Element ? element.closest<HTMLElement>('[data-panel-key^="ai:"]')?.dataset.panelKey : undefined
  return key ? aiInstances.get(key) : focusedAssistant()
}
function openAssistant(focus = false, pinned: string | null = null) {
  if (!active.value) return
  let panel = pinned ? visibleAi.value.find(item => item.doc === pinned) : visibleAi.value.find(item => !item.doc) || visibleAi.value.find(item => item.doc === active.value?.id)
  if (!panel) {
    if (aiPanels.value.length >= MAX_AI_PANELS) { notify(`最多同时打开 ${MAX_AI_PANELS} 个阅读助手。`); return }
    panel = { key: `ai:${crypto.randomUUID()}`, doc: pinned, width: Math.min(420, Math.max(320, Math.round(window.innerWidth * .27))) }
    aiPanels.value = [...aiPanels.value, panel]
  }
  if (focus) {
    const instance = aiInstances.get(panel.key)
    if (instance) void nextTick(() => instance.focusPrompt?.())
    else focusAssistantPending = panel.key
  }
}
function closeAiPanel(key: string) { aiPanels.value = aiPanels.value.filter(panel => panel.key !== key); aiInstances.delete(key) }
function toggleAssistant() {
  const id = active.value?.id
  const panel = visibleAi.value.find(item => !item.doc) || visibleAi.value.find(item => item.doc === id)
  if (panel) closeAiPanel(panel.key)
  else openAssistant(true)
}
// A window pinned to one document remembers its own conversation; a window that follows the
// active tab shows each document's current conversation instead.
function setPanelConversation(key: string, id: string) { const panel = aiPanels.value.find(item => item.key === key); if (panel?.doc) panel.conversation = id }
// ---- Resizing assistant windows -------------------------------------------
let widthDrag: { key: string; x: number; width: number; side: number } | undefined
function startWidthDrag(event: PointerEvent, key: string) {
  const panel = aiPanels.value.find(item => item.key === key)
  if (!panel) return
  const element = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-panel-key]')
  const bounds = element?.getBoundingClientRect()
  // The handle on the left edge grows leftwards; on the right edge it grows rightwards.
  const side = (event.currentTarget as HTMLElement).dataset.edge === 'right' ? 1 : -1
  widthDrag = { key, x: event.clientX, width: bounds?.width || panel.width, side }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  document.documentElement.classList.add('resizing-panels')
  // 拖动助手宽度时，PDF 跟着手实时缩放，松手后再按最终宽度重画一次。
  if (pdfOnScreen()) for (const instance of visibleReaders()) instance.holdPanelResize?.(true)
}
function moveWidthDrag(event: PointerEvent) {
  if (!widthDrag) return
  const panel = aiPanels.value.find(item => item.key === widthDrag!.key)
  if (panel) panel.width = Math.round(Math.min(Math.max(300, window.innerWidth * .6), Math.max(300, widthDrag.width + (event.clientX - widthDrag.x) * widthDrag.side)))
}
function endWidthDrag() {
  if (!widthDrag) return
  widthDrag = undefined; document.documentElement.classList.remove('resizing-panels')
  if (!resizingPanels.size) for (const instance of visibleReaders()) instance.holdPanelResize?.(false, false)
}
// ---- Dragging windows to rearrange (lift, others slide aside) ---------------
let panelDrag: { key: string; element: HTMLElement; grab: number; startX: number; startY: number; moved: boolean; pointer: number } | undefined
const draggingPanel = ref<string>()
function startPanelDrag(event: PointerEvent, key: string) {
  if (event.button !== 0 || !multiPanel.value) return
  const element = document.querySelector<HTMLElement>(`[data-panel-key="${CSS.escape(key)}"]`)
  if (!element) return
  panelDrag = { key, element, grab: event.clientX - element.getBoundingClientRect().left, startX: event.clientX, startY: event.clientY, moved: false, pointer: event.pointerId }
  window.addEventListener('pointermove', movePanelDrag)
  window.addEventListener('pointerup', endPanelDrag)
  window.addEventListener('pointercancel', endPanelDrag)
}
// 文档栏与助手窗口一样可拖：按住工具条空白处（不是按钮、输入框）即可拖动换位。
function paneToolbarGrab(event: PointerEvent, id: string) {
  const target = event.target as Element
  if (!multiPanel.value || !target.closest('.reader-tools') || target.closest('button,input,select,textarea,a,label,[role=slider],[contenteditable]')) return
  event.preventDefault()
  startPanelDrag(event, `doc:${id}`)
}
function panelElements() { return panels.value.map(key => document.querySelector<HTMLElement>(`[data-panel-key="${CSS.escape(key)}"]`)).filter(Boolean) as HTMLElement[] }
function movePanelDrag(event: PointerEvent) {
  const drag = panelDrag
  if (!drag || event.pointerId !== drag.pointer) return
  if (!drag.moved) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
    drag.moved = true; draggingPanel.value = drag.key
    document.documentElement.classList.add('dragging-panels')
  }
  const container = drag.element.parentElement!.getBoundingClientRect()
  const natural = container.left + drag.element.offsetLeft
  const left = event.clientX - drag.grab
  drag.element.style.transform = `translate(${left - natural}px, ${Math.max(-10, Math.min(10, (event.clientY - drag.startY) * .15))}px) scale(1.015)`
  // Swap with a neighbour once the dragged window's centre crosses that neighbour's centre.
  const centre = left + drag.element.offsetWidth / 2
  const keys = panels.value
  const others = panelElements().filter(element => element !== drag.element)
  let index = 0
  for (const other of others) if (centre > container.left + other.offsetLeft + other.offsetWidth / 2) index++
  const without = keys.filter(key => key !== drag.key)
  const next = [...without.slice(0, index), drag.key, ...without.slice(index)]
  if (next.join() === keys.join()) return
  const before = new Map(others.map(element => [element, element.getBoundingClientRect().left]))
  applyPanelOrder(next)
  void nextTick(() => {
    for (const [element, left] of before) {
      const delta = left - element.getBoundingClientRect().left
      if (Math.abs(delta) < 1) continue
      element.animate([{ transform: `translateX(${delta}px)` }, { transform: 'none' }], { duration: 420, easing: getComputedStyle(document.documentElement).getPropertyValue('--spring-snappy').trim() || 'ease-out' })
    }
    const natural = drag.element.parentElement!.getBoundingClientRect().left + drag.element.offsetLeft
    drag.element.style.transform = `translate(${event.clientX - drag.grab - natural}px, 0) scale(1.015)`
  })
}
function applyPanelOrder(next: string[]) {
  order.value = next
  // Document windows of a group follow the same left-to-right order.
  const docs = next.filter(key => key.startsWith('doc:')).map(key => key.slice(4))
  if (group.value.length > 1 && docs.length > 1 && docs.every(id => group.value.includes(id))) group.value = [...docs, ...group.value.filter(id => !docs.includes(id))]
}
function endPanelDrag() {
  const drag = panelDrag
  panelDrag = undefined
  window.removeEventListener('pointermove', movePanelDrag)
  window.removeEventListener('pointerup', endPanelDrag)
  window.removeEventListener('pointercancel', endPanelDrag)
  if (!drag?.moved) return
  const from = drag.element.style.transform
  drag.element.style.transform = ''
  drag.element.animate([{ transform: from }, { transform: 'none' }], { duration: 460, easing: getComputedStyle(document.documentElement).getPropertyValue('--spring-bouncy').trim() || 'ease-out' })
  draggingPanel.value = undefined
  document.documentElement.classList.remove('dragging-panels')
}
// ---- Tab context menu -------------------------------------------------------
type MenuItem = { label: string; icon?: string; action: () => void; danger?: boolean; disabled?: boolean; separator?: boolean; hint?: string }
const contextMenu = ref<{ x: number; y: number; items: MenuItem[] }>()
// 整个应用不出现 WebView 自带的右键菜单（返回、刷新、另存为……），按点到的位置给出自己的玻璃菜单。
// 没在看的对话答完时，右下角浮出一张小玻璃卡，几秒后自己收拢消失。
const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>()
watch(() => notices.map(item => item.id).join(), () => {
  for (const notice of notices) if (!noticeTimers.has(notice.id)) noticeTimers.set(notice.id, setTimeout(() => { noticeTimers.delete(notice.id); dismissNotice(notice.id) }, 9000))
})
function holdNotice(id: string, hold: boolean) {
  clearTimeout(noticeTimers.get(id)); noticeTimers.delete(id)
  if (!hold) noticeTimers.set(id, setTimeout(() => { noticeTimers.delete(id); dismissNotice(id) }, 4000))
}
async function openNotice(notice: Notice) {
  dismissNotice(notice.id)
  await openConversationAt(notice)
}
function appContextMenu(event: MouseEvent) {
  if (event.defaultPrevented) return
  event.preventDefault()
  const target = event.target as HTMLElement
  const items: MenuItem[] = []
  const field = target.closest<HTMLInputElement | HTMLTextAreaElement>('textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file])')
  const text = window.getSelection()?.toString() || ''
  if (field) {
    const editable = !field.readOnly && !field.disabled, selected = (field.selectionEnd ?? 0) > (field.selectionStart ?? 0)
    field.focus()
    items.push({ label: '剪切', icon: 'crop', hint: 'Ctrl+X', disabled: !editable || !selected, action: () => { field.focus(); document.execCommand('cut') } })
    items.push({ label: '复制', icon: 'copy', hint: 'Ctrl+C', disabled: !selected, action: () => { field.focus(); document.execCommand('copy') } })
    items.push({ label: '粘贴', icon: 'doc', hint: 'Ctrl+V', disabled: !editable, action: () => { void navigator.clipboard.readText().then(value => { field.focus(); document.execCommand('insertText', false, value) }).catch(() => notify('无法读取剪贴板，请用 Ctrl+V 粘贴。')) } })
    items.push({ label: '全选', icon: 'check', hint: 'Ctrl+A', separator: true, action: () => { field.focus(); field.select() } })
  } else if (text.trim()) {
    items.push({ label: '复制', icon: 'copy', hint: 'Ctrl+C', action: () => { void navigator.clipboard.writeText(text).catch(() => document.execCommand('copy')) } })
    if (active.value && target.closest('.reader-pane')) items.push({ label: '问阅读助手', icon: 'sparkle', action: () => openAssistant(true) })
    if (active.value && target.closest('.reader-pane')) { const pane = target.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId; items.push({ label: '在这里加书签', icon: 'star', hint: shortcut('bookmark'), action: () => addBookmarkHere(pane || active.value?.id) }) }
  } else if (!active.value && target.closest('.document-card')) {
    const card = target.closest<HTMLElement>('.document-card')!
    const doc = visibleDocuments.value.find(item => item.id === card.dataset.reorderId)
    if (!doc) return
    const cover = covers.get(sourceId(doc.id))?.kind ?? 'icon'
    items.push({ label: '打开', icon: 'book', action: () => { void openDocument(doc) } })
    items.push({ label: doc.starred ? '取消收藏' : '收藏', icon: 'star', action: () => { void toggleStar(doc) } })
    // 显示封面：首页预览、自己的图片或默认图标；当前用的那一种标「当前」。
    items.push({ label: '封面：首页预览', icon: 'doc', hint: cover === 'page' ? '当前' : undefined, separator: true, action: () => { void changeCover(doc, 'page') } })
    items.push({ label: '封面：选择图片…', icon: 'image', hint: cover === 'image' ? '当前' : undefined, action: () => { void changeCover(doc, 'image') } })
    items.push({ label: '封面：默认图标', icon: doc.kind === 'pdf' ? 'file' : 'markdown', hint: cover === 'icon' ? '当前' : undefined, disabled: cover === 'icon', action: () => { void changeCover(doc, 'icon') } })
    items.push({ label: '从文档库移除', icon: 'trash', danger: true, separator: true, action: () => { removeTarget.value = doc } })
  } else if (active.value) {
    if (!aiOpen.value) items.push({ label: '打开阅读助手', icon: 'sparkle', hint: shortcut('ai'), action: () => openAssistant(true) })
    items.push({ label: '并排阅读…', icon: 'split', hint: shortcut('split'), action: () => toggleSplitPicker() })
    items.push({ label: fullscreen.value ? '退出全屏' : '进入全屏', icon: fullscreen.value ? 'exit-fullscreen' : 'fullscreen', hint: shortcut('fullscreen'), separator: true, action: () => { void toggleFullscreen() } })
    items.push({ label: '设置', icon: 'settings', hint: shortcut('settings'), action: () => openSettings() })
  } else {
    items.push({ label: '加入文档', icon: 'plus', hint: shortcut('import'), action: () => { void importDocuments() } })
    items.push({ label: theme.value === 'dark' ? '切换浅色主题' : '切换深色主题', icon: theme.value === 'dark' ? 'sun' : 'moon', action: () => { void toggleTheme() } })
    items.push({ label: '设置', icon: 'settings', hint: shortcut('settings'), separator: true, action: () => openSettings() })
  }
  contextMenu.value = { x: event.clientX, y: event.clientY, items }
}
function pickImageFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}
async function changeCover(doc: Doc, kind: 'page' | 'image' | 'icon') {
  try {
    let cover: Cover | null = null
    if (kind === 'image') { const file = await pickImageFile(); if (!file) return; cover = await imageCover(file) }
    else if (kind === 'page') { notify('正在生成首页封面…'); cover = await pageCover(doc) }
    await setCover(sourceId(doc.id), cover)
    notify(cover ? '已更换封面。' : '已恢复默认图标。')
  } catch (error) { notify(`更换封面失败：${reason(error)}`) }
}
function tabMenu(payload: { id: string; x: number; y: number }) {
  const tab = tabs.value.find(item => item.doc.id === payload.id)
  if (!tab) return
  const id = payload.id, onScreen = paneVisible(id), grouped = inGroup(id)
  const items: MenuItem[] = []
  if (active.value && !onScreen) {
    const full = (inGroup(active.value.id) ? group.value.length : 1) >= MAX_PANES
    items.push({ label: '在右侧并排打开', icon: 'split-add', action: () => openBeside(id, 'right'), disabled: full, hint: full ? `最多 ${MAX_PANES} 份` : undefined })
    items.push({ label: '在左侧并排打开', icon: 'split', action: () => openBeside(id, 'left'), disabled: full })
  }
  if (grouped) items.push({ label: '移出并排', icon: 'close', action: () => removeFromGroup(id) })
  if (group.value.length > 1) items.push({ label: '取消整组并排', icon: 'panel', action: ungroup })
  items.push({ label: '为这份文档开一个助手窗口', icon: 'sparkle', separator: items.length > 0, action: () => { contextMenu.value = undefined; if (!paneVisible(id)) selectTab(id); void nextTick(() => openAssistant(true, id)) } })
  {
    const full = (inGroup(active.value?.id) ? group.value.length : 1) >= MAX_PANES
    items.push({ label: '在右侧再开一份', icon: 'split-add', action: () => openCopy(id), disabled: full, hint: full ? `最多 ${MAX_PANES} 份` : undefined })
  }
  items.push({ label: '关闭标签', icon: 'close', separator: true, action: () => closeTab(id) })
  if (tabs.value.length > 1) items.push({ label: '关闭其他标签', action: () => closeOtherTabs(id) })
  contextMenu.value = { x: payload.x, y: payload.y, items }
}
// ---- Dragging a tab: reorder the strip, or drop beside a window ---------------
const tabDrop = ref<{ id: string; target: string; side: 'left' | 'right'; left: number; top: number; width: number; height: number }>()
function tabDrag(payload: { id: string; x: number; y: number; phase: 'move' | 'end' | 'cancel' }) {
  if (payload.phase !== 'move') {
    const drop = tabDrop.value
    tabDrop.value = undefined
    if (payload.phase === 'end' && drop) {
      if (paneVisible(drop.id) && inGroup(drop.id)) {
        // Move a window of the group to the other side of the target.
        const keys = panels.value.filter(key => key !== `doc:${drop.id}`)
        const at = keys.indexOf(`doc:${drop.target}`) + (drop.side === 'right' ? 1 : 0)
        applyPanelOrder([...keys.slice(0, at), `doc:${drop.id}`, ...keys.slice(at)])
      } else void openBeside(drop.id, drop.side, drop.target)
    }
    return
  }
  const element = document.elementFromPoint(payload.x, payload.y)?.closest<HTMLElement>('.reader-pane[data-pane-id]')
  const target = element?.dataset.paneId
  if (!element || !target || target === payload.id) { tabDrop.value = undefined; return }
  const bounds = element.getBoundingClientRect()
  const side = payload.x < bounds.left + bounds.width / 2 ? 'left' : 'right'
  tabDrop.value = { id: payload.id, target, side, left: side === 'left' ? bounds.left : bounds.left + bounds.width / 2, top: bounds.top, width: bounds.width / 2, height: bounds.height }
}
function reorderTabs(payload: { from: string; to: string; after: boolean }) {
  const list = [...tabs.value]
  const moving = list.find(tab => tab.doc.id === payload.from)
  if (!moving || payload.from === payload.to) return
  const rest = list.filter(tab => tab !== moving)
  const at = rest.findIndex(tab => tab.doc.id === payload.to) + (payload.after ? 1 : 0)
  rest.splice(at, 0, moving)
  tabs.value = rest
  // Within a visible group the windows follow the new tab order.
  if (inGroup(payload.from) && inGroup(payload.to)) {
    const docs = rest.map(tab => tab.doc.id).filter(id => group.value.includes(id))
    const queue = docs.map(id => `doc:${id}`)
    order.value = panels.value.map(key => key.startsWith('doc:') ? queue.shift() || key : key)
    group.value = docs
  }
}
function selectedContext(value: typeof selection.value) {
  dismissCaptureQuick()
  selection.value = value
  if (currentTab.value) currentTab.value.selection = value
  // 截图在后台编码：好了补进同一个选区，再通知界面刷新（卡片和输入框上方的截图预览）。
  if (value?.imagePending) {
    const pending = value
    void pending.imagePending!.then(image => {
      if (toRaw(selection.value) !== toRaw(pending)) return
      if (!image && !pending.text) { clearSelection(); notify('这块区域没有可以交给助手的内容，请换个地方框选。'); return }
      triggerRef(selection)
    }, () => { if (toRaw(selection.value) === toRaw(pending)) clearSelection() })
  }
  // A framed region: a PDF crop, or a Markdown region (its screenshot plus the text under it).
  if (value?.image || value?.imagePending || value?.rect?.space === 'markdown') {
    selectionAction.value = undefined
    if (preferences.value.pdf.quickAskOnCapture && active.value) {
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
  if (current?.pending && current.ownedRequest && chatState(sourceId(current.documentId)).request === current.ownedRequest) stopChat(sourceId(current.documentId))
  if (clear && current && active.value?.id === current.documentId && toRaw(selection.value) === toRaw(current.selection)) clearSelection()
}
function checkCaptureQuick() {
  captureQuickFrame = 0
  const current = captureQuick.value
  if (!current) return
  if (active.value?.id !== current.documentId || toRaw(selection.value) !== toRaw(current.selection)) { dismissCaptureQuick(); return }
  // Settings covers the capture without changing the underlying attachment.
  if (settingsOpen.value) return
  const frame = reader.value?.getCaptureFrame?.(current.selection)
  // 页面重画、重新排版的一两帧里拿不到位置：稍等再看，确实移出视野（或选区没了）才收起。
  if (!frame) {
    captureQuickMissing ||= performance.now()
    if (performance.now() - captureQuickMissing > 400) dismissCaptureQuick(); else scheduleCaptureCheck()
    return
  }
  captureQuickMissing = 0
  // 排版或窗口尺寸变了（全屏切换、重绘、面板开合）：卡片跟着选区走，而不是直接消失。
  if ([frame.left, frame.top, frame.width, frame.height].some((value, index) => Math.abs(value - [current.frame.left, current.frame.top, current.frame.width, current.frame.height][index]) > .5)) captureQuick.value = { ...current, frame }
}
function scheduleCaptureCheck() { if (!captureQuickFrame) captureQuickFrame = requestAnimationFrame(checkCaptureQuick) }
function monitorCaptureQuick() {
  captureQuickMissing = 0
  if (captureQuickFrame) cancelAnimationFrame(captureQuickFrame)
  captureQuickFrame = 0
  captureQuickResize?.disconnect(); captureQuickMutation?.disconnect()
  captureQuickResize = new ResizeObserver(scheduleCaptureCheck)
  const elements: HTMLElement[] = reader.value?.getCaptureElements?.(captureQuick.value?.selection) || []
  const slot = elements.find(element => element.matches('.page-slot'))
  for (const element of [document.querySelector('.reading-main'), ...elements]) if (element) captureQuickResize.observe(element)
  if (slot) {
    captureQuickMutation = new MutationObserver(scheduleCaptureCheck)
    captureQuickMutation.observe(slot, { childList: true, attributes: true, subtree: true, attributeFilter: ['style', 'class', 'width', 'height'] })
  }
  scheduleCaptureCheck()
}
// 窗口尺寸变化（包括全屏切换）、正文滚动（包括重新排版时程序设置的滚动位置）：都只重新定位卡片，
// 选区真的移出视野时由上面的检查收起。
function captureViewportChanged() { if (captureQuick.value) scheduleCaptureCheck() }
function continueCaptureQuick() { dismissCaptureQuick(); openAssistant(true) }
async function askCaptureQuick(question: string) {
  const current = captureQuick.value
  if (!current || current.pending || active.value?.id !== current.documentId) return
  const tabId = current.documentId
  const state = chatState(sourceId(tabId))
  if (state.request) { current.status = '这份文档已有问题正在处理，可点继续查看。'; captureQuick.value = { ...current }; return }
  const doc = { id: sourceId(tabId), title: active.value.name, kind: active.value.kind }
  const context = { page: current.selection.page, selection: current.selection }
  current.pending = true; current.status = '准备提问…'; captureQuick.value = { ...current }
  // 卡片是在截图编码完成之前弹出的：点得很快时先等截图好。
  if (current.selection.imagePending) {
    await current.selection.imagePending.catch(() => '')
    if (toRaw(captureQuick.value?.selection) !== toRaw(current.selection)) return
  }
  // A quick question is about the framed region only: it sends the screenshot,
  // without the page context, document search or earlier references.
  let accepted = false
  const sending = sendChat(doc, context, () => {
    if (active.value?.id === tabId && toRaw(selection.value) === toRaw(context.selection)) openSettings('ai')
  }, () => {
    accepted = true; current.pending = false
    // Do not abort an accepted queued request when removing its capture UI.
    if (captureQuick.value?.documentId === tabId && toRaw(captureQuick.value.selection) === toRaw(context.selection)) {
      captureQuick.value.pending = false; captureQuick.value.ownedRequest = undefined; dismissCaptureQuick()
    }
    consumeSelection({ documentId: tabId, selection: context.selection })
    if (active.value?.id === tabId) openAssistant()
  }, question, { includeSelection: true, includeDocument: false, selectionOnly: true })
  if (captureQuick.value?.documentId === current.documentId) captureQuick.value.ownedRequest = state.request
  try { await sending }
  finally {
    const retained = captureQuick.value
    if (!accepted && retained?.documentId === tabId && toRaw(retained.selection) === toRaw(context.selection)) {
      retained.pending = false; retained.ownedRequest = undefined; retained.status = state.status || '未能发送，请重试。'; captureQuick.value = { ...retained }
    }
  }
}
function selectionChanged() { if (window.getSelection()?.isCollapsed) selectionAction.value = undefined }
function dismissSelectionAction() { selectionAction.value = undefined }
async function toggleStar(doc: Doc) {
  try { updateLocal(await library.update(sourceId(doc.id), { starred: !doc.starred })) }
  catch (error) { notify(reason(error)) }
}
function readingProgress(id: string, value: { page: number; pageCount: number; progress: number }) {
  const tab = tabs.value.find(tab => tab.doc.id === id)
  if (!tab || !value.pageCount) return
  if (captureQuick.value?.documentId === id && captureQuick.value.selection.page !== value.page) dismissCaptureQuick()
  // 排版变了（换页、缩放后重新布局）时，书签在细条上的位置跟着重算。
  if (bookmarks.get(sourceId(id))?.length) bookmarkTick.value++
  const patch = { page: value.page, pageCount: value.pageCount, progress: value.progress }
  const moved = tab.doc.page !== value.page || tab.doc.pageCount !== value.pageCount
  tab.doc = { ...tab.doc, ...patch }
  if (active.value?.id === id) active.value = tab.doc
  const local = documents.value.find(doc => doc.id === id)
  if (local) Object.assign(local, patch)
  if (moved) wakePill(id)
  if (isCopy(id)) return
  pendingProgress.set(id, patch)
  clearTimeout(progressTimer); progressTimer = setTimeout(flushProgress, 800)
}
function indexText(id: string, text: string) {
  if (isCopy(id)) return
  clearTimeout(indexTimers.get(id))
  indexTimers.set(id, setTimeout(() => { indexTimers.delete(id); void library.index(id, text.slice(0, 2000000)).catch(error => notify(`搜索索引更新失败：${reason(error)}`)) }, 1200))
}
function clearSelection() { dismissCaptureQuick(); selection.value = undefined; selectionAction.value = undefined; if (currentTab.value) currentTab.value.selection = undefined; window.getSelection()?.removeAllRanges(); reader.value?.clearSelection?.() }
function consumeSelection(value: { documentId: string; selection: any }) {
  // 助手按原编号报告，选区可能来自同书的任一份。
  const tab = tabs.value.find(tab => (tab.doc.id === value.documentId || sourceId(tab.doc.id) === value.documentId) && toRaw(tab.selection) === toRaw(value.selection))
  if (!tab) return
  tab.selection = undefined
  if (active.value?.id === tab.doc.id && toRaw(selection.value) === toRaw(value.selection)) clearSelection()
}
function jump(value: { page?: number; rect?: any; line?: number }) { if (active.value?.kind === 'markdown') reader.value?.goToPage?.(value.line || value.page || 1); else if (value.page) reader.value?.goToPage?.(value.page, value.rect) }
async function addTag() {
  const value = tagInput.value.trim().slice(0, 40)
  if (!value || !active.value) return
  try { updateLocal(await library.update(sourceId(active.value.id), { tags: [...new Set([...active.value.tags, value])] })); tagInput.value = '' }
  catch (error) { notify(reason(error)) }
}
async function removeTag(value: string) {
  if (!active.value) return
  try { updateLocal(await library.update(sourceId(active.value.id), { tags: active.value.tags.filter(tag => tag !== value) })) }
  catch (error) { notify(reason(error)) }
}
async function removeDocument() {
  if (!removeTarget.value) return
  const target = removeTarget.value
  try { if (active.value?.id === target.id) rememberReader(); await flushProgress(); await progressWrites.get(target.id); clearTimeout(indexTimers.get(target.id)); indexTimers.delete(target.id); await library.remove(target.id); for (const tab of [...tabs.value]) if (sourceId(tab.doc.id) === target.id) closeTab(tab.doc.id); removeTarget.value = null; await refresh(); notify('已从文档库移除，原文件保留。') }
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
  // 暖色极简与铅笔草稿不用玻璃：按实色材质处理，玻璃运行时（折射、字色采样、镜面环）随之停下。
  const glass = appearance.style === 'glass'
  root.dataset.style = appearance.style
  root.dataset.glass = !glass || appearance.glassTransparency === 0 ? 'solid' : 'custom'
  root.style.setProperty('--glass-transparency', String(appearance.glassTransparency / 100))
  // 模糊程度 50% 是默认强度；0 不模糊，100% 为两倍。
  root.style.setProperty('--glass-blur-scale', String(appearance.glassBlur / 50))
  // 边缘高光 100% 是以前的强度，默认 50%。
  root.style.setProperty('--glass-highlight', String(appearance.glassHighlight / 100))
  root.dataset.refraction = glass && appearance.glassRefraction ? 'on' : 'off'
  glassContrast?.setOptions({ legibility: appearance.glassLegibility, compensation: appearance.glassCompensation, tint: appearance.glassTint })
  root.dataset.background = glass && appearance.background ? 'custom' : 'default'
  root.dataset.backdrop = appearance.backdrop
  // Fonts: the interface font replaces the base stack; the reading font defaults to it.
  void registerCustomFonts(appearance.customFonts)
  const uiFont = fontChoices(UI_FONTS, appearance.customFonts).find(item => item.id === appearance.uiFont)
  const readingFont = fontChoices(READING_FONTS, appearance.customFonts).find(item => item.id === appearance.readingFont)
  if (uiFont && uiFont.id !== 'system') { root.style.setProperty('--font', uiFont.stack); root.style.setProperty('--font-display', uiFont.stack) }
  else { root.style.removeProperty('--font'); root.style.removeProperty('--font-display') }
  if (readingFont?.stack) root.style.setProperty('--font-reading', readingFont.stack); else root.style.removeProperty('--font-reading')
  const answerFont = SKETCH_ANSWER_FONTS.find(item => item.id === appearance.sketchAnswerFont)
  if (appearance.style === 'sketch' && answerFont?.stack) root.style.setProperty('--font-answer', answerFont.stack); else root.style.removeProperty('--font-answer')
  const background = glass ? appearance.background?.dataUrl : undefined
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
// 页面视图（单页 / 双页、封面是否单独一页）：所有 PDF 共用一个偏好。
async function setPageLayout(value: { pageLayout: 'single' | 'spread'; coverAlone: boolean }) {
  try { await savePreferences({ ...preferences.value, pdf: { ...preferences.value.pdf, ...value } }) }
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
watch([sidebarOpen, aiOpen, detailsOpen, chromeCollapsed], () => {
  if (pdfOnScreen() && !window.matchMedia('(max-width: 720px)').matches) for (const instance of visibleReaders()) instance.holdPanelResize?.(true)
}, { flush: 'sync' })
// Windows inside the workspace: only assistant windows change the documents' width when they come and go.
function panelResizeStart(element: Element, entering: boolean) { if (element.classList.contains('ai-panel')) paneResizeStart(element, entering) }
function panelResizeEnd(element: Element, cancelled = false) { if (resizingPanels.has(element)) paneResizeEnd(element, cancelled) }
const resizeGeneration = new WeakMap<Element, number>()
function paneResizeStart(element: Element, entering: boolean) {
  resizeGeneration.set(element, (resizeGeneration.get(element) || 0) + 1)
  resizingPanels.set(element, entering)
  if (pdfOnScreen() && !window.matchMedia('(max-width: 720px)').matches) for (const instance of visibleReaders()) instance.holdPanelResize?.(true, entering)
  // 关闭时面板留在原位做完收拢动画，阅读区在动画结束后才一次性展开，PDF 只重新适配一次。
  if (entering) restoreLeavingPanel(element)
}
function paneResizeEnd(element: Element, cancelled = false) {
  // 动画开头那一帧很慢时（比如新面板正在生成折射贴图），Vue 的兜底计时器会在弹簧刚起步就报告结束；
  // 等宽度真正停下再让 PDF 按最终宽度适配，否则会按半途的宽度判断“没超宽”。
  const springing = cancelled ? [] : element.getAnimations().filter(animation => 'transitionProperty' in animation && animation.playState === 'running')
  if (springing.length) {
    const generation = resizeGeneration.get(element)
    void Promise.allSettled(springing.map(animation => animation.finished)).then(() => { if (resizeGeneration.get(element) === generation) paneResizeEnd(element) })
    return
  }
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
function aiSettingsSaved(value: any) { configureRequests(value); for (const instance of aiInstances.values()) instance.applySettings?.(value) }
function shortcut(action: keyof typeof preferences.value.shortcuts) { return shortcutLabel(preferences.value.shortcuts[action]) }
// Bound shortcuts only, for the hover tooltips (data-tip-key); disabled ones show no key.
const tipKeys = computed<Record<string, string>>(() => Object.fromEntries(Object.entries(preferences.value.shortcuts).filter(([, value]) => value).map(([action, value]) => [action, shortcutLabel(value)])))
function tipKey(action: keyof typeof preferences.value.shortcuts) { return tipKeys.value[action] || undefined }
// 发布到 GitHub Releases 的新版本：启动后与每隔几小时检查一次，可在设置里关闭或改收测试版。
watch(() => `${preferences.value.updates.autoCheck}|${preferences.value.updates.prerelease}`, () => startAutoCheck({ enabled: isDesktop && preferences.value.updates.autoCheck, includePrerelease: preferences.value.updates.prerelease }), { immediate: true })
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
watch(settingsOpen, value => { nudgeGlassMotion(560); if (!value && captureQuick.value) monitorCaptureQuick() })
watch(() => preferences.value.pdf.quickAskOnCapture, value => { if (!value) dismissCaptureQuick() })

function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') {
    if (settingsOpen.value) { settingsOpen.value = false; event.preventDefault() }
    else if (splitPicker.value) { splitPicker.value = undefined; event.preventDefault() }
    // 收起卡片但保留截图：之后自己在阅读助手里提问，截图仍在输入框上方。
    else if (captureQuick.value) { dismissCaptureQuick(); event.preventDefault() }
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
  if (['outline', 'fitWidth', 'zoomOut', 'zoomIn', 'previousPage', 'nextPage', 'capture', 'split', 'inkPen', 'inkHighlighter', 'inkUnderline', 'bookmark', 'bookmarkPrev', 'bookmarkNext'].includes(action) && !active.value) return
  if (action === 'fitWidth' && active.value?.kind !== 'pdf') return
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
    case 'sidebar': toggleSidebar(); break
    case 'ai': if (active.value) toggleAssistant(); break
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
    // 标记工具：按一次进入标记并选中这支笔，再按同一个键退出标记。
    case 'bookmark': addBookmarkHere(); break
    case 'bookmarkPrev': stepBookmark(-1); break
    case 'bookmarkNext': stepBookmark(1); break
    case 'inkPen': reader.value?.pickInk?.('pen'); break
    case 'inkHighlighter': reader.value?.pickInk?.('highlighter'); break
    case 'inkUnderline': reader.value?.pickInk?.('underline'); break
    case 'aiSend': assistantFor(event.target)?.send?.(); break
    case 'aiStop': if (active.value) stopChat(active.value.id); break
  }
}
let wheelTimer: ReturnType<typeof setTimeout> | undefined
let wheelAction: 'zoomIn' | 'zoomOut' | undefined
let wheelTime = 0
// Markdown zooms around the cursor; the PDF reader ignores the point.
let wheelPoint: { x: number; y: number } | undefined
function clearWheelZoom() { clearTimeout(wheelTimer); wheelTimer = undefined; wheelAction = undefined; wheelTime = 0 }
function applyWheelZoom() {
  wheelTimer = undefined
  const action = wheelAction; wheelAction = undefined
  if (!action || !active.value || !reader.value || settingsOpen.value || removeTarget.value) return
  wheelTime = performance.now(); reader.value[action]?.(wheelPoint)
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
  wheelPoint = { x: event.clientX, y: event.clientY }
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
      // 桌面版拖放只给文件路径：图片请走阅读助手的「添加图片」或粘贴，不当成文档导入。
      else if (value.type === 'drop') {
        if (value.paths.length && value.paths.every(path => /\.(png|jpe?g|webp|gif)$/i.test(path))) { draggingFiles.value = false; notify('图片请在阅读助手里点「添加图片」，或复制后在输入框 Ctrl+V 粘贴。') }
        else void dropDocuments(value.paths)
      }
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
  glassContrast.setOptions({ legibility: effectiveAppearance.value.glassLegibility, compensation: effectiveAppearance.value.glassCompensation, tint: effectiveAppearance.value.glassTint })
  glassContrast.setBackground(appliedBackground ?? null)
  document.addEventListener('keydown', keydown)
  document.addEventListener('contextmenu', appContextMenu)
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
  await loadLibraryOrder()
  void loadCovers()
  await refresh()
})
onBeforeUnmount(() => { stopAutoCheck(); for (const timer of pillTimers.values()) clearTimeout(timer); clearTimeout(enteringTimer); disposed = true; ++openEpoch; dismissCaptureQuick(); stopDropListening?.(); clearWheelZoom(); readerInstances.clear(); glassContrast?.dispose(); document.removeEventListener('keydown', keydown); document.removeEventListener('contextmenu', appContextMenu); document.removeEventListener('wheel', wheel, true); document.removeEventListener('dragenter', dragEnter); document.removeEventListener('dragover', dragOver); document.removeEventListener('dragleave', dragLeave); document.removeEventListener('drop', fileDrop); document.removeEventListener('selectionchange', selectionChanged); document.removeEventListener('scroll', dismissSelectionAction, true); document.removeEventListener('scroll', captureViewportChanged, true); window.removeEventListener('resize', dismissSelectionAction); window.removeEventListener('resize', captureViewportChanged); closeAllChats(); forgetAllPasswords(); systemTheme.removeEventListener('change', applyTheme); flushProgress(); for (const timer of indexTimers.values()) clearTimeout(timer); clearTimeout(queryTimer); clearTimeout(toastTimer) })
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': !sidebarOpen, 'has-reader': active, 'chrome-collapsed': chromeCollapsed }">
    <Transition name="chrome-tag"><button v-if="chromeCollapsed" class="chrome-tag" data-tip="展开顶栏与侧栏" :data-tip-key="tipKey('sidebar')" aria-label="展开顶栏与侧栏" @click="expandChrome"><AppIcon name="chevron-right" :size="14" /></button></Transition>
    <Transition name="sidebar" @before-enter="paneResizeStart($event, true)" @before-leave="paneResizeStart($event, false)" @after-enter="paneResizeEnd" @after-leave="paneResizeEnd" @enter-cancelled="paneResizeEnd($event, true)" @leave-cancelled="paneResizeEnd($event, true)">
    <aside class="app-sidebar" v-if="sidebarOpen" data-glass-interactive="panel">
      <button class="brand" @click="chooseCategory('all')" aria-label="返回文档库"><span class="brand-symbol"><svg width="26" height="26" viewBox="200 130 624 700" aria-hidden="true"><path d="M220 418c118-52 214-44 278 22v372c-66-56-162-66-278-24z" fill="#fff" /><path d="M804 418c-118-52-214-44-278 22v372c66-56 162-66 278-24z" fill="#fff" fill-opacity=".62" /><path d="M512 150c11 92 41 122 133 133-92 11-122 41-133 133-11-92-41-122-133-133 92-11 122-41 133-133z" fill="#fff" /></svg></span><span>开智</span></button>
      <button class="import-button" data-tip="加入 PDF / Markdown 文档" :data-tip-key="tipKey('import')" @click="importDocuments" :disabled="importing" aria-label="加入文档"><AppIcon name="plus" :size="18" />{{ importing ? '正在导入…' : '加入文档' }}<kbd v-if="preferences.shortcuts.import">{{ shortcut('import') }}</kbd></button>
      <nav v-liquid-selection="{ radius: 'var(--r-control)' }" class="workspace-nav" aria-label="文档分类">
        <button :class="{ selected: category === 'all' && !tagFilter }" @click="chooseCategory('all')"><AppIcon name="library" :size="18" />全部文档<span>{{ documents.length }}</span></button>
        <button :class="{ selected: category === 'recent' }" @click="chooseCategory('recent')"><AppIcon name="clock" :size="18" />最近阅读</button>
        <button :class="{ selected: category === 'starred' }" @click="chooseCategory('starred')"><AppIcon name="star" :size="18" />我的收藏<span>{{ starredCount }}</span></button>
      </nav>
      <div class="tag-heading"><p class="sidebar-label">标签</p><AppIcon name="tag" :size="14" /></div>
      <nav v-liquid-selection="{ radius: 'var(--r-control)' }" class="tag-nav" aria-label="文档标签"><button v-for="tag in tags" :key="tag" :class="{ selected: tagFilter === tag }" @click="chooseTag(tag)"><span class="tag-dot"></span>{{ tag }}<span>{{ documents.filter(doc => doc.tags.includes(tag)).length }}</span></button><p v-if="!tags.length" class="tag-empty">可在文档详情中添加标签。</p></nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-bottom"><button @click="openSettings()" aria-label="设置"><AppIcon name="settings" :size="17" /><span>设置</span></button><button class="icon-button" @click="toggleTheme($event)" :data-tip="theme === 'dark' ? '切换浅色主题' : '切换深色主题'" :aria-label="theme === 'dark' ? '切换浅色主题' : '切换深色主题'"><AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="17" /></button></div>
    </aside>
    </Transition>

    <main class="app-main">
      <Transition name="topbar" @before-enter="paneResizeStart($event, true)" @before-leave="paneResizeStart($event, false)" @after-enter="paneResizeEnd" @after-leave="paneResizeEnd" @enter-cancelled="paneResizeEnd($event, true)" @leave-cancelled="paneResizeEnd($event, true)">
      <header v-show="!chromeCollapsed" class="app-topbar" :class="{ 'with-tabs': tabs.length }" data-glass-interactive="panel">
        <button class="icon-button sidebar-toggle" @click="toggleSidebar" data-tip="显示 / 隐藏侧栏" :data-tip-key="tipKey('sidebar')" aria-label="切换侧栏" :aria-expanded="sidebarOpen"><AppIcon name="panel" :size="18" /></button>
        <FileTabs v-if="tabs.length" :tabs="fileTabs" :active-id="active?.id" :group="group.length > 1 ? group : []" :visible="paneIds" @select="selectTab" @close="closeTab" @library="closeReader" @menu="tabMenu" @drag="tabDrag" @reorder="reorderTabs" />
        <span v-else class="breadcrumb">{{ currentTitle }}</span>
        <div class="topbar-actions">
          <template v-if="active"><button class="icon-button" :class="{ 'is-starred': active.starred }" @click="toggleStar(active)" data-tip="收藏文档" aria-label="收藏文档"><AppIcon name="star" :size="18" /></button><button class="icon-button" :class="{ active: detailsOpen }" @click="detailsOpen = !detailsOpen" data-tip="文档详情与标签" aria-label="文档详情与标签" :aria-expanded="detailsOpen"><AppIcon name="tag" :size="18" /></button><button class="icon-button split-toggle" data-split-anchor :class="{ active: splitPicker || splitView }" @click="toggleSplitPicker($event)" data-tip="并排阅读" :data-tip-key="tipKey('split')" aria-label="并排阅读" :aria-expanded="!!splitPicker"><AppIcon name="split" :size="18" /><span v-if="splitView" class="split-count">{{ paneIds.length }}</span></button><button class="ai-toggle" data-tip="阅读助手" :data-tip-key="tipKey('ai')" :class="{ active: aiOpen }" @click="toggleAssistant" :aria-expanded="aiOpen"><ClaudeBurst :size="17" />阅读助手</button></template>
          <button v-else class="icon-button" @click="toggleTheme" :data-tip="theme === 'dark' ? '切换浅色主题' : '切换深色主题'" :aria-label="theme === 'dark' ? '切换浅色主题' : '切换深色主题'"><AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" /></button>
          <button class="icon-button" @click="collapseChrome" data-tip="收起顶栏与侧栏，阅读区占满窗口" aria-label="收起顶栏与侧栏"><AppIcon name="collapse-up" :size="18" /></button>
          <button class="icon-button" @click="toggleFullscreen" :disabled="fullscreenPending" :aria-label="fullscreen ? '退出全屏' : '进入全屏'" :aria-pressed="fullscreen" :data-tip="fullscreen ? '退出全屏' : '进入全屏'" :data-tip-key="tipKey('fullscreen')"><AppIcon :name="fullscreen ? 'exit-fullscreen' : 'fullscreen'" :size="18" /></button>
          <button class="icon-button" @click="openSettings()" data-tip="设置" :data-tip-key="tipKey('settings')" aria-label="打开设置"><AppIcon name="settings" :size="18" /></button>
        </div>
      </header>
      </Transition>

      <Transition name="view">
      <div v-if="!active" class="library-view" key="library" data-reorder-scroll>
        <header class="library-header">
          <div class="library-heading"><h1>{{ currentTitle }}<span class="heading-count">{{ visibleDocuments.length }}</span></h1></div>
          <div class="library-tools">
            <div class="library-search"><AppIcon name="search" :size="17" /><input ref="search" v-model="query" @input="searchDocuments" placeholder="搜索标题、标签或已索引内容" aria-label="搜索文档" /><button v-if="query" @click="query = ''; refresh()" data-tip="清空搜索" aria-label="清空搜索"><AppIcon name="close" :size="14" /></button><kbd v-else-if="preferences.shortcuts.search">{{ shortcut('search') }}</kbd></div>
            <button v-if="libraryOrder.length && canArrange" class="icon-button arrange-reset" @click="resetLibraryOrder" data-tip="恢复按最近阅读排列" aria-label="恢复按最近阅读排列"><AppIcon name="clock" :size="16" /></button><button class="library-sort" data-tip="排序方式（再选一次切换升降序）" aria-label="排序方式" aria-haspopup="menu" @click="openSortMenu($event)"><AppIcon name="list" :size="15" /><span>{{ SORTS.find(item => item.key === librarySort.key)?.label }}</span><AppIcon name="down" :size="12" /></button><button v-if="librarySort.key !== 'default'" class="icon-button sort-direction" :data-tip="librarySort.descending ? '降序（点一下改为升序）' : '升序（点一下改为降序）'" :aria-label="librarySort.descending ? '降序' : '升序'" @click="chooseSort(librarySort.key)"><span aria-hidden="true">{{ librarySort.descending ? '↓' : '↑' }}</span></button><div v-liquid-selection class="view-switch"><button :class="{ selected: display === 'grid' }" @click="setDisplay('grid')" data-tip="卡片视图" aria-label="卡片视图"><AppIcon name="grid" :size="16" /></button><button :class="{ selected: display === 'list' }" @click="setDisplay('list')" data-tip="列表视图" aria-label="列表视图"><AppIcon name="list" :size="17" /></button></div>
          </div>
        </header>
        <div class="library-summary"><div><AppIcon name="book" :size="15" /><strong>{{ documents.length }}</strong><span>份文档</span></div><span class="summary-divider"></span><div><AppIcon name="star" :size="15" /><strong>{{ starredCount }}</strong><span>份收藏</span></div><span class="summary-divider"></span><div><AppIcon name="file" :size="15" /><strong>{{ totalPages }}</strong><span>页已打开文档</span></div><span v-if="!isDesktop" class="summary-note">浏览器预览</span></div>
        <div v-if="query || category === 'recent'" class="library-list-heading"><span>{{ query ? `搜索「${query}」` : '按最近阅读排列' }}</span></div>
        <div v-if="loading" class="library-empty"><span class="spinner"></span><p>正在读取文档库…</p></div>
        <div v-else-if="!visibleDocuments.length" class="library-empty"><div class="empty-art"><AppIcon name="book" :size="42" /></div><h2>{{ query ? '没有匹配的文档' : category === 'starred' ? '暂无收藏' : tagFilter ? '此标签下暂无文档' : '暂无文档' }}</h2><p>{{ query ? '可搜索标题、标签和已读取的文档内容。' : '点击“加入文档”添加 PDF 或 Markdown，可一次选择多个文件。' }}</p><button v-if="query" @click="query = ''; refresh()">查看全部文档</button><small>导入不会移动或修改原文件</small></div>
        <div v-else ref="collection" class="document-collection" :class="[display, { arrangeable: canArrange }]" :aria-description="canArrange ? '拖动卡片或按 Alt+方向键调整位置' : undefined">
          <article v-for="doc in visibleDocuments" :key="doc.id" class="document-card" :class="[doc.kind, { 'reorder-lifted': reorderLibrary.dragging.value === doc.id }]" :data-reorder-id="doc.id" tabindex="0" role="button" :aria-label="`打开 ${doc.name}`" @click="openDocument(doc)" @keydown.enter="openDocument(doc)" @keydown="reorderLibrary.keydown($event, doc.id)" @pointerdown="reorderLibrary.pointerdown($event, doc.id)">
            <div class="document-cover" :class="{ 'has-image': covers.has(sourceId(doc.id)) }"><img v-if="covers.has(sourceId(doc.id))" class="cover-image" :class="covers.get(sourceId(doc.id))!.kind" :src="covers.get(sourceId(doc.id))!.image" alt="" draggable="false" /><template v-else><div class="cover-lines"><i></i><i></i><i></i><i></i></div><div class="document-type-icon"><AppIcon :name="doc.kind === 'pdf' ? 'file' : 'markdown'" :size="display === 'list' ? 23 : 30" /></div></template><button class="card-star" :class="{ 'is-starred': doc.starred }" @click.stop="toggleStar(doc)" :data-tip="doc.starred ? '取消收藏' : '收藏文档'" :aria-label="doc.starred ? '取消收藏' : '收藏文档'"><AppIcon name="star" :size="17" /></button></div>
            <div class="document-card-body"><div class="document-card-title"><h3 :data-tip="doc.name">{{ doc.name.replace(/\.(pdf|md|markdown)$/i, '') }}</h3><span class="format-pill">{{ doc.kind === 'pdf' ? 'PDF' : 'MD' }}</span></div><p class="document-meta">{{ size(doc.size) }}<span>·</span>{{ doc.lastOpenedAt ? `阅读于 ${date(doc.lastOpenedAt)}` : `加入于 ${date(doc.addedAt)}` }}</p><div class="document-tags"><span v-for="tag in doc.tags.slice(0, 3)" :key="tag">{{ tag }}</span><span v-if="doc.tags.length > 3">+{{ doc.tags.length - 3 }}</span></div><div class="document-progress"><div><i :style="{ width: `${progressPercent(doc)}%` }"></i></div><span>{{ doc.progress ? `${progressPercent(doc)}%` : '未读' }}</span></div></div>
            <button class="card-remove icon-button" @click.stop="removeTarget = doc" data-tip="从文档库移除" aria-label="从文档库移除"><AppIcon name="trash" :size="15" /></button>
          </article>
        </div>
      </div>

      </Transition>
      <Transition name="view">
      <div v-if="stageDoc" v-show="active" class="reading-workspace">
        <section class="reading-main">
          <div v-if="opening && !multiPanel" class="reader-overlay"><span class="spinner"></span><p>正在打开 {{ stageDoc!.name }}…</p></div>
          <TransitionGroup tag="div" name="pane" class="reader-panes" :class="{ split: splitView, multi: multiPanel, dragging: draggingPanel }" @before-enter="panelResizeStart($event, true)" @before-leave="panelResizeStart($event, false)" @after-enter="panelResizeEnd($event)" @after-leave="panelResizeEnd($event)" @enter-cancelled="panelResizeEnd($event, true)" @leave-cancelled="panelResizeEnd($event, true)">
            <section v-for="entry in readerCache" v-show="paneVisible(entry.id)" :key="entry.id" class="reader-pane" :class="{ focused: splitView && stageDoc!.id === entry.id, entering: enteringPane === entry.id, lifted: draggingPanel === `doc:${entry.id}` }" :style="{ order: panelOrder(`doc:${entry.id}`) }" :data-pane-id="entry.id" :data-panel-key="`doc:${entry.id}`" :aria-label="splitView ? `并排阅读：${entry.doc.name}` : undefined" @pointerdown.capture="pointerFocusPane($event, entry.id)" @pointerdown="paneToolbarGrab($event, entry.id)" @focusin="focusPane(entry.id)">
              <KeepAlive>
                <component v-if="paneVisible(entry.id)" :is="entry.doc.kind === 'pdf' ? PdfReader : MarkdownReader" :ref="value => bindReader(entry.id, value)" :key="entry.id" :data="entry.bytes" :document-id="sourceId(entry.id)" :initial-page="entry.doc.page || 1" :initial-progress="entry.doc.progress || 0" :sidebar-fit-enabled="preferences.pdf.fitOnPanelOverflow" :initial-zoom="preferences.pdf.initialZoom === 'fit-width' ? 'fit' : preferences.pdf.initialZoom / 100" :zoom-step="preferences.pdf.zoomStep / 100" :fit-request="fitRequest" :font-size="preferences.markdown.fontSize" :content-width="preferences.markdown.contentWidth" :find-shortcut="preferences.shortcuts.find ? shortcut('find') : ''" :shortcuts="tipKeys" :initial-view="entry.view" :page-layout="preferences.pdf.pageLayout" :cover-alone="preferences.pdf.coverAlone" v-on="entry.events" @page-layout="setPageLayout" />
              </KeepAlive>
              <BookmarkRail v-if="paneVisible(entry.id)" :marks="paneBookmarks(entry.id)" :editing="editingBookmark" @jump="markId => jumpBookmark(entry.id, markId)" @menu="(markId, event) => bookmarkMenu(entry.id, markId, event)" @rename="(markId, name) => finishRename(entry.id, markId, name)" @remove="markId => deleteBookmark(entry.id, markId)" @cancel="editingBookmark = null" />
              <div v-if="tabDoc(entry.id)" class="reading-pill" :class="{ awake: pillAwake[entry.id] || splitView }" :data-tip="splitView ? entry.doc.name : undefined" role="status" :aria-label="`阅读位置自动保存 · ${tabDoc(entry.id)!.kind === 'pdf' ? `第 ${tabDoc(entry.id)!.page || 1} / ${tabDoc(entry.id)!.pageCount || '—'} 页 · ` : ''}已读 ${progressPercent(tabDoc(entry.id)!)}%`">
                <svg class="pill-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="pill-ring-track" cx="12" cy="12" r="9" /><circle class="pill-ring-value" cx="12" cy="12" r="9" pathLength="100" :style="{ strokeDashoffset: 100 - progressPercent(tabDoc(entry.id)!) }" /></svg>
                <span class="pill-text" aria-hidden="true"><span v-if="tabDoc(entry.id)!.kind === 'pdf'" class="pill-page"><b :key="tabDoc(entry.id)!.page || 1">{{ tabDoc(entry.id)!.page || 1 }}</b><i>/</i>{{ tabDoc(entry.id)!.pageCount || '—' }}</span><span v-else class="pill-page"><b :key="progressPercent(tabDoc(entry.id)!)">{{ progressPercent(tabDoc(entry.id)!) }}</b><i>%</i></span></span>
                <button v-if="splitView" class="pill-close" :data-tip="`移出并排`" :aria-label="`关闭并排的 ${entry.doc.name}`" @click.stop="closePane(entry.id)"><AppIcon name="close" :size="11" /></button>
              </div>
            </section>
            <section v-for="id in (multiPanel ? paneIds.filter(id => !readerCache.some(entry => entry.id === id)) : [])" :key="`pending:${id}`" class="reader-pane pending" :style="{ order: panelOrder(`doc:${id}`) }"><div class="reader-overlay"><span class="spinner"></span><p>正在打开 {{ tabDoc(id)?.name }}…</p></div></section>
            <section v-for="panel in stageAi" :key="panel.key" class="ai-panel" :class="{ lifted: draggingPanel === panel.key }" :style="{ order: panelOrder(panel.key), width: `${panel.width}px`, '--panel-width': `${panel.width}px` }" :data-panel-key="panel.key">
              <div class="panel-resizer" :data-edge="panelOrder(panel.key) === 0 && multiPanel ? 'right' : 'left'" role="separator" aria-orientation="vertical" aria-label="拖动调整阅读助手宽度" data-tip="拖动调整宽度，双击恢复" @pointerdown.stop="startWidthDrag($event, panel.key)" @pointermove="moveWidthDrag" @pointerup="endWidthDrag" @pointercancel="endWidthDrag" @dblclick="panel.width = 380" />
              <AiPane v-if="aiDocument(panel)" :ref="value => bindAi(panel.key, value)" data-glass-interactive="panel" :document="aiDocument(panel)!" :context="aiContext(panel)" :conversation-id="panel.conversation" :draggable="multiPanel" :send-shortcut="preferences.shortcuts.aiSend ? shortcut('aiSend') : ''" :consume-capture="consumeSelection" @settings="openSettings('ai')" @close="closeAiPanel(panel.key)" @jump="jump" @clear-selection="clearSelection" @conversation="id => setPanelConversation(panel.key, id)" @grab="startPanelDrag($event, panel.key)" :alternatives="aiAlternatives(panel)" :library="libraryIndex" @switch-document="id => switchAiDocument(panel, id)" @open-conversation="openConversationAt" />
            </section>
          </TransitionGroup>
          <div v-if="selection && !captureQuick && !aiOpen && selection.image" class="selection-context"><AppIcon name="crop" :size="16" /><span>{{ selection.image ? `已框选第 ${selection.page} 页的图表或公式` : `已选择 ${selection.text.length} 个字符` }}</span><button @click="openAssistant(true)"><AppIcon name="sparkle" :size="15" />向 AI 提问</button><button class="icon-button" @click="clearSelection" data-tip="清除选区" aria-label="清除选区"><AppIcon name="close" :size="14" /></button></div>
        </section>
        <Transition name="pane" @before-enter="paneResizeStart($event, true)" @before-leave="paneResizeStart($event, false)" @after-enter="paneResizeEnd" @after-leave="paneResizeEnd" @enter-cancelled="paneResizeEnd($event, true)" @leave-cancelled="paneResizeEnd($event, true)">
          <aside v-if="detailsOpen && active" class="document-details pane-shell"><div class="details-heading"><h3>文档详情</h3><button class="icon-button" @click="detailsOpen = false" data-tip="关闭文档详情" aria-label="关闭文档详情"><AppIcon name="close" :size="17" /></button></div><div class="detail-icon"><AppIcon :name="active.kind === 'pdf' ? 'file' : 'markdown'" :size="30" /></div><h4>{{ stageDoc!.name }}</h4><dl><dt>格式</dt><dd>{{ active.kind === 'pdf' ? 'PDF' : 'Markdown' }}</dd><dt>文件大小</dt><dd>{{ size(active.size) }}</dd><dt>加入时间</dt><dd>{{ date(active.addedAt) }}</dd><dt>文件位置</dt><dd class="detail-path">{{ active.path }}</dd></dl><p class="eyebrow">标签</p><div class="editable-tags"><span v-for="tag in active.tags" :key="tag">{{ tag }}<button @click="removeTag(tag)" :data-tip="`移除标签 ${tag}`" :aria-label="`移除标签 ${tag}`"><AppIcon name="close" :size="12" /></button></span></div><form class="add-tag" @submit.prevent="addTag"><input v-model="tagInput" placeholder="添加标签" maxlength="40" /><button :disabled="!tagInput.trim()" data-tip="添加标签" aria-label="添加标签"><AppIcon name="plus" :size="16" /></button></form><button class="remove-document" @click="removeTarget = active"><AppIcon name="trash" :size="16" />从文档库移除</button></aside>
        </Transition>
      </div>
      </Transition>
    </main>

    <ContextMenu v-if="contextMenu" :x="contextMenu.x" :y="contextMenu.y" :items="contextMenu.items" @close="contextMenu = undefined" />
    <div v-if="tabDrop" class="tab-drop-zone" :style="{ left: `${tabDrop.left}px`, top: `${tabDrop.top}px`, width: `${tabDrop.width}px`, height: `${tabDrop.height}px` }"><span>{{ tabDrop.side === 'left' ? '放在左侧' : '放在右侧' }}</span></div>
    <SplitPicker v-if="splitPicker && active" :anchor="splitPicker" :candidates="splitCandidates" :full="paneIds.length >= MAX_PANES" :limit="MAX_PANES" @pick="openBeside" @close="splitPicker = undefined" />
    <Transition name="capture-focus"><CaptureQuickPrompt v-if="captureQuick && !settingsOpen" :frame="captureQuick.frame" :prompts="preferences.assistant.captureQuestions" :busy="captureQuickBusy" :status="captureQuickStatus" @ask="askCaptureQuick" @continue="continueCaptureQuick" @cancel="dismissCaptureQuick()" /></Transition>
    <div v-if="draggingFiles" class="file-drop-overlay" aria-live="polite"><div class="file-drop-target"><AppIcon name="plus" :size="32" /><strong>加入文档库</strong><span>松开以加入 PDF / Markdown 文档</span></div></div>
    <button v-if="selectionAction && selection?.text && !aiOpen && active" class="selection-ask" :style="{ left: selectionAction.left + 'px', top: selectionAction.top + 'px' }" @mousedown.prevent @click="openAssistant(true)" aria-label="用所选文字向 AI 提问"><AppIcon name="sparkle" :size="14" />问 AI</button>
    <UpdateCard v-if="!settingsOpen" />
    <TransitionGroup tag="div" name="notice" class="notice-stack" aria-live="polite">
      <div v-for="notice in notices" :key="notice.id" class="answer-notice" role="status" @pointerenter="holdNotice(notice.id, true)" @pointerleave="holdNotice(notice.id, false)">
        <span class="notice-mark" aria-hidden="true"><AppIcon name="check" :size="13" /></span>
        <button class="notice-body" @click="openNotice(notice)"><strong>{{ notice.title }}</strong><small>已回答完 · {{ notice.documentTitle.replace(/\.(pdf|md|markdown)$/i, '') }}</small></button>
        <button class="notice-close" aria-label="关闭提示" @click="dismissNotice(notice.id)"><AppIcon name="close" :size="12" /></button>
      </div>
    </TransitionGroup>
    <Transition name="toast"><div v-if="toast" class="toast-message" role="status"><span>{{ toast }}</span><button @click="toast = ''" data-tip="关闭提示" aria-label="关闭提示"><AppIcon name="close" :size="15" /></button></div></Transition>
    <Transition name="dialog">
      <div v-if="removeTarget" class="dialog-backdrop" @click.self="removeTarget = null"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-title"><div class="dialog-icon"><AppIcon name="trash" :size="24" /></div><h2 id="remove-title">从文档库移除？</h2><p>「{{ removeTarget.name }}」的阅读记录与标签会被移除，原文件仍保留在电脑上。</p><div class="dialog-actions"><button @click="removeTarget = null">取消</button><button class="danger-button" @click="removeDocument">移除文档</button></div></section></div>
    </Transition>
    <Transition name="settings-pop">
      <SettingsDialog v-if="settingsOpen" :initial-tab="settingsTab" @close="settingsOpen = false" @ai-saved="aiSettingsSaved" />
    </Transition>
  </div>
</template>
