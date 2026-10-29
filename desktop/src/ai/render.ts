/**
 * Markdown for assistant answers: headings, lists, tables, quotes, code with a
 * copy button, KaTeX math and Mermaid diagrams. Source HTML stays disabled; the
 * only generated HTML comes from markdown-it, KaTeX and Mermaid (strict mode).
 */
import MarkdownIt from 'markdown-it'
import { installMarkdownMath } from '../components/markdown-math'
import { installCjkEmphasis } from '../components/markdown-cjk'

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })
installMarkdownMath(markdown)
installCjkEmphasis(markdown)

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
export type DiagramStyle = 'glass' | 'warm' | 'sketch'
// 图示跟着界面风格走：暖色用象牙白与陶土色，草稿用 Mermaid 的手绘线条；字和线条都保持足够的对比度。
function mermaidConfig(dark: boolean, style: DiagramStyle) {
  const base = { startOnLoad: false, securityLevel: 'strict', fontFamily: 'inherit', flowchart: { htmlLabels: false }, suppressErrorRendering: true }
  if (style === 'warm') return { ...base, theme: 'base', fontFamily: "'Anthropic Sans', 'Segoe UI', 'Microsoft YaHei UI', sans-serif", themeVariables: dark
    ? { background: '#30302e', primaryColor: '#3a3a37', primaryBorderColor: '#d97757', primaryTextColor: '#faf9f5', secondaryColor: '#262624', tertiaryColor: '#2a2a28', lineColor: '#c2c0b6', textColor: '#faf9f5', noteBkgColor: '#4a3229', noteTextColor: '#faf9f5', fontSize: '14px' }
    : { background: '#faf9f5', primaryColor: '#f5f4ed', primaryBorderColor: '#c96442', primaryTextColor: '#141413', secondaryColor: '#ebdbbc', tertiaryColor: '#f0eee6', lineColor: '#5e5d59', textColor: '#141413', noteBkgColor: '#f2dfd3', noteTextColor: '#141413', fontSize: '14px' } }
  if (style === 'sketch') return { ...base, theme: 'base', look: 'handDrawn', handDrawnSeed: 7, fontFamily: "'Patrick Hand', 'Ma Shan Zheng', KaiTi, 'Microsoft YaHei UI', sans-serif", themeVariables: dark
    ? { background: '#2e2c28', primaryColor: '#5e5427', primaryBorderColor: '#ece6d6', primaryTextColor: '#ece6d6', secondaryColor: '#36503a', tertiaryColor: '#34322d', lineColor: '#ece6d6', textColor: '#ece6d6', noteBkgColor: '#5e5427', noteTextColor: '#ece6d6', fontSize: '15px' }
    : { background: '#fbf8f0', primaryColor: '#fff2a8', primaryBorderColor: '#2e2d2a', primaryTextColor: '#2e2d2a', secondaryColor: '#d6ecd2', tertiaryColor: '#ffd9cc', lineColor: '#2e2d2a', textColor: '#2e2d2a', noteBkgColor: '#fff2a8', noteTextColor: '#2e2d2a', fontSize: '15px' } }
  return { ...base, theme: dark ? 'dark' : 'neutral' }
}
export function renderDiagrams(root: HTMLElement, dark: boolean, style: DiagramStyle = 'glass'): Promise<void> {
  const pending: HTMLElement[] = []
  for (const figure of root.querySelectorAll<HTMLElement>('figure[data-diagram]:not([data-rendered])')) {
    const svg = svgCache.get(`${style}:${dark}:${figure.dataset.diagram || ''}`)
    if (svg) { figure.dataset.rendered = 'true'; figure.innerHTML = svg; figure.classList.add('rendered') }
    else pending.push(figure)
  }
  if (!pending.length) return Promise.resolve()
  renderQueue = renderQueue.then(() => renderPending(pending, dark, style)).catch(() => {})
  return renderQueue
}
async function renderPending(figures: HTMLElement[], dark: boolean, style: DiagramStyle) {
  mermaidModule ||= import('mermaid').then(module => module.default)
  const mermaid = await mermaidModule
  mermaid.initialize(mermaidConfig(dark, style))
  for (const figure of figures) {
    if (!figure.isConnected || figure.dataset.rendered) continue
    figure.dataset.rendered = 'true'
    const source = figure.dataset.diagram || '', key = `${style}:${dark}:${source}`
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
