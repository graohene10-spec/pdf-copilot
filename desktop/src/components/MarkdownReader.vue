<script setup lang="ts">
import { ref, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount, nextTick } from 'vue'
import MarkdownIt from 'markdown-it'
import 'katex/dist/katex.min.css'
import { installMarkdownMath } from './markdown-math'
import { installGithubFlavor } from './markdown-github'
import { installCjkEmphasis } from './markdown-cjk'
import { library } from '../sdk'
import { clampMarkdownFontSize, clampMarkdownContentWidth, clampMarkdownZoom, readingScrollTarget } from '../reader/layout.mjs'
import { markdownTextIndex, markdownSearchRanges, markdownSearchHighlighter } from '../reader/markdown-search'
import { rectangleSelector } from '../../../extension/reader/selection.mjs'
import { regionText, captureRegion } from '../reader/markdown-capture'
import { usePdfInk } from '../reader/ink/use-ink'
import AppIcon from './AppIcon.vue'
import ReaderSearch from './ReaderSearch.vue'
import InkButton from './ink/InkButton.vue'
import InkPalette from './ink/InkPalette.vue'

const props = withDefaults(defineProps<{ data: Uint8Array; documentId: string; initialProgress?: number; fontSize?: number; contentWidth?: number; findShortcut?: string; shortcuts?: Record<string, string>; zoomStep?: number; initialView?: { progress: number; raw: boolean; outlineOpen: boolean; fontSize: number; zoom?: number; search?: { query: string; current: number } } }>(), { initialProgress: 0, fontSize: 17, contentWidth: 820, findShortcut: 'Ctrl + F', zoomStep: .1 })
const emit = defineEmits<{
  ready: [value: { text: string; headings: { title: string; id: string; level: number }[] }]
  progress: [value: { page: number; pageCount: number; progress: number }]
  selection: [value: { text: string; page: number; image?: string; rect?: MarkdownRect; captureFrame?: { left: number; top: number; width: number; height: number } }]
  text: [value: string]
  error: [value: string]
  fontSizeChange: [value: number]
}>()
/** A framed region in the article's own (unzoomed) CSS pixels. */
type MarkdownRect = { space: 'markdown'; x: number; y: number; width: number; height: number }
const content = ref('')
const error = ref('')
const body = ref<HTMLElement>()
const scroll = ref<HTMLElement>()
const stage = ref<HTMLElement>()
// 整页缩放（Ctrl + 滚轮、Ctrl + = / -）：文字、图片、公式、表格与版心宽度一起放大，窄窗口里像浏览器缩放那样重新折行。
const zoom = ref(clampMarkdownZoom(props.initialView?.zoom ?? 1))
const capture = ref(false)
const outlineOpen = ref(props.initialView?.outlineOpen || false)
const headings = ref<{ title: string; id: string; level: number }[]>([])
const displayFontSize = ref(clampMarkdownFontSize(props.initialView?.fontSize || props.fontSize))
const raw = ref(props.initialView?.raw || false)
let rendered = false
let urls: string[] = []
let epoch = 0
let totalLines = 1
let currentLine = 1
let active = true
let activation = 0
let sourceText = ''
let cachedProgress = props.initialView?.progress ?? props.initialProgress
const searchControl = ref<InstanceType<typeof ReaderSearch>>()
const searchQuery = ref(props.initialView?.search?.query || '')
const searchCurrent = ref(Math.max(0, props.initialView?.search?.current || 0))
const searchTotal = ref(0)
const searchBusy = ref(false)
const searchStatus = ref('')
const searchHighlighter = markdownSearchHighlighter()
let searchRanges: Range[] = []
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchPending = false
let searchIndex: ReturnType<typeof markdownTextIndex> | undefined
const transientMarkers = new Set<() => void>()
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true })
installMarkdownMath(markdown)
installGithubFlavor(markdown)
installCjkEmphasis(markdown)
function selectedText() {
  if (!active) return
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !body.value?.contains(selection.anchorNode)) return
  const text = selection.toString().trim().slice(0, 16000)
  const source = selection.anchorNode?.parentElement?.closest('[data-source-line]')
  if (text) emit('selection', { text, page: Number(source?.getAttribute('data-source-line')) || 1 })
}
function scrolled() { progress(); if (ink.state.enabled) inkSchedule() }
function progress() {
  if (!active || !scroll.value) return
  const max = scroll.value.scrollHeight - scroll.value.clientHeight
  const blocks = body.value?.querySelectorAll<HTMLElement>('[data-source-line]') || []
  const top = scroll.value.getBoundingClientRect().top + 20
  let line = 1
  for (const block of blocks) { if (block.getBoundingClientRect().top <= top) line = Number(block.dataset.sourceLine) || line; else break }
  if (raw.value) line = Math.max(1, Math.round((scroll.value.scrollTop / Math.max(1, max)) * (totalLines - 1)) + 1)
  currentLine = line
  emit('progress', { page: line, pageCount: totalLines, progress: max > 0 ? Math.min(1, scroll.value.scrollTop / max) : 1 })
}
/** `around`: the screen point that stays put (the cursor for Ctrl + wheel); otherwise the top of the view. */
async function setZoom(value: number, around?: { x: number; y: number }) {
  const next = clampMarkdownZoom(value)
  const view = scroll.value, article = body.value
  if (Math.abs(next - zoom.value) < .0001) return
  if (!view || !article || !active) { zoom.value = next; return }
  const box = view.getBoundingClientRect(), before = article.getBoundingClientRect(), previous = zoom.value
  const anchor = around && around.y >= box.top && around.y <= box.bottom ? around : { x: box.left + view.clientWidth / 2, y: box.top + 24 }
  // The point of the article under the anchor, in unzoomed article pixels.
  const ax = (anchor.x - before.left) / previous, ay = (anchor.y - before.top) / previous
  zoom.value = next
  await nextTick()
  const after = article.getBoundingClientRect()
  view.scrollLeft += after.left + ax * next - anchor.x
  view.scrollTop += after.top + ay * next - anchor.y
  inkSchedule()
  progress()
}
const zoomIn = (around?: { x: number; y: number }) => setZoom(Math.round((zoom.value + Math.max(.05, Math.min(.5, props.zoomStep))) * 100) / 100, around)
const zoomOut = (around?: { x: number; y: number }) => setZoom(Math.round((zoom.value - Math.max(.05, Math.min(.5, props.zoomStep))) * 100) / 100, around)
const resetZoom = () => setZoom(1)
function toggleOutline() { outlineOpen.value = !outlineOpen.value }
function movePosition(direction: number) {
  if (!scroll.value) return
  const view = scroll.value
  view.scrollTo({ top: readingScrollTarget(view.scrollTop, view.clientHeight, view.scrollHeight, direction), behavior: 'smooth' })
}
function nextPage() { movePosition(1) }
function previousPage() { movePosition(-1) }
function goToHeading(id: string) {
  const heading = body.value?.querySelector(`[id="${CSS.escape(id)}"]`)
  heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function goToPage(line: number) {
  if (!scroll.value || !body.value) return
  if (raw.value) { scroll.value.scrollTo({ top: (scroll.value.scrollHeight - scroll.value.clientHeight) * (Math.max(1, line) - 1) / Math.max(1, totalLines - 1), behavior: 'smooth' }); return }
  const blocks = [...body.value.querySelectorAll<HTMLElement>('[data-source-line]')]
  const target = blocks.filter(block => Number(block.dataset.sourceLine) <= line).at(-1) || blocks[0]
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  target?.classList.add('source-highlight')
  const timer = setTimeout(() => { target?.classList.remove('source-highlight'); transientMarkers.delete(clear) }, 4500)
  const clear = () => { clearTimeout(timer); target?.classList.remove('source-highlight'); transientMarkers.delete(clear) }
  transientMarkers.add(clear)
}
function revealSearchMatch() {
  const range = searchRanges[searchCurrent.value - 1]
  if (!active || !range || !scroll.value) return
  const rectangle = range.getClientRects()[0] || range.getBoundingClientRect()
  const viewport = scroll.value.getBoundingClientRect()
  if (rectangle.top < viewport.top + 24 || rectangle.bottom > viewport.bottom - 24) {
    scroll.value.scrollTo({ top: scroll.value.scrollTop + rectangle.top - viewport.top - viewport.height * .38, behavior: 'instant' })
  }
  progress()
}
function runSearch(preserveCurrent = false, reveal = true) {
  searchTimer = undefined
  if (!active || !body.value || !rendered) { searchPending = true; searchBusy.value = false; return }
  searchPending = false
  searchIndex ||= markdownTextIndex(body.value)
  const matches = markdownSearchRanges(searchIndex, searchQuery.value)
  searchRanges = matches.ranges
  searchTotal.value = searchRanges.length
  searchCurrent.value = searchRanges.length ? Math.max(1, Math.min(searchRanges.length, preserveCurrent ? searchCurrent.value : 1)) : 0
  searchStatus.value = matches.limited ? '仅显示前 5000 处' : ''
  searchBusy.value = false
  searchHighlighter.apply(searchRanges, searchCurrent.value - 1)
  if (reveal) revealSearchMatch()
}
function scheduleSearch(preserveCurrent = false, reveal = true) {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = undefined
  searchPending = true
  searchHighlighter.clear()
  if (!searchQuery.value.trim()) {
    searchRanges = []; searchTotal.value = 0; searchCurrent.value = 0; searchBusy.value = false; searchStatus.value = ''; searchPending = false
    return
  }
  searchBusy.value = active
  if (active) searchTimer = setTimeout(() => runSearch(preserveCurrent, reveal), 130)
}
function moveSearch(direction: number) {
  if (!active) return
  if (searchTimer || searchPending) { if (searchTimer) clearTimeout(searchTimer); runSearch(true, false) }
  if (!searchRanges.length) return
  searchCurrent.value = ((searchCurrent.value - 1 + direction + searchRanges.length) % searchRanges.length) + 1
  searchHighlighter.apply(searchRanges, searchCurrent.value - 1)
  revealSearchMatch()
}
function clearSearch() {
  const focused = document.activeElement instanceof HTMLElement && Boolean(document.activeElement.closest('.markdown-reader .reader-search'))
  const handled = Boolean(searchQuery.value || searchTotal.value || focused)
  searchQuery.value = ''
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = undefined; searchPending = false; searchBusy.value = false; searchRanges = []; searchTotal.value = 0; searchCurrent.value = 0; searchStatus.value = ''
  searchHighlighter.clear()
  if (focused && document.activeElement instanceof HTMLElement) document.activeElement.blur()
  return handled
}
// ---- 框选提问 ----------------------------------------------------------------
let selector: ReturnType<typeof rectangleSelector> | undefined
let selectionBox: HTMLElement | undefined
function toggleCapture() { setCapture(!capture.value) }
function setCapture(value: boolean) {
  if (value && raw.value) raw.value = false
  capture.value = value
  selector?.setActive(value)
}
function cancelCapture() { if (!capture.value) return false; setCapture(false); return true }
async function captured(rect: { x: number; y: number; width: number; height: number }) {
  setCapture(false)
  const article = body.value, host = stage.value
  if (!article || !host || !active) return
  const origin = host.getBoundingClientRect(), paper = article.getBoundingClientRect()
  const region = { left: origin.left + rect.x, top: origin.top + rect.y, width: rect.width, height: rect.height }
  const scale = zoom.value
  const frame: MarkdownRect = { space: 'markdown', x: (region.left - paper.left) / scale, y: (region.top - paper.top) / scale, width: region.width / scale, height: region.height / scale }
  const first = [...article.querySelectorAll<HTMLElement>('[data-source-line]')].find(block => { const box = block.getBoundingClientRect(); return box.bottom > region.top && box.top < region.top + region.height })
  const page = Number(first?.dataset.sourceLine) || currentLine
  const text = regionText(article, region)
  const current = activation
  const image = await captureRegion(article, region, scale).catch(() => null)
  if (!active || current !== activation) return
  if (!image && !text) { emit('error', '这块区域没有可以交给助手的内容，请换个地方框选。'); return }
  const selected = { text, page, image: image || undefined, rect: frame }
  emit('selection', { ...selected, captureFrame: getCaptureFrame(selected) })
}
function getCaptureFrame(selection: { image?: string; rect?: any }) {
  const rect = selection?.rect
  if (!active || rect?.space !== 'markdown' || !body.value || !scroll.value) return
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return
  const paper = body.value.getBoundingClientRect(), visible = scroll.value.getBoundingClientRect(), scale = zoom.value
  const left = Math.max(0, visible.left, paper.left + rect.x * scale), top = Math.max(0, visible.top, paper.top + rect.y * scale)
  const right = Math.min(window.innerWidth, visible.right, paper.left + (rect.x + rect.width) * scale), bottom = Math.min(window.innerHeight, visible.bottom, paper.top + (rect.y + rect.height) * scale)
  if (right <= left || bottom <= top) return
  return { left, top, width: right - left, height: bottom - top }
}
function getCaptureElements(selection: { rect?: any }) {
  if (!active || selection?.rect?.space !== 'markdown') return []
  return [scroll.value, stage.value, body.value].filter((element): element is HTMLElement => !!element?.isConnected)
}
function clearSelection() { selector?.clear() }

// ---- 手写标记：笔迹挂在各个段落上，改字号、缩放或窗口变宽时跟着各自的段落走 ----
const inkPage = ref(1)
/** The same `views` / `sizes` shape as the PDF viewer, with one "page" per top-level block (keyed by its source line). */
function inkViewer() {
  const article = body.value, view = scroll.value
  const views = new Map<number, { number: number; slot: HTMLElement }>()
  if (!article || !view || raw.value || !rendered) return { views, sizes: { get: () => undefined } }
  const bounds = view.getBoundingClientRect(), reach = bounds.height * 1.5
  for (const block of article.querySelectorAll<HTMLElement>(':scope > div > [data-source-line]')) {
    const line = Number(block.dataset.sourceLine)
    if (!line || views.has(line)) continue
    // Blocks with marks always carry a layer; while drawing, so do the blocks around the view.
    let wanted = ink.hasInk(line)
    if (!wanted && ink.state.enabled) { const box = block.getBoundingClientRect(); wanted = box.bottom > bounds.top - reach && box.top < bounds.bottom + reach }
    if (wanted) views.set(line, { number: line, slot: block })
  }
  return {
    views,
    sizes: { get(line: number) { const slot = views.get(line)?.slot; const box = (slot?.querySelector(':scope > .ink-layer') || slot)?.getBoundingClientRect(); return box ? { width: box.width, height: box.height } : undefined } },
  }
}
const ink = usePdfInk({ container: body, viewer: inkViewer, documentId: () => props.documentId, page: inkPage, capture, cancelCapture, scope: 'document' })
function inkSchedule() { ink.schedule() }
watch(raw, value => { if (value) ink.exit() })
function toggleInk() { if (raw.value) raw.value = false; ink.toggle() }

// ---- 书签：位置就是整篇的滚动比例 ----
function getBookmarkPosition() { return active && rendered ? { progress: Math.max(0, Math.min(1, getViewState().progress)) } : undefined }
function bookmarkRatio(position: { progress?: number }) { return Math.max(0, Math.min(1, position.progress ?? 0)) }
function goToBookmark(position: { progress?: number }) {
  const view = scroll.value
  if (!active || !view) return
  if (raw.value) raw.value = false
  view.scrollTo({ top: Math.max(0, view.scrollHeight - view.clientHeight) * (position.progress ?? 0), behavior: 'smooth' })
}

async function focusSearch() { if (active) { await nextTick(); searchControl.value?.focus() } }
async function renderDocument() {
  const targetProgress = rendered ? getViewState().progress : cachedProgress
  const current = ++epoch
  rendered = false
  searchIndex = undefined
  searchRanges = []
  searchHighlighter.clear()
  error.value = ''
  urls.forEach(url => URL.revokeObjectURL(url)); urls = []
  const text = new TextDecoder().decode(props.data)
  sourceText = text
  totalLines = text.split('\n').length
  headings.value = []
  const tokens = markdown.parse(text, {})
  let headingCount = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.map && token.type !== 'inline' && token.nesting !== -1) token.attrSet('data-source-line', String(token.map[0] + 1))
    if (token.type === 'heading_open') {
      const id = `heading-${++headingCount}`
      token.attrSet('id', id)
      headings.value.push({ title: tokens[i + 1]?.content || '', id, level: Number(token.tag.slice(1)) })
    }
    for (const child of token.children || []) {
      if (child.type === 'image') {
        const src = child.attrGet('src') || ''
        if (/^(https?:|\/\/)/i.test(src)) { child.attrSet('src', src.startsWith('//') ? `https:${src}` : src); child.attrSet('loading', 'lazy'); child.attrSet('referrerpolicy', 'no-referrer'); continue }
        if (/^(data:|blob:)/i.test(src)) { child.attrSet('src', ''); continue }
        try {
          const asset = await library.readAsset(props.documentId, decodeURIComponent(src.split('#')[0]))
          if (current !== epoch) return
          const url = URL.createObjectURL(new Blob([asset.data.slice().buffer as ArrayBuffer], { type: asset.mime }))
          urls.push(url); child.attrSet('src', url)
        } catch { child.attrSet('src', ''); child.attrSet('alt', `图片无法读取：${child.content || src}`) }
      }
      if (child.type === 'link_open') {
        const href = child.attrGet('href') || ''
        if (/^(https?:|mailto:)/i.test(href)) { child.attrSet('target', '_blank'); child.attrSet('rel', 'noopener noreferrer') }
        else if (!href.startsWith('#')) { child.attrSet('href', '#'); child.attrSet('title', '本地文档链接：请从文档库导入目标文件') }
      }
    }
  }
  if (epoch !== current) return
  content.value = raw.value ? text : markdown.renderer.render(tokens, markdown.options, {})
  if (active) { emit('ready', { text, headings: headings.value }); emit('text', text) }
  await nextTick()
  if (epoch !== current) return
  if (active && scroll.value) scroll.value.scrollTop = Math.max(0, scroll.value.scrollHeight - scroll.value.clientHeight) * targetProgress
  cachedProgress = targetProgress
  rendered = true
  if (searchQuery.value.trim()) runSearch(true, false)
  progress()
}
async function render() {
  const current = epoch + 1
  try { await renderDocument() }
  catch (reason: any) {
    if (current !== epoch) return
    error.value = reason?.message || '无法读取 Markdown。'
    if (active) emit('error', error.value)
  }
}
function linkClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement)?.closest('a')
  const href = anchor?.getAttribute('href')
  if (href?.startsWith('#')) {
    event.preventDefault()
    const id = decodeURIComponent(href.slice(1))
    const heading = headings.value.find(item => item.title === id || item.id === id || item.title.toLowerCase().replace(/\s+/g, '-') === id.toLowerCase())
    if (heading) goToHeading(heading.id)
  }
}
watch([() => props.data, raw], render)
watch(searchQuery, () => scheduleSearch())
watch(() => props.fontSize, value => { displayFontSize.value = clampMarkdownFontSize(value); void nextTick(progress) })
watch(() => props.contentWidth, () => { void nextTick(progress) })
onMounted(render)
let resize: ResizeObserver | undefined
onMounted(() => {
  if (!stage.value || !body.value) return
  selectionBox = document.createElement('div')
  selectionBox.className = 'selection-box'
  selectionBox.hidden = true
  stage.value.append(selectionBox)
  selector = rectangleSelector(stage.value, selectionBox, (rect: { x: number; y: number; width: number; height: number }) => { void captured(rect) })
  // Reflow (font size, width, zoom, late images) changes each block's height: redraw the marks on it.
  resize = new ResizeObserver(() => inkSchedule())
  resize.observe(body.value)
})
onBeforeUnmount(() => { selector?.dispose(); resize?.disconnect(); active = false; ++activation; ++epoch; if (searchTimer) clearTimeout(searchTimer); searchIndex = undefined; searchRanges = []; searchHighlighter.dispose(); for (const clear of transientMarkers) clear(); urls.forEach(url => URL.revokeObjectURL(url)) })
function getViewState() { return { progress: active && scroll.value ? scroll.value.scrollTop / Math.max(1, scroll.value.scrollHeight - scroll.value.clientHeight) : cachedProgress, raw: raw.value, outlineOpen: outlineOpen.value, fontSize: displayFontSize.value, zoom: zoom.value, search: { query: searchQuery.value, current: searchCurrent.value } } }
function suspend() {
  if (!active) return
  cachedProgress = getViewState().progress
  active = false; ++activation
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = undefined; searchPending = true }
  searchBusy.value = false
  searchHighlighter.clear()
  for (const clear of transientMarkers) clear()
  cancelCapture()
}
async function resume() {
  if (active) return
  active = true
  const visible = ++activation
  await nextTick()
  if (!active || visible !== activation) return
  if (error.value) { emit('error', error.value); return }
  if (!rendered || !scroll.value) return
  scroll.value.scrollTop = Math.max(0, scroll.value.scrollHeight - scroll.value.clientHeight) * cachedProgress
  if (searchPending) runSearch(true, false)
  else searchHighlighter.apply(searchRanges, searchCurrent.value - 1)
  emit('ready', { text: sourceText, headings: headings.value })
  emit('text', sourceText)
  progress()
}
onActivated(resume)
onDeactivated(suspend)
defineExpose({ goToPage, goToHeading, isSuspended: () => !active, zoomIn, zoomOut, resetZoom, getZoom: () => zoom.value, toggleOutline, nextPage, previousPage, focusSearch, clearSearch, toggleCapture, cancelCapture, getCaptureFrame, getCaptureElements, clearSelection, toggleInk, exitInk: ink.exit, pickInk: ink.pick, getPage: () => currentLine, getFontSize: () => displayFontSize.value, getViewState, getBookmarkPosition, bookmarkRatio, goToBookmark, suspend, resume, getCacheStats: () => ({ suspended: !active, pages: 0, pixels: 0 }) })
</script>

