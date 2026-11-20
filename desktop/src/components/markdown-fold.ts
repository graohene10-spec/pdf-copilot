// 折叠段落：模型做「点开再看」的大纲时会写 <details><summary>标题</summary> … </details>。
// 源 HTML 仍然关闭，这里只认这两个标签各占一行的写法，中间的内容照常按 Markdown 处理，所以可以嵌套。
import type MarkdownIt from 'markdown-it'

const OPEN = /^<details(\s+open)?\s*>\s*(?:<summary>(.*)<\/summary>)?\s*$/i
const TITLE = /^<summary>(.*)<\/summary>\s*$/i
const CLOSE = /^(?:<\/details>\s*)+$/i
// 标题里常见的几个行内标签换成 Markdown 的写法，其余标签去掉。
const inlineTags = (text: string) => text
  .replace(/<\/?(?:strong|b)>/gi, '**').replace(/<\/?(?:em|i)>/gi, '*').replace(/<\/?code>/gi, '`')
  .replace(/<\/?[a-z][^>]*>/gi, '').trim()

export function installFold(markdown: MarkdownIt) {
  markdown.block.ruler.before('paragraph', 'fold', (state, startLine, _endLine, silent) => {
    if (state.sCount[startLine]! - state.blkIndent >= 4) return false
    const from = state.bMarks[startLine]! + state.tShift[startLine]!
    if (state.src.charCodeAt(from) !== 0x3c) return false
    const line = state.src.slice(from, state.eMarks[startLine])
    const open = OPEN.exec(line), title = open ? null : TITLE.exec(line)
    if (!open && !title && !CLOSE.test(line)) return false
    if (silent) return true
    const heading = (text: string) => {
      state.push('fold_title_open', 'summary', 1)
      const inline = state.push('inline', '', 0)
      inline.content = inlineTags(text); inline.map = [startLine, startLine + 1]; inline.children = []
      state.push('fold_title_close', 'summary', -1)
    }
    if (open) {
      const token = state.push('fold_open', 'details', 1)
      token.block = true; token.attrSet('class', 'answer-fold')
      if (open[1]) token.attrSet('open', '')
      if (open[2] !== undefined) heading(open[2])
    } else if (title) heading(title[1]!)
    else for (let count = line.match(/<\/details>/gi)!.length; count > 0; count--) state.push('fold_close', 'details', -1).block = true
    state.line = startLine + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}
