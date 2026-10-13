import { createTextSearchIndex } from './search.mjs'

type TextPiece = { node: Text; start: number; end: number }
type TextIndex = { text: string; pieces: TextPiece[]; search?: ReturnType<typeof createTextSearchIndex> }

/** Visible document text only. KaTeX's hidden MathML and TeX annotations
 * duplicate the visible formula and must not create extra search results. */
export function markdownTextIndex(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || !node.textContent || parent.closest('script,style,button,input,select,textarea,.katex-mathml,annotation,.formula-notice,[hidden]')) return NodeFilter.FILTER_REJECT
      const hidden = parent.closest('[aria-hidden="true"]')
      if (hidden && !hidden.classList.contains('katex-html')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let text = '', previousBlock: Element | null = null
  const pieces: TextPiece[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const block = node.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,pre,li,td,th,blockquote,.markdown-math') || root
    if (previousBlock && previousBlock !== block && text && !/\s$/.test(text)) text += '\n'
    const start = text.length
    text += node.data
    pieces.push({ node, start, end: text.length })
    previousBlock = block
  }
  return { text, pieces }
}

export function markdownSearchRanges(index: TextIndex, query: string, limit = 5000): { ranges: Range[]; limited: boolean } {
  const matches = (index.search ||= createTextSearchIndex(index.text)).find(query, limit + 1)
  const ranges: Range[] = []
  const locate = (offset: number, isEnd: boolean) => {
    let low = 0, high = index.pieces.length - 1
    while (low < high) {
      const middle = (low + high) >>> 1
      if (index.pieces[middle].end < offset || (!isEnd && index.pieces[middle].end === offset)) low = middle + 1
      else high = middle
    }
    const piece = index.pieces[low]
    return piece ? { node: piece.node, offset: Math.max(0, Math.min(piece.node.length, offset - piece.start)) } : null
  }
  for (const match of matches.slice(0, limit)) {
    const start = locate(match.start, false)
    const end = locate(match.end, true)
    if (start && end) {
      const range = document.createRange()
      range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset)
      ranges.push(range)
    }
  }
  return { ranges, limited: matches.length > limit }
}

let highlightSequence = 0
export function markdownSearchHighlighter() {
  const id = `kaizhi-md-search-${++highlightSequence}`
  const selectedId = `${id}-current`
  type Registry = { set(name: string, value: unknown): void; delete(name: string): void }
  const registry = (CSS as unknown as { highlights?: Registry }).highlights
  const HighlightClass = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  let style: HTMLStyleElement | undefined
  function clear() { registry?.delete(id); registry?.delete(selectedId) }
  return {
    apply(ranges: Range[], selected: number) {
      clear()
      if (!registry || !HighlightClass || !ranges.length) return
      if (!style) {
        style = document.createElement('style')
        style.dataset.markdownSearch = id
        style.textContent = `::highlight(${id}) { background-color: rgba(218, 173, 34, .34); } ::highlight(${selectedId}) { background-color: rgba(232, 155, 35, .68); }`
        document.head.append(style)
      }
      registry.set(id, new HighlightClass(...ranges))
      if (ranges[selected]) registry.set(selectedId, new HighlightClass(ranges[selected]))
    },
    clear,
    dispose() { clear(); style?.remove(); style = undefined },
  }
}
