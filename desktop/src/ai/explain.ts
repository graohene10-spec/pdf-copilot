/**
 * 快速解释：选中一个词或一句话，按鼠标中键（或右键「解释」），用专门配的 AI 就地解释。
 * AI 只拿到解释的要求、选中的文字和它周围的一小段上下文。PDF 里弹一张卡片；Markdown 里直接插在那一段下面，可以留在笔记里。
 */
import { createApp, reactive, shallowRef, type App } from 'vue'
import { complete } from './complete'
import ExplainNote from '../components/ExplainNote.vue'

export type ExplainMode = 'plain' | 'deeper' | 'example' | 'simpler'
export type Explain = { id: string; term: string; context: string; mode: ExplainMode; text: string; reasoning: string; status: 'running' | 'done' | 'error'; error: string; startedAt: number; ms: number }
export type ExplainTarget = { term: string; context: string; block?: HTMLElement }

const MODES: Record<ExplainMode, string> = {
  plain: '先用一句话说清它是什么，再用两三句讲它在这段上下文里的意思和作用。不超过 150 字。',
  deeper: '讲得更深入一些：给出准确的定义、来由或推导要点，以及它和上下文里其他概念的关系。不超过 300 字。',
  example: '举一个具体的小例子把它讲明白（数字、图景或类比都可以），例子要贴合这段上下文。不超过 200 字。',
  simpler: '说得再浅一点：假设读者没有学过这个领域，用日常的话讲，不用术语。不超过 120 字。',
}
export function explainPrompt(term: string, context: string, mode: ExplainMode, previous = '') {
  return `解释下面这段文字里「${term}」的意思。${MODES[mode]}\n用简体中文，直接开始解释，不要寒暄、不要复述原文；公式写成 $...$。`
    + (previous && mode !== 'plain' ? `\n\n刚才的解释（不要重复它）：\n${previous.slice(0, 600)}` : '')
    + `\n\n上下文：\n"""\n${context}\n"""`
}

const controllers = new Map<string, AbortController>()
function run(item: Explain, previous = '') {
  controllers.get(item.id)?.abort()
  const controller = new AbortController()
  controllers.set(item.id, controller)
  Object.assign(item, { text: '', reasoning: '', status: 'running', error: '', startedAt: Date.now(), ms: 0 })
  void complete({ kind: 'explain', messages: [{ role: 'user', content: explainPrompt(item.term, item.context, item.mode, previous) }], signal: controller.signal,
    onDelta: (_delta, all) => { if (controllers.get(item.id) === controller) item.text = all },
    onReasoning: delta => { if (controllers.get(item.id) === controller) item.reasoning += delta } })
    .then(text => { if (controllers.get(item.id) !== controller) return; item.text = text.trim(); item.status = item.text ? 'done' : 'error'; if (!item.text) item.error = '没有得到解释' })
    .catch(cause => { if (controllers.get(item.id) !== controller || controller.signal.aborted) return; item.status = 'error'; item.error = cause?.message || String(cause) })
    .finally(() => { if (controllers.get(item.id) === controller) { controllers.delete(item.id); item.ms = Date.now() - item.startedAt } })
}
export function startExplain(term: string, context: string, mode: ExplainMode = 'plain'): Explain {
  const item = reactive<Explain>({ id: crypto.randomUUID(), term, context, mode, text: '', reasoning: '', status: 'running', error: '', startedAt: Date.now(), ms: 0 })
  run(item)
  return item
}
export function rerunExplain(item: Explain, mode: ExplainMode) { const previous = item.text; item.mode = mode; run(item, previous) }
export function stopExplain(item: Explain) { controllers.get(item.id)?.abort(); controllers.delete(item.id); if (item.status === 'running') { item.status = 'error'; item.error = '已停止' } }

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim()
/** 选中文字前后各取一段（共约 1300 字以内）。 */
function around(whole: string, term: string, span = 600) {
  const text = squeeze(whole), needle = squeeze(term)
  if (text.length <= span * 2 + needle.length) return text || needle
  const at = Math.max(0, text.indexOf(needle))
  return (at > span ? '…' : '') + text.slice(Math.max(0, at - span), at + needle.length + span) + '…'
}
/** 读当前选区：选中的文字、它周围的上下文；在 Markdown 正文里还带上它所在的那一段（解释就插在这段下面）。 */
export function explainTarget(): ExplainTarget | undefined {
  const selection = window.getSelection(), term = selection?.toString().trim() || ''
  if (!selection?.rangeCount || !term || term.length > 600) return
  const range = selection.getRangeAt(0), node = range.commonAncestorContainer, element = node instanceof Element ? node : node.parentElement
  if (!element?.closest('.reader-pane') || element.closest('.explain-note, .selection-translation')) return
  const paper = element.closest<HTMLElement>('.markdown-paper:not(.source-view)')
  if (paper) {
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
    let block = start?.closest<HTMLElement>('[data-source-line]') || undefined
    while (block?.parentElement?.closest('[data-source-line]')) block = block.parentElement.closest<HTMLElement>('[data-source-line]')!
    if (block && paper.contains(block)) {
      const nearby = [block.previousElementSibling, block, block.nextElementSibling].filter(item => item && !item.classList.contains('explain-host')).map(item => item!.textContent || '').join('\n')
      return { term, context: around(nearby, term), block }
    }
  }
  const holder = element.closest('.textLayer, .page') || element
  return { term, context: around(holder.textContent || term, term) }
}

