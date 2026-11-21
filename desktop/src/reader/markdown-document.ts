// 文档用的 Markdown：阅读器里打开的 .md 和总结的草稿面板用同一套，两边看到的样子一致。
// 和助手回答的那一套（ai/render.ts）不同：这里是 GitHub 式排版，源 HTML 只放行排版标签。
import MarkdownIt from 'markdown-it'
import { installMarkdownMath } from '../components/markdown-math'
import { installGithubFlavor } from '../components/markdown-github'
import { installCjkEmphasis } from '../components/markdown-cjk'
import { highlightCode } from '../ai/highlight'

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
/** ```ui 代码块：不显示代码，留一个占位，由 intelligent-ui.ts 的 mountIntelligentUi 画成图解或可操作的界面。 */
function installUiBlocks(markdown: MarkdownIt) {
  const fallback = markdown.renderer.rules.fence!
  markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index]!, language = (token.info || '').trim().split(/\s+/)[0]!.toLowerCase()
    if (language !== 'ui' && language !== 'iui') return fallback(tokens, index, options, env, self)
    return `<div class="iui"${self.renderAttrs(token)} data-ui="${escape(token.content)}"></div>\n`
  }
}
export function documentMarkdown(): MarkdownIt {
  const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true, highlight: (code, language) => highlightCode(code, language.trim().split(/\s+/)[0]!.toLowerCase()) })
  installMarkdownMath(markdown)
  installGithubFlavor(markdown)
  installCjkEmphasis(markdown)
  installUiBlocks(markdown)
  return markdown
}
