import { nextTick, ref } from 'vue'

// iOS 主屏式的拖动排列：按住物件拖动时它浮起并跟随指针，经过其他物件时
// 它们用弹簧动画让出位置；松手后物件弹回自己的新格子。
// 物件需带 data-reorder-id，容器需为定位元素（offsetLeft/offsetTop 以它为准）。
export type ReorderOptions = {
  container: () => HTMLElement | null | undefined
  ids: () => string[]
  apply: (ids: string[]) => void
  commit?: (ids: string[]) => void
  enabled?: () => boolean
  threshold?: number
}

const spring = (name: string, fallback = 'cubic-bezier(.2,.8,.2,1)') => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function useReorder(options: ReorderOptions) {
  const dragging = ref<string>()
  let state: {
    id: string; pointer: number; startX: number; startY: number; grabX: number; grabY: number
    x: number; y: number; moved: boolean; element: HTMLElement; scroller: HTMLElement | null; frame: number
  } | undefined

  const items = (root: HTMLElement) => [...root.children].filter((node): node is HTMLElement => node instanceof HTMLElement && !!node.dataset.reorderId)
  const find = (root: HTMLElement, id: string) => items(root).find(node => node.dataset.reorderId === id)

  // 记录每个物件当前屏幕位置（含进行中的动画），状态更新后再把它们从旧位置弹到新位置。
  function flip(root: HTMLElement, change: () => void, skip?: HTMLElement) {
    const before = new Map(items(root).filter(node => node !== skip).map(node => [node, node.getBoundingClientRect()]))
    change()
    return nextTick(() => {
      if (reduced()) return
      const easing = spring('--spring-snappy')
      for (const [node, rect] of before) {
        if (!node.isConnected) continue
        for (const animation of node.getAnimations()) if (animation.id === 'reorder-flip') animation.cancel()
        const now = node.getBoundingClientRect()
        const dx = rect.left - now.left, dy = rect.top - now.top
        if (Math.abs(dx) < .5 && Math.abs(dy) < .5) continue
        const animation = node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 460, easing })
        animation.id = 'reorder-flip'
      }
    })
  }

  function place() {
    if (!state) return
    const root = state.element.offsetParent as HTMLElement | null
    const origin = root?.getBoundingClientRect() || { left: 0, top: 0 }
    const dx = state.x - state.grabX - (origin.left + state.element.offsetLeft)
    const dy = state.y - state.grabY - (origin.top + state.element.offsetTop)
    state.element.style.transform = `translate(${dx}px, ${dy}px)`
  }

  function target(root: HTMLElement) {
    if (!state) return
    const origin = root.getBoundingClientRect()
    for (const node of items(root)) {
      if (node === state.element) continue
      const left = origin.left + node.offsetLeft, top = origin.top + node.offsetTop
      if (state.x >= left && state.x <= left + node.offsetWidth && state.y >= top && state.y <= top + node.offsetHeight) return node.dataset.reorderId
    }
  }

  function reorder() {
    const root = options.container()
    if (!state || !root) return
    const over = target(root)
    if (!over) return
    const ids = options.ids(), from = ids.indexOf(state.id), to = ids.indexOf(over)
    if (from < 0 || to < 0 || from === to) return
    const next = ids.filter(id => id !== state!.id)
    next.splice(to, 0, state.id)
    void flip(root, () => options.apply(next), state.element).then(place)
  }

  // 指针靠近滚动区域上下边缘时自动滚动，便于把物件拖到屏幕外的位置。
  function tick() {
    if (!state?.moved) return
    const scroller = state.scroller
    if (scroller) {
      const box = scroller.getBoundingClientRect(), edge = 64
      const speed = state.y < box.top + edge ? -(box.top + edge - state.y) : state.y > box.bottom - edge ? state.y - (box.bottom - edge) : 0
      if (speed) { scroller.scrollTop += Math.max(-18, Math.min(18, speed * .3)); place(); reorder() }
    }
    state.frame = requestAnimationFrame(tick)
  }

  function move(event: PointerEvent) {
    if (!state || event.pointerId !== state.pointer) return
    state.x = event.clientX; state.y = event.clientY
    if (!state.moved) {
      if (Math.hypot(state.x - state.startX, state.y - state.startY) < (options.threshold ?? 6)) return
      state.moved = true
      dragging.value = state.id
      const root = options.container()
      root?.classList.add('reorder-active', 'reorder-settled')
      document.documentElement.classList.add('reordering')
      state.element.classList.add('reorder-lifted')
      state.frame = requestAnimationFrame(tick)
    }
    event.preventDefault()
    place()
    reorder()
  }

  function swallowClick(event: Event) { event.stopPropagation(); event.preventDefault() }

  function end() {
    const drag = state
    state = undefined
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    if (!drag?.moved) return
    cancelAnimationFrame(drag.frame)
    // 拖动结束时紧跟着的 click 不应再打开文档。
    window.addEventListener('click', swallowClick, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallowClick, true), 0)
    const from = drag.element.style.transform
    drag.element.style.transform = ''
    drag.element.classList.remove('reorder-lifted')
    drag.element.classList.add('reorder-landing')
    const landing = reduced() ? undefined : drag.element.animate([{ transform: `${from} scale(1.05)` }, { transform: 'none' }], { duration: 520, easing: spring('--spring-bouncy') })
    const settle = () => drag.element.classList.remove('reorder-landing')
    if (landing) landing.finished.then(settle, settle); else settle()
    options.container()?.classList.remove('reorder-active')
    document.documentElement.classList.remove('reordering')
    dragging.value = undefined
    options.commit?.(options.ids())
  }

  function pointerdown(event: PointerEvent, id: string) {
    if (event.button !== 0 || state || options.enabled?.() === false) return
    if ((event.target as Element).closest('button,a,input,textarea,select,[contenteditable]')) return
    const element = event.currentTarget as HTMLElement
    const rect = element.getBoundingClientRect()
    state = {
      id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      grabX: event.clientX - rect.left, grabY: event.clientY - rect.top, moved: false, element, frame: 0,
      scroller: element.closest<HTMLElement>('[data-reorder-scroll]'),
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  // 键盘：Alt+方向键把聚焦的物件前后移动一格（网格中上下按行移动）。
  function keydown(event: KeyboardEvent, id: string) {
    if (!event.altKey || options.enabled?.() === false) return
    const root = options.container()
    if (!root) return
    const ids = options.ids(), index = ids.indexOf(id)
    const nodes = items(root), first = nodes[0]
    const columns = first ? nodes.filter(node => node.offsetTop === first.offsetTop).length : 1
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key]
    if (!step || index < 0) return
    event.preventDefault()
    const to = Math.max(0, Math.min(ids.length - 1, index + step))
    if (to === index) return
    const next = ids.filter(item => item !== id)
    next.splice(to, 0, id)
    root.classList.add('reorder-settled')
    void flip(root, () => options.apply(next)).then(() => { find(root, id)?.focus({ preventScroll: false }); options.commit?.(next) })
  }

  return { dragging, pointerdown, keydown }
}