// ---- PDF：鼠标旁的卡片 ----
export const explainCard = shallowRef<{ item: Explain; x: number; y: number }>()
export function closeExplainCard() { if (explainCard.value) { stopExplain(explainCard.value.item); explainCard.value = undefined } }

// ---- Markdown：插在段落下面的释义；留下的记在本机，下次打开还在 ----
const NOTES_KEY = 'kaizhi.explain.notes.v1'
type Saved = { id: string; line: number; term: string; text: string }
function allNotes(): Record<string, Saved[]> { try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}') || {} } catch { return {} } }
function writeNotes(doc: string, change: (list: Saved[]) => Saved[]) {
  if (!doc) return
  const all = allNotes(), list = change(Array.isArray(all[doc]) ? all[doc] : [])
  if (list.length) all[doc] = list.slice(-200); else delete all[doc]
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(all)) } catch { /* 存不下就只留在这次阅读里 */ }
}
export function keepNote(doc: string, line: number, item: Explain) { writeNotes(doc, list => [...list.filter(note => note.id !== item.id), { id: item.id, line, term: item.term, text: item.text }]) }
export function dropNote(doc: string, id: string) { writeNotes(doc, list => list.filter(note => note.id !== id)) }

const mounted = new WeakMap<HTMLElement, Set<App>>()
function insertNote(block: HTMLElement, item: Explain, kept: boolean) {
  const paper = block.closest<HTMLElement>('.markdown-paper')
  if (!paper) return
  const host = document.createElement('div')
  host.className = 'explain-host'
  // 新的释义排在这一段已有的释义后面。
  let after: Element = block
  while (after.nextElementSibling?.classList.contains('explain-host')) after = after.nextElementSibling
  after.after(host)
  const apps = mounted.get(paper) || new Set<App>()
  mounted.set(paper, apps)
  const app = createApp(ExplainNote, { item, kept, doc: paper.dataset.explainDoc || '', line: Number(block.dataset.sourceLine) || 1, onClose: () => { stopExplain(item); app.unmount(); apps.delete(app); host.remove() } })
  apps.add(app)
  app.mount(host)
}
/** 文档重新排版后调用：把留下的释义插回原来的段落下面。 */
export function restoreNotes(paper: HTMLElement, doc: string) {
  paper.dataset.explainDoc = doc
  for (const app of mounted.get(paper) || []) app.unmount()
  mounted.delete(paper)
  paper.querySelectorAll('.explain-host').forEach(host => host.remove())
  for (const note of allNotes()[doc] || []) {
    const block = [...paper.querySelectorAll<HTMLElement>(`[data-source-line="${note.line}"]`)].find(item => !item.parentElement?.closest('[data-source-line]'))
    if (block) insertNote(block, reactive<Explain>({ id: note.id, term: note.term, context: block.textContent || '', mode: 'plain', text: note.text, reasoning: '', status: 'done', error: '', startedAt: 0, ms: 0 }), true)
  }
}

export function runExplain(target: ExplainTarget, x: number, y: number) {
  const item = startExplain(target.term, target.context)
  if (target.block?.isConnected) { insertNote(target.block, item, false); return }
  if (explainCard.value) stopExplain(explainCard.value.item)
  explainCard.value = { item, x, y }
}
