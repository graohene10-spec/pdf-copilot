/**
 * Markdown for assistant answers: headings, lists, tables, quotes, code with a
 * copy button, KaTeX math and Mermaid diagrams. Source HTML stays disabled; the
 * only generated HTML comes from markdown-it, KaTeX and Mermaid (strict mode).
 */
import MarkdownIt from 'markdown-it'
import { installMarkdownMath } from '../components/markdown-math'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })
installMarkdownMath(markdown)

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
const DIAGRAM_LANGUAGES = new Set(['mermaid', 'flowchart', 'sequence', 'mmd'])

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index]
  const language = (token.info || '').trim().split(/\s+/)[0].toLowerCase()
  if (DIAGRAM_LANGUAGES.has(language)) {
    return `<figure class="answer-diagram" data-diagram="${escape(token.content)}"><pre class="answer-code"><code>${escape(token.content)}</code></pre></figure>\n`
  }
  const label = language ? `<span>${escape(language)}</span>` : '<span>代码</span>'
  return `<div class="answer-code-block"><div class="answer-code-head">${label}<button type="button" class="answer-copy" data-copy>复制</button></div><pre class="answer-code"><code>${escape(token.content)}</code></pre></div>\n`
}
markdown.renderer.rules.code_block = markdown.renderer.rules.fence
const defaultLink = markdown.renderer.rules.link_open || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer')
  return defaultLink(tokens, index, options, env, self)
}
// Tables scroll horizontally inside narrow panes instead of widening them.
markdown.renderer.rules.table_open = () => '<div class="answer-table"><table>'
markdown.renderer.rules.table_close = () => '</table></div>'

export function renderMarkdown(source: string): string {
  return markdown.render(String(source || ''))
}

let mermaidModule: Promise<any> | undefined
let diagramSeed = 0
// Mermaid is not re-entrant: renders run one at a time, and finished SVGs are reused,
// so re-rendering an answer (scrolling, theme, streaming) never races or flashes the source.
const svgCache = new Map<string, string>()
let renderQueue: Promise<void> = Promise.resolve()
export function renderDiagrams(root: HTMLElement, dark: boolean): Promise<void> {
  const pending: HTMLElement[] = []
  for (const figure of root.querySelectorAll<HTMLElement>('figure[data-diagram]:not([data-rendered])')) {
    const svg = svgCache.get(`${dark}:${figure.dataset.diagram || ''}`)
    if (svg) { figure.dataset.rendered = 'true'; figure.innerHTML = svg; figure.classList.add('rendered') }
    else pending.push(figure)
  }
  if (!pending.length) return Promise.resolve()
  renderQueue = renderQueue.then(() => renderPending(pending, dark)).catch(() => {})
  return renderQueue
}
async function renderPending(figures: HTMLElement[], dark: boolean) {
  mermaidModule ||= import('mermaid').then(module => module.default)
  const mermaid = await mermaidModule
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', fontFamily: 'inherit', flowchart: { htmlLabels: false }, suppressErrorRendering: true })
  for (const figure of figures) {
    if (!figure.isConnected || figure.dataset.rendered) continue
    figure.dataset.rendered = 'true'
    const source = figure.dataset.diagram || '', key = `${dark}:${source}`
    try {
      const svg = svgCache.get(key) || (await mermaid.render(`answer-diagram-${++diagramSeed}`, source)).svg
      if (svgCache.size > 60) svgCache.delete(svgCache.keys().next().value!)
      svgCache.set(key, svg)
      if (!figure.isConnected) continue
      figure.innerHTML = svg
      figure.classList.add('rendered')
    } catch {
      figure.classList.add('failed')
      figure.insertAdjacentHTML('beforeend', '<figcaption>图示语法有误，显示原文</figcaption>')
    }
  }
}
