// CommonMark 的强调规则对中文不友好：「了。**下文」里收尾的 ** 前面是标点、后面紧跟汉字，
// 不算右侧定界，**插入新牌之前……了。** 就原样显示成星号。这里在这种 ** 与标点之间插入一个零宽空格，
// 让它重新成为合法的开/闭定界符；代码、公式不经过这条规则（只处理 inline 内容里代码以外的部分）。
import type MarkdownIt from 'markdown-it'

const PUNCT = '\\p{P}\\p{S}'
const CLOSER = new RegExp(`([${PUNCT}])(\\*\\*)(?=[^\\s${PUNCT}])`, 'gu')
const OPENER = new RegExp(`([^\\s${PUNCT}])(\\*\\*)(?=[${PUNCT}])`, 'gu')

/** Inserts U+200B where a CJK punctuation mark would otherwise stop `**` from opening or closing. */
export function fixCjkEmphasis(text: string) {
  if (!text.includes('**')) return text
  // Inline code keeps its exact characters.
  return text.split(/(`+[^`]*`+)/g).map((part, index) => index % 2 ? part : part.replace(CLOSER, '$1​$2').replace(OPENER, '$1$2​')).join('')
}

export function installCjkEmphasis(markdown: MarkdownIt) {
  markdown.core.ruler.before('inline', 'cjk_emphasis', state => {
    for (const token of state.tokens) if (token.type === 'inline') token.content = fixCjkEmphasis(token.content)
  })
}
