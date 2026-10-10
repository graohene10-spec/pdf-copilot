<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { ContinuousPdfViewer } from '../reader/continuous.mjs'
import { cropImage } from '../../../extension/reader/selection.mjs'
import { availableReadingWidth, shrinkToFitScale, clampPdfScale } from '../reader/layout.mjs'
import AppIcon from './AppIcon.vue'
import { documentPassword, rememberPassword } from '../document/passwords.mjs'
import { floatLeavingPanel, restoreLeavingPanel } from '../ui/panel-transition'

const props = withDefaults(defineProps<{
  data: Uint8Array
  documentId?: string
  initialPage?: number
  sidebarFitEnabled?: boolean
  initialZoom?: 'fit' | number
  zoomStep?: number
  fitRequest?: number
  initialView?: { page: number; fraction: number; scale: number | null; outlineOpen: boolean }
}>(), { initialPage: 1, sidebarFitEnabled: true, initialZoom: 'fit', zoomStep: .1, fitRequest: 0 })
const emit = defineEmits<{
  ready: [value: { pdf: any; page: number }]
  progress: [value: { page: number; pageCount: number; progress: number }]
  selection: [value: { text: string; page: number; image?: string; rect?: any }]
  text: [value: string]
  error: [value: string]
}>()
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
const container = ref<HTMLElement>()
const viewportHost = ref<HTMLElement>()
const page = ref(props.initialPage)
const pageInput = ref(props.initialPage)
const total = ref(0)
const scale = ref(1)
const loading = ref(true)
const error = ref('')
const capture = ref(false)
const outlineOpen = ref(props.initialView?.outlineOpen || false)
const outline = ref<{ title: string; dest: any; depth: number }[]>([])
let viewer: any
let pdf: any
let task: any
let epoch = 0
let observer: ResizeObserver | undefined
let indexedText = new Map<number, string>()
let indexedCharacters = 0
let layoutTimer: ReturnType<typeof setTimeout> | undefined
let renderRevision = 0
let panelResizeHeld = false
let outlineResizeHeld = false
let frozenViewport: { left: number; top: number; width: number; height: number } | undefined
let fitMode = props.initialView ? props.initialView.scale === null : props.initialZoom === 'fit'
let pendingPanelFit = false
let lastAvailableWidth = 0
let prepareScheduled = false
let suppressPanelFit = false
const panelCommitWaiters = new Set<() => void>()

