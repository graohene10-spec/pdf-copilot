import { ref, shallowRef, type Ref } from 'vue'

// 像 Windows 资源管理器那样：在空白处按住左键拖出一个框，框到的项目被选中。
// Ctrl / ⌘ 拖动在原有选择上反选，Shift 拖动追加；没拖动只是点一下空白处则清空选择。
// 拖到滚动区上下边缘时自动滚动，框跟着内容走。
export type RubberBandOptions = {
  /** 可滚动的容器：在它的空白处按下才开始框选。 */
  container: () => HTMLElement | null | undefined
  /** 当前可被框选的元素及其编号。 */
  items: () => { id: string; element: HTMLElement }[]
  selected: Ref<Set<string>>
  /** 按在这些元素上不开始框选（卡片、按钮、输入框……）。 */
  ignore?: (target: Element) => boolean
  threshold?: number
}

export type Box = { left: number; top: number; width: number; height: number }
const EDGE = 44 // 离上下边缘多近开始自动滚动
const intersects = (a: Box, b: DOMRect | Box) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top

/** 框选的几何：起点、当前点（都是内容坐标）→ 内容坐标里的矩形。 */
export function bandRect(start: [number, number], end: [number, number]): Box {
  const left = Math.min(start[0], end[0]), top = Math.min(start[1], end[1])
  return { left, top, width: Math.abs(end[0] - start[0]), height: Math.abs(end[1] - start[1]) }
}

/** 拖动结束时的选择：普通拖动替换，Shift 追加，Ctrl 反选。 */
export function combineSelection(base: Set<string>, hit: Iterable<string>, mode: 'replace' | 'add' | 'toggle') {
  if (mode === 'replace') return new Set(hit)
  const next = new Set(base)
  for (const id of hit) if (mode === 'add' || !base.has(id)) next.add(id); else next.delete(id)
  return next
}

export function useRubberBand(options: RubberBandOptions) {
  /** 屏幕上的框（视口坐标，已裁到容器内），没有在框选时为 null。 */
  const box = shallowRef<Box | null>(null)
  const active = ref(false)
  let state: {
    pointer: number; root: HTMLElement; start: [number, number]; client: [number, number]
    base: Set<string>; mode: 'replace' | 'add' | 'toggle'; moved: boolean; frame: number
  } | undefined

  const content = (root: HTMLElement, x: number, y: number): [number, number] => {
    const rect = root.getBoundingClientRect()
    return [x - rect.left + root.scrollLeft, y - rect.top + root.scrollTop]
  }

  function update() {
    if (!state) return
    const { root, start, client } = state
    const end = content(root, client[0], client[1])
    const band = bandRect(start, end)
    const rect = root.getBoundingClientRect()
    // 画在视口里：内容坐标换回屏幕坐标，再裁到容器可见范围内。
    const left = Math.max(rect.left, band.left + rect.left - root.scrollLeft), top = Math.max(rect.top, band.top + rect.top - root.scrollTop)
    const right = Math.min(rect.right, band.left + band.width + rect.left - root.scrollLeft), bottom = Math.min(rect.bottom, band.top + band.height + rect.top - root.scrollTop)
    box.value = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
    const hit: string[] = []
    for (const { id, element } of options.items()) {
      const own = element.getBoundingClientRect()
      if (intersects(band, { left: own.left - rect.left + root.scrollLeft, top: own.top - rect.top + root.scrollTop, width: own.width, height: own.height })) hit.push(id)
    }
    options.selected.value = combineSelection(state.base, hit, state.mode)
  }

  // 指针停在上下边缘附近时持续滚动，框随之延伸。
  function autoscroll() {
    if (!state) return
    state.frame = 0
    const rect = state.root.getBoundingClientRect(), y = state.client[1]
    const speed = y < rect.top + EDGE ? -Math.ceil((rect.top + EDGE - y) / 3) : y > rect.bottom - EDGE ? Math.ceil((y - rect.bottom + EDGE) / 3) : 0
    if (!speed) return
    const before = state.root.scrollTop
    state.root.scrollTop += speed
    if (state.root.scrollTop !== before) update()
    state.frame = requestAnimationFrame(autoscroll)
  }

  function pointerdown(event: PointerEvent) {
    const root = options.container()
    if (!root || state || event.button !== 0 || event.pointerType === 'touch' || !(event.target instanceof Element)) return
    if (options.ignore?.(event.target)) return
    // 点在滚动条上不算。
    const rect = root.getBoundingClientRect()
    if (event.clientX >= rect.left + root.clientWidth || event.clientY >= rect.top + root.clientHeight) return
    const mode = event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'add' : 'replace'
    state = { pointer: event.pointerId, root, start: content(root, event.clientX, event.clientY), client: [event.clientX, event.clientY], base: new Set(options.selected.value), mode, moved: false, frame: 0 }
    window.addEventListener('pointermove', pointermove, true)
    window.addEventListener('pointerup', pointerup, true)
    window.addEventListener('pointercancel', cancel, true)
  }

  function pointermove(event: PointerEvent) {
    if (!state || event.pointerId !== state.pointer) return
    state.client = [event.clientX, event.clientY]
    if (!state.moved) {
      const [x, y] = content(state.root, event.clientX, event.clientY)
      if (Math.hypot(x - state.start[0], y - state.start[1]) < (options.threshold ?? 5)) return
      state.moved = true
      active.value = true
      // 框选时不顺带选中页面上的文字。
      window.getSelection()?.removeAllRanges()
      document.documentElement.classList.add('rubber-banding')
    }
    event.preventDefault()
    update()
    if (!state.frame) state.frame = requestAnimationFrame(autoscroll)
  }

  function finish() {
    if (!state) return
    cancelAnimationFrame(state.frame)
    window.removeEventListener('pointermove', pointermove, true)
    window.removeEventListener('pointerup', pointerup, true)
    window.removeEventListener('pointercancel', cancel, true)
    document.documentElement.classList.remove('rubber-banding')
    state = undefined
    box.value = null
    active.value = false
  }

  function pointerup(event: PointerEvent) {
    if (!state || event.pointerId !== state.pointer) return
    // 只是点了一下空白处：普通点击清空选择。
    if (!state.moved && state.mode === 'replace') options.selected.value = new Set()
    else if (state.moved) {
      // 松手后紧跟的 click 不该再触发卡片或空白处的点击。
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    }
    finish()
  }
  const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault() }
  function cancel(event: PointerEvent) { if (state && event.pointerId === state.pointer) finish() }

  return { box, active, pointerdown, cancel: finish }
}
