/**
 * 快速解释：选中一个词或一句话，按鼠标中键（或右键「解释」），用专门配的 AI 就地解释。
 * AI 只拿到解释的要求、选中的文字和它周围的一小段上下文。PDF 里弹一张卡片；Markdown 里直接插在那一段下面，可以留在笔记里。
 */
import { createApp, reactive, ref, shallowReactive, watch, type App } from 'vue'
import { looksMathy, selectionImage } from '../reader/selection-image'
import { IMAGE_NOTE } from './translate'
import { complete } from './complete'
import { UI_INSTRUCTIONS } from './intelligent-ui'
import { library } from '../sdk'
import { useSettings } from '../settings'
import ExplainNote from '../components/ExplainNote.vue'

export type ExplainMode = 'plain' | 'deeper' | 'example' | 'simpler' | 'visual'
export type Explain = { id: string; term: string; context: string; mode: ExplainMode; text: string; reasoning: string; status: 'running' | 'done' | 'error'; error: string; startedAt: number; firstTokenAt?: number; ms: number; /** 写完后点开了思维链。 */ chainOpen?: boolean; /** 选区的截图（PDF 里的公式以图为准）。 */ image?: string }
export type ExplainTarget = { term: string; context: string; block?: HTMLElement; image?: string; doc?: string; page?: number; /** PDF：选区所在的那一页，图钉钉住后卡片跟着它走。 */ anchor?: HTMLElement }

const MODES: Record<ExplainMode, string> = {
  plain: '先用一句话说清它是什么，再用两三句讲它在这段上下文里的意思和作用。不超过 150 字。',
  deeper: '讲得更深入一些：给出准确的定义、来由或推导要点，以及它和上下文里其他概念的关系。不超过 300 字。',
  example: '举一个具体的小例子把它讲明白（数字、图景或类比都可以），例子要贴合这段上下文。不超过 200 字。',
  simpler: '说得再浅一点：假设读者没有学过这个领域，用日常的话讲，不用术语。不超过 120 字。',
  // 可视化讲解：必须给出一个 ui 代码块（Intelligent UI），写法随请求一起告诉模型。
  visual: '用一张图把它讲明白：先用一两句话点题，然后必须给出一个 ui 代码块。优先用图解——集合关系用 venn 或 nest，函数 / 同态用 map，交换关系或概念网用 graph，证明步骤用 flow，分类用 tree，有限运算用 optable，置换用 cycle，区间用 axis，按两个性质分类用 quadrant。可交互的是可选项：只有量确实随参数连续变化时才用 sim，有真实数据对比时才用 chart 或 table，可以单独用，也可以跟在图解后面。图里是示意的就注明「示例」。图外的文字不超过 80 字。',
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
  Object.assign(item, { text: '', reasoning: '', status: 'running', error: '', startedAt: Date.now(), firstTokenAt: undefined, ms: 0 })
  const visual = item.mode === 'visual'
  const ask = (image?: string) => complete({ kind: 'explain', visual, ...(visual ? { extraInstructions: UI_INSTRUCTIONS.explain } : {}), messages: [{ role: 'user', content: explainPrompt(item.term, item.context, item.mode, previous) + (image ? IMAGE_NOTE : ''), ...(image ? { images: [image] } : {}) }], signal: controller.signal,
    onDelta: (_delta, all) => { if (controllers.get(item.id) === controller) { if (!item.text && all) item.firstTokenAt = Date.now(); item.text = all } },
    onReasoning: delta => { if (controllers.get(item.id) === controller) item.reasoning += delta } })
  // 模型看不了图就退回只用文字。
  void ask(item.image).catch(cause => { if (!item.image || controller.signal.aborted) throw cause; if (controllers.get(item.id) === controller) { item.text = ''; item.reasoning = '' } return ask() })
    .then(text => { if (controllers.get(item.id) !== controller) return; item.text = text.trim(); item.status = item.text ? 'done' : 'error'; if (!item.text) item.error = '没有得到解释' })
    .catch(cause => { if (controllers.get(item.id) !== controller || controller.signal.aborted) return; item.status = 'error'; item.error = cause?.message || String(cause) })
    .finally(() => { if (controllers.get(item.id) === controller) { controllers.delete(item.id); item.ms = Date.now() - item.startedAt } })
}
export function startExplain(term: string, context: string, mode: ExplainMode = 'plain', image?: string): Explain {
  const item = reactive<Explain>({ id: crypto.randomUUID(), term, context, mode, image, text: '', reasoning: '', status: 'running', error: '', startedAt: Date.now(), ms: 0 })
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
  const slot = element.closest<HTMLElement>('.page-slot')
  const context = around((slot || element).textContent || term, term)
  return { term, context, doc: slot?.closest<HTMLElement>('.pdf-scroll')?.dataset.explainDoc, page: Number(slot?.dataset.page) || undefined, anchor: slot || undefined, image: slot && looksMathy(term + context) ? selectionImage(40, 60) : undefined }
}