function readingWidth() {
  if (!container.value) return 0
  const style = getComputedStyle(container.value)
  // The host follows the final panel layout while the visible scroll surface
  // keeps its old bounds until the new bitmap can be committed in one frame.
  const width = viewportHost.value?.clientWidth ?? container.value.clientWidth
  const gutter = container.value.offsetWidth - container.value.clientWidth
  return availableReadingWidth(Math.max(0, width - gutter), style.paddingLeft, style.paddingRight)
}
function positionFrozenViewport() {
  if (!frozenViewport || !container.value || !viewportHost.value) return
  const host = viewportHost.value.getBoundingClientRect()
  Object.assign(container.value.style, {
    left: `${frozenViewport.left - host.left}px`, top: `${frozenViewport.top - host.top}px`,
    right: 'auto', bottom: 'auto', width: `${frozenViewport.width}px`, height: `${frozenViewport.height}px`,
  })
}
function freezeViewport() {
  if (!frozenViewport && container.value) {
    const bounds = container.value.getBoundingClientRect()
    frozenViewport = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
  }
  positionFrozenViewport()
}
function releaseViewport() {
  frozenViewport = undefined
  for (const property of ['left', 'top', 'right', 'bottom', 'width', 'height']) container.value?.style.removeProperty(property)
}
function overflowScale() {
  const active = viewer?.active
  if (!active?.ready) return null
  return shrinkToFitScale(active.slot.getBoundingClientRect().width, readingWidth(), viewer.displayScale)
}
async function renderZoom(value: number | null, deferLayout = false) {
  const current = epoch
  const document = pdf
  const revision = ++renderRevision
  if (!document) return
  const target = value ?? viewer.getFitScale(readingWidth())
  const stagedPage = viewer.currentPage
  try {
    await viewer.zoom(target, {
      deferLayout,
      waitBeforeCommit: deferLayout ? waitForPanelCommit : undefined,
      beforeCommit: () => {
        if (current !== epoch || document !== pdf || (deferLayout && (panelResizeHeld || outlineResizeHeld || stagedPage !== viewer.currentPage))) return false
        releaseViewport()
        return true
      },
    })
    if (revision === renderRevision && current === epoch && document === pdf) {
      scale.value = viewer.displayScale || 1
      // Scrolling can release the staged page. Refit the new active page
      // rather than leaving a canceled resize as the last measured width.
      if (deferLayout && !panelResizeHeld && !outlineResizeHeld && !viewer.active?.failed && Math.abs(target - viewer.displayScale) > .000001) {
        if (!fitMode) pendingPanelFit = true
        scheduleLayout()
      }
      if (viewer.active?.failed && !panelResizeHeld && !outlineResizeHeld) releaseViewport()
    }
  } catch (reason: any) { if (revision === renderRevision && current === epoch) emit('error', reason?.message || '无法调整 PDF 缩放。') }
}
async function renderFit() {
  // The desktop viewer computes this once from the current page's measured
  // size, rather than rendering the first-page fit and correcting it later.
  await renderZoom(null)
}
function scheduleLayout() {
  clearTimeout(layoutTimer)
  layoutTimer = setTimeout(() => { void refreshLayout() }, 140)
}
function waitForPanelCommit(signal?: AbortSignal) {
  if ((!panelResizeHeld && !outlineResizeHeld) || signal?.aborted) return Promise.resolve()
  return new Promise<void>(resolve => {
    const finish = () => { panelCommitWaiters.delete(finish); signal?.removeEventListener('abort', finish); resolve() }
    panelCommitWaiters.add(finish)
    signal?.addEventListener('abort', finish, { once: true })
  })
}
function releaseCommitWaiters() {
  for (const finish of panelCommitWaiters) finish()
}
function preparePanelLayout() {
  if (prepareScheduled) return
  prepareScheduled = true
  const current = epoch
  void nextTick(() => {
    prepareScheduled = false
    if (current !== epoch || loading.value || !viewer?.pdf || (!panelResizeHeld && !outlineResizeHeld)) return
    positionFrozenViewport()
    if (!viewer.active?.paintedScale) { viewer.cancelDeferredZoom(); return }
    const target = fitMode ? viewer.getFitScale(readingWidth()) : pendingPanelFit && props.sidebarFitEnabled ? overflowScale() : null
    // A rapid reverse can restore the already committed width. Cancel the
    // obsolete candidate, while retaining the pin through the remaining pop.
    if (target === null || Math.abs(target - viewer.displayScale) < .000001) { viewer.cancelDeferredZoom(); return }
    if (viewer.pendingZoom?.scale === target && viewer.pendingZoom.view === viewer.active) return
    if (!viewer.active?.failed) void renderZoom(target, true)
  })
}
function finishPanelLayout() {
  const current = epoch
  void nextTick(() => {
    if (current !== epoch || panelResizeHeld || outlineResizeHeld) return
    // Popup bounds are already final. Reserve debounce for continuous window
    // resize instead of leaving the old fitted page pinned for another 140ms.
    clearTimeout(layoutTimer)
    void refreshLayout()
    suppressPanelFit = false
    // refreshLayout chooses/cancels the final target synchronously before its
    // first await. Only then may an already prepared bitmap pass the gate.
    releaseCommitWaiters()
  })
}
function requestPanelFit() {
  if (!props.sidebarFitEnabled || suppressPanelFit) return
  pendingPanelFit = true
  if (panelResizeHeld || outlineResizeHeld) preparePanelLayout()
  else scheduleLayout()
}
async function refreshLayout() {
  if (loading.value || !viewer?.pdf) return
  // Keep the old screen bounds through a panel's pop/shrink animation.
  // One fitted bitmap and the final viewport replace them together.
  if (panelResizeHeld || outlineResizeHeld) return
  const width = readingWidth()
  const widthChanged = Math.abs(width - lastAvailableWidth) > .5
  lastAvailableWidth = width
  // Fit mode already covers overflow: choose one target, with no second
  // correction after the redraw. Size and bitmap commit together for panels.
  if (fitMode) {
    pendingPanelFit = false
    const target = viewer.getFitScale(width)
    if (widthChanged || Math.abs(target - viewer.displayScale) > .000001) await renderZoom(target, true)
    else { viewer.cancelDeferredZoom(); releaseViewport() }
    return
  }
  if (!pendingPanelFit || !props.sidebarFitEnabled) { viewer.cancelDeferredZoom(); releaseViewport(); return }
  if (!viewer.active?.ready) return
  pendingPanelFit = false
  const target = overflowScale()
  if (target !== null) await renderZoom(target, true)
  else { viewer.cancelDeferredZoom(); releaseViewport() }
}

