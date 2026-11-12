// 代码语法高亮：常用的三十几种语言（highlight.js 的 common 集合）。没写语言的短代码自动识别，拿不准就不上色。
import hljs from 'highlight.js/lib/common'

/** 返回带 hljs-* 标记的 HTML（已转义）；不认识的语言或识别不出来时返回空串，由调用方按纯文本输出。 */
export function highlightCode(code: string, language = ''): string {
  try {
    if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value
    if (!language && code.length <= 6000) { const guess = hljs.highlightAuto(code); if (guess.relevance >= 5) return guess.value }
  } catch { /* 高亮失败就照纯文本显示 */ }
  return ''
}