// ---- PDF：鼠标旁的卡片 ----
/** 没钉住的卡片点别处就消失，同时最多一张；钉住的留着，可以有好几张。follow：钉住后跟着书页走，还是停在屏幕上。 */
export type ExplainCardState = { id: string; item: Explain; x: number; y: number; pinned: boolean; follow: 'page' | 'screen'; anchor?: HTMLElement
  /** 所属的文档和页码；钉住之后的位置（相对那一页的比例 / 屏幕上的坐标）和改过的大小——钉住的便签靠这些存下来、下次打开放回原处。 */
  doc?: string; page?: number; rel?: { x: number; y: number }; screen?: { left: number; top: number }; size?: { width?: number; height?: number }
  /** 从翻译卡片变过来时，先显示的译文。 */ from?: string }
export const explainCards = shallowReactive<ExplainCardState[]>([])
export function closeCard(card: ExplainCardState) { stopExplain(card.item); const at = explainCards.indexOf(card); if (at >= 0) explainCards.splice(at, 1) }
export function closeLooseCards() { for (const card of [...explainCards]) if (!card.pinned) closeCard(card) }

// 钉住的便签不会自己消失：记在文档库的设置里，关掉文档、关掉应用再打开都放回原处；只有拔下图钉才没。
const CARDS = 'explain.cards.v1'
type SavedCard = { id: string; term: string; text: string; page?: number; follow: 'page' | 'screen'; rel?: { x: number; y: number }; screen?: { left: number; top: number }; size?: { width?: number; height?: number } }
let cardStore: Record<string, SavedCard[]> = {}
const openDocs = new Map<string, number>()
const cardsReady: Promise<void> = (async () => {
  try { const value = JSON.parse(await library.getSetting(CARDS) || '{}'); if (value && typeof value === 'object') cardStore = value } catch { /* 没有记录 */ }
})()
function saveCards() {
  for (const doc of openDocs.keys()) {
    const list = explainCards.filter(card => card.doc === doc && card.pinned && card.item.status === 'done' && card.item.text)
      .map(card => ({ id: card.id, term: card.item.term, text: card.item.text, page: card.page, follow: card.follow, rel: card.rel, screen: card.screen, size: card.size }))
    if (list.length) cardStore[doc] = list; else delete cardStore[doc]
  }
  void library.setSetting(CARDS, JSON.stringify(cardStore)).catch(() => { /* 存不进去就只留在这次阅读里 */ })
  uiVersion.value++
}
let saveTimer = 0
watch(() => explainCards.map(card => [card.pinned, card.follow, card.rel?.x, card.rel?.y, card.screen?.left, card.screen?.top, card.size?.width, card.size?.height, card.item.status, card.item.text.length].join()).join('|'),
  () => { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => { void cardsReady.then(saveCards) }, 300) })
/** PDF 打开、页面摆好之后调用：把这份文档钉住的便签放回去。 */
export function restoreCards(scroller: HTMLElement, doc: string) {
  if (scroller.dataset.explainDoc === doc) return
  scroller.dataset.explainDoc = doc
  openDocs.set(doc, (openDocs.get(doc) || 0) + 1)
  void cardsReady.then(() => {
    for (const saved of cardStore[doc] || []) {
      if (!scroller.isConnected || explainCards.some(card => card.id === saved.id)) continue
      const anchor = saved.page ? scroller.querySelector<HTMLElement>(`.page-slot[data-page="${saved.page}"]`) || undefined : undefined
      const item = reactive<Explain>({ id: saved.id, term: saved.term, context: '', mode: 'plain', text: saved.text, reasoning: '', status: 'done', error: '', startedAt: 0, ms: 0 })
      explainCards.push(reactive({ id: saved.id, item, x: saved.screen?.left ?? 80, y: saved.screen?.top ?? 120, pinned: true, follow: anchor ? saved.follow : 'screen', anchor, doc, page: saved.page, rel: saved.rel, screen: saved.screen, size: saved.size }) as ExplainCardState)
    }
  })
}
/** PDF 关闭时调用：便签从屏幕上撤下，记录留着。 */
export function releaseCards(scroller: HTMLElement) {
  const doc = scroller.dataset.explainDoc
  if (!doc) return
  delete scroller.dataset.explainDoc
  clearTimeout(saveTimer); saveCards()
  const left = (openDocs.get(doc) || 1) - 1
  if (left > 0) { openDocs.set(doc, left); return }
  openDocs.delete(doc)
  for (const card of [...explainCards]) if (card.doc === doc) closeCard(card)
}

