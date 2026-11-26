/**
 * 把模型写歪了的学习块扶正，再交给 learning.ts 解析和界面显示：
 * - 有的模型（DeepSeek）把块写成自己的工具调用语法：<｜DSML｜invoke name="learn-quiz">{...}
 * - 块里是 JSON，公式的反斜杠该写两个；模型常只写一个（\frac、\varepsilon），JSON 就坏了或被读成别的字符。
 */
const INVOKE = /<[\s|｜]*DSML[\s|｜]*invoke\s+name\s*=\s*"(learn-[a-z]+)"\s*>/gi
const TAGS = /<[\s|｜]*\/?[\s|｜]*DSML[^>\n]*>/gi
const EMPTY_FENCE = /(^|\n)[ \t]*```[a-z-]*[ \t]*\n\s*```[ \t]*(?=\n|$)/gi
const BLOCK = /(^|\n)([ \t]*```learn-[a-z]+[^\n]*\n)([\s\S]*?)(\n[ \t]*```)/gi
// 已经成对的不动；后面跟着两个以上字母的（\frac、\nu、\beta）是公式命令；其余不是 JSON 认识的转义的（\{、\,、\|）也是公式。
const LONE_SLASH = /\\\\|\\(?=[a-zA-Z]{2})|\\(?!["\\/bfnrtu])/g

/** 从 start 处的 { 起找到和它配对的 }；字符串里的括号不算。没配上返回 -1。 */
function closing(text: string, start: number): number {
  let depth = 0, quoted = false
  for (let at = start; at < text.length; at++) {
    const char = text[at]
    if (quoted) { if (char === '\\') at++; else if (char === '"') quoted = false; continue }
    if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return at
  }
  return -1
}

function fences(content: string): string {
  if (!/DSML/i.test(content)) return content
  let out = '', from = 0
  for (const match of content.matchAll(INVOKE)) {
    const open = content.indexOf('{', match.index + match[0].length), end = open < 0 ? -1 : closing(content, open)
    // 还在写（流式途中）：这一块先不显示。
    if (end < 0) { out += content.slice(from, match.index); from = content.length; break }
    out += `${content.slice(from, match.index)}\n\`\`\`${match[1]!.toLowerCase()}\n${content.slice(open, end + 1)}\n\`\`\`\n`
    from = end + 1
  }
  return (out + content.slice(from)).replace(TAGS, '').replace(EMPTY_FENCE, '$1').replace(/\n{3,}/g, '\n\n')
}

// 应用附在历史回答后面的出处清单，模型有时照着抄到自己回答的末尾。
const ECHO = /\s*\[此前查到的相关位置\]\s*(\[\s*\{[\s\S]*)?$/

export function normalizeLearning(content: string): string {
  content = content.replace(ECHO, '')
  if (!/learn-/i.test(content)) return content
  return fences(content).replace(BLOCK, (_all, lead: string, open: string, body: string, close: string) => lead + open + body.replace(LONE_SLASH, hit => hit === '\\\\' ? hit : '\\\\') + close)
}
