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
export type SummaryOptions = { scope: string; length: string; structure: string; tone: string; language: string; focus: string; ui: boolean; /** 图解和可交互界面放多少。 */ uiAmount: UiAmount; /** 偏向哪一类。 */ uiLean: UiLean; multi: boolean }
export const UI_AMOUNTS: { id: UiAmount; label: string }[] = [{ id: 'less', label: '少' }, { id: 'normal', label: '正常' }, { id: 'more', label: '多' }]
export const UI_LEANS: { id: UiLean; label: string }[] = [{ id: 'diagram', label: '偏图解' }, { id: 'balanced', label: '平衡' }, { id: 'interactive', label: '偏交互' }]
const amountOf = (value: unknown): UiAmount => value === 'less' || value === 'more' ? value : 'normal'
const leanOf = (value: unknown): UiLean => value === 'diagram' || value === 'interactive' ? value : 'balanced'
/** 从存下来的东西里读出这几个开关（对话记录、上次的设置都用它）。 */
export function readSwitches(options: SummaryOptions, stored: any) { options.ui = stored?.ui === true; options.uiAmount = amountOf(stored?.uiAmount); options.uiLean = leanOf(stored?.uiLean); options.multi = stored?.multi === true }
export type SummaryState = { options: SummaryOptions; started: boolean; /** 存出来的那份文档的 id：再存时覆盖它。 */ savedId?: string; /** 分多次写时已经自动接着写了几轮。 */ rounds?: number }
export const emptySummaryOptions = (): SummaryOptions => ({ scope: '', length: '', structure: '', tone: '', language: '', focus: '', ui: false, uiAmount: 'normal', uiLean: 'balanced', multi: false })

type TextKey = 'scope' | 'length' | 'structure' | 'tone' | 'language' | 'focus'
/** 表格里的固定要素。都可以不填；每一项除了现成的几个选项，还能自己写。 */
export const SUMMARY_FIELDS: { key: TextKey; label: string; options: string[]; many?: boolean; placeholder: string; /** 没选的时候在这一行下面提示什么。 */ hint: string; /** 每个现成选项是什么意思：表里指上去就显示，也会告诉助手。 */ notes: Record<string, string> }[] = [
  { key: 'scope', label: '范围', options: ['全文'], placeholder: '或者说个大概：讲同态的那部分、后半本', hint: '勾章节，或者说个大概；不选就是全文。',
    notes: { 全文: '整份文档从头到尾。', 选中的内容: '只总结你现在选中的那一段。' } },
  { key: 'length', label: '长度', options: ['一页以内', '约原文的 5%', '约原文的 10%'], placeholder: '比如：800 字、每章三五句', hint: '不选由助手按文档长短决定。',
    notes: { 一页以内: '几百字，只留最要紧的。', '约原文的 5%': '原文一百页，大约写五页。', '约原文的 10%': '更细一些，主要的论证也留着。' } },
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

/** 文档目录里的一条：阅读器给的，表格里拿来让读者勾章节。 */
export type Chapter = { title: string; level: number; page?: number }
/** 表格里列哪些：只要最上面两层（章和节），太细的不列。 */
export function summaryChapters(outline: Chapter[] = []): Chapter[] {
  const items = outline.filter(item => item.title.trim())
  if (!items.length) return []
  const top = Math.min(...items.map(item => item.level))
  return items.filter(item => item.level <= top + 1).slice(0, 300).map(item => ({ ...item, level: item.level - top }))
}
/** 勾选的章节写成一句范围：「第三章 群」（第 45 页起）、「第四章 环」（第 80 页起）。 */
export const chapterScope = (chapters: Chapter[]) => chapters.map(item => `「${item.title.trim().slice(0, 60)}」${item.page ? `（第 ${item.page} 页起）` : ''}`).join('、').slice(0, 400)

/** 读者点「开始」后发出去的第一句话：把表格里填的列出来，读者自己也看得到问了什么。 */
const bare = (title: string) => title.replace(/\.(pdf|md|markdown|mdown)$/i, '')
export function summaryRequest(title: string, options: SummaryOptions, extra = ''): string {
  const lines = SUMMARY_FIELDS.filter(field => options[field.key].trim()).map(field => `- ${field.label}：${options[field.key].trim()}`)
  if (extra.trim()) lines.push(`- 其他要求：${extra.trim()}`)
  return `总结《${bare(title)}》` + (lines.length ? `\n${lines.join('\n')}` : '')
}

const AMOUNT_RULE: Record<UiAmount, string> = {
  less: '全篇最多一两处，只放在最关键、文字确实讲不清的地方。',
  normal: '大约每个主要章节一处；确实比文字清楚才放，没有合适的就不放。',
  more: '只要一张图或一个演示能帮上忙就放，每一节都可以有；但不要重复，也不要为了凑数硬放。',
}
const LEAN_RULE: Record<UiLean, string> = {
  diagram: '以图解为主，讲清概念的结构和关系；可交互的只在量确实随参数连续变化时才用。',
  balanced: '图解和可交互按内容选：讲「是什么、什么关系」用图解，讲「怎么变、差多少」用可交互。',
  interactive: '优先做读者能动手的：可以拖参数的演示、可以筛选的表、能对比的图表；只有纯粹的结构关系才用图解。',
}
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
    '- 范围有三种给法。没说：就是全文。给了章节名（带书名号「」，有的还带起始页）：只总结这几章，从给的页码读起，读到下一章开始为止。说得含糊（「讲同态的那部分」「后半本」）：自己用目录、搜索和翻页找到对应的页或行，在标签外用一句话说明你认定的是哪一段。只有确实定不下来时才问读者。',
    '- 表格里没填的要素由你按这份文档的性质决定，不用问。',
    ...(chosenNotes(options).length ? ['读者在表格里选的这几项，意思是：', ...chosenNotes(options)] : []),
    options.multi
      ? '这份文档比较长，分多次写：每次回复只读、只写一部分（大约一章或几十页）。第一次用 <summary-doc> 写出标题和第一部分，之后每次用 <summary-add> 把新的一部分接在文档末尾，不要重复已经写过的内容。每次回复的最后单独一行写 [[继续]]（后面还有没写的）或 [[完成]]（全部写完了）。收到「继续」就接着写下一部分。'
      : '一次回复里把整份总结写完。一次大约能读四十页；范围比这大、读不完时，按顺序尽量读到，在标签外说明哪些部分没有覆盖到，并提醒读者可以在表里打开「分多次写」。',
    uiGuide ? `这份文档可以用图解和可交互的界面（Intelligent UI），它们同样写在 <summary-doc> 里面。\n- 放多少：${AMOUNT_RULE[options.uiAmount]}\n- 用哪类：${LEAN_RULE[options.uiLean]}\n${uiGuide}` : '这份文档只用文字、公式、列表和表格，不要写 ui 代码块，也不要写 mermaid。',
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
