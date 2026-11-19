/**
 * 记忆：读者在阅读助手里学过什么。
 *
 * 每段对话各有一份记录（几行「学了哪个概念、掌握得怎样」），由小模型在对话告一段落后整理出来；
 * 对话删掉，它的记录跟着删掉。之后提问时，这些记录随请求带给模型，只用来判断讲解的起点和深度。
 * 快速解释、翻译不读也不写这份记忆。
 */
import { reactive } from 'vue'
import { library } from '../sdk'

export type MemoryEntry = { documentId: string; documentTitle: string; title: string; at: number; items: string[]; /** 整理时这段对话有多少条消息。 */ count: number }
const KEY = 'ai.memory.v1'
const MAX_ITEMS = 8
export const memory = reactive<{ entries: Record<string, MemoryEntry>; ready: boolean }>({ entries: {}, ready: false })
const loaded: Promise<void> = (async () => {
  try {
    const value = JSON.parse(await library.getSetting(KEY) || '{}')
    for (const [id, entry] of Object.entries<any>(value?.entries || {})) {
      if (!entry || !Array.isArray(entry.items)) continue
      memory.entries[id] = { documentId: String(entry.documentId || ''), documentTitle: String(entry.documentTitle || ''), title: String(entry.title || ''), at: Number(entry.at) || 0, count: Number(entry.count) || 0, items: entry.items.filter((item: unknown) => typeof item === 'string' && item.trim()).slice(0, MAX_ITEMS) }
    }
  } catch { /* 读不到就从空的开始 */ }
  memory.ready = true
})()
export const memoryReady = () => loaded
let timer = 0
function persist() { clearTimeout(timer); timer = window.setTimeout(() => { void library.setSetting(KEY, JSON.stringify({ entries: memory.entries })).catch(() => { /* 存不进去就只留在这次 */ }) }, 300) }

export function forgetConversation(conversationId: string) { if (memory.entries[conversationId]) { delete memory.entries[conversationId]; persist() } }
export function forgetItem(conversationId: string, index: number) {
  const entry = memory.entries[conversationId]
  if (!entry) return
  entry.items.splice(index, 1)
  if (!entry.items.length) delete memory.entries[conversationId]
  persist()
}
/** 对话换了书、改了名：记录跟着改。 */
/** 撤销用：把一段对话的记忆原样放回去。 */
export function restoreMemory(conversationId: string, entry: MemoryEntry) { memory.entries[conversationId] = entry; persist() }
export function retagMemory(conversationId: string, patch: Partial<Pick<MemoryEntry, 'documentId' | 'documentTitle' | 'title'>>) {
  const entry = memory.entries[conversationId]
  if (entry) { Object.assign(entry, patch); persist() }
}

/** 整理用的提示词：只记学了什么、掌握得怎样，不猜读者是谁。 */
export function memoryPrompt(documentTitle: string, transcript: string, previous: string[]) {
  return [
    `下面是读者和阅读助手围绕《${documentTitle}》的一段对话。请整理出读者在这段对话里学了什么，供以后判断讲解的起点和深度。`,
    '要求：',
    `- 每行一条，以「- 」开头，最多 ${MAX_ITEMS} 条，每条不超过 40 个字；`,
    '- 每条写清楚是哪个概念、方法或结论，再写掌握情况，只用这三种说法之一：已弄懂、问过还不熟、反复卡住；',
    '- 只写对话里确实出现的内容。不要推测读者的身份、目的、水平或情绪，不要记姓名、联系方式等个人信息；',
    '- 寒暄、怎么用软件、与学习无关的闲聊不记；没有值得记的就只回复「无」。',
    previous.length ? `\n此前为这段对话整理过的记录（在它的基础上更新，合并重复的，掌握情况有变化就改）：\n${previous.map(item => `- ${item}`).join('\n')}` : '',
    `\n对话：\n"""\n${transcript}\n"""`,
  ].filter(Boolean).join('\n')
}
export function parseMemory(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => /^[-·•*]\s*\S/.test(line)).map(line => line.replace(/^[-·•*]\s*/, '').slice(0, 80)).filter(line => line !== '无').slice(0, MAX_ITEMS)
}

