// 实时模糊的玻璃身后有东西在动（滚动 PDF、对话流式输出、弹窗弹出）时，折射透镜每帧都要整块重算，
// 是这时最贵的一步。动起来时先撤掉透镜（模糊不变），停下片刻再装回去。
const HOLD = 320
let timer: ReturnType<typeof setTimeout> | undefined

function needed() {
  const data = document.documentElement.dataset
  return data.style === 'glass' && data.refraction === 'on' && data.glass !== 'solid'
}

/** Marks the glass as moving for a short while; repeated calls keep it moving. */
export function nudgeGlassMotion(hold = HOLD) {
  if (!timer && !needed()) return
  const root = document.documentElement
  if (!timer) root.dataset.glassMotion = ''
  clearTimeout(timer)
  timer = setTimeout(() => { timer = undefined; delete root.dataset.glassMotion }, hold)
}

export function installGlassMotion(): () => void {
  // 玻璃面板自己里面的滚动（阅读助手的对话列表等，标 data-glass-still）不会改变任何玻璃身后的画面，
  // 不必撤透镜——撤 / 装透镜要整页重算样式，长对话里滚一下就顿一下。
  const onScroll = (event: Event) => { if (event.target instanceof Element && event.target.closest('[data-glass-still]')) return; nudgeGlassMotion() }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => { document.removeEventListener('scroll', onScroll, { capture: true }); clearTimeout(timer); timer = undefined; delete document.documentElement.dataset.glassMotion }
}
