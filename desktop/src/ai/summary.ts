/**
 * 总结模式：让助手把一份文档写成一份总结文档。
 *
 * 一段对话带上 summary 标记就是总结对话：系统提示词换成下面这一套，助手把文档正文写在
 * <summary-doc>…</summary-doc>（整篇）或 <summary-add>…</summary-add>（在末尾续写）里；
 * 改已有的草稿用 <summary-edit><old>原文</old><new>新内容</new></summary-edit>，只发改动的那几处。
 * 对话栏里只显示标签外面的话，正文显示在草稿面板里；读者满意后存成 Markdown 放进文档库。
 */
export type UiAmount = 'less' | 'normal' | 'more'
export type UiLean = 'diagram' | 'balanced' | 'interactive'
export type SummaryOptions = { scope: string; length: string; structure: string; tone: string; language: string; focus: string; ui: boolean; /** 图解和可交互界面放多少。 */ uiAmount: UiAmount; /** 偏向哪一类。 */ uiLean: UiLean; multi: boolean; /** 不遗漏知识点：逐节把每一条都写到，篇幅跟着内容走。 */ complete: boolean }
export const UI_AMOUNTS: { id: UiAmount; label: string }[] = [{ id: 'less', label: '少' }, { id: 'normal', label: '正常' }, { id: 'more', label: '多' }]
export const UI_LEANS: { id: UiLean; label: string }[] = [{ id: 'diagram', label: '偏图解' }, { id: 'balanced', label: '平衡' }, { id: 'interactive', label: '偏交互' }]
const amountOf = (value: unknown): UiAmount => value === 'less' || value === 'more' ? value : 'normal'
const leanOf = (value: unknown): UiLean => value === 'diagram' || value === 'interactive' ? value : 'balanced'
/** 从存下来的东西里读出这几个开关（对话记录、上次的设置都用它）。 */
export function readSwitches(options: SummaryOptions, stored: any) { options.ui = stored?.ui === true; options.uiAmount = amountOf(stored?.uiAmount); options.uiLean = leanOf(stored?.uiLean); options.multi = stored?.multi === true; options.complete = stored?.complete === true }
export type SummaryState = { options: SummaryOptions; started: boolean; /** 存出来的那份文档的 id：再存时覆盖它。 */ savedId?: string; /** 分多次写时已经自动接着写了几轮。 */ rounds?: number }
export const emptySummaryOptions = (): SummaryOptions => ({ scope: '', length: '', structure: '', tone: '', language: '', focus: '', ui: false, uiAmount: 'normal', uiLean: 'balanced', multi: false, complete: false })