type Turn = { role: 'user' | 'assistant'; content: string }
const running = new Set<string>()
/**
 * 把一段对话整理进记忆。消息数没变就不重复整理；整理失败不影响对话，下次再试。
 * turns 只要正式的问答（不含失败的、已压缩的）。
 */
export async function memorize(conversation: { id: string; title: string; documentId: string }, documentTitle: string, turns: Turn[]) {
  await loaded
  const previous = memory.entries[conversation.id]
  if (running.has(conversation.id) || turns.length < 2 || previous?.count === turns.length) return
  running.add(conversation.id)
  const controller = new AbortController(), limit = window.setTimeout(() => controller.abort(), 60000)
  try {
    // 只看还没整理过的部分，前面带两条衔接；太长的回答截掉后半。
    const fresh = turns.slice(Math.max(0, (previous?.count || 0) - 2)).slice(-16)
    const transcript = fresh.map(turn => `${turn.role === 'user' ? '读者' : '助手'}：${turn.content.slice(0, turn.role === 'user' ? 1500 : 2500)}`).join('\n\n').slice(0, 24000)
    const { complete } = await import('./complete')
    const items = parseMemory(await complete({ kind: 'memory', fast: true, signal: controller.signal, messages: [{ role: 'user', content: memoryPrompt(documentTitle, transcript, previous?.items || []) }] }))
    const kept = items.length ? items : previous?.items || []
    if (kept.length) memory.entries[conversation.id] = { documentId: conversation.documentId, documentTitle, title: conversation.title, at: Date.now(), items: kept, count: turns.length }
    persist()
  } catch { /* 没整理成：留着原来的，下次再来 */ }
  finally { clearTimeout(limit); running.delete(conversation.id) }
}

/**
 * 随提问带给模型的那段话。记录先用来定讲解的深浅；联系旧知识是允许的，但要有实质关系，
 * 防的是模型形成路径依赖：沾一点边就往记录上靠。
 * current 是正在进行的这段对话（它自己的记录不用带，内容就在上文里）；同一本书的排在前面。
 */
export function memoryInstructions(current: { id: string; documentId: string }, budget = 1800): string {
  const entries = Object.entries(memory.entries).filter(([id, entry]) => id !== current.id && entry.items.length)
    .sort(([, a], [, b]) => Number(b.documentId === current.documentId) - Number(a.documentId === current.documentId) || b.at - a.at)
  const lines: string[] = []
  let used = 0
  for (const [, entry] of entries) {
    const head = `《${entry.documentTitle || '已移除的文档'}》`
    for (const item of entry.items) {
      const line = `- ${item}（${head}）`
      if (used + line.length > budget) break
      lines.push(line); used += line.length
    }
    if (used > budget - 40) break
  }
  if (!lines.length) return ''
  return [
    '# 读者的学习记录',
    '下面是读者以前在这个应用里学过的内容，由系统自动整理，可能不全，也可能过时。',
    lines.join('\n'),
    '这份记录首先用来判断讲解的起点和深浅：读者已弄懂的概念可以直接用、不必从头解释；还不熟或卡住过的，用到时多铺垫一步。',
    '也可以把当前的问题和读者学过的东西联系起来，但要过一道门槛：',
    '- 只有某一条和当前的问题有实质关系时才联系：它是这个问题的前提，是同一个思想的另一种形式，或者读者上次卡住的正是这里，而且提一句确实能让这次讲得更清楚。这时自然地带上即可，不用回避。',
    '- 只是沾边的不要提：同属一个领域、出现了同一个词、勉强能做个类比，都不算。多数问题和记录里的任何一条都没有这种关系，不联系是常态，不是疏漏。',
    '- 回答的主体始终是当前的问题和当前的文档。不要为了用上这份记录而改变回答的方向，也不要顺势去回顾、复习以前的内容。',
    '- 记录和读者现在说的有出入时，以读者现在说的为准。',
  ].join('\n')
}
