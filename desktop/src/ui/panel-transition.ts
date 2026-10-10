const layoutProperties = [
  'position', 'left', 'right', 'top', 'bottom', 'width', 'height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'z-index',
] as const
const floatingPanels = new WeakMap<HTMLElement, Array<{ name: string; value: string; priority: string }>>()

// Keep the shrinking panel in place while freeing its final reading width.
// The parent is positioned, and the PDF viewport stays pinned until its new bitmap is ready.
export function floatLeavingPanel(element: Element, edge: 'left' | 'right' = 'left') {
  if (!(element instanceof HTMLElement) || floatingPanels.has(element)) return
  const { offsetLeft: left, offsetTop: top, offsetWidth: width, offsetHeight: height } = element
  const right = element.offsetParent instanceof HTMLElement ? element.offsetParent.clientWidth - left - width : 0
  floatingPanels.set(element, layoutProperties.map(name => ({
    name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name),
  })))
  Object.assign(element.style, {
    position: 'absolute', left: edge === 'left' ? `${left}px` : 'auto',
    right: edge === 'right' ? `${right}px` : 'auto', top: `${top}px`, bottom: 'auto',
    width: `${width}px`, height: `${height}px`,
    marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0', zIndex: '5',
  })
}

export function restoreLeavingPanel(element: Element) {
  if (!(element instanceof HTMLElement)) return
  const saved = floatingPanels.get(element)
  if (!saved) return
  for (const { name, value, priority } of saved) {
    if (value) element.style.setProperty(name, value, priority)
    else element.style.removeProperty(name)
  }
  floatingPanels.delete(element)
}