type TextKey = 'scope' | 'length' | 'structure' | 'tone' | 'language' | 'focus'
/** 表格里的固定要素。都可以不填；每一项除了现成的几个选项，还能自己写。 */
export const SUMMARY_FIELDS: { key: TextKey; label: string; options: string[]; many?: boolean; placeholder: string; /** 没选的时候在这一行下面提示什么。 */ hint: string; /** 每个现成选项是什么意思：表里指上去就显示，也会告诉助手。 */ notes: Record<string, string> }[] = [
  { key: 'scope', label: '范围', options: ['全文'], placeholder: '或者说个大概：讲同态的那部分、后半本', hint: '勾章节，或者说个大概；不选就是全文。',
    notes: { 全文: '整份文档从头到尾。', 选中的内容: '只总结你现在选中的那一段。' } },
  { key: 'length', label: '长度', options: ['一页以内', '约原文的 5%', '约原文的 10%', '约原文的 25%'], placeholder: '比如：800 字、每章三五句', hint: '不选由助手按文档长短决定。',
    notes: { 一页以内: '几百字，只留最要紧的。', '约原文的 5%': '原文一百页，大约写五页。', '约原文的 10%': '更细一些，主要的论证也留着。', '约原文的 25%': '很细：推导、例题大多留着。要一条不落，打开下面的「不遗漏知识点」。' } },
  { key: 'structure', label: '写法', options: ['提纲', '连贯成文', '按原章节', '问答'], placeholder: '比如：先结论后推导', hint: '这份总结排成什么样子。',
    notes: { 提纲: '分点分层列出来，一眼看到骨架，适合复习。', 连贯成文: '每一节里用成段的文字把道理讲通，不是一条条的列表；照样分节、有小标题。', 按原章节: '跟着原文的章节顺序，一章一段。', 问答: '一问一答，适合拿来自测。' } },
  { key: 'tone', label: '语风', options: ['平实', '学术', '口语讲解'], placeholder: '比如：像给同学讲题', hint: '用什么口气写。',
    notes: { 平实: '直接说事，不绕弯。', 学术: '用术语，表述严谨。', 口语讲解: '像当面给人讲，会打比方。' } },
  { key: 'language', label: '语言', options: ['中文', 'English', '跟随原文'], placeholder: '比如：中文，术语附英文', hint: '不选就跟着你提问用的语言。',
    notes: { 中文: '用中文写。', English: '用英文写。', 跟随原文: '原文是什么语言就用什么语言。' } },
  { key: 'focus', label: '侧重', options: ['知识体系', '概念与定义', '公式与结论', '推导与证明', '例题与方法', '重点与易错'], many: true, placeholder: '比如：只要考试会考的', hint: '想从这份文档里拿走什么，可以选几样。',
    notes: {
      知识体系: '概念之间是什么关系、谁是谁的前提、整体怎么搭起来的，先给出全貌。',
      概念与定义: '每个术语是什么意思，说清楚、说准确。',
      公式与结论: '要记住的结果：定理、公式、数据、结论，不管是怎么来的。',
      推导与证明: '关键的结果是怎么一步步得到的，思路和关键步骤。',
      例题与方法: '这类问题怎么下手，套路是什么，配上有代表性的例题。',
      重点与易错: '哪里最要紧，哪里容易弄混、容易做错。',
    } },
]
/** 一句范围、长度……里用到了哪些现成的选项：它们各是什么意思。给助手看，免得同一个词各有各的理解。 */
export function chosenNotes(options: SummaryOptions): string[] {
  const lines: string[] = []
  for (const field of SUMMARY_FIELDS) for (const item of options[field.key].split('、')) if (field.notes[item] && field.key !== 'scope' && field.key !== 'language') lines.push(`- ${field.label}「${item}」：${field.notes[item]}`)
  return lines
}

// 上次用的设置：下次打开表格时照着填好。
const KEY = 'ai.summary.options'
export function lastSummaryOptions(): SummaryOptions {
  const options = emptySummaryOptions()
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}')
    // 范围每次都不一样，不沿用。
    for (const field of SUMMARY_FIELDS) if (field.key !== 'scope' && typeof stored[field.key] === 'string') options[field.key] = stored[field.key].slice(0, 200)
    readSwitches(options, stored)
  } catch { /* 读不到就用空的 */ }
  return options
}
export function rememberSummaryOptions(options: SummaryOptions) { try { localStorage.setItem(KEY, JSON.stringify(options)) } catch { /* 只在这次有效 */ } }

