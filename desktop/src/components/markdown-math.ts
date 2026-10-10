import type MarkdownIt from 'markdown-it'
import katex from 'katex'

const MAX_FORMULA_LENGTH = 4000
export function renderFormula(source: string, displayMode: boolean): string {
  if (source.length > MAX_FORMULA_LENGTH) return '<span class="formula-notice">公式过长，已省略渲染。</span>'
  return katex.renderToString(source, { displayMode, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 64, maxSize: 30, output: 'htmlAndMathml' })
}

/** Small math rules run outside code tokens; document HTML remains disabled. */
export function installMarkdownMath(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'document_math', (state: any, silent: boolean) => {
    const start = state.pos
    const source: string = state.src
    let open = '', close = '', display = false
    if (source.startsWith('$$', start)) { open = close = '$$'; display = true }
    else if (source[start] === '$') { open = close = '$' }
    else if (source.startsWith('\\(', start)) { open = '\\('; close = '\\)' }
    else if (source.startsWith('\\[', start)) { open = '\\['; close = '\\]'; display = true }
    else return false
    const contentStart = start + open.length
    if (/\s/.test(source[contentStart] || ' ')) return false
    let end = contentStart
    while ((end = source.indexOf(close, end)) >= 0) {
      let slashes = 0
      for (let cursor = end - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) slashes++
      if (slashes % 2 === 0 && !/\s/.test(source[end - 1] || ' ')) break
      end += close.length
    }
    if (end < 0 || (!display && source.slice(contentStart, end).includes('\n'))) return false
    if (!silent) {
      const token = state.push('math_inline', 'span', 0)
      token.content = source.slice(contentStart, end); token.meta = { display }
    }
    state.pos = end + close.length
    return true
  })

  md.block.ruler.before('fence', 'document_math_block', (state: any, startLine: number, endLine: number, silent: boolean) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const first: string = state.src.slice(start, state.eMarks[startLine]).trim()
    const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : ''
    if (!open) return false
    const close = open === '$$' ? '$$' : '\\]'
    let body = first.slice(open.length), nextLine = startLine + 1, found = false
    const inlineEnd = body.indexOf(close)
    if (inlineEnd >= 0 && !body.slice(inlineEnd + close.length).trim()) { body = body.slice(0, inlineEnd); found = true }
    else {
      const lines = [body]
      for (; nextLine < endLine && nextLine - startLine <= 200; nextLine++) {
        const line: string = state.src.slice(state.bMarks[nextLine] + state.tShift[nextLine], state.eMarks[nextLine])
        const end = line.indexOf(close)
        if (end >= 0 && !line.slice(end + close.length).trim()) { lines.push(line.slice(0, end)); nextLine++; found = true; break }
        lines.push(line)
        if (lines.reduce((sum, item) => sum + item.length, 0) > MAX_FORMULA_LENGTH * 2) break
      }
      body = lines.join('\n')
    }
    if (!found) return false
    if (silent) return true
    const token = state.push('math_block', 'div', 0)
    token.block = true; token.content = body.trim(); token.map = [startLine, nextLine]
    state.line = nextLine
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
  md.renderer.rules.math_inline = (tokens, index) => renderFormula(tokens[index].content, Boolean(tokens[index].meta?.display))
  md.renderer.rules.math_block = (tokens, index) => `<div class="markdown-math" data-source-line="${(tokens[index].map?.[0] || 0) + 1}">${renderFormula(tokens[index].content, true)}</div>\n`
}
