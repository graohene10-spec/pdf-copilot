/**
 * 总结模式：让助手把一份文档写成一份总结文档。
 *
 * 一段对话带上 summary 标记就是总结对话：系统提示词换成下面这一套，助手把文档正文写在
 * <summary-doc>…</summary-doc>（整篇）或 <summary-add>…</summary-add>（在末尾续写）里。
 * 对话栏里只显示标签外面的话，正文显示在草稿面板里；读者满意后存成 Markdown 放进文档库。
 */
export type SummaryOptions = { scope: string; length: string; structure: string; tone: string; language: string; focus: string; ui: boolean; multi: boolean }
export type SummaryState = { options: SummaryOptions; started: boolean; /** 存出来的那份文档的 id：再存时覆盖它。 */ savedId?: string; /** 分多次写时已经自动接着写了几轮。 */ rounds?: number }
export const emptySummaryOptions = (): SummaryOptions => ({ scope: '', length: '', structure: '', tone: '', language: '', focus: '', ui: false, multi: false })

type TextKey = 'scope' | 'length' | 'structure' | 'tone' | 'language' | 'focus'
/** 表格里的固定要素。都可以不填；每一项除了现成的几个选项，还能自己写。 */
export const SUMMARY_FIELDS: { key: TextKey; label: string; options: string[]; many?: boolean; placeholder: string }[] = [
  { key: 'scope', label: '范围', options: ['全文', '当前这一章'], placeholder: '说个大概就行，比如：第三章、讲同态的那部分' },
  { key: 'length', label: '长度', options: ['一页以内', '约原文的 5%', '约原文的 10%'], placeholder: '比如：800 字、每章三五句' },
  { key: 'structure', label: '结构', options: ['提纲', '连贯成文', '按原章节', '问答'], placeholder: '比如：先结论后推导' },
  { key: 'tone', label: '语风', options: ['平实', '学术', '口语讲解'], placeholder: '比如：像给同学讲题' },
  { key: 'language', label: '语言', options: ['中文', 'English', '跟随原文'], placeholder: '比如：中文，术语附英文' },
  { key: 'focus', label: '侧重', options: ['概念与定义', '推导与证明', '结论与数据', '例题'], many: true, placeholder: '比如：只要考试会考的' },
]

// 上次用的设置：下次打开表格时照着填好。
const KEY = 'ai.summary.options'
export function lastSummaryOptions(): SummaryOptions {
  const options = emptySummaryOptions()
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}')
    // 范围每次都不一样，不沿用。
    for (const field of SUMMARY_FIELDS) if (field.key !== 'scope' && typeof stored[field.key] === 'string') options[field.key] = stored[field.key].slice(0, 200)
    options.ui = stored.ui === true; options.multi = stored.multi === true
  } catch { /* 读不到就用空的 */ }
  return options
}
export function rememberSummaryOptions(options: SummaryOptions) { try { localStorage.setItem(KEY, JSON.stringify(options)) } catch { /* 只在这次有效 */ } }

/** 读者点「开始」后发出去的第一句话：把表格里填的列出来，读者自己也看得到问了什么。 */
const bare = (title: string) => title.replace(/\.(pdf|md|markdown|mdown)$/i, '')
export function summaryRequest(title: string, options: SummaryOptions, extra = ''): string {
  const lines = SUMMARY_FIELDS.filter(field => options[field.key].trim()).map(field => `- ${field.label}：${options[field.key].trim()}`)
  if (extra.trim()) lines.push(`- 其他要求：${extra.trim()}`)
  return `总结《${bare(title)}》` + (lines.length ? `\n${lines.join('\n')}` : '')
}

