// Attaches one SVG markup layer to each rendered page slot of a continuous
// PDF viewer (or each block of a Markdown document, through an adapter with
// the same `views` / `sizes` shape) and turns pointer input into hand-drawn strokes.
//
// The viewer creates page slots per document and recycles canvases as the
// rendered window moves, so layers follow its live views reactively through a
// MutationObserver scoped to this reader's own scroll container.
import './ink.css'
import {
  DEFAULT_COLORS, DEFAULT_SIZES, HIGHLIGHTER_OPACITY, MAX_STROKE_POINTS, PAGE_UNITS,
  normalizePoint, snapUnderline, strokeHit, strokeId, strokePath,
  type InkMode, type InkStroke, type InkTool,
} from './model.ts'
import type { InkStore } from './store.ts'

const SVG = 'http://www.w3.org/2000/svg'
const ERASER_RADIUS = 9 // screen pixels
interface Layer { page: number; slot: HTMLElement; svg: SVGSVGElement; aspect: number; paths: Map<string, SVGPathElement>; dispose: () => void }
interface Gesture {
  pointer: number; layer: Layer; tool: InkMode; color: string; size: number; seed: number
  points: number[]; path?: SVGPathElement; frame: number; erased: Set<string>; last?: [number, number]
}
export interface InkLayerOptions {
  container: HTMLElement
  viewer: () => any
  /** UI state changed: history, current page contents or a status message. */
  onChange?: () => void
}

const geometry = new WeakMap<InkStroke, { aspect: number; d: string }>()
function cachedPath(stroke: InkStroke, aspect: number) {
  const cached = geometry.get(stroke)
  if (cached && Math.abs(cached.aspect - aspect) < 1e-6) return cached.d
  const d = strokePath(stroke, aspect)
  geometry.set(stroke, { aspect, d })
  return d
}

export class InkLayers {
  enabled = false
  mode: InkMode = 'pen'
  colors: Record<InkTool, string> = { ...DEFAULT_COLORS }
  status = ''
  private container: HTMLElement
  private viewer: () => any
  private onChange?: () => void
  private layers = new Map<HTMLElement, Layer>()
  private observer: MutationObserver
  private frame = 0
  private store: InkStore | null = null
  private unsubscribe?: () => void
  private gesture?: Gesture

  constructor({ container, viewer, onChange }: InkLayerOptions) {
    this.container = container; this.viewer = viewer; this.onChange = onChange
    this.observer = new MutationObserver(records => {
      // Our own path insertions are not page changes.
      if (records.some(record => !(record.target as Element).closest?.('.ink-layer'))) this.schedule()
    })
    this.observer.observe(container, { childList: true, subtree: true })
    this.schedule()
  }

  get tool(): InkTool { return this.mode === 'eraser' ? 'pen' : this.mode }

  setStore(store: InkStore | null) {
    this.cancelGesture()
    this.unsubscribe?.()
    this.store = store
    this.unsubscribe = store?.subscribe(page => this.storeChanged(page))
    for (const layer of this.layers.values()) this.render(layer)
    this.onChange?.()
  }

