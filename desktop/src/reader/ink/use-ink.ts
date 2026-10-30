// Vue glue for hand-drawn markup on PDF pages and Markdown blocks: mode, tools, persistence and keys.
import { reactive, watch, onMounted, onDeactivated, onBeforeUnmount, type Ref } from 'vue'
import { library } from '../../sdk'
import { InkLayers } from './layers.ts'
import { acquireInkStore, releaseInkStore, type InkStore } from './store.ts'
import { DEFAULT_COLORS, type InkMode, type InkTool } from './model.ts'

export interface PdfInkOptions {
  container: Ref<HTMLElement | undefined>
  viewer: () => any
  documentId: () => string | undefined
  page: Ref<number>
  capture: Ref<boolean>
  cancelCapture: () => unknown
  /** 'document': marks hang on Markdown blocks, so "clear" and "has ink" cover the whole document. */
  scope?: 'page' | 'document'
}
export type PdfInk = ReturnType<typeof usePdfInk>

// The reader most recently used for markup answers keys pressed while focus
// rests on the page body (e.g. after the focused palette button was disabled).
let lastActive: object | null = null
const unfocused = (target: EventTarget | null) => !target || target === document.body || target === document.documentElement || target === document
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')

export function usePdfInk(options: PdfInkOptions) {
  const state = reactive({ enabled: false, mode: 'pen' as InkMode, colors: { ...DEFAULT_COLORS } as Record<InkTool, string>, lastTool: 'pen' as InkTool, canUndo: false, pageHasInk: false, selected: 0, status: '' })
  let layers: InkLayers | undefined
  let store: InkStore | undefined
  let root: HTMLElement | null = null
  const token = {}

  function refresh() {
    state.canUndo = !!store?.canUndo
    state.pageHasInk = options.scope === 'document' ? !!store?.hasInk : !!store?.strokes(options.page.value).length
    state.status = layers?.status || store?.error || ''
    state.selected = layers?.selectedCount || 0
    // Markdown attaches layers only to blocks that carry marks (or near the view while drawing).
    if (options.scope === 'document') layers?.schedule()
  }
  function openStore() {
    if (store) releaseInkStore(store)
    store = acquireInkStore(options.documentId(), library)
    layers?.setStore(store)
    void store.loaded.then(refresh)
    refresh()
  }

  function setEnabled(value: boolean) {
    if (value === state.enabled) return
    if (value) { options.cancelCapture(); lastActive = token }
    state.enabled = value
    layers?.setEnabled(value)
    if (!value) void store?.flush()
  }
  const toggle = () => setEnabled(!state.enabled)
  /** Leave markup mode; true when it was on. */
  function exit() { if (!state.enabled) return false; setEnabled(false); return true }
  function setMode(mode: InkMode) {
    state.mode = mode
    if (mode !== 'eraser' && mode !== 'select') state.lastTool = mode
    layers?.setMode(mode)
  }
  /** Shortcut for one drawing tool: turns markup on with that tool, or off when it is already the active tool. */
  function pick(tool: InkTool) {
    if (state.enabled && state.mode === tool) { setEnabled(false); return }
    setEnabled(true)
    setMode(tool)
  }
  function setColor(color: string) {
    // With strokes selected, a colour recolours them; otherwise picking an ink returns to the last drawing tool.
    if (state.mode === 'select' && layers?.recolorSelection(color)) { refresh(); return }
    if (state.mode === 'eraser' || state.mode === 'select') setMode(state.lastTool)
    state.colors[state.lastTool] = color
    layers?.setColor(color)
  }
  function undo() { layers?.undo(); refresh() }
  function deleteSelection() { layers?.deleteSelection(); refresh() }
  function clearPage() { if (options.scope === 'document') layers?.clearAll(); else layers?.clearPage(options.page.value); refresh() }

  function keydown(event: KeyboardEvent) {
    if (!state.enabled || event.defaultPrevented || event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); if (!layers?.clearSelection()) setEnabled(false); return }
    if (state.mode === 'select' && !editable(event.target)) {
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.selected) { event.preventDefault(); deleteSelection(); return }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === 'KeyA') {
        event.preventDefault()
        layers?.selectAll(options.scope === 'document' ? (store?.document.pages.keys() || []) : [options.page.value])
        return
      }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === 'KeyZ' && !editable(event.target)) { event.preventDefault(); undo() }
  }
  const flush = () => { void store?.flush() }
  const claim = () => { lastActive = token }
  const fallback = (event: KeyboardEvent) => { if (lastActive === token && unfocused(event.target)) keydown(event) }

  watch(options.capture, value => { if (value) setEnabled(false) })
  watch(options.page, refresh)
  watch(options.documentId, () => { if (layers) openStore() })
  onMounted(() => {
    const container = options.container.value
    if (!container) return
    layers = new InkLayers({ container, viewer: options.viewer, onChange: refresh })
    root = container.closest('.reader-engine')
    root?.addEventListener('keydown', keydown)
    root?.addEventListener('pointerdown', claim, true)
    window.addEventListener('keydown', fallback, true)
    window.addEventListener('pagehide', flush)
    openStore()
  })
  // A cached tab keeps its marks; it simply leaves markup mode.
  onDeactivated(() => { setEnabled(false); flush() })
  onBeforeUnmount(() => {
    root?.removeEventListener('keydown', keydown)
    root?.removeEventListener('pointerdown', claim, true)
    window.removeEventListener('keydown', fallback, true)
    if (lastActive === token) lastActive = null
    window.removeEventListener('pagehide', flush)
    layers?.dispose(); layers = undefined
    if (store) releaseInkStore(store)
    store = undefined
  })
  return { state, toggle, exit, pick, setMode, setColor, undo, clearPage, deleteSelection, schedule: () => layers?.schedule(), hasInk: (page: number) => !!store?.strokes(page).length }
}
