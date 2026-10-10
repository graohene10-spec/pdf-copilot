<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import MarkdownIt from 'markdown-it'
import 'katex/dist/katex.min.css'
import { installMarkdownMath } from './markdown-math'
import { library } from '../sdk'
import { clampMarkdownFontSize, clampMarkdownContentWidth, readingScrollTarget } from '../reader/layout.mjs'
import AppIcon from './AppIcon.vue'

const props = withDefaults(defineProps<{ data: Uint8Array; documentId: string; initialProgress?: number; fontSize?: number; contentWidth?: number; initialView?: { progress: number; raw: boolean; outlineOpen: boolean; fontSize: number } }>(), { initialProgress: 0, fontSize: 17, contentWidth: 820 })
const emit = defineEmits<{
  ready: [value: { text: string; headings: { title: string; id: string; level: number }[] }]
  progress: [value: { page: number; pageCount: number; progress: number }]
  selection: [value: { text: string; page: number }]
  text: [value: string]
  error: [value: string]
  fontSizeChange: [value: number]
}>()
const content = ref('')
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
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true })
installMarkdownMath(markdown)
function selectedText() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !body.value?.contains(selection.anchorNode)) return
  const text = selection.toString().trim().slice(0, 16000)
  const source = selection.anchorNode?.parentElement?.closest('[data-source-line]')
  if (text) emit('selection', { text, page: Number(source?.getAttribute('data-source-line')) || 1 })
}
function progress() {
  if (!scroll.value) return
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
  emit('fontSizeChange', displayFontSize.value)
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
  setTimeout(() => target?.classList.remove('source-highlight'), 4500)
}
async function render() {
  const targetProgress = rendered ? getViewState().progress : props.initialView?.progress ?? props.initialProgress
  const current = ++epoch
  urls.forEach(url => URL.revokeObjectURL(url)); urls = []
  const text = new TextDecoder().decode(props.data)
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
  emit('ready', { text, headings: headings.value }); emit('text', text)
  await nextTick()
  if (scroll.value) scroll.value.scrollTop = Math.max(0, scroll.value.scrollHeight - scroll.value.clientHeight) * targetProgress
  rendered = true
  progress()
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
watch(() => props.fontSize, value => { displayFontSize.value = clampMarkdownFontSize(value); void nextTick(progress) })
watch(() => props.contentWidth, () => { void nextTick(progress) })
onMounted(render)
onBeforeUnmount(() => { ++epoch; urls.forEach(url => URL.revokeObjectURL(url)) })
function getViewState() { return { progress: scroll.value ? scroll.value.scrollTop / Math.max(1, scroll.value.scrollHeight - scroll.value.clientHeight) : 0, raw: raw.value, outlineOpen: outlineOpen.value, fontSize: displayFontSize.value } }
defineExpose({ goToPage, goToHeading, zoomIn, zoomOut, toggleOutline, nextPage, previousPage, getPage: () => currentLine, getFontSize: () => displayFontSize.value, getViewState })
</script>

<template>
  <div class="markdown-reader reader-engine">
    <div class="reader-tools">
      <button class="quiet-button" :class="{ active: outlineOpen }" @click="toggleOutline"><AppIcon name="list" :size="17" />目录</button>
      <span class="reader-format-label">Markdown</span>
      <div class="reader-zoom"><button @click="zoomOut" title="缩小字号">A−</button><span>{{ displayFontSize }}</span><button @click="zoomIn" title="放大字号">A＋</button></div>
      <button class="quiet-button" :class="{ active: raw }" @click="raw = !raw">{{ raw ? '阅读视图' : '查看源码' }}</button>
    </div>
    <div class="reader-engine-body">
      <aside v-if="outlineOpen" class="document-outline"><p class="eyebrow">文档目录</p><button v-for="item in headings" :key="item.id" :style="{ paddingLeft: `${12 + Math.max(0, item.level - 1) * 10}px` }" @click="goToHeading(item.id)">{{ item.title }}</button><p v-if="!headings.length" class="subtle">此文档没有标题。</p></aside>
      <div ref="scroll" class="markdown-scroll" @scroll="progress"><article ref="body" class="markdown-paper" :class="{ 'source-view': raw }" :style="{ fontSize: `${displayFontSize}px`, maxWidth: `${clampMarkdownContentWidth(props.contentWidth)}px` }" @mouseup="selectedText" @keyup="selectedText" @click="linkClick"><pre v-if="raw" style="font-size: inherit">{{ content }}</pre><div v-else v-html="content"></div></article></div>
    </div>
  </div>
</template>
