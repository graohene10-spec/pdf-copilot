import type MarkdownIt from 'markdown-it'

type Token = ReturnType<MarkdownIt['parse']>[number]

// GitHub 风格的补充：任务列表复选框，以及 README 里常见的少量内联 HTML。
// 只放行无属性的排版标签；<img>/<a> 改写成普通图片与链接，交给后续的图片与链接处理；
// 其他标签一律去掉，只保留其中文字，脚本与事件属性都不会进入页面。
const SIMPLE_TAGS = new Set(['kbd', 'sub', 'sup', 'mark', 'b', 'i', 'u', 's', 'del', 'ins', 'small', 'strong', 'em', 'code', 'br'])
const TAG = /^<(\/?)([a-zA-Z][\w-]*)([^>]*?)\/?>$/
const ATTR = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g

function attributes(source: string) {
  const result: Record<string, string> = {}
  for (const match of source.matchAll(ATTR)) result[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  return result
}

export function installGithubFlavor(markdown: MarkdownIt) {
  markdown.set({ html: true })
  const Token = markdown.core.State.prototype.Token

  // HTML 块按段落里的内联 HTML 处理，下一步统一过滤。
  markdown.core.ruler.before('inline', 'github_html_block', state => {
    const tokens: Token[] = []
    for (const token of state.tokens) {
      if (token.type !== 'html_block') { tokens.push(token); continue }
      const open = new Token('paragraph_open', 'p', 1); open.map = token.map; open.block = true
      const inline = new Token('inline', '', 0); inline.content = token.content.trim(); inline.map = token.map; inline.children = []
      if (/^<(p|div|h[1-6])\b[^>]*\balign\s*=\s*["']?center/i.test(inline.content)) open.attrSet('class', 'align-center')
      const close = new Token('paragraph_close', 'p', -1); close.block = true
      tokens.push(open, inline, close)
    }
    state.tokens = tokens
  })

  markdown.core.ruler.after('inline', 'github_inline_html', state => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue
      const children: Token[] = []
      let hidden = ''
      for (const child of block.children) {
        const match = child.type === 'html_inline' ? TAG.exec(child.content.trim()) : null
        const name = match?.[2]!.toLowerCase()
        // <script>/<style> 里的内容整个丢弃。
        if (hidden) { if (match?.[1] && name === hidden) hidden = ''; continue }
        if (child.type !== 'html_inline') { children.push(child); continue }
        if (!match || !name) continue
        const [, closing, , rawAttrs] = match
        if ((name === 'script' || name === 'style') && !closing) { hidden = name; continue }
        if (SIMPLE_TAGS.has(name)) {
          const clean = new Token('html_inline', '', 0)
          clean.content = name === 'br' ? '<br>' : `<${closing}${name}>`
          children.push(clean)
        } else if (name === 'img' && !closing) {
          const attrs = attributes(rawAttrs!)
          if (!attrs.src) continue
          const image = new Token('image', 'img', 0)
          image.attrs = [['src', attrs.src], ['alt', '']]
          for (const key of ['width', 'height']) if (/^\d+%?$/.test(attrs[key] || '')) image.attrSet(key, attrs[key]!)
          const alt = new Token('text', '', 0); alt.content = attrs.alt || ''
          image.children = [alt]; image.content = attrs.alt || ''
          children.push(image)
        } else if (name === 'a') {
          if (closing) children.push(new Token('link_close', 'a', -1))
          else { const link = new Token('link_open', 'a', 1); link.attrs = [['href', attributes(rawAttrs!).href || '#']]; children.push(link) }
        }
      }
      block.children = children
    }
  })

  // - [ ] / - [x] 任务列表。
  markdown.core.ruler.after('github_inline_html', 'github_task_list', state => {
    const tokens = state.tokens
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i]!, first = inline.children?.[0]
      if (inline.type !== 'inline' || tokens[i - 1]!.type !== 'paragraph_open' || tokens[i - 2]!.type !== 'list_item_open' || first?.type !== 'text') continue
      const match = /^\[([ xX])\]\s+/.exec(first.content)
      if (!match) continue
      first.content = first.content.slice(match[0].length)
      const box = new Token('html_inline', '', 0)
      box.content = `<input class="task-list-checkbox" type="checkbox" tabindex="-1" aria-readonly="true"${match[1] === ' ' ? '' : ' checked'}> `
      inline.children!.unshift(box)
      tokens[i - 2]!.attrJoin('class', 'task-list-item')
    }
  })
}
