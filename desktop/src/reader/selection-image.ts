/**
 * 选区的截图：扫描版 PDF 的文字层是 OCR 出来的，公式常常是一串乱码。翻译、解释这类选区时把那一块页面截下来一起交给 AI，
 * 公式以图为准。
 */
/** 选中的文字像是公式或识别坏了的符号。 */
export const looksMathy = (text: string) => /[■□▪▫�^_{}=∈∉∩∪⊂⊆≤≥≠±×÷∑∏∫√∞→←↔∀∃∅]|[α-ωΑ-Ω]|[A-Za-z]\s?[0-9]\b/.test(text)

/** 把当前选区所在的那一块页面画下来（只对画在 canvas 上的 PDF 有用），返回 JPEG 的 data URL。 */
export function selectionImage(padX = 14, padY = 12): string | undefined {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0), node = range.commonAncestorContainer, element = node instanceof Element ? node : node.parentElement
  const pane = element?.closest('.reader-pane')
  if (!pane) return
  const box = range.getBoundingClientRect()
  if (box.width < 2 || box.height < 2) return
  const area = { left: box.left - padX, top: box.top - padY, right: box.right + padX, bottom: box.bottom + padY }
  const hits = [...pane.querySelectorAll<HTMLCanvasElement>('.page-slot canvas')].map(canvas => ({ canvas, rect: canvas.getBoundingClientRect() }))
    .filter(({ canvas, rect }) => canvas.width > 0 && rect.width > 0 && rect.right > area.left && rect.left < area.right && rect.bottom > area.top && rect.top < area.bottom)
  if (!hits.length) return
  const ratio = Math.min(3, Math.max(1, hits[0].canvas.width / hits[0].rect.width)), scale = Math.min(ratio, 1800 / (area.right - area.left), 1800 / (area.bottom - area.top))
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round((area.right - area.left) * scale)); out.height = Math.max(1, Math.round((area.bottom - area.top) * scale))
  const context = out.getContext('2d')
  if (!context) return
  context.fillStyle = '#fff'; context.fillRect(0, 0, out.width, out.height)
  try {
    for (const { canvas, rect } of hits) {
      const left = Math.max(area.left, rect.left), top = Math.max(area.top, rect.top), right = Math.min(area.right, rect.right), bottom = Math.min(area.bottom, rect.bottom)
      const kx = canvas.width / rect.width, ky = canvas.height / rect.height
      context.drawImage(canvas, (left - rect.left) * kx, (top - rect.top) * ky, (right - left) * kx, (bottom - top) * ky, (left - area.left) * scale, (top - area.top) * scale, (right - left) * scale, (bottom - top) * scale)
    }
    return out.toDataURL('image/jpeg', .9)
  } catch { return }
}