  setEnabled(value: boolean) {
    if (this.enabled === value) return
    this.enabled = value
    if (!value) this.cancelGesture()
    else {
      // A text selection made before entering markup mode would otherwise
      // stay highlighted (and be offered to the assistant) under the pen.
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && this.container.contains(selection.anchorNode)) selection.removeAllRanges()
    }
    this.container.classList.toggle('ink-mode', value)
    this.updateCursor()
    this.schedule()
  }

  setMode(mode: InkMode) { this.cancelGesture(); this.mode = mode; this.updateCursor() }
  setColor(color: string) { this.colors[this.tool] = color }
  private updateCursor() {
    for (const name of [...this.container.classList]) if (name.startsWith('ink-tool-')) this.container.classList.remove(name)
    if (this.enabled) this.container.classList.add(`ink-tool-${this.mode}`)
  }

  undo() { this.cancelGesture(); return this.store?.undo() ?? null }
  clearPage(page: number) { this.cancelGesture(); return this.store?.clearPage(page) ?? false }
  clearAll() { this.cancelGesture(); return this.store?.clearAll() ?? false }

  private storeChanged(page: number | null) {
    this.status = this.store?.error || ''
    for (const layer of this.layers.values()) if (page === null || layer.page === page) this.render(layer)
    this.onChange?.()
  }

  schedule() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.sync() })
  }

  /** Attach layers to the viewer's live page views and drop the rest. */
  sync() {
    const viewer = this.viewer()
    const live = new Set<HTMLElement>()
    for (const view of viewer?.views?.values?.() || []) {
      const slot = view?.slot as HTMLElement | undefined
      if (!slot?.isConnected || !this.container.contains(slot)) continue
      live.add(slot)
      const page = Number(slot.dataset.page) || view.number
      let layer = this.layers.get(slot)
      if (layer && (layer.page !== page || !layer.svg.isConnected || layer.svg.parentNode !== slot)) { this.detach(layer); layer = undefined }
      if (!layer) layer = this.attach(slot, page)
      const size = viewer.sizes?.get?.(page) || viewer.defaultSize
      const aspect = size?.width > 0 && size?.height > 0 ? size.height / size.width : 1.294
      if (Math.abs(aspect - layer.aspect) > 1e-6) {
        layer.aspect = aspect
        layer.svg.setAttribute('viewBox', `0 0 ${PAGE_UNITS} ${Math.round(PAGE_UNITS * aspect * 1000) / 1000}`)
        layer.paths.forEach(path => path.remove()); layer.paths.clear()
      }
      this.render(layer)
    }
    for (const layer of [...this.layers.values()]) if (!live.has(layer.slot) && this.gesture?.layer !== layer) this.detach(layer)
  }

  private attach(slot: HTMLElement, page: number): Layer {
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('class', 'ink-layer')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.dataset.page = String(page)
    slot.append(svg)
    const layer: Layer = { page, slot, svg, aspect: 0, paths: new Map(), dispose: () => {} }
    const down = (event: PointerEvent) => this.down(event, layer)
    const move = (event: PointerEvent) => this.move(event, layer)
    const up = (event: PointerEvent) => this.up(event, layer)
    const cancel = (event: PointerEvent) => { if (this.gesture?.pointer === event.pointerId) this.cancelGesture() }
    svg.addEventListener('pointerdown', down)
    svg.addEventListener('pointermove', move)
    svg.addEventListener('pointerup', up)
    svg.addEventListener('pointercancel', cancel)
    svg.addEventListener('lostpointercapture', cancel)
    layer.dispose = () => {
      svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', move)
      svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', cancel); svg.removeEventListener('lostpointercapture', cancel)
    }
    this.layers.set(slot, layer)
    return layer
  }

  private detach(layer: Layer) {
    layer.dispose(); layer.svg.remove()
    if (this.layers.get(layer.slot) === layer) this.layers.delete(layer.slot)
  }

  private render(layer: Layer) {
    if (!layer.aspect) return
    const strokes = this.store?.strokes(layer.page) || []
    const wanted = new Set(strokes.map(stroke => stroke.id))
    for (const [id, path] of layer.paths) if (!wanted.has(id)) { path.remove(); layer.paths.delete(id) }
    let highlight = false
    let previous: SVGPathElement | null = null
    for (const stroke of strokes) {
      if (stroke.tool === 'highlighter') highlight = true
      let path = layer.paths.get(stroke.id)
      if (!path) {
        path = document.createElementNS(SVG, 'path')
        path.setAttribute('class', `ink-stroke ink-${stroke.tool}`)
        path.dataset.strokeId = stroke.id
        path.setAttribute('fill', stroke.color)
        if (stroke.tool === 'highlighter') path.setAttribute('fill-opacity', String(HIGHLIGHTER_OPACITY))
        layer.paths.set(stroke.id, path)
      }
      path.setAttribute('d', cachedPath(stroke, layer.aspect))
      path.style.display = ''
      // Keep document order: undo restores erased strokes at their old depth.
      const expected: ChildNode | null = previous ? previous.nextSibling : layer.svg.firstChild
      if (expected !== path) layer.svg.insertBefore(path, expected)
      previous = path
    }
    if (this.gesture?.layer === layer && this.gesture.tool === 'highlighter') highlight = true
    layer.svg.classList.toggle('ink-multiply', highlight)
  }

  private point(event: PointerEvent, layer: Layer) { return normalizePoint(event.clientX, event.clientY, layer.svg.getBoundingClientRect()) }

  private down(event: PointerEvent, layer: Layer) {
    if (!this.enabled || this.gesture || !this.store) return
    // The barrel/back eraser button of a stylus erases with any tool.
    const eraserButton = event.pointerType === 'pen' && (event.button === 5 || (event.buttons & 32) !== 0)
    if (event.button !== 0 && !eraserButton) return
    event.preventDefault()
    this.container.focus({ preventScroll: true })
    try { layer.svg.setPointerCapture(event.pointerId) } catch { /* Synthetic pointers cannot be captured. */ }
    const tool: InkMode = eraserButton ? 'eraser' : this.mode
    const drawing = tool === 'eraser' ? null : tool
    const start = this.point(event, layer)
    this.gesture = {
      pointer: event.pointerId, layer, tool, frame: 0, erased: new Set(), last: start,
      color: drawing ? this.colors[drawing] : '#000000', size: drawing ? DEFAULT_SIZES[drawing] : 0,
      seed: Math.floor(Math.random() * 0x7fffffff), points: [start[0], start[1]],
    }
    if (tool === 'eraser') { this.erase(start, start); return }
    const path = this.gesture.path = document.createElementNS(SVG, 'path')
    path.setAttribute('class', `ink-stroke ink-live ink-${tool}`)
    path.setAttribute('fill', this.gesture.color)
    if (tool === 'highlighter') { path.setAttribute('fill-opacity', String(HIGHLIGHTER_OPACITY)); layer.svg.classList.add('ink-multiply') }
    layer.svg.append(path)
  }

  private move(event: PointerEvent, layer: Layer) {
    const gesture = this.gesture
    if (!gesture || gesture.pointer !== event.pointerId || gesture.layer !== layer) return
    event.preventDefault()
    const rect = layer.svg.getBoundingClientRect()
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
    for (const sample of events.length ? events : [event]) {
      const point = normalizePoint(sample.clientX, sample.clientY, rect)
      if (gesture.tool === 'eraser') { this.erase(gesture.last || point, point); gesture.last = point; continue }
      if (gesture.tool === 'underline') {
        const aspect = layer.aspect || 1
        const end = snapUnderline([gesture.points[0], gesture.points[1] * aspect], [point[0], point[1] * aspect])
        gesture.points = [gesture.points[0], gesture.points[1], end[0], end[1] / aspect]
        continue
      }
      // Skip sub-pixel jitter; it only adds stored points, not shape.
      const last = gesture.points.length - 2
      if (Math.hypot((point[0] - gesture.points[last]) * rect.width, (point[1] - gesture.points[last + 1]) * rect.height) < .4) continue
      if (gesture.points.length / 2 >= MAX_STROKE_POINTS) break
      gesture.points.push(point[0], point[1])
    }
    if (gesture.tool !== 'eraser' && !gesture.frame) gesture.frame = requestAnimationFrame(() => { gesture.frame = 0; this.drawLive(gesture) })
  }

  private drawLive(gesture: Gesture) {
    if (this.gesture !== gesture || !gesture.path || gesture.tool === 'eraser') return
    gesture.path.setAttribute('d', strokePath({ tool: gesture.tool, size: gesture.size, seed: gesture.seed, points: gesture.points }, gesture.layer.aspect || 1, false))
  }

  private up(event: PointerEvent, layer: Layer) {
    const gesture = this.gesture
    if (!gesture || gesture.pointer !== event.pointerId || gesture.layer !== layer) return
    this.move(event, layer)
    this.gesture = undefined
    cancelAnimationFrame(gesture.frame)
    try { if (layer.svg.hasPointerCapture(event.pointerId)) layer.svg.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    if (gesture.tool === 'eraser') {
      if (gesture.erased.size) this.store?.erase(layer.page, gesture.erased)
      this.render(layer)
      return
    }
    const rect = layer.svg.getBoundingClientRect()
    const points = gesture.points
    const span = Math.hypot((points[points.length - 2] - points[0]) * rect.width, (points[points.length - 1] - points[1]) * rect.height)
    // A tap is not a mark; an underline needs a short drag.
    const keep = points.length >= 4 && (gesture.tool !== 'underline' || span >= 4)
    const stroke: InkStroke = { id: strokeId(), tool: gesture.tool, color: gesture.color, size: gesture.size, seed: gesture.seed, points }
    const added = keep && !!this.store?.add(layer.page, stroke)
    if (keep && !added) { this.status = '本文档的标记已达上限，请先擦除一部分。'; this.onChange?.() }
    gesture.path?.remove()
    this.render(layer)
  }

  private erase(from: [number, number], to: [number, number]) {
    const gesture = this.gesture, layer = gesture?.layer
    if (!gesture || !layer || !this.store) return
    const rect = layer.svg.getBoundingClientRect()
    if (!rect.width) return
    const aspect = layer.aspect || 1, radius = ERASER_RADIUS * PAGE_UNITS / rect.width
    const a: [number, number] = [from[0] * PAGE_UNITS, from[1] * PAGE_UNITS * aspect], b: [number, number] = [to[0] * PAGE_UNITS, to[1] * PAGE_UNITS * aspect]
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (radius / 2)))
    for (const stroke of this.store.strokes(layer.page)) {
      if (gesture.erased.has(stroke.id)) continue
      for (let step = 0; step <= steps; step++) {
        const t = step / steps
        if (!strokeHit(stroke, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], radius, aspect)) continue
        gesture.erased.add(stroke.id)
        const path = layer.paths.get(stroke.id)
        if (path) path.style.display = 'none'
        break
      }
    }
  }

  private cancelGesture() {
    const gesture = this.gesture
    if (!gesture) return
    this.gesture = undefined
    cancelAnimationFrame(gesture.frame)
    gesture.path?.remove()
    try { if (gesture.layer.svg.hasPointerCapture(gesture.pointer)) gesture.layer.svg.releasePointerCapture(gesture.pointer) } catch { /* already released */ }
    this.render(gesture.layer)
  }

  dispose() {
    this.cancelGesture()
    cancelAnimationFrame(this.frame); this.frame = 0
    this.observer.disconnect()
    this.unsubscribe?.(); this.unsubscribe = undefined
    for (const layer of [...this.layers.values()]) this.detach(layer)
    this.container.classList.remove('ink-mode')
    this.updateCursor()
  }
}
