<script setup lang="ts">
import { ref, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount, nextTick } from 'vue'
import MarkdownIt from 'markdown-it'
import 'katex/dist/katex.min.css'
import { installMarkdownMath } from './markdown-math'
import { library } from '../sdk'
import { clampMarkdownFontSize, clampMarkdownContentWidth, readingScrollTarget } from '../reader/layout.mjs'
import { markdownTextIndex, markdownSearchRanges, markdownSearchHighlighter } from '../reader/markdown-search'
import AppIcon from './AppIcon.vue'
import ReaderSearch from './ReaderSearch.vue'

const props = withDefaults(defineProps<{ data: Uint8Array; documentId: string; initialProgress?: number; fontSize?: number; contentWidth?: number; findShortcut?: string; initialView?: { progress: number; raw: boolean; outlineOpen: boolean; fontSize: number; search?: { query: string; current: number } } }>(), { initialProgress: 0, fontSize: 17, contentWidth: 820, findShortcut: 'Ctrl + F' })
const emit = defineEmits<{
  ready: [value: { text: string; headings: { title: string; id: string; level: number }[] }]
  progress: [value: { page: number; pageCount: number; progress: number }]
  selection: [value: { text: string; page: number }]
  text: [value: string]
  error: [value: string]
  fontSizeChange: [value: number]
}>()
const content = ref('')
const error = ref('')
const body = ref<HTMLElement>()
const scroll = ref<HTMLElement>()
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
function selectedText() {
  if (!active) return
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !body.value?.contains(selection.anchorNode)) return
  const text = selection.toString().trim().slice(0, 16000)
  const source = selection.anchorNode?.parentElement?.closest('[data-source-line]')
  if (text) emit('selection', { text, page: Number(source?.getAttribute('data-source-line')) || 1 })
}
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
function changeFontSize(value: number) {
  displayFontSize.value = clampMarkdownFontSize(value)
  if (active) emit('fontSizeChange', displayFontSize.value)
  void nextTick(progress)
}
function zoomIn() { changeFontSize(displayFontSize.value + 1) }
function zoomOut() { changeFontSize(displayFontSize.value - 1) }
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
        if (/^(https?:|\/\/)/i.test(src)) { child.attrSet('src', ''); child.attrSet('alt', `外部图片：${child.content || src}`); continue }
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
onBeforeUnmount(() => { active = false; ++activation; ++epoch; if (searchTimer) clearTimeout(searchTimer); searchIndex = undefined; searchRanges = []; searchHighlighter.dispose(); for (const clear of transientMarkers) clear(); urls.forEach(url => URL.revokeObjectURL(url)) })
function getViewState() { return { progress: active && scroll.value ? scroll.value.scrollTop / Math.max(1, scroll.value.scrollHeight - scroll.value.clientHeight) : cachedProgress, raw: raw.value, outlineOpen: outlineOpen.value, fontSize: displayFontSize.value, search: { query: searchQuery.value, current: searchCurrent.value } } }
function suspend() {
  if (!active) return
  cachedProgress = getViewState().progress
  active = false; ++activation
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = undefined; searchPending = true }
  searchBusy.value = false
  searchHighlighter.clear()
  for (const clear of transientMarkers) clear()
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
defineExpose({ goToPage, goToHeading, zoomIn, zoomOut, toggleOutline, nextPage, previousPage, focusSearch, clearSearch, getPage: () => currentLine, getFontSize: () => displayFontSize.value, getViewState, suspend, resume, getCacheStats: () => ({ suspended: !active, pages: 0, pixels: 0 }) })
</script>

<template>
  <div class="markdown-reader reader-engine">
    <div class="reader-tools">
      <button class="quiet-button" :class="{ active: outlineOpen }" @click="toggleOutline"><AppIcon name="list" :size="17" />目录</button>
      <span class="reader-format-label">Markdown</span>
      <div class="reader-zoom"><button @click="zoomOut" title="缩小字号">A−</button><span>{{ displayFontSize }}</span><button @click="zoomIn" title="放大字号">A＋</button></div>
      <button class="quiet-button" :class="{ active: raw }" @click="raw = !raw">{{ raw ? '阅读视图' : '查看源码' }}</button>
      <ReaderSearch ref="searchControl" v-model="searchQuery" :busy="searchBusy" :current="searchCurrent" :total="searchTotal" :status="searchStatus" :shortcut="props.findShortcut" @next="moveSearch(1)" @previous="moveSearch(-1)" @clear="clearSearch" />
    </div>
    <div class="reader-engine-body">
      <aside v-if="outlineOpen" class="document-outline"><p class="eyebrow">文档目录</p><button v-for="item in headings" :key="item.id" :style="{ paddingLeft: `${12 + Math.max(0, item.level - 1) * 10}px` }" @click="goToHeading(item.id)">{{ item.title }}</button><p v-if="!headings.length" class="subtle">此文档没有标题。</p></aside>
      <div ref="scroll" class="markdown-scroll" @scroll="progress"><article ref="body" class="markdown-paper" :class="{ 'source-view': raw }" :style="{ fontSize: `${displayFontSize}px`, maxWidth: `${clampMarkdownContentWidth(props.contentWidth)}px` }" @mouseup="selectedText" @keyup="selectedText" @click="linkClick"><pre v-if="raw" style="font-size: inherit">{{ content }}</pre><div v-else v-html="content"></div></article></div>
      <div v-if="error" class="reader-overlay error-state"><AppIcon name="file" :size="34" /><p>{{ error }}</p><button @click="render">重试</button></div>
    </div>
  </div>
</template>