/** 文档目录里的一条：阅读器给的，表格里拿来让读者勾章节。end 是这一章（节）到哪一页为止。 */
export type Chapter = { title: string; level: number; page?: number; end?: number }
/** 表格里列哪些：只要最上面两层（章和节），太细的不列。最上面只有孤零零一条时（多半是书名）它不算一章，往下取。 */
export function summaryChapters(outline: Chapter[] = []): Chapter[] {
  let items = outline.filter(item => item.title.trim())
  for (let pass = 0; pass < 3 && items.length > 1; pass++) {
    const top = Math.min(...items.map(item => item.level))
    if (items.filter(item => item.level === top).length !== 1) break
    items = items.filter(item => item.level !== top)
  }
  if (!items.length) return []
  const top = Math.min(...items.map(item => item.level))
  const kept = items.filter(item => item.level <= top + 1).slice(0, 400).map(item => ({ title: item.title, page: item.page, level: item.level - top }))
  return kept.map((item, index) => {
    // 到下一个同级或更高一级的条目为止。章一般另起一页，所以算到它前一页；节常常在页中间开始，那一页两边都算。
    const next = kept.slice(index + 1).find(other => other.level <= item.level)
    return item.page && next?.page ? { ...item, end: Math.max(item.page, item.level ? next.page : next.page - 1) } : item
  })
}
/** 目录排成「章 → 它下面的节」：at 是章在列表里的位置，parts 是它的节。前面没有章的节自己算一组。 */
export function chapterGroups(chapters: Chapter[]): { at: number; parts: number[] }[] {
  const groups: { at: number; parts: number[] }[] = []
  chapters.forEach((item, index) => { if (item.level && groups.length && chapters[groups.at(-1)!.at]!.level === 0) groups.at(-1)!.parts.push(index); else groups.push({ at: index, parts: [] }) })
  return groups
}
const named = (item: Chapter) => `「${item.title.trim().slice(0, 60)}」${item.page ? item.end === undefined ? `（第 ${item.page} 页起）` : item.end > item.page ? `（第 ${item.page}–${item.end} 页）` : `（第 ${item.page} 页）` : ''}`
/**
 * 勾选的章节写成一句范围。chosen 里是勾上的位置：章勾上＝整章；章没勾、只勾了它的几节＝只要这几节。
 * 「第三章 群」（第 45–79 页）；「第四章 环」里的「4.1 理想」（第 80–86 页）、「4.2 商环」（第 86–91 页）
 */
export function chapterScope(chapters: Chapter[], chosen: Iterable<number>): string {
  const on = new Set(chosen), out: string[] = []
  for (const group of chapterGroups(chapters)) {
    const head = chapters[group.at]!
    if (on.has(group.at)) { out.push(named(head)); continue }
    const parts = group.parts.filter(index => on.has(index)).map(index => named(chapters[index]!))
    if (parts.length) out.push(`「${head.title.trim().slice(0, 60)}」里的${parts.join('、')}`)
  }
  return out.join('；').slice(0, 1200)
}
/** 行尾那几个字：勾了什么。只勾一处就写它的名字。 */
export function chapterLabel(chapters: Chapter[], chosen: Iterable<number>): string {
  const on = new Set(chosen); let whole = 0, parts = 0, only = ''
  for (const group of chapterGroups(chapters)) {
    if (on.has(group.at)) { whole++; only = chapters[group.at]!.title; continue }
    for (const index of group.parts) if (on.has(index)) { parts++; only = chapters[index]!.title }
  }
  if (whole + parts === 1) return only.trim()
  return [whole ? `${whole} 章` : '', parts ? `${parts} 节` : ''].filter(Boolean).join(' ')
}
/** 把一句范围读回成勾选（编辑那张表时用）。读不回去（读者自己写的范围）就是 null。 */
export function chosenFromScope(chapters: Chapter[], scope: string): number[] | null {
  if (!scope.includes('「')) return null
  const on: number[] = []
  for (const group of chapterGroups(chapters)) {
    const head = `「${chapters[group.at]!.title.trim().slice(0, 60)}」`
    if (scope.includes(`${head}里的`)) on.push(...group.parts.filter(index => scope.includes(named(chapters[index]!))))
    else if (scope.includes(named(chapters[group.at]!))) on.push(group.at, ...group.parts)
  }
  return on.length && chapterScope(chapters, on) === scope ? on : null
}