// ---- Markdown：插在段落下面的释义；留下的记在本机，下次打开还在 ----
const NOTES_KEY = 'kaizhi.explain.notes.v1'
type Saved = { id: string; line: number; term: string; text: string; size?: { width?: number; height?: number } }
// 记在文档库的设置里（和分组、排列顺序一样，跟着库走），关掉应用再开还在；浏览器的本地存储只当备份，
// 以前只存在那里的也并进来。
const SETTING = 'explain.notes.v1'
let store: Record<string, Saved[]> = {}
const parse = (text: string | null): Record<string, Saved[]> => { try { const value = JSON.parse(text || '{}'); return value && typeof value === 'object' ? value : {} } catch { return {} } }
const ready: Promise<void> = (async () => {
  let local: Record<string, Saved[]> = {}
  try { local = parse(localStorage.getItem(NOTES_KEY)) } catch { /* 读不到就算了 */ }
  let saved: Record<string, Saved[]> = {}
  try { saved = parse(await library.getSetting(SETTING)) } catch { /* 文档库读不到时先用本地的 */ }
  const merged: Record<string, Saved[]> = { ...saved }
  for (const [doc, list] of Object.entries(local)) {
    if (!Array.isArray(list)) continue
    const known = new Set((merged[doc] || []).map(note => note.id))
    merged[doc] = [...(merged[doc] || []), ...list.filter(note => note && !known.has(note.id))]
  }
  // 读取期间已经记下的不丢。
  for (const [doc, list] of Object.entries(store)) { const known = new Set(list.map(note => note.id)); merged[doc] = [...(merged[doc] || []).filter(note => !known.has(note.id)), ...list] }
  store = merged
  if (JSON.stringify(merged) !== JSON.stringify(saved)) persist()
})()
function persist() {
  uiVersion.value++
  const text = JSON.stringify(store)
  try { localStorage.setItem(NOTES_KEY, text) } catch { /* 备份存不下不要紧 */ }
  void library.setSetting(SETTING, text).catch(() => { /* 存不进文档库时至少本地有一份 */ })
}
function allNotes(): Record<string, Saved[]> { return store }
function writeNotes(doc: string, change: (list: Saved[]) => Saved[]) {
  if (!doc) return
  const list = change(Array.isArray(store[doc]) ? store[doc] : [])
  if (list.length) store[doc] = list.slice(-200); else delete store[doc]
  void ready.then(persist)
}
export function keepNote(doc: string, line: number, item: Explain, size?: { width?: number; height?: number }) { writeNotes(doc, list => { const old = list.find(note => note.id === item.id); return [...list.filter(note => note.id !== item.id), { id: item.id, line, term: item.term, text: item.text, size: size ?? old?.size }] }) }
export function dropNote(doc: string, id: string) { writeNotes(doc, list => list.filter(note => note.id !== id)) }