<template>
  <div class="markdown-reader reader-engine">
    <div class="reader-tools">
      <button class="quiet-button" :class="{ active: outlineOpen }" data-tip="文档目录" :data-tip-key="shortcuts?.outline" @click="toggleOutline"><AppIcon name="list" :size="17" />目录</button>
      <span class="reader-format-label">Markdown</span>
      <div class="reader-zoom"><button @click="zoomOut()" data-tip="缩小" aria-label="缩小" :data-tip-key="shortcuts?.zoomOut">−</button><button @click="resetZoom" data-tip="恢复 100%" aria-label="缩放比例">{{ Math.round(zoom * 100) }}%</button><button @click="zoomIn()" data-tip="放大" aria-label="放大" :data-tip-key="shortcuts?.zoomIn">＋</button></div>
      <button class="quiet-button crop-toggle" :class="{ active: capture }" @click="toggleCapture" data-tip="框选公式、图表或一段内容作为 AI 上下文" :data-tip-key="shortcuts?.capture"><AppIcon name="crop" :size="17" />{{ capture ? '拖动框选' : '框选' }}</button>
      <InkButton :active="ink.state.enabled" :tip-key="shortcuts?.inkPen" @click="toggleInk" />
      <button class="quiet-button" :class="{ active: raw }" @click="raw = !raw">{{ raw ? '阅读视图' : '查看源码' }}</button>
      <ReaderSearch ref="searchControl" v-model="searchQuery" :busy="searchBusy" :current="searchCurrent" :total="searchTotal" :status="searchStatus" :shortcut="props.findShortcut" @next="moveSearch(1)" @previous="moveSearch(-1)" @clear="clearSearch" />
    </div>
    <div class="reader-engine-body">
      <aside v-if="outlineOpen" class="document-outline"><p class="outline-heading">目录</p><button v-for="item in headings" :key="item.id" :class="`depth-${Math.min(3, Math.max(0, item.level - 1))}`" :style="{ '--depth': Math.max(0, item.level - 1) }" @click="goToHeading(item.id)"><span class="outline-title">{{ item.title }}</span></button><p v-if="!headings.length" class="subtle">此文档没有标题。</p></aside>
      <div class="markdown-viewport">
        <div ref="scroll" class="markdown-scroll" @scroll="scrolled"><div ref="stage" class="markdown-stage"><article ref="body" class="markdown-paper" tabindex="-1" :class="{ 'source-view': raw }" :style="{ fontSize: `${displayFontSize}px`, maxWidth: `${clampMarkdownContentWidth(props.contentWidth)}px`, zoom }" @mouseup="selectedText" @keyup="selectedText" @click="linkClick"><pre v-if="raw" style="font-size: inherit">{{ content }}</pre><div v-else v-html="content"></div></article></div></div>
        <InkPalette v-if="ink.state.enabled" :mode="ink.state.mode" :colors="ink.state.colors" :last-tool="ink.state.lastTool" :can-undo="ink.state.canUndo" :page-has-ink="ink.state.pageHasInk" :status="ink.state.status" clear-label="清除全部标记（可撤销）" @mode="ink.setMode" @color="ink.setColor" @undo="ink.undo" @clear="ink.clearPage" @close="ink.exit" />
      </div>
      <div v-if="error" class="reader-overlay error-state"><AppIcon name="file" :size="34" /><p>{{ error }}</p><button @click="render">重试</button></div>
    </div>
  </div>
</template>
