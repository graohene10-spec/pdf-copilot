<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent, toRaw } from 'vue'
import { library, isDesktop } from './sdk'
import type { Doc } from './sdk/types'
import AppIcon from './components/AppIcon.vue'
import FileTabs from './components/FileTabs.vue'
import { chatPhase, closeChat, closeAllChats, configureRequests, stopChat } from './ai/workspace'
import { forgetPassword, forgetAllPasswords } from './document/passwords.mjs'
import { useSettings, matchShortcut, shortcutLabel } from './settings'
import { installGlassContrast } from './ui/glass-contrast'
import { floatLeavingPanel, restoreLeavingPanel } from './ui/panel-transition'
const PdfReader = defineAsyncComponent(() => import('./components/PdfReader.vue'))
const MarkdownReader = defineAsyncComponent(() => import('./components/MarkdownReader.vue'))
const AiPane = defineAsyncComponent(() => import('./components/AiPane.vue'))
const SettingsDialog = defineAsyncComponent(() => import('./components/SettingsDialog.vue'))
const { preferences, effectiveAppearance, load: loadPreferences, save: savePreferences } = useSettings()

const documents = ref<Doc[]>([])
type OpenTab = { doc: Doc; view?: any; selection?: { text: string; page: number; image?: string; rect?: any } }
const tabs = ref<OpenTab[]>([])
const active = ref<Doc | null>(null)
const currentTab = computed(() => tabs.value.find(tab => tab.doc.id === active.value?.id))
const fileTabs = computed(() => tabs.value.map(tab => ({ id: tab.doc.id, name: tab.doc.name, kind: tab.doc.kind, phase: chatPhase(tab.doc.id) })))
const initialView = shallowRef<any>()
const readerEvents = shallowRef<Record<string, (...args: any[]) => void>>({})
const selectionAction = ref<{ left: number; top: number }>()
const data = shallowRef<Uint8Array>()
const selection = shallowRef<{ text: string; page: number; image?: string; rect?: any }>()
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
async function importDocuments() {
  if (importing.value) return
  importing.value = true
  try {
    const imported = await library.importDocuments()
    if (!imported.length) return
    query.value = ''; await refresh()
    notify(`已加入 ${imported.length} 份文档`)
    for (const doc of imported) if (!tabs.value.some(tab => tab.doc.id === doc.id)) tabs.value.push({ doc })
    await openDocument(imported[0])
  } catch (error) { notify(`导入失败：${reason(error)}`) }
  finally { importing.value = false }
}
async function flushProgress() {
  clearTimeout(progressTimer)
  const pending = [...pendingProgress]; pendingProgress.clear()
  await Promise.all(pending.map(([id, patch]) => {
    const write = (progressWrites.get(id) || Promise.resolve()).then(async () => {
      try { updateLocal(await library.update(id, patch)) }
      catch (error) { notify(`阅读位置保存失败：${reason(error)}`) }
    })
    progressWrites.set(id, write)
    void write.finally(() => { if (progressWrites.get(id) === write) progressWrites.delete(id) })
    return write
  }))
}
function rememberReader() {
  const tab = currentTab.value
  if (tab) { tab.view = reader.value?.getViewState?.() || tab.view; tab.selection = selection.value }
  selectionAction.value = undefined
  window.getSelection()?.removeAllRanges()
}
async function openDocument(doc: Doc) {
  if (active.value?.id === doc.id) return
  rememberReader()
  const epoch = ++openEpoch
  void flushProgress()
  let tab = tabs.value.find(tab => tab.doc.id === doc.id)
  if (!tab) { tab = { doc }; tabs.value.push(tab) }
  active.value = tab.doc; initialView.value = tab.view; selection.value = tab.selection
  data.value = undefined
  opening.value = true; detailsOpen.value = false
  readerEvents.value = {
    progress: value => { if (epoch === openEpoch) readingProgress(doc.id, value) },
    selection: value => { if (epoch === openEpoch) selectedContext(value) },
    text: value => indexText(doc.id, value),
    error: message => { if (epoch === openEpoch) notify(message) },
  }
  try {
    const bytes = await library.read(doc.id)
    if (epoch !== openEpoch) return
    data.value = bytes
    const updated = await library.update(doc.id, { lastOpenedAt: Date.now() })
    if (tabs.value.includes(tab)) updateLocal(updated)
  } catch (error) { if (epoch === openEpoch) { notify(`无法打开文档：${reason(error)}`); closeTab(doc.id) } }
  finally { if (epoch === openEpoch) opening.value = false }
}
function closeReader() { rememberReader(); ++openEpoch; void flushProgress(); active.value = null; data.value = undefined; selection.value = undefined; detailsOpen.value = false; void refresh() }
function selectTab(id: string) { const tab = tabs.value.find(tab => tab.doc.id === id); if (tab) void openDocument(tab.doc) }
function closeTab(id: string) {
  const index = tabs.value.findIndex(tab => tab.doc.id === id)
  if (index < 0) return
  const selected = active.value?.id === id
  if (selected) closeReader()
  closeChat(id); forgetPassword(id); tabs.value.splice(index, 1)
  if (selected && tabs.value.length) selectTab(tabs.value[Math.min(index, tabs.value.length - 1)].doc.id)
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
  selection.value = value
  if (currentTab.value) currentTab.value.selection = value
  if (value?.image) {
    selectionAction.value = undefined
    if (preferences.value.pdf.openAssistantOnCapture) openAssistant(true)
  } else if (value?.text) {
    const native = window.getSelection()
    const rect = native?.rangeCount ? native.getRangeAt(0).getBoundingClientRect() : null
    if (rect?.width) selectionAction.value = { left: Math.max(8, Math.min(window.innerWidth - 88, rect.right - 70)), top: Math.max(8, Math.min(window.innerHeight - 40, rect.bottom + 5)) }
  }
}
function selectionChanged() { if (window.getSelection()?.isCollapsed) selectionAction.value = undefined }
function dismissSelectionAction() { selectionAction.value = undefined }
async function toggleStar(doc: Doc) {
  try { updateLocal(await library.update(doc.id, { starred: !doc.starred })) }
  catch (error) { notify(reason(error)) }
}
function readingProgress(id: string, value: { page: number; pageCount: number; progress: number }) {
  if (active.value?.id !== id || !value.pageCount) return
  const patch = { page: value.page, pageCount: value.pageCount, progress: value.progress }
  active.value = { ...active.value, ...patch }
  const local = documents.value.find(doc => doc.id === active.value!.id)
  if (local) Object.assign(local, patch)
  if (currentTab.value) currentTab.value.doc = active.value
  pendingProgress.set(id, patch)
  clearTimeout(progressTimer); progressTimer = setTimeout(flushProgress, 800)
}
function indexText(id: string, text: string) {
  clearTimeout(indexTimers.get(id))
  indexTimers.set(id, setTimeout(() => { indexTimers.delete(id); void library.index(id, text.slice(0, 2000000)).catch(error => notify(`搜索索引更新失败：${reason(error)}`)) }, 1200))
}
function clearSelection() { selection.value = undefined; selectionAction.value = undefined; if (currentTab.value) currentTab.value.selection = undefined; window.getSelection()?.removeAllRanges(); reader.value?.clearSelection?.() }
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
async function toggleTheme() {
  try { await savePreferences({ ...preferences.value, appearance: { ...preferences.value.appearance, theme: theme.value === 'dark' ? 'light' : 'dark' } }) }
  catch (error) { notify(reason(error)) }
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
  if (active.value?.kind === 'pdf' && !window.matchMedia('(max-width: 720px)').matches) reader.value?.holdPanelResize?.(true)
}, { flush: 'sync' })
function paneResizeStart(element: Element, entering: boolean) {
  resizingPanels.set(element, entering)
  if (active.value?.kind === 'pdf' && !window.matchMedia('(max-width: 720px)').matches) reader.value?.holdPanelResize?.(true, entering)
  if (entering) restoreLeavingPanel(element)
  else floatLeavingPanel(element, element.classList.contains('app-sidebar') ? 'left' : 'right')
}
function paneResizeEnd(element: Element, cancelled = false) {
  restoreLeavingPanel(element)
  if (resizingPanels.get(element) && !cancelled) fitAfterPanelResize = true
  resizingPanels.delete(element)
  if (!resizingPanels.size) {
    if (active.value?.kind === 'pdf') {
      const target = reader.value
      if (target?.holdPanelResize) target.holdPanelResize(false, fitAfterPanelResize)
      else if (fitAfterPanelResize) fitRequest.value++
    }
    fitAfterPanelResize = false
  }
}
function openSettings(tab: typeof settingsTab.value = 'appearance') { settingsTab.value = tab; settingsOpen.value = true }
function aiSettingsSaved(value: any) { configureRequests(value); assistant.value?.applySettings?.(value) }
function shortcut(action: keyof typeof preferences.value.shortcuts) { return shortcutLabel(preferences.value.shortcuts[action]) }
watch(effectiveAppearance, () => { applyTheme(); display.value = effectiveAppearance.value.libraryView }, { immediate: true })
// A tab may mount its reader while several panels are still transitioning.
watch(reader, value => {
  if (active.value?.kind === 'pdf' && resizingPanels.size && !window.matchMedia('(max-width: 720px)').matches) value?.holdPanelResize?.(true)
})
watch(search, value => {
  if (value && focusSearchPending) { value.focus(); focusSearchPending = false }
})
watch(assistant, async value => {
  if (value && aiOpen.value && focusAssistantPending) { value.focusPrompt?.(); focusAssistantPending = false }
})
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') { settingsOpen.value = false; detailsOpen.value = false; removeTarget.value = null; return }
  if (settingsOpen.value || removeTarget.value || event.defaultPrevented) return
  let action = matchShortcut(event, preferences.value)
  if (!action && active.value) {
    const candidate = matchShortcut(event, preferences.value, { scope: 'ai' })
    if (candidate === 'aiStop' || (aiOpen.value && event.target instanceof Element && event.target.closest('.ai-pane'))) action = candidate
  }
  if (!action) return
  if (event.repeat && !['zoomIn', 'zoomOut', 'previousPage', 'nextPage'].includes(action)) return
  if (['outline', 'fitWidth', 'zoomOut', 'zoomIn', 'previousPage', 'nextPage', 'capture'].includes(action) && !active.value) return
  if (['capture', 'fitWidth'].includes(action) && active.value?.kind !== 'pdf') return
  event.preventDefault()
  switch (action) {
    case 'import': void importDocuments(); break
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
onMounted(async () => {
  glassContrast = installGlassContrast(document.getElementById('app')!)
  glassContrast.setBackground(appliedBackground ?? null)
  document.addEventListener('keydown', keydown)
  document.addEventListener('selectionchange', selectionChanged)
  document.addEventListener('scroll', dismissSelectionAction, true)
  window.addEventListener('resize', dismissSelectionAction)
  systemTheme.addEventListener('change', applyTheme)
  try { await loadPreferences() } catch (error) { notify(`设置加载失败：${reason(error)}`) }
  await refresh()
})
onBeforeUnmount(() => { glassContrast?.dispose(); document.removeEventListener('keydown', keydown); document.removeEventListener('selectionchange', selectionChanged); document.removeEventListener('scroll', dismissSelectionAction, true); window.removeEventListener('resize', dismissSelectionAction); closeAllChats(); forgetAllPasswords(); systemTheme.removeEventListener('change', applyTheme); flushProgress(); for (const timer of indexTimers.values()) clearTimeout(timer); clearTimeout(queryTimer); clearTimeout(toastTimer) })
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': !sidebarOpen, 'has-reader': active }">
    <Transition name="sidebar" @before-enter="paneResizeStart($event, true)" @before-leave="paneResizeStart($event, false)" @after-enter="paneResizeEnd" @after-leave="paneResizeEnd" @enter-cancelled="paneResizeEnd($event, true)" @leave-cancelled="paneResizeEnd($event, true)">
    <aside class="app-sidebar" v-if="sidebarOpen" data-glass-interactive="panel">
      <button class="brand" @click="chooseCategory('all')" aria-label="返回文档库"><span class="brand-symbol"><AppIcon name="book" :size="22" /></span><span>开智</span></button>
      <button class="import-button" @click="importDocuments" :disabled="importing" aria-label="加入文档"><AppIcon name="plus" :size="18" />{{ importing ? '正在导入…' : '加入文档' }}<kbd v-if="preferences.shortcuts.import">{{ shortcut('import') }}</kbd></button>
      <nav class="workspace-nav" aria-label="文档分类">
        <button :class="{ selected: category === 'all' && !tagFilter }" @click="chooseCategory('all')"><AppIcon name="library" :size="18" />全部文档<span>{{ documents.length }}</span></button>
        <button :class="{ selected: category === 'recent' }" @click="chooseCategory('recent')"><AppIcon name="clock" :size="18" />最近阅读</button>
        <button :class="{ selected: category === 'starred' }" @click="chooseCategory('starred')"><AppIcon name="star" :size="18" />我的收藏<span>{{ starredCount }}</span></button>
      </nav>
      <div class="tag-heading"><p class="sidebar-label">标签</p><AppIcon name="tag" :size="14" /></div>
      <nav class="tag-nav" aria-label="文档标签"><button v-for="tag in tags" :key="tag" :class="{ selected: tagFilter === tag }" @click="chooseTag(tag)"><span class="tag-dot"></span>{{ tag }}<span>{{ documents.filter(doc => doc.tags.includes(tag)).length }}</span></button><p v-if="!tags.length" class="tag-empty">可在文档详情中添加标签。</p></nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-bottom"><button @click="openSettings()" aria-label="设置"><AppIcon name="settings" :size="17" /><span>设置</span></button><button class="icon-button" @click="toggleTheme" :title="theme === 'dark' ? '切换浅色主题' : '切换深色主题'"><AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="17" /></button></div>
    </aside>
    </Transition>

    <main class="app-main">
      <header class="app-topbar" :class="{ 'with-tabs': tabs.length }" data-glass-interactive="panel">
        <button class="icon-button sidebar-toggle" @click="sidebarOpen = !sidebarOpen" title="切换侧栏" aria-label="切换侧栏" :aria-expanded="sidebarOpen"><AppIcon name="panel" :size="18" /></button>
        <FileTabs v-if="tabs.length" :tabs="fileTabs" :active-id="active?.id" @select="selectTab" @close="closeTab" @library="closeReader" />
        <span v-else class="breadcrumb">{{ currentTitle }}</span>
        <div class="topbar-actions"><template v-if="active"><button class="icon-button" :class="{ 'is-starred': active.starred }" @click="toggleStar(active)" title="收藏文档"><AppIcon name="star" :size="18" /></button><button class="icon-button" :class="{ active: detailsOpen }" @click="detailsOpen = !detailsOpen" title="文档详情与标签" :aria-expanded="detailsOpen"><AppIcon name="tag" :size="18" /></button><button class="ai-toggle" :class="{ active: aiOpen }" @click="aiOpen ? aiOpen = false : openAssistant(true)" :aria-expanded="aiOpen"><AppIcon name="sparkle" :size="17" />阅读助手</button></template><button v-else class="icon-button" @click="toggleTheme" :title="theme === 'dark' ? '切换浅色主题' : '切换深色主题'"><AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" /></button><button class="icon-button" @click="openSettings()" title="设置" aria-label="打开设置"><AppIcon name="settings" :size="18" /></button></div>
      </header>

      <Transition name="view" mode="out-in">
      <div v-if="!active" class="library-view" key="library">
        <div class="library-search"><AppIcon name="search" :size="17" /><input ref="search" v-model="query" @input="searchDocuments" placeholder="搜索标题、标签或已索引内容" aria-label="搜索文档" /><button v-if="query" @click="query = ''; refresh()" title="清空搜索"><AppIcon name="close" :size="14" /></button><kbd v-else-if="preferences.shortcuts.search">{{ shortcut('search') }}</kbd></div>
        <div class="library-heading"><h1>{{ currentTitle }}<span class="heading-count">{{ visibleDocuments.length }}</span></h1></div>
        <div class="library-summary"><div><AppIcon name="book" :size="18" /><strong>{{ documents.length }}</strong><span>份文档</span></div><span class="summary-divider"></span><div><AppIcon name="star" :size="17" /><strong>{{ starredCount }}</strong><span>份收藏</span></div><span class="summary-divider"></span><div><strong>{{ totalPages }}</strong><span>页已打开文档</span></div><span v-if="!isDesktop" class="summary-note">浏览器预览</span></div>
        <div class="library-list-heading"><span>{{ query ? `搜索「${query}」` : category === 'recent' ? '按最近阅读排列' : '' }}</span><div class="view-switch"><button :class="{ selected: display === 'grid' }" @click="setDisplay('grid')" title="卡片视图"><AppIcon name="grid" :size="16" /></button><button :class="{ selected: display === 'list' }" @click="setDisplay('list')" title="列表视图"><AppIcon name="list" :size="17" /></button></div></div>
        <div v-if="loading" class="library-empty"><span class="spinner"></span><p>正在读取文档库…</p></div>
        <div v-else-if="!visibleDocuments.length" class="library-empty"><div class="empty-art"><AppIcon name="book" :size="42" /></div><h2>{{ query ? '没有匹配的文档' : category === 'starred' ? '暂无收藏' : tagFilter ? '此标签下暂无文档' : '暂无文档' }}</h2><p>{{ query ? '可搜索标题、标签和已读取的文档内容。' : '点击“加入文档”添加 PDF 或 Markdown，可一次选择多个文件。' }}</p><button v-if="query" @click="query = ''; refresh()">查看全部文档</button><small>导入不会移动或修改原文件</small></div>
        <div v-else class="document-collection" :class="display">
          <article v-for="doc in visibleDocuments" :key="doc.id" class="document-card" :class="doc.kind" tabindex="0" role="button" :aria-label="`打开 ${doc.name}`" @click="openDocument(doc)" @keydown.enter="openDocument(doc)">
            <div class="document-cover"><div class="cover-lines"><i></i><i></i><i></i><i></i></div><div class="document-type-icon"><AppIcon :name="doc.kind === 'pdf' ? 'file' : 'markdown'" :size="display === 'list' ? 23 : 30" /></div><button class="card-star" :class="{ 'is-starred': doc.starred }" @click.stop="toggleStar(doc)" :title="doc.starred ? '取消收藏' : '收藏文档'"><AppIcon name="star" :size="17" /></button></div>
            <div class="document-card-body"><div class="document-card-title"><h3 :title="doc.name">{{ doc.name.replace(/\.(pdf|md|markdown)$/i, '') }}</h3><span class="format-pill">{{ doc.kind === 'pdf' ? 'PDF' : 'MD' }}</span></div><p class="document-meta">{{ size(doc.size) }}<span>·</span>{{ doc.lastOpenedAt ? `阅读于 ${date(doc.lastOpenedAt)}` : `加入于 ${date(doc.addedAt)}` }}</p><div class="document-tags"><span v-for="tag in doc.tags.slice(0, 3)" :key="tag">{{ tag }}</span><span v-if="doc.tags.length > 3">+{{ doc.tags.length - 3 }}</span></div><div class="document-progress"><div><i :style="{ width: `${progressPercent(doc)}%` }"></i></div><span>{{ doc.progress ? `${progressPercent(doc)}%` : '未读' }}</span></div></div>
            <button class="card-remove icon-button" @click.stop="removeTarget = doc" title="从文档库移除"><AppIcon name="trash" :size="15" /></button>
          </article>
        </div>
      </div>

      <div v-else class="reading-workspace">
        <section class="reading-main">
          <div v-if="opening" class="reader-overlay"><span class="spinner"></span><p>正在打开 {{ active.name }}…</p></div>
          <PdfReader v-else-if="data && active.kind === 'pdf'" ref="reader" :key="active.id" :data="data" :document-id="active.id" :initial-page="active.page || 1" :sidebar-fit-enabled="preferences.pdf.fitOnPanelOverflow" :initial-zoom="preferences.pdf.initialZoom === 'fit-width' ? 'fit' : preferences.pdf.initialZoom / 100" :zoom-step="preferences.pdf.zoomStep / 100" :fit-request="fitRequest" :initial-view="initialView" v-on="readerEvents" />
          <MarkdownReader v-else-if="data" ref="reader" :key="active.id" :data="data" :document-id="active.id" :initial-progress="active.progress || 0" :font-size="preferences.markdown.fontSize" :content-width="preferences.markdown.contentWidth" @font-size-change="setMarkdownFontSize" :initial-view="initialView" v-on="readerEvents" />
          <div v-if="selection && !aiOpen && selection.image" class="selection-context"><AppIcon name="crop" :size="16" /><span>{{ selection.image ? `已框选第 ${selection.page} 页的图表或公式` : `已选择 ${selection.text.length} 个字符` }}</span><button @click="openAssistant(true)"><AppIcon name="sparkle" :size="15" />向 AI 提问</button><button class="icon-button" @click="clearSelection" title="清除选区"><AppIcon name="close" :size="14" /></button></div>
          <footer class="reading-status"><span><span class="status-dot"></span>阅读位置自动保存</span><span>{{ active.kind === 'pdf' ? `第 ${active.page || 1} / ${active.pageCount || '—'} 页` : 'Markdown 文档' }}<span class="status-divider">·</span>{{ progressPercent(active) }}%</span></footer>
        </section>
        <Transition name="pane" @before-enter="paneResizeStart($event, true)" @before-leave="paneResizeStart($event, false)" @after-enter="paneResizeEnd" @after-leave="paneResizeEnd" @enter-cancelled="paneResizeEnd($event, true)" @leave-cancelled="paneResizeEnd($event, true)">
          <AiPane v-if="aiOpen && aiDocument" ref="assistant" class="pane-shell" data-glass-interactive="panel" :document="aiDocument" :context="aiContext" :send-shortcut="preferences.shortcuts.aiSend ? shortcut('aiSend') : ''" :consume-capture="consumeSelection" @settings="openSettings('ai')" @close="aiOpen = false" @jump="jump" @clear-selection="clearSelection" />
        </Transition>
        <Transition name="pane" @before-enter="paneResizeStart($event, true)" @before-leave="paneResizeStart($event, false)" @after-enter="paneResizeEnd" @after-leave="paneResizeEnd" @enter-cancelled="paneResizeEnd($event, true)" @leave-cancelled="paneResizeEnd($event, true)">
          <aside v-if="detailsOpen" class="document-details pane-shell"><div class="details-heading"><h3>文档详情</h3><button class="icon-button" @click="detailsOpen = false" title="关闭文档详情"><AppIcon name="close" :size="17" /></button></div><div class="detail-icon"><AppIcon :name="active.kind === 'pdf' ? 'file' : 'markdown'" :size="30" /></div><h4>{{ active.name }}</h4><dl><dt>格式</dt><dd>{{ active.kind === 'pdf' ? 'PDF' : 'Markdown' }}</dd><dt>文件大小</dt><dd>{{ size(active.size) }}</dd><dt>加入时间</dt><dd>{{ date(active.addedAt) }}</dd><dt>文件位置</dt><dd class="detail-path">{{ active.path }}</dd></dl><p class="eyebrow">标签</p><div class="editable-tags"><span v-for="tag in active.tags" :key="tag">{{ tag }}<button @click="removeTag(tag)" :title="`移除标签 ${tag}`"><AppIcon name="close" :size="12" /></button></span></div><form class="add-tag" @submit.prevent="addTag"><input v-model="tagInput" placeholder="添加标签" maxlength="40" /><button :disabled="!tagInput.trim()" title="添加标签"><AppIcon name="plus" :size="16" /></button></form><button class="remove-document" @click="removeTarget = active"><AppIcon name="trash" :size="16" />从文档库移除</button></aside>
        </Transition>
      </div>
      </Transition>
    </main>

    <button v-if="selectionAction && selection?.text && !aiOpen && active" class="selection-ask" :style="{ left: selectionAction.left + 'px', top: selectionAction.top + 'px' }" @mousedown.prevent @click="openAssistant(true)" aria-label="用所选文字向 AI 提问"><AppIcon name="sparkle" :size="14" />问 AI</button>
    <Transition name="toast"><div v-if="toast" class="toast-message" role="status"><span>{{ toast }}</span><button @click="toast = ''" title="关闭提示"><AppIcon name="close" :size="15" /></button></div></Transition>
    <Transition name="dialog">
      <div v-if="removeTarget" class="dialog-backdrop" @click.self="removeTarget = null"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-title"><div class="dialog-icon"><AppIcon name="trash" :size="24" /></div><h2 id="remove-title">从文档库移除？</h2><p>「{{ removeTarget.name }}」的阅读记录与标签会被移除，原文件仍保留在电脑上。</p><div class="dialog-actions"><button @click="removeTarget = null">取消</button><button class="danger-button" @click="removeDocument">移除文档</button></div></section></div>
    </Transition>
    <Transition name="settings-pop">
      <SettingsDialog v-if="settingsOpen" :initial-tab="settingsTab" @close="settingsOpen = false" @ai-saved="aiSettingsSaved" />
    </Transition>
  </div>
</template>
