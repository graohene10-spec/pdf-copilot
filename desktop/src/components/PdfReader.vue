<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount, nextTick } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'
import { ContinuousPdfViewer } from '../reader/continuous.mjs'
import { cropImage } from '../../../extension/reader/selection.mjs'
import { availableReadingWidth, shrinkToFitScale, clampPdfScale } from '../reader/layout.mjs'
import AppIcon from './AppIcon.vue'
import ReaderSearch from './ReaderSearch.vue'
import { normalizeSearchText, scanPdfMatches } from '../reader/search.mjs'
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
  findShortcut?: string
  initialView?: { page: number; fraction: number; scale: number | null; outlineOpen: boolean; search?: { query: string; current: number } }
}>(), { initialPage: 1, sidebarFitEnabled: true, initialZoom: 'fit', zoomStep: .1, fitRequest: 0 })
const emit = defineEmits<{
  ready: [value: { pdf: any; page: number }]
  progress: [value: { page: number; pageCount: number; progress: number }]
  selection: [value: { text: string; page: number; image?: string; rect?: any; captureFrame?: { left: number; top: number; width: number; height: number } }]
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
const transientMarkers = new Set<() => void>()
let active = true
let activation = 0
let cachedView: { page: number; fraction: number; scale: number | null; outlineOpen: boolean; search?: { query: string; current: number } } | undefined
type SearchMatch = { page: number; segments: { item: number; start: number; end: number }[] }
const searchControl = ref<InstanceType<typeof ReaderSearch>>()
const searchQuery = ref(props.initialView?.search?.query || '')
const searchMatches = shallowRef<SearchMatch[]>([])
const searchCurrent = ref(-1)
const searchBusy = ref(false)
const searchStatus = ref('')
const searchCount = computed(() => searchCurrent.value < 0 ? 0 : searchCurrent.value + 1)
let searchController: AbortController | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchedPages = 0
let searchComplete = false
let searchNavigation = 0
let searchDesiredIndex = props.initialView?.search?.current ?? 0
let restoringSearch = !!props.initialView?.search?.query

function removeSearchHighlights() { container.value?.querySelectorAll('.pdf-search-highlights').forEach(node => node.remove()) }
function highlightSearch(view: any) {
  view.slot.querySelector('.pdf-search-highlights')?.remove()
  if (!active || !view.ready || view.disposed || !searchQuery.value || !view.layer?.textDivs) return
  const matches = searchMatches.value.map((match, index) => ({ match, index })).filter(({ match }) => match.page === view.number)
  if (!matches.length) return
  const overlay = document.createElement('div')
  overlay.className = 'pdf-search-highlights'
  overlay.setAttribute('aria-hidden', 'true')
  const bounds = view.slot.getBoundingClientRect()
  let markers = 0
  for (const { match, index } of matches) {
    // Dense single-letter searches must not turn one cached page into an
    // unbounded DOM layer. The selected result is always drawn in full.
    if (markers >= 1200 && index !== searchCurrent.value) continue
    for (const segment of match.segments) {
      const span = view.layer.textDivs[segment.item] as HTMLElement | undefined
      const text = span?.firstChild
      if (!text || text.nodeType !== Node.TEXT_NODE || !text.textContent) continue
      const range = document.createRange()
      const end = Math.min(segment.end, text.textContent.length), start = Math.min(segment.start, end)
      if (start === end) continue
      range.setStart(text, start); range.setEnd(text, end)
      for (const rectangle of range.getClientRects()) {
        if (rectangle.width < .1 || rectangle.height < .1) continue
        const marker = document.createElement('span')
        marker.className = `document-search-hit${index === searchCurrent.value ? ' document-search-current' : ''}`
        marker.dataset.match = String(index)
        Object.assign(marker.style, { left: `${rectangle.left - bounds.left}px`, top: `${rectangle.top - bounds.top}px`, width: `${rectangle.width}px`, height: `${rectangle.height}px` })
        overlay.append(marker)
        markers++
      }
    }
  }
  view.slot.append(overlay)
}
function highlightRenderedSearch() { for (const view of viewer?.views?.values() || []) highlightSearch(view) }
function stopSearch() { clearTimeout(searchTimer); searchTimer = undefined; searchController?.abort(); searchController = undefined; ++searchNavigation }
function clearSearch() {
  const hadSearch = !!searchQuery.value || document.activeElement === searchControl.value?.$el?.querySelector('input')
  stopSearch(); searchQuery.value = ''; searchMatches.value = []; searchCurrent.value = -1; searchBusy.value = false; searchStatus.value = ''; searchedPages = 0; searchComplete = false; searchDesiredIndex = 0
  removeSearchHighlights()
  return hadSearch
}
function focusSearch() { searchControl.value?.focus() }
async function revealSearch(index: number) {
  if (!active || !searchMatches.value.length || !viewer?.pdf) return
  const normalized = (index + searchMatches.value.length) % searchMatches.value.length
  const match = searchMatches.value[normalized], navigation = ++searchNavigation
  searchCurrent.value = normalized
  highlightRenderedSearch()
  const current = epoch, visible = activation
  const view = await viewer.goToPage(match.page)
  if (!view || !active || current !== epoch || visible !== activation || navigation !== searchNavigation || searchMatches.value[normalized] !== match) return
  highlightSearch(view)
  const marker = view.slot.querySelector('.document-search-current') as HTMLElement | null
  if (marker && container.value) {
    const hit = marker.getBoundingClientRect(), surface = container.value.getBoundingClientRect()
    container.value.scrollTop += hit.top - surface.top - container.value.clientHeight * .35
    const left = hit.left - surface.left, right = hit.right - surface.right
    if (left < 0) container.value.scrollLeft += left - 20
    else if (right > 0) container.value.scrollLeft += right + 20
    viewer.explicitPosition = { page: match.page, top: container.value.scrollTop }
  }
}
function nextSearch() { return revealSearch(searchCurrent.value + 1) }
function previousSearch() { return revealSearch(searchCurrent.value - 1) }
async function runSearch() {
  if (!active || !pdf || loading.value || !normalizeSearchText(searchQuery.value) || searchComplete) return
  searchController?.abort()
  const controller = searchController = new AbortController(), document = pdf, current = epoch
  searchBusy.value = true; searchStatus.value = '正在搜索文档…'
  try {
    const result = await scanPdfMatches(document, searchQuery.value, {
      signal: controller.signal, startPage: searchedPages + 1, limit: Math.max(0, 10000 - searchMatches.value.length),
      onPage(number: number, matches: Omit<SearchMatch, 'page'>[]) {
        if (controller.signal.aborted || !active || document !== pdf || current !== epoch) return
        searchedPages = number
        if (!matches.length) return
        searchMatches.value = [...searchMatches.value, ...matches.map(match => ({ ...match, page: number }))]
        const view = viewer?.views?.get(number)
        if (view) highlightSearch(view)
        if (searchCurrent.value < 0 && searchMatches.value.length > searchDesiredIndex) {
          if (restoringSearch) { searchCurrent.value = searchDesiredIndex; highlightRenderedSearch() }
          else void revealSearch(searchDesiredIndex)
        }
      },
      releasePage(number: number, page: any) { if (document === pdf && !viewer?.views?.has(number)) page.cleanup() },
    })
    if (controller.signal.aborted || !active || document !== pdf || current !== epoch) return
    searchComplete = true; searchBusy.value = false
    searchStatus.value = result.limited ? '仅显示前 10000 处匹配' : searchMatches.value.length ? '' : '没有找到匹配文字；扫描版 PDF 需要文字层。'
    if (searchCurrent.value < 0 && searchMatches.value.length) {
      const index = Math.min(searchDesiredIndex, searchMatches.value.length - 1)
      if (restoringSearch) { searchCurrent.value = index; highlightRenderedSearch() }
      else void revealSearch(index)
    }
    restoringSearch = false
  } catch (reason: any) {
    if (controller.signal.aborted || current !== epoch || document !== pdf) return
    searchBusy.value = false; searchStatus.value = reason?.message || '无法搜索文档文字。'
  } finally { if (searchController === controller) searchController = undefined }
}
function changeSearch() {
  stopSearch(); searchedPages = 0; searchComplete = false; searchMatches.value = []; searchCurrent.value = -1; searchDesiredIndex = 0; restoringSearch = false; searchStatus.value = ''; removeSearchHighlights()
  searchBusy.value = !!normalizeSearchText(searchQuery.value)
  if (active && searchBusy.value) searchTimer = setTimeout(() => { searchTimer = undefined; void runSearch() }, 160)
}
watch(searchQuery, changeSearch)

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
  if (!active) return
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
        if (!active || current !== epoch || document !== pdf || (deferLayout && (panelResizeHeld || outlineResizeHeld || stagedPage !== viewer.currentPage))) return false
        releaseViewport()
        return true
      },
    })
    if (active && revision === renderRevision && current === epoch && document === pdf) {
      scale.value = viewer.displayScale || 1
      // Scrolling can release the staged page. Refit the new active page
      // rather than leaving a canceled resize as the last measured width.
      if (deferLayout && !panelResizeHeld && !outlineResizeHeld && !viewer.active?.failed && Math.abs(target - viewer.displayScale) > .000001) {
        if (!fitMode) pendingPanelFit = true
        scheduleLayout()
      }
      if (viewer.active?.failed && !panelResizeHeld && !outlineResizeHeld) releaseViewport()
    }
  } catch (reason: any) { if (active && revision === renderRevision && current === epoch) emit('error', reason?.message || '无法调整 PDF 缩放。') }
}
async function renderFit() {
  // The desktop viewer computes this once from the current page's measured
  // size, rather than rendering the first-page fit and correcting it later.
  await renderZoom(null)
}
function scheduleLayout() {
  if (!active) return
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
  if (!active || prepareScheduled) return
  prepareScheduled = true
  const current = epoch
  void nextTick(() => {
    prepareScheduled = false
    if (!active || current !== epoch || loading.value || !viewer?.pdf || (!panelResizeHeld && !outlineResizeHeld)) return
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
    if (!active || current !== epoch || panelResizeHeld || outlineResizeHeld) return
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
  if (!active) return
  if (panelResizeHeld || outlineResizeHeld) preparePanelLayout()
  else scheduleLayout()
}
async function refreshLayout() {
  if (!active || loading.value || !viewer?.pdf) return
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
  if (!active || !pdf) return
  if (typeof dest === 'string') dest = await pdf.getDestination(dest)
  if (!Array.isArray(dest)) return
  const number = typeof dest[0] === 'number' ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1
  await goToPage(number)
}
async function goToPage(number: number, rect?: any) {
  if (!active) return
  const view = await viewer?.goToPage(number)
  if (rect && view) {
    const [x1, y1] = view.viewport.convertToViewportPoint(rect.x, rect.y)
    const [x2, y2] = view.viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height)
    const marker = document.createElement('div')
    marker.className = 'citation-highlight'
    Object.assign(marker.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` })
    view.slot.append(marker)
    const timer = setTimeout(() => { marker.remove(); transientMarkers.delete(clear) }, 4500)
    const clear = () => { clearTimeout(timer); marker.remove(); transientMarkers.delete(clear) }
    transientMarkers.add(clear)
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
function cancelCapture() {
  if (!capture.value) return false
  capture.value = false; viewer?.capture(false)
  return true
}
function getCaptureElements(selection: { page: number; image?: string }) {
  if (!active || !selection?.image) return []
  const view = viewer?.views?.get(selection.page)
  if (!view || view.disposed) return []
  return [viewportHost.value, container.value, view.slot, view.canvas].filter((element): element is HTMLElement => !!element?.isConnected)
}
function getCaptureFrame(selection: { page: number; image?: string; rect?: any }) {
  if (!active || !selection?.image || selection.rect?.space !== 'pdf-points') return
  const rect = selection.rect
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return
  const view = viewer?.views?.get(selection.page)
  if (!view?.ready || view.disposed || !view.viewport || !view.canvas?.isConnected || !container.value) return
  const canvas = view.canvas.getBoundingClientRect()
  const visible = container.value.getBoundingClientRect()
  if (!canvas.width || !canvas.height || !view.viewport.width || !view.viewport.height) return
  const [x1, y1] = view.viewport.convertToViewportPoint(rect.x, rect.y)
  const [x2, y2] = view.viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height)
  const scaleX = canvas.width / view.viewport.width, scaleY = canvas.height / view.viewport.height
  const left = Math.max(0, visible.left, canvas.left + Math.min(x1, x2) * scaleX)
  const top = Math.max(0, visible.top, canvas.top + Math.min(y1, y2) * scaleY)
  const right = Math.min(window.innerWidth, visible.right, canvas.left + Math.max(x1, x2) * scaleX)
  const bottom = Math.min(window.innerHeight, visible.bottom, canvas.top + Math.max(y1, y2) * scaleY)
  if (right <= left || bottom <= top) return
  return { left, top, width: right - left, height: bottom - top }
}
/* Freeze before Vue changes the panel layout, then commit one fitted frame. */
function holdPanelResize(held: boolean, fitOverflow = false) {
  if (!active) return
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
  if (!active) return
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
  if (!active) return
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !container.value?.contains(selection.anchorNode)) return
  const text = selection.toString().trim().slice(0, 16000)
  const selectedPage = Number((selection.anchorNode?.parentElement?.closest('.page-slot') as HTMLElement | null)?.dataset.page) || page.value
  if (text) emit('selection', { text, page: selectedPage })
}
async function load() {
  stopSearch(); searchedPages = 0; searchComplete = false; searchMatches.value = []; searchCurrent.value = -1; removeSearchHighlights()
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
    if (!fitMode && active) await renderZoom(props.initialView?.scale ?? clampPdfScale(props.initialZoom))
    await viewer.goToPage(Math.max(1, Math.min(restorePage, total.value)))
    if (epoch !== current) return
    if (fitMode && active) {
      const target = overflowScale()
      if (target !== null) await renderZoom(target)
    }
    if (epoch !== current) return
    if (props.initialView && container.value && active) {
      const number = viewer.currentPage
      container.value.scrollTop = viewer.stack.offsetTop + viewer.offsets[number - 1] + props.initialView.fraction * viewer.heights[number - 1]
      viewer.explicitPosition = { page: number, top: container.value.scrollTop }
    }
    if (active) lastAvailableWidth = readingWidth()
    loading.value = false
    if (pendingPanelFit) scheduleLayout()
    if (!active) cachedView = props.initialView || { page: restorePage, fraction: 0, scale: fitMode ? null : clampPdfScale(props.initialZoom), outlineOpen: outlineOpen.value }
    if (active) {
      emit('progress', { page: page.value, pageCount: total.value, progress: page.value / total.value })
      emit('ready', { pdf, page: page.value })
      if (searchQuery.value) void runSearch()
    }
    const entries = await pdf.getOutline()
    const flat: any[] = []
    function flatten(items: any[], depth = 0) { for (const item of items || []) { if (flat.length >= 1000 || depth > 20) break; flat.push({ title: item.title, dest: item.dest, depth }); flatten(item.items, depth + 1) } }
    flatten(entries); if (epoch === current) outline.value = flat
  } catch (reason: any) {
    if (current !== epoch) return
    error.value = reason?.message || '无法读取 PDF。'
    loading.value = false; if (active) emit('error', error.value)
  }
}
onMounted(async () => {
  await nextTick()
  viewer = new ContinuousPdfViewer({
    container: container.value, pdfjs,
    onPageChange(number: number, zoom: number) { if (!active) return; page.value = pageInput.value = number; scale.value = zoom; container.value?.querySelectorAll('.pdf-search-highlights').forEach(node => { if (!viewer.views.has(Number((node.parentElement as HTMLElement)?.dataset.page))) node.remove() }); if (panelResizeHeld || outlineResizeHeld) preparePanelLayout(); if (!loading.value) emit('progress', { page: number, pageCount: total.value, progress: total.value ? number / total.value : 0 }) },
    async onPageReady(view: any) {
      if (!active) return
      highlightSearch(view)
      if ((panelResizeHeld || outlineResizeHeld) && view.number === viewer.currentPage) preparePanelLayout()
      if (pendingPanelFit && view.number === viewer.currentPage) scheduleLayout()
      if (indexedText.has(view.number) || indexedCharacters >= 2000000) return
      const current = epoch
      const visible = activation
      let content
      try { content = await view.page.getTextContent() }
      catch (reason: any) { if (active && visible === activation && current === epoch && !view.disposed) emit('error', reason?.message || '无法读取页面文字。'); return }
      if (current !== epoch || view.disposed) return
      const text = content.items.map((item: any) => item.str || '').join(' ').slice(0, 2000000 - indexedCharacters)
      indexedText.set(view.number, text); indexedCharacters += text.length
      if (active && visible === activation) emit('text', collectedText())
    },
    onSelect(view: any, rect: any) {
      if (!active) return
      const [x1, y1] = view.viewport.convertToPdfPoint(rect.x, rect.y)
      const [x2, y2] = view.viewport.convertToPdfPoint(rect.x + rect.width, rect.y + rect.height)
      const image = cropImage(view.canvas, rect, view.viewport.width, view.viewport.height)
      const selected = { text: '', page: view.number, image, rect: { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), space: 'pdf-points' } }
      emit('selection', { ...selected, captureFrame: getCaptureFrame(selected) })
      capture.value = false; viewer.capture(false)
    },
    onDestination: destination,
    onSelectionPending() {},
    onError(reason: any) { if (active) emit('error', reason?.message || String(reason)) },
  })
  observer = new ResizeObserver(() => { if (active) { positionFrozenViewport(); scheduleLayout() } })
  if (active) observer.observe(viewportHost.value!)
  else viewer.suspend()
  await load()
})
watch(() => props.data, () => { if (viewer) load() })
watch(() => props.initialZoom, value => { if (active && !loading.value && viewer?.pdf) void zoom(value === 'fit' ? null : value) })
watch(() => props.fitRequest, requestPanelFit)
watch(() => props.sidebarFitEnabled, enabled => { if (!enabled) pendingPanelFit = false; else requestPanelFit() })
onBeforeUnmount(() => { stopSearch(); removeSearchHighlights(); active = false; ++activation; ++epoch; clearTimeout(layoutTimer); observer?.disconnect(); releaseViewport(); viewer?.reset(); releaseCommitWaiters(); for (const clear of transientMarkers) clear(); task?.destroy() })
function getViewState() {
  if (!active) return cachedView
  if (loading.value || !viewer?.pdf || !container.value) return undefined
  const number = viewer.currentPage
  return { page: number, fraction: (container.value.scrollTop - viewer.stack.offsetTop - viewer.offsets[number - 1]) / viewer.heights[number - 1], scale: fitMode ? null : viewer.displayScale, outlineOpen: outlineOpen.value, search: { query: searchQuery.value, current: Math.max(0, searchCurrent.value) } }
}

function collectedText() { return [...indexedText.entries()].sort(([a], [b]) => a - b).map(([n, text]) => `第 ${n} 页\n${text}`).join('\n\n') }
function suspend() {
  if (!active) return
  cachedView = getViewState()
  stopSearch(); removeSearchHighlights()
  active = false; ++activation; ++renderRevision
  clearTimeout(layoutTimer); observer?.disconnect()
  for (const clear of transientMarkers) clear()
  capture.value = false
  viewer?.suspend()
  panelResizeHeld = outlineResizeHeld = false
  pendingPanelFit = false; prepareScheduled = false; suppressPanelFit = false
  releaseViewport(); releaseCommitWaiters()
}
async function resume() {
  if (active) return
  active = true
  const visible = ++activation
  await nextTick()
  if (!active || visible !== activation || !viewer) return
  viewer.resume()
  observer?.observe(viewportHost.value!)
  if (loading.value) return
  if (error.value) { emit('error', error.value); return }
  if (!pdf) return
  if (cachedView && container.value && viewer.heights) {
    const number = Math.max(1, Math.min(total.value, cachedView.page))
    viewer.currentPage = number
    container.value.scrollTop = viewer.stack.offsetTop + viewer.offsets[number - 1] + cachedView.fraction * viewer.heights[number - 1]
    viewer.explicitPosition = { page: number, top: container.value.scrollTop }
  }
  // Rebind the parent's active-document API immediately without parsing the
  // file again. The existing current-page bitmap stays visible during refit.
  emit('ready', { pdf, page: viewer.currentPage })
  if (indexedText.size) emit('text', collectedText())
  if (cachedView?.scale != null && Math.abs(cachedView.scale - viewer.displayScale) > .000001) await renderZoom(cachedView.scale, true)
  if (!active || visible !== activation) return
  pendingPanelFit = props.sidebarFitEnabled && readingWidth() < lastAvailableWidth - .5
  await refreshLayout()
  if (!active || visible !== activation) return
  viewer.updateWindow(viewer.currentPage)
  highlightRenderedSearch()
  if (searchQuery.value && !searchComplete) void runSearch()
}
onActivated(resume)
onDeactivated(suspend)
defineExpose({ goToPage, getPage: () => page.value, getPdf: () => pdf, clearSelection: () => viewer?.clearOverlays(), getCaptureFrame, getCaptureElements, zoomIn, zoomOut, fitWidth, nextPage, previousPage, toggleOutline, toggleCapture, cancelCapture, focusSearch, clearSearch, getDisplayScale: () => scale.value, getViewState, holdPanelResize, suspend, resume, getCacheStats: () => viewer?.getCacheStats() })
</script>

<template>
  <div class="pdf-reader reader-engine">
    <div class="reader-tools">
      <button class="quiet-button" :class="{ active: outlineOpen }" @click="toggleOutline" title="文档目录"><AppIcon name="list" :size="17" />目录</button>
      <div class="reader-page-control"><button @click="previousPage" :disabled="page <= 1" title="上一页">‹</button><input aria-label="页码" v-model.number="pageInput" type="number" min="1" :max="total" @change="goToPage(pageInput)" @keydown.enter="goToPage(pageInput)" /><span>/ {{ total || '—' }}</span><button @click="nextPage" :disabled="page >= total" title="下一页">›</button></div>
      <div class="reader-zoom"><button title="缩小" @click="zoomOut">−</button><button @click="fitWidth" title="适应宽度">{{ scale >= .01 ? Math.round(scale * 100) : Math.round(scale * 1000) / 10 }}%</button><button title="放大" @click="zoomIn">＋</button></div>
      <button class="quiet-button crop-toggle" :class="{ active: capture }" @click="toggleCapture" title="框选公式或图表作为 AI 上下文"><AppIcon name="crop" :size="17" />{{ capture ? '拖动框选' : '框选' }}</button>
      <ReaderSearch ref="searchControl" v-model="searchQuery" :busy="searchBusy" :current="searchCount" :total="searchMatches.length" :status="searchStatus" :shortcut="findShortcut" @next="nextSearch" @previous="previousSearch" @clear="clearSearch" />
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
:deep(.pdf-search-highlights) { position: absolute; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
:deep(.document-search-hit) { position: absolute; background: rgba(235, 181, 44, .32); mix-blend-mode: multiply; }
:deep(.document-search-current) { background: rgba(245, 138, 33, .5); outline: 1px solid rgba(155, 83, 15, .75); }
:global(:root[data-theme='dark']) :deep(.document-search-hit) { mix-blend-mode: normal; background: rgba(241, 194, 69, .32); }
:global(:root[data-theme='dark']) :deep(.document-search-current) { background: rgba(244, 150, 50, .5); outline-color: rgba(255, 210, 128, .8); }
</style>
