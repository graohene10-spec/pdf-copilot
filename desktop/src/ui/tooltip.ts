/**
 * One floating glass tooltip for every element with `data-tip`. It appears
 * after the pointer (or keyboard focus) rests on a control, showing its name
 * and, from `data-tip-key`, its current shortcut. While one is visible, moving
 * to a neighbouring control swaps the text at once, as macOS tooltips do.
 * The tooltip never takes pointer events; clicks, typing, scrolling and wheel
 * dismiss it. Document content (PDF pages, Markdown paper) is never targeted.
 */
const SELECTOR = '[data-tip]'
const PAPER = '.pdf-scroll .page-slot, .markdown-paper'
const DELAY = 600
const WARM = 450
const GAP = 8
const MARGIN = 8

export function installTooltips(root: HTMLElement): () => void {
  const doc = root.ownerDocument
  const win = doc.defaultView!
  const tip = doc.createElement('div')
  tip.className = 'glass-tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.hidden = true
  const label = doc.createElement('span')
  const key = doc.createElement('kbd')
  tip.append(label, key)
  doc.body.append(tip)

  let target: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let shown = false
  let warmUntil = 0
  // Only while visible: hide if the control is removed under a still pointer.
  const removal = new MutationObserver(() => { if (target && !target.isConnected) hide() })

  function candidate(node: EventTarget | null) {
    if (!(node instanceof Element) || !root.contains(node) || node.closest(PAPER)) return null
    const element = node.closest<HTMLElement>(SELECTOR)
    return element?.dataset.tip ? element : null
  }
  function place(element: HTMLElement) {
    const anchor = element.getBoundingClientRect()
    // Untransformed size: the entrance scale must not skew the centring.
    const box = { width: tip.offsetWidth, height: tip.offsetHeight }
    let top = anchor.bottom + GAP
    let placement = 'below'
    if (top + box.height > win.innerHeight - MARGIN) { top = anchor.top - GAP - box.height; placement = 'above' }
    const left = Math.max(MARGIN, Math.min(win.innerWidth - box.width - MARGIN, anchor.left + anchor.width / 2 - box.width / 2))
    tip.style.left = `${Math.round(left)}px`
    tip.style.top = `${Math.round(Math.max(MARGIN, top))}px`
    tip.dataset.placement = placement
  }
  function show(element: HTMLElement) {
    timer = undefined
    if (!element.isConnected) return
    label.textContent = element.dataset.tip || ''
    const shortcut = element.dataset.tipKey || ''
    key.textContent = shortcut
    key.hidden = !shortcut
    // 和所指控件用同一种文字颜色（含底图上的自适应墨色与光晕）。
    const style = win.getComputedStyle(element)
    tip.style.setProperty('--tip-ink', style.getPropertyValue('--control-ink').trim() || style.color)
    tip.style.setProperty('--tip-shadow', style.getPropertyValue('--glass-label-shadow').trim() || 'none')
    const swap = shown
    tip.hidden = false
    if (!swap) tip.classList.remove('visible')
    place(element)
    if (!swap) { void tip.offsetWidth; tip.classList.add('visible') }
    shown = true
    removal.observe(root, { childList: true, subtree: true })
  }
  function hide() {
    if (timer) { clearTimeout(timer); timer = undefined }
    if (shown) warmUntil = performance.now() + WARM
    shown = false
    target = null
    removal.disconnect()
    tip.classList.remove('visible')
    tip.hidden = true
  }
  function aim(element: HTMLElement | null) {
    if (element === target) return
    if (timer) { clearTimeout(timer); timer = undefined }
    const warm = shown || performance.now() < warmUntil
    if (!element) { hide(); return }
    target = element
    timer = setTimeout(() => show(element), warm ? 0 : DELAY)
  }
  function over(event: PointerEvent) {
    if (event.pointerType === 'touch') return
    aim(candidate(event.target))
  }
  function out(event: PointerEvent) {
    if (event.relatedTarget === null) hide()
  }
  function focusIn(event: FocusEvent) {
    const element = candidate(event.target)
    if (element && element.matches(':focus-visible')) aim(element)
  }
  function focusOut(event: FocusEvent) {
    if (target && event.target === target) hide()
  }
  function dismiss() { if (target || shown) hide() }

  doc.addEventListener('pointerover', over, { passive: true })
  doc.addEventListener('pointerout', out, { passive: true })
  doc.addEventListener('pointerdown', dismiss, { passive: true, capture: true })
  doc.addEventListener('keydown', dismiss, true)
  doc.addEventListener('wheel', dismiss, { passive: true, capture: true })
  doc.addEventListener('scroll', dismiss, { passive: true, capture: true })
  root.addEventListener('focusin', focusIn)
  root.addEventListener('focusout', focusOut)
  win.addEventListener('blur', dismiss)
  win.addEventListener('resize', dismiss)

  return () => {
    hide()
    doc.removeEventListener('pointerover', over)
    doc.removeEventListener('pointerout', out)
    doc.removeEventListener('pointerdown', dismiss, true)
    doc.removeEventListener('keydown', dismiss, true)
    doc.removeEventListener('wheel', dismiss, true)
    doc.removeEventListener('scroll', dismiss, true)
    root.removeEventListener('focusin', focusIn)
    root.removeEventListener('focusout', focusOut)
    win.removeEventListener('blur', dismiss)
    win.removeEventListener('resize', dismiss)
    tip.remove()
  }
}