async function destination(dest: any) {
  if (!pdf) return
  if (typeof dest === 'string') dest = await pdf.getDestination(dest)
  if (!Array.isArray(dest)) return
  const number = typeof dest[0] === 'number' ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1
  await goToPage(number)
}
async function goToPage(number: number, rect?: any) {
  const view = await viewer?.goToPage(number)
  if (rect && view) {
    const [x1, y1] = view.viewport.convertToViewportPoint(rect.x, rect.y)
    const [x2, y2] = view.viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height)
    const marker = document.createElement('div')
    marker.className = 'citation-highlight'
    Object.assign(marker.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` })
    view.slot.append(marker)
    setTimeout(() => marker.remove(), 4500)
  }
}
async function zoom(value: number | null) {
  pendingPanelFit = false
  if (panelResizeHeld || outlineResizeHeld) suppressPanelFit = true
  fitMode = value === null
  releaseViewport()
  if (value === null) await renderFit()
  else await renderZoom(clampPdfScale(value))
  lastAvailableWidth = readingWidth()
}
function zoomIn() { return zoom(scale.value + Math.max(.05, Math.min(.5, props.zoomStep))) }
function zoomOut() { if (scale.value > .25) return zoom(scale.value - Math.max(.05, Math.min(.5, props.zoomStep))) }
function fitWidth() { return zoom(null) }
function nextPage() { return goToPage(page.value + 1) }
function previousPage() { return goToPage(page.value - 1) }
async function toggleOutline() {
  holdOutlineResize(true)
  outlineOpen.value = !outlineOpen.value
  if (outlineOpen.value) { await nextTick(); if (outlineOpen.value) requestPanelFit() }
}
function toggleCapture() {
  capture.value = !capture.value
  viewer?.capture(capture.value)
}
/* Freeze before Vue changes the panel layout, then commit one fitted frame. */
function holdPanelResize(held: boolean, fitOverflow = false) {
  if (held && !panelResizeHeld && !outlineResizeHeld) suppressPanelFit = false
  panelResizeHeld = held
  if (fitOverflow && props.sidebarFitEnabled && !suppressPanelFit) pendingPanelFit = true
  clearTimeout(layoutTimer)
  if (held) {
    freezeViewport()
    // before-enter runs before insertion. Adjust once more after Vue has
    // patched the final-width panel, before the browser can paint that frame.
    void nextTick(positionFrozenViewport)
    preparePanelLayout()
  }
  if (!held) {
    positionFrozenViewport()
    if (fitOverflow && props.sidebarFitEnabled && !suppressPanelFit) pendingPanelFit = true
    finishPanelLayout()
  }
}
function holdOutlineResize(held: boolean, fitOverflow = false) {
  if (held && !panelResizeHeld && !outlineResizeHeld) suppressPanelFit = false
  outlineResizeHeld = held
  if (fitOverflow && props.sidebarFitEnabled && !suppressPanelFit) pendingPanelFit = true
  clearTimeout(layoutTimer)
  if (held) { freezeViewport(); void nextTick(positionFrozenViewport); preparePanelLayout() }
  else { positionFrozenViewport(); if (outlineOpen.value && props.sidebarFitEnabled && !suppressPanelFit) pendingPanelFit = true; finishPanelLayout() }
}
function outlineResizeStart(element: Element, entering: boolean) {
  holdOutlineResize(true, entering)
  if (entering) restoreLeavingPanel(element)
  else floatLeavingPanel(element)
}
function outlineResizeEnd(element: Element) {
  restoreLeavingPanel(element)
  holdOutlineResize(false)
}
function selectedText() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !container.value?.contains(selection.anchorNode)) return
  const text = selection.toString().trim().slice(0, 16000)
  const selectedPage = Number((selection.anchorNode?.parentElement?.closest('.page-slot') as HTMLElement | null)?.dataset.page) || page.value
  if (text) emit('selection', { text, page: selectedPage })
}
async function load() {
  const current = ++epoch
  const restorePage = props.initialView?.page || props.initialPage
  loading.value = true; error.value = ''; indexedText.clear(); indexedCharacters = 0; outline.value = []
  releaseViewport()
  releaseCommitWaiters()
  viewer?.reset()
  await task?.destroy()
  pdf = null
  try {
    task = pdfjs.getDocument({ data: props.data.slice(), password: documentPassword(props.documentId), cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/' })
    task.onPassword = (update: (password: string) => void) => {
      const value = window.prompt('这份 PDF 需要密码，请输入：')
      if (value === null) { task.destroy(); error.value = '已取消打开加密文档。'; loading.value = false }
      else { rememberPassword(props.documentId, value); update(value) }
    }
    const document = await task.promise
    if (epoch !== current) return
    pdf = document; total.value = pdf.numPages
    await viewer.setDocument(pdf)
    if (epoch !== current) return
    fitMode = props.initialView ? props.initialView.scale === null : props.initialZoom === 'fit'
    if (!fitMode) await renderZoom(props.initialView?.scale ?? clampPdfScale(props.initialZoom))
    await viewer.goToPage(Math.max(1, Math.min(restorePage, total.value)))
    if (epoch !== current) return
    if (fitMode) {
      const target = overflowScale()
      if (target !== null) await renderZoom(target)
    }
    if (epoch !== current) return
    if (props.initialView && container.value) {
      const number = viewer.currentPage
      container.value.scrollTop = viewer.stack.offsetTop + viewer.offsets[number - 1] + props.initialView.fraction * viewer.heights[number - 1]
      viewer.explicitPosition = { page: number, top: container.value.scrollTop }
    }
    lastAvailableWidth = readingWidth()
    loading.value = false
    if (pendingPanelFit) scheduleLayout()
    emit('progress', { page: page.value, pageCount: total.value, progress: page.value / total.value })
    emit('ready', { pdf, page: page.value })
    const entries = await pdf.getOutline()
    const flat: any[] = []
    function flatten(items: any[], depth = 0) { for (const item of items || []) { if (flat.length >= 1000 || depth > 20) break; flat.push({ title: item.title, dest: item.dest, depth }); flatten(item.items, depth + 1) } }
    flatten(entries); if (epoch === current) outline.value = flat
  } catch (reason: any) {
    if (current !== epoch) return
    error.value = reason?.message || '无法读取 PDF。'
    loading.value = false; emit('error', error.value)
  }
}
onMounted(async () => {
  await nextTick()
  viewer = new ContinuousPdfViewer({
    container: container.value, pdfjs,
    onPageChange(number: number, zoom: number) { page.value = pageInput.value = number; scale.value = zoom; if (panelResizeHeld || outlineResizeHeld) preparePanelLayout(); if (!loading.value) emit('progress', { page: number, pageCount: total.value, progress: total.value ? number / total.value : 0 }) },
    async onPageReady(view: any) {
      if ((panelResizeHeld || outlineResizeHeld) && view.number === viewer.currentPage) preparePanelLayout()
      if (pendingPanelFit && view.number === viewer.currentPage) scheduleLayout()
      if (indexedText.has(view.number) || indexedCharacters >= 2000000) return
      const current = epoch
      let content
      try { content = await view.page.getTextContent() }
      catch (reason: any) { if (current === epoch && !view.disposed) emit('error', reason?.message || '无法读取页面文字。'); return }
      if (current !== epoch || view.disposed) return
      const text = content.items.map((item: any) => item.str || '').join(' ').slice(0, 2000000 - indexedCharacters)
      indexedText.set(view.number, text); indexedCharacters += text.length
      emit('text', [...indexedText.entries()].sort(([a], [b]) => a - b).map(([n, text]) => `第 ${n} 页\n${text}`).join('\n\n'))
    },
    onSelect(view: any, rect: any) {
      const [x1, y1] = view.viewport.convertToPdfPoint(rect.x, rect.y)
      const [x2, y2] = view.viewport.convertToPdfPoint(rect.x + rect.width, rect.y + rect.height)
      const image = cropImage(view.canvas, rect, view.viewport.width, view.viewport.height)
      emit('selection', { text: '', page: view.number, image, rect: { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), space: 'pdf-points' } })
      capture.value = false; viewer.capture(false)
    },
    onDestination: destination,
    onSelectionPending() {},
    onError(reason: any) { emit('error', reason?.message || String(reason)) },
  })
  observer = new ResizeObserver(() => { positionFrozenViewport(); scheduleLayout() })
  observer.observe(viewportHost.value!)
  await load()
})
watch(() => props.data, () => { if (viewer) load() })
watch(() => props.initialZoom, value => { if (!loading.value && viewer?.pdf) void zoom(value === 'fit' ? null : value) })
watch(() => props.fitRequest, requestPanelFit)
watch(() => props.sidebarFitEnabled, enabled => { if (!enabled) pendingPanelFit = false; else requestPanelFit() })
onBeforeUnmount(() => { ++epoch; clearTimeout(layoutTimer); observer?.disconnect(); releaseViewport(); viewer?.reset(); releaseCommitWaiters(); task?.destroy() })
function getViewState() {
  if (loading.value || !viewer?.pdf || !container.value) return undefined
  const number = viewer.currentPage
  return { page: number, fraction: (container.value.scrollTop - viewer.stack.offsetTop - viewer.offsets[number - 1]) / viewer.heights[number - 1], scale: fitMode ? null : viewer.displayScale, outlineOpen: outlineOpen.value }
}
defineExpose({ goToPage, getPage: () => page.value, getPdf: () => pdf, clearSelection: () => viewer?.clearOverlays(), zoomIn, zoomOut, fitWidth, nextPage, previousPage, toggleOutline, toggleCapture, getDisplayScale: () => scale.value, getViewState, holdPanelResize })
</script>

<template>
  <div class="pdf-reader reader-engine">
    <div class="reader-tools">
      <button class="quiet-button" :class="{ active: outlineOpen }" @click="toggleOutline" title="文档目录"><AppIcon name="list" :size="17" />目录</button>
      <div class="reader-page-control"><button @click="previousPage" :disabled="page <= 1" title="上一页">‹</button><input aria-label="页码" v-model.number="pageInput" type="number" min="1" :max="total" @change="goToPage(pageInput)" @keydown.enter="goToPage(pageInput)" /><span>/ {{ total || '—' }}</span><button @click="nextPage" :disabled="page >= total" title="下一页">›</button></div>
      <div class="reader-zoom"><button title="缩小" @click="zoomOut">−</button><button @click="fitWidth" title="适应宽度">{{ scale >= .01 ? Math.round(scale * 100) : Math.round(scale * 1000) / 10 }}%</button><button title="放大" @click="zoomIn">＋</button></div>
      <button class="quiet-button crop-toggle" :class="{ active: capture }" @click="toggleCapture" title="框选公式或图表作为 AI 上下文"><AppIcon name="crop" :size="17" />{{ capture ? '拖动框选' : '框选' }}</button>
    </div>
    <div class="reader-engine-body">
      <Transition name="pane" @before-enter="outlineResizeStart($event, true)" @before-leave="outlineResizeStart($event, false)" @after-enter="outlineResizeEnd" @after-leave="outlineResizeEnd" @enter-cancelled="outlineResizeEnd" @leave-cancelled="outlineResizeEnd">
        <aside v-if="outlineOpen" class="document-outline"><p class="eyebrow">文档目录</p><button v-for="(item, index) in outline" :key="index" :style="{ paddingLeft: `${12 + item.depth * 12}px` }" @click="destination(item.dest)">{{ item.title }}</button><p v-if="!outline.length" class="subtle">此文档没有目录。</p></aside>
      </Transition>
      <div ref="viewportHost" class="pdf-viewport"><div ref="container" class="pdf-scroll" tabindex="0" aria-label="PDF 阅读区域" @mouseup="selectedText" @keyup="selectedText"></div></div>
      <div v-if="loading" class="reader-overlay"><span class="spinner"></span><p>正在打开文档…</p></div>
      <div v-if="error" class="reader-overlay error-state"><AppIcon name="file" :size="34" /><p>{{ error }}</p><button @click="load">重试</button></div>
    </div>
  </div>
</template>

<style scoped>
.pdf-viewport { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.pdf-viewport > .pdf-scroll { position: absolute; inset: 0; }
</style>
