/**
 * 对话压缩。做法参照 Codex CLI 开源的 compact：把较早的对话写成一份「交接摘要」，
 * 读者自己的原话另外原样保留一份，最近几轮不动。摘要只给模型看，不出现在界面上。
 */
export type Turn = { role: 'user' | 'assistant'; content: string; compressed?: boolean; summary?: boolean; failed?: boolean; note?: unknown; auto?: boolean }

/** 粗估 token 数：中日韩字符一字一个，其余四个字符一个。 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g)?.length || 0
  return Math.ceil(cjk + (text.length - cjk) / 4)
}
/** 对话到多少 token 自动压缩（设置里可调）；每次请求带的历史也以它为上限。 */
export const DEFAULT_LIMIT = 200000
let limit = DEFAULT_LIMIT
export const compactLimit = () => limit
/** 这个模型上实际用的上限：不超过窗口的六成，剩下的留给文档原文、提示词和回答。 */
export const limitFor = (window: number) => Math.min(limit, Math.floor(window * .6))
export function setCompactLimit(tokens: number) { limit = Number.isFinite(tokens) && tokens >= 2000 ? Math.round(tokens) : DEFAULT_LIMIT }
/** 摘要之外，读者原话最多保留这么多字（从最近的往前取）。 */
const QUOTES = 6000

export const liveTurns = <T extends Turn>(messages: T[]) => messages.filter(message => !message.compressed && message.content && !(message.failed && !message.content))
/** 还会随请求带出去的对话有多少 token。 */
export const liveTokens = (messages: Turn[]) => liveTurns(messages).reduce((sum, message) => sum + estimateTokens(message.content), 0)
/** 0–1：离自动压缩还有多远。 */
export const fullness = (messages: Turn[], tokens = limit) => Math.min(1, liveTokens(messages) / Math.max(1, tokens))
/** 较早的部分交给模型写摘要；最近几轮（最多 6 条、约上限的四分之一，从读者的一问开始）原样留下。 */
export function splitForCompaction<T extends Turn>(messages: T[], tokens = limit): { old: T[]; tail: T[] } {
  const live = liveTurns(messages), room = Math.min(8000, tokens / 4)
  let start = live.length, used = 0
  while (start > 0 && live.length - start < 6 && used + estimateTokens(live[start - 1]!.content) <= room) used += estimateTokens(live[--start]!.content)
  while (start < live.length && (live[start]!.role !== 'user' || live[start]!.summary)) start++
  return { old: live.slice(0, start), tail: live.slice(start) }
}
/** 摘要篇幅跟着原文走：约六分之一，800–4000 字。 */
export const summaryBudget = (chars: number) => Math.max(800, Math.min(4000, Math.round(chars / 6 / 100) * 100))

export function compactionPrompt(title: string, old: Turn[], instructions = ''): string {
  const transcript = old.map(message => `${message.summary ? '【此前的交接摘要】' : message.role === 'user' ? '读者' : '助手'}：${message.content.slice(0, 12000)}`).join('\n\n')
  const budget = summaryBudget(transcript.length)
  return [
    `下面是读者与阅读助手围绕《${title}》的一段较早的对话。上下文快满了，请写一份交接摘要：之后由另一位助手只凭这份摘要（和最近几轮原文）接着陪读者读下去，读者不会看到它。`,
    [
      '按下面几节写，没有内容的节省略：',
      '## 读者与要求：读者的水平、想达到的目标、对讲解方式和格式提过的要求（这些要求原样保留，不要概括掉）。',
      '## 已经讲清的内容：按主题逐条写。每条给出结论本身——定义、定理的条件与结论、关键公式（保留 LaTeX）、证明的关键一步、用过的例子，并注明页码或章节。写到「以后被问起能直接接上」的程度，不要只列标题。',
      '## 做过的题：题号、结论、用的方法；读者卡住或做错的地方。',
      '## 读者还不熟或有误解的地方。',
      '## 悬而未决：没答完的问题、约好之后再看的内容。',
      '## 用到的记号与约定。',
    ].join('\n'),
    `用读者使用的语言。宁可具体不要笼统，不写寒暄，不评价对话本身。此前已有交接摘要的，把它的内容并进来，不要丢。约 ${budget} 字，最多不超过 ${Math.round(budget * 1.3)} 字。`,
    instructions && `读者对这次压缩的额外要求：${instructions}`,
    `[对话]\n${transcript}`,
  ].filter(Boolean).join('\n\n')
}
/** 存进对话里的那条摘要：模型写的交接摘要 + 读者较早的原话。 */
export function handoff(summary: string, old: Turn[]): string {
  const quotes: string[] = []
  let chars = 0
  for (const message of [...old].reverse()) {
    if (message.role !== 'user' || message.summary || message.note || message.auto) continue
    const text = message.content.trim().slice(0, 600)
    if (!text || chars + text.length > QUOTES) break
    quotes.unshift(`- ${text.replace(/\s*\n\s*/g, ' ')}`); chars += text.length
  }
  return summary.trim() + (quotes.length ? `\n\n## 读者较早的原话（按先后）\n${quotes.join('\n')}` : '')
}