const mounted = new WeakMap<HTMLElement, Set<App>>()
/** 正显示着的 Markdown 释义：右键菜单、Intelligent UI 合集要能找到它、关掉它。 */
export const shownNotes = new Map<string, { item: Explain; doc: string; remove: () => void }>()
function insertNote(block: HTMLElement, item: Explain, kept: boolean) {
  const paper = block.closest<HTMLElement>('.markdown-paper')
  if (!paper) return
  const host = document.createElement('div')
  host.className = 'explain-host'
  host.dataset.note = item.id
  // 新的释义排在这一段已有的释义后面。
  let after: Element = block
  while (after.nextElementSibling?.classList.contains('explain-host')) after = after.nextElementSibling
  after.after(host)
  const apps = mounted.get(paper) || new Set<App>()
  mounted.set(paper, apps)
  const doc = paper.dataset.explainDoc || ''
  const close = () => { stopExplain(item); shownNotes.delete(item.id); app.unmount(); apps.delete(app); host.remove() }
  const app = createApp(ExplainNote, { item, kept, doc, line: Number(block.dataset.sourceLine) || 1, size: kept ? (store[doc] || []).find(note => note.id === item.id)?.size : undefined, onClose: close })
  shownNotes.set(item.id, { item, doc, remove: () => { dropNote(doc, item.id); close() } })
  apps.add(app)
  app.mount(host)
}
/** 文档重新排版后调用：把留下的释义插回原来的段落下面。 */
export function restoreNotes(paper: HTMLElement, doc: string) {
  paper.dataset.explainDoc = doc
  for (const app of mounted.get(paper) || []) app.unmount()
  mounted.delete(paper)
  paper.querySelectorAll('.explain-host').forEach(host => host.remove())
  // 刚开应用时记录可能还在读：读完再插（已经读完就是马上）。期间文档又重排了就以后一次为准。
  const turn = String((Number(paper.dataset.explainTurn) || 0) + 1)
  paper.dataset.explainTurn = turn
  void ready.then(() => {
    if (!paper.isConnected || paper.dataset.explainTurn !== turn) return
    for (const note of allNotes()[doc] || []) {
      if (paper.querySelector(`.explain-host[data-note="${note.id}"]`)) continue
      const block = [...paper.querySelectorAll<HTMLElement>(`[data-source-line="${note.line}"]`)].find(item => !item.parentElement?.closest('[data-source-line]'))
      if (block) insertNote(block, reactive<Explain>({ id: note.id, term: note.term, context: block.textContent || '', mode: 'plain', text: note.text, reasoning: '', status: 'done', error: '', startedAt: 0, ms: 0 }), true)
    }
  })
}

export function runExplain(target: ExplainTarget, x: number, y: number, from?: string, visual = false) {
  // Shift + 中键，或设置里打开了「默认用可视化讲解」：直接出图。
  const item = startExplain(target.term, target.context, visual || useSettings().preferences.value.assistant.explainVisual ? 'visual' : 'plain', target.image)
  if (target.block?.isConnected) { insertNote(target.block, item, false); return }
  closeLooseCards()
  explainCards.push(reactive({ id: item.id, item, x, y, pinned: false, follow: 'page', anchor: target.anchor, doc: target.doc, page: target.page, from }) as ExplainCardState)
}

// ---- Intelligent UI 合集：钉住的 PDF 卡片和记入文档的 Markdown 释义里，带 ```ui 界面的那些 ----
export type UiEntry = { kind: 'card' | 'note'; doc: string; id: string; term: string; text: string; page?: number; line?: number }
/** 存的东西变了就加一，合集据此刷新。 */
export const uiVersion = ref(0)
export const uiReady = Promise.all([cardsReady, ready])
export function uiEntries(): UiEntry[] {
  const out: UiEntry[] = []
  for (const [doc, list] of Object.entries(cardStore)) for (const card of list || []) if (card.text?.includes('```ui')) out.push({ kind: 'card', doc, id: card.id, term: card.term, text: card.text, page: card.page })
  for (const [doc, list] of Object.entries(store)) for (const note of list || []) if (note.text?.includes('```ui')) out.push({ kind: 'note', doc, id: note.id, term: note.term, text: note.text, line: note.line })
  return out
}
/** 从合集里删：文档里正显示着的那张卡片 / 那条释义一起撤掉，存的记录也删掉。 */
export function removeUiEntries(entries: UiEntry[]) {
  let cards = false
  for (const entry of entries) {
    if (entry.kind === 'card') {
      const shown = explainCards.find(card => card.id === entry.id)
      if (shown) { shown.pinned = false; closeCard(shown) }
      const list = (cardStore[entry.doc] || []).filter(card => card.id !== entry.id)
      if (list.length) cardStore[entry.doc] = list; else delete cardStore[entry.doc]
      cards = true
    } else {
      const shown = shownNotes.get(entry.id)
      if (shown) shown.remove(); else dropNote(entry.doc, entry.id)
    }
  }
  if (cards) { void library.setSetting(CARDS, JSON.stringify(cardStore)).catch(() => { /* 存不进去就只留在这次 */ }); uiVersion.value++ }
}
