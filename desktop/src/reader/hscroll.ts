import { onBeforeUnmount, onMounted, reactive, type Ref } from 'vue'

/**
 * 阅读区底部的横向滚动条：页面放大到比阅读区宽时出现，可拖动、可点轨道跳转。
 * 不依赖系统滚动条（WebView2 的悬浮滚动条平时看不见），范围随缩放、侧栏和窗口变化实时更新。
 */
export function useHorizontalScroll(container: Ref<HTMLElement | undefined>) {
  const bar = reactive({ visible: false, left: 0, width: 100, dragging: false })
  let frame = 0, drag: { offset: number; track: HTMLElement } | undefined
  let resize: ResizeObserver | undefined, mutations: MutationObserver | undefined
  function measure() {
    frame = 0
    const element = container.value
    if (!element) return
    const overflow = element.scrollWidth - element.clientWidth
    bar.visible = overflow > 1
    if (!bar.visible) return
    bar.width = Math.max(6, element.clientWidth / element.scrollWidth * 100)
    bar.left = element.scrollLeft / overflow * (100 - bar.width)
  }
  function update() { if (!frame) frame = requestAnimationFrame(measure) }
  function ratio(event: PointerEvent, track: HTMLElement) { const box = track.getBoundingClientRect(); return (event.clientX - box.left) / Math.max(1, box.width) * 100 }
  function scrollTo(percent: number) {
    const element = container.value
    if (!element) return
    const overflow = element.scrollWidth - element.clientWidth
    element.scrollLeft = Math.max(0, Math.min(1, percent / Math.max(1e-6, 100 - bar.width))) * overflow
  }
  function down(event: PointerEvent) {
    if (event.button !== 0) return
    const track = event.currentTarget as HTMLElement
    event.preventDefault()
    const at = ratio(event, track)
    // 点在滑块上就拖动；点在空白处先跳过去，再继续拖。
    const onThumb = at >= bar.left && at <= bar.left + bar.width
    if (!onThumb) scrollTo(at - bar.width / 2)
    drag = { offset: onThumb ? at - bar.left : bar.width / 2, track }
    bar.dragging = true
    track.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent) { if (drag) scrollTo(ratio(event, drag.track) - drag.offset) }
  function up() { drag = undefined; bar.dragging = false }
  onMounted(() => {
    const element = container.value
    if (!element) return
    element.addEventListener('scroll', update, { passive: true })
    resize = new ResizeObserver(update)
    resize.observe(element)
    // 缩放会改变页面栈的大小；页面栈本身在加载后才挂上，所以也看子节点的增减。
    const watchStack = () => { for (const child of element.children) resize?.observe(child) ; update() }
    mutations = new MutationObserver(watchStack)
    mutations.observe(element, { childList: true })
    watchStack()
  })
  onBeforeUnmount(() => { container.value?.removeEventListener('scroll', update); resize?.disconnect(); mutations?.disconnect(); if (frame) cancelAnimationFrame(frame) })
  return { bar, update, down, move, up }
}