/** 读者点「开始」后发出去的第一句话：把表格里填的列出来，读者自己也看得到问了什么。 */
/** 助手给总结起的文件名收拾一下：只要第一行，去掉引号、扩展名和不能当文件名的字符。起不出来返回空。 */
export function cleanFileName(raw: string) {
  const line = raw.split('\n').map(item => item.trim()).find(Boolean) || ''
  const name = line.replace(/^(文件名|标题)\s*[:：]\s*/, '').replace(/\.(md|markdown)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f`#]/g, '').replace(/^[「『《“'\s]+|[」』》”'\s。.，,]+$/g, '').trim()
  return name.length >= 2 && name.length <= 40 ? name : ''
}
export const fileNamePrompt = (source: string, text: string) => `给下面这份读书总结起一个文件名，让人在一堆文件里一眼认出它讲的是哪本书的哪部分。
要求：不超过 20 个字；先写书名的简称，再写总结的范围或主题；书名很长就缩成通用的叫法，去掉作者、出版信息、网站名；用总结本身的语言。
只输出文件名这一行，不带扩展名、引号、解释。

原文档的文件名：${source}

总结的开头：
"""
${text.slice(0, 2400)}
"""`
export const COMPLETE = '不遗漏知识点'
const bare = (title: string) => title.replace(/\.(pdf|md|markdown|mdown)$/i, '')
export function summaryRequest(title: string, options: SummaryOptions, extra = ''): string {
  const lines = SUMMARY_FIELDS.filter(field => options[field.key].trim()).map(field => `- ${field.label}：${options[field.key].trim()}`)
  if (options.complete) lines.push(`- 覆盖：${COMPLETE}`)
  if (extra.trim()) lines.push(`- 其他要求：${extra.trim()}`)
  return `总结《${bare(title)}》` + (lines.length ? `\n${lines.join('\n')}` : '')
}

const AMOUNT_RULE: Record<UiAmount, string> = {
  less: '全篇一到两处，放在最关键的概念上。',
  normal: '每个二级标题下面一般一处，全篇不少于三处（文档只有一两节时至少一处）。',
  more: '每个二级标题下面至少一处；一节里既有结构又有变化的，放两处。全篇不少于五处（文档只有一两节时至少两处）。',
}
const LEAN_RULE: Record<UiLean, string> = {
  diagram: '以图解为主，讲清概念的结构和关系；可交互的只在量确实随参数连续变化时才用。',
  balanced: '图解和可交互按内容选：讲「是什么、什么关系」用图解，讲「怎么变、差多少」用可交互。',
  interactive: '优先做读者能动手的：可以拖参数的演示、可以筛选的表、能对比的图表；只有纯粹的结构关系才用图解。',
}
/** 第一句话里读者另外写的要求（编辑那张表时放回输入框）。 */
export const requestExtra = (content: string) => /^- 其他要求：(.+)$/m.exec(content)?.[1]?.trim() || ''
/** 把那第一句话读回成一张表（对话栏里它显示成表格，不是一段带横杠的文字）。不是那句话就返回 null。 */
export function parseSummaryRequest(content: string): { title: string; rows: [string, string][] } | null {
  const lines = content.split('\n'), head = /^总结《(.+)》$/.exec(lines[0]?.trim() || '')
  if (!head) return null
  const rows: [string, string][] = []
  for (const line of lines.slice(1)) {
    const row = /^- ([^：]{1,8})：(.+)$/.exec(line.trim())
    if (row) rows.push([row[1]!, row[2]!]); else if (line.trim()) return null
  }
  return { title: head[1]!, rows }
}

/** 总结对话的系统提示词（接在文档阅读那一套后面）。uiGuide 是 Intelligent UI 的写法说明，开了才给。 */
export function summaryInstructions(title: string, options: SummaryOptions, uiGuide: string): string {
  return [
    `# 总结模式`,
    `你现在的任务是为读者把《${bare(title)}》写成一份总结文档。这份文档单独显示在草稿面板里，读者满意后会存成 Markdown 文件放进文档库，以后当作一份独立的文档来读。`,
    '怎么写：',
    '- 文档正文放在 <summary-doc> 和 </summary-doc> 之间，两个标签各占一行。里面是完整的 Markdown：以一个一级标题开头，公式写成 $…$ 或 $$…$$，不要写 HTML 标签。',
    '- 不管选的是哪种写法，文档都要有清楚的 Markdown 结构：一个一级标题；按内容分成几节，每节一个二级标题，节里内容多再用三级标题；该强调的术语加粗，公式单独成行时用 $$…$$，并列的几项用列表，成组的对比用表格。「连贯成文」说的是每一节里面用成段的文字讲，不是把标题也去掉——没有标题的一大片文字不算合格的文档。',
    '- 标签外面只用一两句话交代你做了什么、认定的范围、哪里拿不准。不要在标签外重复正文，也不要把正文放进代码块。',
    '- 文档里不要写 [S1a2b-3] 这类来源编号：那是对话里用来跳转的标记，放进一份独立的文档里只是一串乱码。这一条优先于前面关于标注来源的要求。读者要出处时写页码，例如（第 38 页）。',
    '- 读者要你修改时：只发改动的地方，不要把整篇重新输出一遍。每一处改动写一个块：<summary-edit>，里面先是 <old>…</old>，再是 <new>…</new>，最后 </summary-edit>。<old> 里从草稿的 Markdown 原文里原样抄下要被换掉的那一段（一个字、一个符号都不要改，长短以能唯一确定位置为准，一般是一两句或一个小节）；<new> 里写换成的内容。删掉一段就让 <new> 空着；在某处后面加内容，就把那处的原文抄进 <old>，<new> 里写「原文 + 新增的部分」。一次回复可以有好几个这样的块。草稿的全文每次都会随读者的话带给你，以它为准。',
    '- 只有改动遍及全文（换一种语言、整体压缩、换结构）时才重新输出整篇，仍然放在 <summary-doc> 里。只是在末尾续写时用 <summary-add> 和 </summary-add>，里面只放新增的部分。',
    '- 读者只是提问、不需要动文档时，直接回答，不输出这两种标签。',
    '内容从哪来：',
    '- 必须来自文档。动笔前先用阅读工具把要总结的范围读过，不要凭印象写；文档里没有的不要补，拿不准的宁可不写。',
    '- 范围有三种给法。没说：就是全文。给了章节名（带「」，后面括号里是页码）：只总结点到的这些章节——「某章」里的「某节」表示只要那一章里的这几节；给了页码范围就读这个范围，只给了起始页就从那里读到下一章（节）开始为止。说得含糊（「讲同态的那部分」「后半本」）：自己用目录、搜索和翻页找到对应的页或行，在标签外用一句话说明你认定的是哪一段。只有确实定不下来时才问读者。',
    '- 表格里没填的要素由你按这份文档的性质决定，不用问。',
    ...(chosenNotes(options).length ? ['读者在表格里选的这几项，意思是：', ...chosenNotes(options)] : []),
    ...(options.complete ? [
      '读者要求不遗漏知识点。这份总结是拿来代替重读原文的，按下面的做：',
      '- 按原文的顺序一节一节写。每一节里出现的定义、定理、公式、结论、方法、例题、图表给出的结果、作者特意提醒的地方，每一条都要写到，不能为了篇幅合并或跳过。',
      '- 公式写全，连同适用条件和每个符号的含义；推导保留关键步骤；例题保留题设、思路和结果。',
      '- 能压缩的只有铺垫、重复和闲话。篇幅跟着内容走：这时「长度」一栏只说明每一条讲多细，不是总字数的上限，宁可长也不要漏。',
      '- 每写完一节，对照刚读过的原文数一遍有没有落下的，有就补在这一节里再往下写。',
    ] : []),
    options.multi || options.complete
      ? '这份文档比较长，分多次写：每次回复只读、只写一部分（大约一章或几十页）。第一次用 <summary-doc> 写出标题和第一部分，之后每次用 <summary-add> 把新的一部分接在文档末尾，不要重复已经写过的内容。每次回复的最后单独一行写 [[继续]]（后面还有没写的）或 [[完成]]（全部写完了）。收到「继续」就接着写下一部分。'
      : '一次回复里把整份总结写完。一次大约能读四十页；范围比这大、读不完时，按顺序尽量读到，在标签外说明哪些部分没有覆盖到，并提醒读者可以在表里打开「分多次写」。',
    uiGuide ? [
      '读者打开了「图解与可交互」（Intelligent UI）。这是对这份文档的要求，不是一个可用可不用的选项：没有 ui 代码块的文档不合格。',
      `- 放多少：${AMOUNT_RULE[options.uiAmount]}`,
      `- 用哪类：${LEAN_RULE[options.uiLean]}`,
      '- 放在哪：ui 代码块直接写在 <summary-doc>（或 <summary-add>）里面的正文中间，紧跟在它讲的那段文字后面。前面说的「不要把正文放进代码块」指的是整篇文档，不包括这些 ui 代码块。',
      '- 画什么：概念之间的包含、层级、分类、对应用图解；推导和流程用带步骤的图解；公式里有参数、量随量变化用 sim；几样东西的对比用 table 或 chart。每一节动笔前先想这一节哪一处最值得画。',
      '- 写完一节（或整篇）回头数一遍 ui 代码块的个数，不够就在最合适的地方补上再结束。分多次写时每一次回复都按这个数量来。读者后来要求修改时，除非他说不要图，改完仍要保持这个数量。',
      uiGuide,
    ].join('\n') : '这份文档只用文字、公式、列表和表格，不要写 ui 代码块，也不要写 mermaid。',
  ].join('\n')
}

