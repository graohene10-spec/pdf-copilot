/**
 * Glass responds only where the pointer or keyboard focus is resting. Event
 * delegation also covers async panels; a single RAF batches bounded reads and
 * writes without making pointer coordinates part of the Vue render tree.
 */
const CONTROL = [
  '[data-glass-interactive]:not([data-glass-interactive="panel"])',
  '.file-tab',
  'button:not(.brand):not(.text-action):not([role="tab"]):not(.close-tab):not(.pdf-link)',
].join(',')
const PANEL = [
  '[data-glass-interactive="panel"]', '.app-sidebar', '.app-topbar',
  '.reader-tools', '.library-toolbar', '.ai-pane', '.document-details',
  '.settings-dialog', '.confirm-dialog',
].join(',')
const PROPERTIES = ['--glass-x', '--glass-y', '--glass-active']
const PAPER = '.pdf-scroll, .markdown-paper'

export function installLiquidGlass(root: HTMLElement): () => void {
  const owner = root.ownerDocument
  const win = owner.defaultView!
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)')
  const transparency = win.matchMedia('(prefers-reduced-transparency: reduce)')
  const contrast = win.matchMedia('(forced-colors: active), (prefers-contrast: more)')
  const supported = CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
  let pointer: { target: Element; x: number; y: number } | null = null
  let focus: Element | null = null
  let keyboard = false
  let frame = 0
  let disposed = false
  let active = new Set<HTMLElement>()

  function enabled() {
    return supported && !transparency.matches && !contrast.matches &&
      owner.documentElement.dataset.glass !== 'solid' && owner.documentElement.dataset.contrast !== 'high'
  }
  function targets(target: Element | null) {
    const result: { element: HTMLElement; kind: 'control' | 'panel' }[] = []
    if (!target?.isConnected || !root.contains(target) || target.closest(PAPER)) return result
    const control = target.closest<HTMLElement>(CONTROL)
    if (control && !control.matches(':disabled,[aria-disabled="true"]')) result.push({ element: control, kind: 'control' })
    const panel = target.closest<HTMLElement>(PANEL)
    if (panel && panel !== control) result.push({ element: panel, kind: 'panel' })
    return result
  }
  function schedule() {
    if (!frame && !disposed) frame = win.requestAnimationFrame(paint)
  }
  function paint() {
    frame = 0
    const next = new Map<HTMLElement, { kind: 'control' | 'panel'; x: number; y: number; strength: number }>()
    if (enabled()) {
      // Keyboard gets the same reflection, anchored to the upper centre.
      for (const { element, kind } of targets(focus)) next.set(element, { kind, x: 50, y: 20, strength: .85 })
      if (pointer && !motion.matches) {
        // Only one control and its closest material are measured per frame.
        for (const { element, kind } of targets(pointer.target)) {
          const rect = element.getBoundingClientRect()
          if (!rect.width || !rect.height) continue
          const x = Math.max(0, Math.min(100, (pointer.x - rect.left) / rect.width * 100))
          const y = Math.max(0, Math.min(100, (pointer.y - rect.top) / rect.height * 100))
          next.set(element, { kind, x, y, strength: 1 })
        }
      }
    }
    // All geometry reads above finish before any material writes below.
    for (const element of active) if (!next.has(element)) element.style.setProperty('--glass-active', '0')
    for (const [element, state] of next) {
      element.dataset.glassLive = state.kind
      element.style.setProperty('--glass-x', `${state.x.toFixed(1)}%`)
      element.style.setProperty('--glass-y', `${state.y.toFixed(1)}%`)
      element.style.setProperty('--glass-active', String(state.strength))
    }
    active = new Set(next.keys())
  }
  function move(event: PointerEvent) {
    if (event.pointerType === 'touch' || !enabled() || motion.matches) return
    const hadPointer = !!pointer
    pointer = event.target instanceof Element && root.contains(event.target) && !event.target.closest(PAPER)
      ? { target: event.target, x: event.clientX, y: event.clientY } : null
    // Pointer activity outside a material should not schedule idle paints.
    if (pointer && !pointer.target.closest(`${CONTROL},${PANEL}`)) pointer = null
    if (pointer || hadPointer) schedule()
  }
  function leave(event: PointerEvent) {
    if (event.relatedTarget === null) { pointer = null; schedule() }
  }
  function key(event: KeyboardEvent) {
    if (['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) keyboard = true
  }
  function down() { keyboard = false; focus = null; schedule() }
  function focusIn(event: FocusEvent) {
    focus = event.target instanceof Element && (keyboard || event.target.matches(':focus-visible')) ? event.target : null
    schedule()
  }
  function focusOut() { focus = null; schedule() }
  function blur() { pointer = null; focus = null; schedule() }
  function visibility() { if (owner.hidden) blur() }
  function preferences() {
    pointer = null
    if (!enabled()) focus = null
    schedule()
  }
  const observer = new MutationObserver(preferences)
  observer.observe(owner.documentElement, { attributes: true, attributeFilter: ['data-glass', 'data-contrast'] })
  owner.addEventListener('pointermove', move, { passive: true })
  owner.addEventListener('pointerout', leave, { passive: true })
  owner.addEventListener('pointercancel', blur, { passive: true })
  owner.addEventListener('pointerdown', down, { passive: true, capture: true })
  owner.addEventListener('keydown', key, true)
  root.addEventListener('focusin', focusIn)
  root.addEventListener('focusout', focusOut)
  owner.addEventListener('visibilitychange', visibility)
  win.addEventListener('blur', blur)
  for (const query of [motion, transparency, contrast]) query.addEventListener('change', preferences)

  return () => {
    if (disposed) return
    disposed = true
    if (frame) win.cancelAnimationFrame(frame)
    observer.disconnect()
    owner.removeEventListener('pointermove', move)
    owner.removeEventListener('pointerout', leave)
    owner.removeEventListener('pointercancel', blur)
    owner.removeEventListener('pointerdown', down, true)
    owner.removeEventListener('keydown', key, true)
    root.removeEventListener('focusin', focusIn)
    root.removeEventListener('focusout', focusOut)
    owner.removeEventListener('visibilitychange', visibility)
    win.removeEventListener('blur', blur)
    for (const query of [motion, transparency, contrast]) query.removeEventListener('change', preferences)
    for (const element of root.querySelectorAll<HTMLElement>('[data-glass-live]')) {
      element.removeAttribute('data-glass-live')
      for (const property of PROPERTIES) element.style.removeProperty(property)
    }
    active.clear(); pointer = null; focus = null
  }
}
