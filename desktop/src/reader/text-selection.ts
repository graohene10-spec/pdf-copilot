/**
 * PDF 文字层的选中手感。文字层是一堆绝对定位的小块，块与块之间是空的：拖选时鼠标一划进空隙，浏览器找不到落点，
 * 就把选区甩到整层的开头或结尾——OCR 出来的扫描版尤其明显，稍一偏就选中一整段。
 * 做法和 pdf.js 自己的阅读器一样：选的时候在文字层里铺一块不可选的垫片（endOfContent），并且始终把它挪到选区焦点的后面，
 * 空隙里的落点就都落在它身上，选区停在刚才那个字，不再乱跳。
 */
const pads = new WeakMap<HTMLElement, HTMLElement>()
let installed = false, selecting = false, previous: Range | null = null

function pad(layer: HTMLElement) {
  let element = pads.get(layer)
  if (!element || element.closest('.textLayer') !== layer) {
    element = document.createElement('div')
    element.className = 'endOfContent'
    layer.append(element)
    pads.set(layer, element)
  }
  return element
}
function reset() {
  for (const layer of document.querySelectorAll<HTMLElement>('.textLayer.selecting')) {
    layer.classList.remove('selecting')
    const element = pads.get(layer)
    if (element?.isConnected) { layer.append(element); element.style.width = ''; element.style.height = '' }
  }
  previous = null
}
function begin(event: PointerEvent) {
  if (event.button !== 0) return
  const layer = (event.target as Element | null)?.closest?.<HTMLElement>('.textLayer')
  if (!layer) return
  selecting = true
  // 同一个阅读区里的每一页都垫上：跨页拖选时落点也稳。
  for (const each of layer.closest('.pdf-scroll')?.querySelectorAll<HTMLElement>('.textLayer') || [layer]) { pad(each); each.classList.add('selecting') }
}
function finish() { if (!selecting) return; selecting = false; reset() }
function changed() {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || !selecting) return
  const range = selection.getRangeAt(0)
  // 选区是从哪一头在变：往回拖时变的是起点。
  const modifyStart = Boolean(previous) && (range.compareBoundaryPoints(Range.END_TO_END, previous!) === 0 || range.compareBoundaryPoints(Range.START_TO_END, previous!) === 0)
  let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
  if (!modifyStart && range.endOffset === 0) {
    try { do { while (anchor && !anchor.previousSibling) anchor = anchor.parentNode; anchor = anchor?.previousSibling || null } while (anchor && !anchor.childNodes.length) } catch { anchor = null }
  }
  const layer = (anchor as Element | null)?.parentElement?.closest<HTMLElement>('.textLayer')
  const element = layer && pads.get(layer)
  if (anchor && layer && element && anchor !== element && anchor.parentElement) {
    element.style.width = `${layer.clientWidth}px`; element.style.height = `${layer.clientHeight}px`
    anchor.parentElement.insertBefore(element, modifyStart ? anchor : anchor.nextSibling)
  }
  previous = range.cloneRange()
}
export function installTextSelection() {
  if (installed) return
  installed = true
  document.addEventListener('pointerdown', begin, true)
  document.addEventListener('pointerup', finish, true)
  document.addEventListener('pointercancel', finish, true)
  window.addEventListener('blur', finish)
  document.addEventListener('selectionchange', changed)
}