// 来源编号（[S1a2b-3]、[S1a2b-3, S1a2b-4]）：模型偶尔还是会带上，进草稿前去掉。
const CITATION = /[ \t]?[\[【]\s*S[a-zA-Z0-9]+-\d+(?:\s*[,，、;；]\s*S[a-zA-Z0-9]+-\d+)*\s*[\]】]/g
const BLOCK = /<summary-(doc|add|edit)>\s*\n?([\s\S]*?)(?:\n?\s*<\/summary-\1>|$)/g
const MARK = /\n?\s*\[\[(继续|完成)\]\]\s*$/
type Block = { kind: 'doc' | 'add' | 'edit'; text: string; open: boolean; from: number; to: number }
/** 一条回答里的文档块（最后一个块没有结束标签＝还在写）。 */
function blocks(content: string) {
  const found: Block[] = []
  for (const match of content.matchAll(BLOCK)) found.push({ kind: match[1] as Block['kind'], text: match[2]!.replace(MARK, '').replace(CITATION, ''), open: !match[0].trimEnd().endsWith(`</summary-${match[1]}>`), from: match.index!, to: match.index! + match[0].length })
  return found
}
/** 一处修改：要换掉的原文和新内容。ready＝原文已经写完（可以去草稿里找了），done＝新内容也写完了。 */
function parseEdit(body: string) {
  const match = /<old>\s*\n?([\s\S]*?)(?:\n?\s*<\/old>\s*(?:<new>\s*\n?([\s\S]*?)(\n?\s*<\/new>|$)|$)|$)/.exec(body)
  if (!match) return { old: '', next: '', ready: false, done: false }
  const ready = /<\/old>/.test(body)
  return { old: (match[1] || '').trim(), next: (match[2] || '').replace(/\s+$/, ''), ready, done: Boolean(match[3]) }
}
/** 在草稿里找要换掉的那一段：先原样找；找不到再放宽空白（模型抄的时候常常多一个空格、少一个换行）。 */
function locate(text: string, old: string): { from: number; to: number } | null {
  if (!old) return null
  const exact = text.indexOf(old)
  if (exact >= 0) return { from: exact, to: exact + old.length }
  if (old.length > 6000) return null
  const loose = new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  const match = loose.exec(text)
  return match ? { from: match.index, to: match.index + match[0].length } : null
}
type Turn = { role: string; content: string; failed?: boolean; finishedAt?: number }
export type Draft = { text: string; writing: boolean; versions: number; /** 最近一次改动是哪一种：整篇、续写，还是局部修改。 */ last: '' | Block['kind']; /** 最近一条回答里有几处修改没对上原文、没改成。 */ missed: number }
/** 现在的草稿：按顺序把每条回答里的块放上去——整篇的换掉前面的，续写的接在后面，修改的只换它点名的那一段。 */
export function summaryDraft(messages: Turn[]): Draft {
  let text = '', writing = false, versions = 0, last: Draft['last'] = '', missed = 0
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const found = blocks(message.content)
    if (found.length) missed = 0
    for (const block of found) {
      const live = block.open && !message.finishedAt
      // 被打断的那一块只写了一半：整篇重写不拿它换掉原来完整的那一份（除非原来就没有），局部修改不套半截的新内容。
      const cut = block.open && Boolean(message.finishedAt)
      if (block.kind === 'doc') { if (!cut || !text) { text = block.text; versions++; last = 'doc' } }
      else if (block.kind === 'add') { if (block.text.trim()) { text = text ? `${text.trimEnd()}\n\n${block.text}` : block.text; versions++; last = 'add' } }
      else {
        const edit = parseEdit(block.text)
        // 还在写的时候：原文一写完就定位，新内容写到哪换到哪，草稿上看得见它在改。
        if (edit.ready && (edit.done || live)) {
          const at = locate(text, edit.old)
          if (at) { text = text.slice(0, at.from) + edit.next + text.slice(at.to); versions++; last = 'edit' }
          else if (!live) missed++
        } else if (cut || (!live && !edit.ready)) missed++
      }
      writing = live
    }
  }
  return { text: text.trim(), writing, versions, last, missed }
}
/** 对话栏里显示的内容：文档块换成一枚小牌子（点它看草稿），续写用的标记去掉。 */
export function summaryChat(content: string): string {
  let out = '', last = 0, edits = 0
  const found = blocks(content)
  for (const [index, block] of found.entries()) {
    out += content.slice(last, block.from)
    last = block.to
    if (block.kind === 'edit') {
      // 连着的几处修改合成一枚牌子。
      edits++
      if (found[index + 1]?.kind === 'edit' && !content.slice(block.to, found[index + 1]!.from).trim()) continue
      out += `\n\n\`\`\`draft-chip\n修改草稿 · ${edits} 处${block.open ? ' · 正在改' : ''}\n\`\`\`\n\n`; edits = 0
      continue
    }
    const size = block.text.replace(/\s+/g, '').length
    out += `\n\n\`\`\`draft-chip\n${block.kind === 'doc' ? '写入草稿' : '续写草稿'} · ${size} 字${block.open ? ' · 正在写' : ''}\n\`\`\`\n\n`
  }
  return (out + content.slice(last)).replace(MARK, '').replace(/\n{3,}/g, '\n\n').trim()
}
/** 有几处没改成时，替读者发给助手的那句话。 */
export const RETRY_EDITS = '上一轮有修改没有改成：<old> 里的文字和草稿对不上。请对照现在的草稿全文，把没改成的那几处重新给一遍，<old> 必须从草稿里原样抄。'
/** 分多次写：这条回答的最后是不是「后面还有」。 */
export const summaryContinues = (content: string) => /\[\[继续\]\]\s*$/.test(content.trimEnd())
/** 总结对话每一问的阅读预算：都放到设置里允许的上限。 */
export const SUMMARY_READING = { pages: 40, characters: 120000, calls: 60, rounds: 8 }
/** 最多自动接着写这么多轮，免得没完没了。 */
export const MAX_SUMMARY_ROUNDS = 40