/** 总结对话的系统提示词（接在文档阅读那一套后面）。uiGuide 是 Intelligent UI 的写法说明，开了才给。 */
export function summaryInstructions(title: string, options: SummaryOptions, uiGuide: string): string {
  return [
    `# 总结模式`,
    `你现在的任务是为读者把《${bare(title)}》写成一份总结文档。这份文档单独显示在草稿面板里，读者满意后会存成 Markdown 文件放进文档库，以后当作一份独立的文档来读。`,
    '怎么写：',
    '- 文档正文放在 <summary-doc> 和 </summary-doc> 之间，两个标签各占一行。里面是完整的 Markdown：以一个一级标题开头，公式写成 $…$ 或 $$…$$，不要写 HTML 标签。',
    '- 标签外面只用一两句话交代你做了什么、认定的范围、哪里拿不准。不要在标签外重复正文，也不要把正文放进代码块。',
    '- 读者要你修改时：重新输出修改后的完整文档（仍然放在 <summary-doc> 里），没让改的部分原样保留，不要顺手改写。只是在末尾续写时，可以改用 <summary-add> 和 </summary-add>，里面只放新增的部分。',
    '- 读者只是提问、不需要动文档时，直接回答，不输出这两种标签。',
    '内容从哪来：',
    '- 必须来自文档。动笔前先用阅读工具把要总结的范围读过，不要凭印象写；文档里没有的不要补，拿不准的宁可不写。',
    '- 范围常常说得很含糊（「第三章」「讲同态的那部分」「当前这一章」），甚至没说。没说就是全文；说得含糊就自己用目录、搜索和翻页找到对应的页或行，在标签外用一句话说明你认定的是哪一段。只有确实定不下来时才问读者。',
    '- 表格里没填的要素由你按这份文档的性质决定，不用问。',
    options.multi
      ? '这份文档比较长，分多次写：每次回复只读、只写一部分（大约一章或几十页）。第一次用 <summary-doc> 写出标题和第一部分，之后每次用 <summary-add> 把新的一部分接在文档末尾，不要重复已经写过的内容。每次回复的最后单独一行写 [[继续]]（后面还有没写的）或 [[完成]]（全部写完了）。收到「继续」就接着写下一部分。'
      : '一次回复里把整份总结写完。文档太长、一次读不完时，按上面的范围尽量读到，并在标签外说明哪些部分没有覆盖到。',
    uiGuide ? `这份文档可以用图解和可交互的界面（Intelligent UI）。它们同样写在 <summary-doc> 里面，用在确实比文字清楚的地方，不要每节都放。\n${uiGuide}` : '这份文档只用文字、公式、列表和表格，不要写 ui 代码块，也不要写 mermaid。',
  ].join('\n')
}

const BLOCK = /<summary-(doc|add)>\s*\n?([\s\S]*?)(?:\n?\s*<\/summary-\1>|$)/g
const MARK = /\n?\s*\[\[(继续|完成)\]\]\s*$/
/** 一条回答里有没有写完的文档块（最后一个块没有结束标签＝还在写）。 */
function blocks(content: string) {
  const found: { kind: 'doc' | 'add'; text: string; open: boolean; from: number; to: number }[] = []
  for (const match of content.matchAll(BLOCK)) found.push({ kind: match[1] as 'doc' | 'add', text: match[2]!.replace(MARK, ''), open: !match[0].trimEnd().endsWith(`</summary-${match[1]}>`), from: match.index!, to: match.index! + match[0].length })
  return found
}
type Turn = { role: string; content: string; failed?: boolean; finishedAt?: number }
/** 现在的草稿：按顺序把每条回答里的文档块放上去，整篇的换掉前面的，续写的接在后面。 */
export function summaryDraft(messages: Turn[]): { text: string; writing: boolean; versions: number } {
  let text = '', writing = false, versions = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of blocks(message.content)) {
      // 被打断的整篇重写只写了一半：不拿它换掉原来完整的那一份，除非原来就没有。
      const cut = block.open && Boolean(message.finishedAt)
      if (block.kind === 'doc') { if (!cut || !text) { text = block.text; versions++ } }
      else if (block.text.trim()) { text = text ? `${text.trimEnd()}\n\n${block.text}` : block.text; versions++ }
      writing = block.open && !message.finishedAt
    }
  }
  return { text: text.trim(), writing, versions }
}
/** 对话栏里显示的内容：文档块换成一枚小牌子（点它看草稿），续写用的标记去掉。 */
export function summaryChat(content: string): string {
  let out = '', last = 0
  for (const block of blocks(content)) {
    const size = block.text.replace(/\s+/g, '').length
    out += content.slice(last, block.from) + `\n\n\`\`\`draft-chip\n${block.kind === 'doc' ? '写入草稿' : '续写草稿'} · ${size} 字${block.open ? ' · 正在写' : ''}\n\`\`\`\n\n`
    last = block.to
  }
  return (out + content.slice(last)).replace(MARK, '').replace(/\n{3,}/g, '\n\n').trim()
}
/** 分多次写：这条回答的最后是不是「后面还有」。 */
export const summaryContinues = (content: string) => /\[\[继续\]\]\s*$/.test(content.trimEnd())
/** 最多自动接着写这么多轮，免得没完没了。 */
export const MAX_SUMMARY_ROUNDS = 40
