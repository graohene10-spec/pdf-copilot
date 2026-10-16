import type { Directive } from 'vue'

/**
 * A single glass droplet slides under the selected item of a group (navigation,
 * segmented switches, settings categories, file tabs). Geometry comes from the
 * offset chain, so transforms from panel transitions do not skew it, and the
 * droplet scrolls with the group's own content. Only the selected element is
 * measured, after Vue has patched the group or its box has resized.
 */
type Options = { selector?: string; radius?: string } | string | undefined
type State = {
  indicator: HTMLSpanElement
  resize: ResizeObserver
  target: HTMLElement | null
  key: string
  frame: number
  selector: string
  count: number
}
const DEFAULT = '.selected, [aria-selected="true"], [aria-current="page"]'
const states = new WeakMap<HTMLElement, State>()

function selectorOf(value: Options) {
  return typeof value === 'string' ? value : value?.selector || DEFAULT
}

function offsetWithin(element: HTMLElement, group: HTMLElement) {
  let left = 0, top = 0
  for (let node: HTMLElement | null = element; node && node !== group; node = node.offsetParent as HTMLElement | null) {
    if (!group.contains(node)) {
      // The group is not positioned: fall back to unscaled client rects.
      const a = element.getBoundingClientRect(), b = group.getBoundingClientRect()
      return { left: a.left - b.left + group.scrollLeft - group.clientLeft, top: a.top - b.top + group.scrollTop - group.clientTop }
    }
    left += node.offsetLeft; top += node.offsetTop
  }
  return { left, top }
}

function place(group: HTMLElement, state: State, animate: boolean) {
  state.frame = 0
  const { indicator } = state
  const target = [...group.querySelectorAll<HTMLElement>(state.selector)].find(element => element !== indicator && element.offsetParent !== null) || null
  state.count = group.childElementCount
  if (target !== state.target) {
    if (state.target) state.resize.unobserve(state.target)
    if (target) state.resize.observe(target)
  }
  if (!target) {
    indicator.classList.remove('visible')
    group.classList.remove('has-indicator')
    state.target = null
    return
  }
  const { left, top } = offsetWithin(target, group)
  const width = target.offsetWidth, height = target.offsetHeight
  const key = `${left},${top},${width},${height}`
  const moved = state.target !== null && state.target !== target
  const first = !indicator.classList.contains('visible')
  if (key === state.key && !first) { state.target = target; return }
  const previous = state.key.split(',').map(Number)
  state.key = key
  state.target = target
  indicator.classList.toggle('instant', first || !animate)
  indicator.style.translate = `${left}px ${top}px`
  indicator.style.width = `${width}px`
  indicator.style.height = `${height}px`
  if (first || !animate) void indicator.offsetWidth
  indicator.classList.remove('instant')
  indicator.classList.add('visible')
  group.classList.add('has-indicator')
  // A short stretch along the direction of travel reads as liquid, not a sliding box.
  if (moved && animate && previous.length === 4 && typeof indicator.animate === 'function' &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const horizontal = Math.abs(left - previous[0]!) >= Math.abs(top - previous[1]!)
    const stretch = horizontal ? '1.12 .9' : '.96 1.12'
    indicator.animate([{ scale: '1 1' }, { scale: stretch, offset: .32 }, { scale: '1 1' }], { duration: 420, easing: 'cubic-bezier(.3, .7, .3, 1)' })
  }
}

function schedule(group: HTMLElement, animate = true) {
  const state = states.get(group)
  if (!state || state.frame) return
  state.frame = requestAnimationFrame(() => place(group, state, animate))
}

export const vLiquidSelection: Directive<HTMLElement, Options> = {
  mounted(group, binding) {
    const indicator = document.createElement('span')
    indicator.className = 'liquid-indicator'
    indicator.setAttribute('aria-hidden', 'true')
    if (typeof binding.value === 'object' && binding.value?.radius) indicator.style.setProperty('--indicator-radius', binding.value.radius)
    group.classList.add('liquid-group')
    group.prepend(indicator)
    const state: State = { indicator, target: null, key: '', frame: 0, count: 0, selector: selectorOf(binding.value), resize: new ResizeObserver(() => schedule(group, false)) }
    states.set(group, state)
    state.resize.observe(group)
    schedule(group, false)
  },
  updated(group, binding) {
    const state = states.get(group)
    if (!state) return
    const selector = selectorOf(binding.value)
    // Parent re-renders (reading progress, timers) leave most groups untouched:
    // skip the measurement unless the selection or the item set changed.
    if (selector === state.selector && group.childElementCount === state.count && state.target?.isConnected &&
        state.target.matches(selector) && group.querySelectorAll(selector).length === 1) return
    state.selector = selector
    schedule(group)
  },
  beforeUnmount(group) {
    const state = states.get(group)
    if (!state) return
    if (state.frame) cancelAnimationFrame(state.frame)
    state.resize.disconnect()
    state.indicator.remove()
    group.classList.remove('liquid-group', 'has-indicator')
    states.delete(group)
  },
}

/** Re-measure after a change Vue cannot see, such as fonts loading or a sibling resizing. */
export function refreshLiquidSelection(group: HTMLElement | null | undefined, animate = true) {
  if (group) schedule(group, animate)
}
