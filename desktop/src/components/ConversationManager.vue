<script setup lang="ts">
// 管理对话：单独一整页。左边是一棵从左往右长的树（书 → 对话 → 这段对话记下的记忆），右边一栏列出现在记着的全部内容。
// 左键进入；右键选中并弹出操作；按住节点拖动：拖到别的书是移动，拖到同一本书的另一个位置是排序，红线标出会落在哪。
// 空白处按住拖动是框选，点一下空白取消选中。每一步都能 Ctrl + Z 撤销。
// 书和对话的顺序是定住的（自己排的），不会因为刚动过哪一段就跳到前面。书从文档库移除后对话和记忆还在，根节点打上阴影。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { library } from '../sdk'
import { booksReady, conversationBooks, conversationBundle, conversations, deleteConversation, forgetBook, loadConversations, memorizeNow, moveConversation, rememberBook, renameConversation, restoreConversations, setConversationMemory, type ChatState } from '../ai/workspace'
import { editItem, forgetItem, moveItem, replaceMemory, reviseMemory, snapshotMemory, memory, memoryMode, memoryReady, restoreMemory, type MemoryMode } from '../ai/memory'

type Book = { id: string; title: string; kind: string }
type Root = Book & { gone: boolean; list: ChatState[] }
const props = defineProps<{ documents: Book[] }>()
const emit = defineEmits<{ close: []; openConversation: [value: { documentId: string; conversationId: string }]; openDocument: [id: string]; notify: [text: string] }>()

// ---- 顺序：书和每本书里的对话各有一份自己排的顺序，存在本机 ----
const ORDER_KEY = 'ai.conversations.order.v1'
const order = reactive<{ books: string[]; talks: Record<string, string[]> }>({ books: [], talks: {} })
const saveOrder = () => { void library.setSetting(ORDER_KEY, JSON.stringify(order)).catch(() => { /* 存不进去就只在这次有效 */ }) }
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))

const ready = ref(false), opening = ref(true), version = ref(0)
const shelf = computed(() => new Map(props.documents.map(doc => [doc.id, doc])))
const recent = (id: string): ChatState[] => conversations(id).filter(item => item.messages.length)
// 排过的按排的来；没排过的（新对话）在最前，新的在上。
function talks(id: string): ChatState[] {
  void version.value
  const rank = order.talks[id] || []
  return recent(id).map((item, index) => ({ item, at: rank.indexOf(item.id), index })).sort((a, b) => a.at - b.at || a.index - b.index).map(entry => entry.item)
}
onMounted(async () => {
  await Promise.all([booksReady, memoryReady()])
  try {
    const saved = JSON.parse(await library.getSetting(ORDER_KEY) || '{}')
    if (Array.isArray(saved?.books)) order.books = saved.books.filter((id: unknown) => typeof id === 'string')
    for (const [id, list] of Object.entries<any>(saved?.talks || {})) if (Array.isArray(list)) order.talks[id] = list.filter((item: unknown) => typeof item === 'string')
  } catch { /* 没排过 */ }
  const ids = [...new Set([...props.documents.map(doc => doc.id), ...Object.keys(conversationBooks)])]
  await Promise.all(ids.map(id => loadConversations(id).catch(() => {})))
  // 以前的对话没有登记过属于哪本书：现在补上。
  for (const doc of props.documents) if (recent(doc.id).length) rememberBook(doc)
  // 打开时把顺序定住：之后只有自己拖才会变。
  for (const id of ids) if (recent(id).length) { if (!order.books.includes(id)) order.books.push(id); order.talks[id] = talks(id).map(item => item.id) }
  saveOrder()
  ready.value = true
  setTimeout(() => { opening.value = false }, 1200)
  void nextTick(() => dialog.value?.focus())
})
const bookOf = (id: string): Book => shelf.value.get(id) || { id, title: conversationBooks[id]?.title || '已移除的文档', kind: conversationBooks[id]?.kind || 'pdf' }
const roots = computed<Root[]>(() => {
  void version.value
  if (!ready.value) return []
  return order.books.map(id => ({ ...bookOf(id), gone: !shelf.value.has(id), list: talks(id) })).filter(root => root.list.length)
})
const total = computed(() => roots.value.reduce((sum, root) => sum + root.list.length, 0))
const remembered = computed(() => Object.values(memory.entries).reduce((sum, entry) => sum + entry.items.length, 0))
const key = (documentId: string, conversationId: string) => `${documentId}::${conversationId}`
const split = (value: string) => { const at = value.indexOf('::'); return { documentId: value.slice(0, at), conversationId: value.slice(at + 2) } }
const folded = reactive(new Set<string>()), opened = reactive(new Set<string>()), picked = reactive(new Set<string>())
const itemsOf = (id: string) => memory.entries[id]?.items || []
const memoryOf = (root: { list: ChatState[] }) => root.list.reduce((sum, talk) => sum + itemsOf(talk.id).length, 0)
// 记忆是「概念：掌握得怎样」一行：拆开，概念深一点，掌握情况淡一点。
const parts = (item: string) => { const at = item.search(/[：:]/); return at > 0 ? [item.slice(0, at), item.slice(at + 1).trim()] : [item, ''] }
// 选中的，按树上的先后排好（移动后保持它们原来的相对顺序）。
const pickedInOrder = () => roots.value.flatMap(root => root.list.map(talk => key(root.id, talk.id))).filter(id => picked.has(id))
function relative(time: number) {
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`
  const date = new Date(time)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

// ---- 位置变了不跳：记下每个节点原来在哪，变完后从原处滑到新处 ----
type Snap = Map<string, DOMRect>
function snapshot(): Snap {
  const map: Snap = new Map()
  for (const el of tree.value?.querySelectorAll<HTMLElement>('[data-f]') || []) map.set(el.dataset.f!, el.getBoundingClientRect())
  return map
}
function glide(snap: Snap) {
  const host = tree.value
  if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const list = [...host.querySelectorAll<HTMLElement>('[data-f]')], shift = new Map<HTMLElement, { x: number; y: number }>()
  for (const el of list) { const was = snap.get(el.dataset.f!); if (was) { const now = el.getBoundingClientRect(); shift.set(el, { x: was.left - now.left, y: was.top - now.top }) } }
  for (const el of list) {
    const own = shift.get(el), parent = el.parentElement?.closest<HTMLElement>('[data-f]')
    // 新出现的淡入（它的上一层也是新的就跟着上一层一起，不重复）。
    if (!own) { if (!parent || shift.has(parent)) el.animate([{ opacity: 0, translate: '-8px 0' }, { opacity: 1, translate: '0 0' }], { duration: 280, easing: 'cubic-bezier(.22,.9,.28,1)' }); continue }
    // 上一层自己也在滑：只补上相对它的那一段。
    const base = parent && shift.get(parent) || { x: 0, y: 0 }, x = own.x - base.x, y = own.y - base.y
    if (Math.abs(x) > .5 || Math.abs(y) > .5) el.animate([{ translate: `${x}px ${y}px` }, { translate: '0 0' }], { duration: 360, easing: 'cubic-bezier(.22,.9,.28,1)' })
  }
}
function flip(change: () => void) { const snap = snapshot(); change(); void nextTick(() => glide(snap)) }
const toggle = (set: Set<string>, id: string) => flip(() => { if (set.has(id)) set.delete(id); else set.add(id) })

// ---- 撤销：每一步记下怎么退回去 ----
type Step = { label: string; undo: () => Promise<void> | void }
const steps: Step[] = [], undoable = ref(0)
const flash = ref<{ text: string; undo: boolean }>()
let flashTimer: ReturnType<typeof setTimeout> | undefined
function say(text: string, undo = false) { flash.value = { text, undo }; clearTimeout(flashTimer); flashTimer = setTimeout(() => { flash.value = undefined }, 5200) }
function record(label: string, undo: Step['undo']) { steps.push({ label, undo }); if (steps.length > 60) steps.shift(); undoable.value = steps.length; say(`已${label}`, true) }
let undoing = false
async function undoLast() {
  if (undoing) return
  const step = steps.pop()
  undoable.value = steps.length
  if (!step) { say('没有可以撤销的操作'); return }
  undoing = true
  const snap = snapshot()
  try { await step.undo() } finally { undoing = false }
  version.value++
  await nextTick(); glide(snap)
  say(`已撤销：${step.label}`)
}

// ---- 左键进入；Ctrl / Shift + 左键加选 ----
let dragged = false
function openTalk(root: Root, talk: ChatState, event: MouseEvent) {
  if (dragged || renaming.value) return
  const id = key(root.id, talk.id)
  if (event.ctrlKey || event.metaKey || event.shiftKey) { if (picked.has(id)) picked.delete(id); else picked.add(id); return }
  if (root.gone) { say('这本书已从文档库移除。把对话拖到另一本书上就能接着用。'); return }
  emit('openConversation', { documentId: root.id, conversationId: talk.id })
  emit('close')
}
function openRoot(root: Root) {
  if (dragged) return
  if (root.gone) { say('这本书已从文档库移除，对话和记忆仍然保留。'); return }
  emit('openDocument', root.id)
  emit('close')
}

// ---- 右键：选中并弹出操作 ----
type Item = { label: string; icon: string; danger?: boolean; disabled?: boolean; line?: boolean; run: () => void }
const menu = ref<{ x: number; y: number; items: Item[] }>()
function place(event: MouseEvent, items: Item[]) {
  peekOut()
  const box = dialog.value!.getBoundingClientRect()
  menu.value = { x: Math.min(event.clientX - box.left, box.width - 216), y: Math.min(event.clientY - box.top, box.height - items.length * 32 - 20), items }
}
function talkMenu(root: Root, talk: ChatState, event: MouseEvent) {
  const id = key(root.id, talk.id)
  if (!picked.has(id)) { picked.clear(); picked.add(id) }
  const many = picked.size > 1, mode = memoryMode(talk)
  place(event, many ? [
    { label: `移到另一本书…`, icon: 'folder', run: () => { moving.value = pickedInOrder() } },
    { label: `删除所选 ${picked.size} 段`, icon: 'trash', danger: true, line: true, run: () => { doomed.value = [...picked] } },
  ] : [
    { label: '打开', icon: 'book', disabled: root.gone, run: () => { emit('openConversation', { documentId: root.id, conversationId: talk.id }); emit('close') } },
    { label: '重命名', icon: 'edit', run: () => startRename(root.id, talk) },
    ...MODES.map((item, index) => ({ label: `记忆：${item.label}`, icon: mode === item.id ? 'check' : 'memory', line: index === 0, run: () => setMode(root.id, talk, item.id) })),
    { label: '移到另一本书…', icon: 'folder', line: true, run: () => { moving.value = [id] } },
    { label: '删除', icon: 'trash', danger: true, run: () => { doomed.value = [id] } },
  ])
}
function rootMenu(root: Root, event: MouseEvent) {
  const all = root.list.map(talk => key(root.id, talk.id))
  picked.clear(); for (const id of all) picked.add(id)
  place(event, [
    { label: '打开这本书', icon: 'book', disabled: root.gone, run: () => openRoot(root) },
    { label: '全部移到另一本书…', icon: 'folder', line: true, run: () => { moving.value = all } },
    { label: '删除这本书的全部对话', icon: 'trash', danger: true, run: () => { doomed.value = all } },
  ])
}
function run(item: Item) { if (item.disabled) return; menu.value = undefined; item.run() }

// ---- 重命名、记不记入记忆、忘掉一条 ----
const renaming = ref(''), draft = ref(''), field = ref<HTMLInputElement[]>([])
let renamingFrom = ''
function startRename(documentId: string, talk: ChatState) { renaming.value = key(documentId, talk.id); renamingFrom = talk.title || ''; draft.value = renamingFrom; void nextTick(() => { field.value[0]?.focus(); field.value[0]?.select() }) }
function endRename(save: boolean) {
  if (!renaming.value) return
  const { documentId, conversationId } = split(renaming.value), next = draft.value.replace(/\s+/g, ' ').trim(), old = renamingFrom
  renaming.value = ''
  if (save && next && next !== old) {
    renameConversation(documentId, conversationId, next)
    record('重命名', () => renameConversation(documentId, conversationId, old || '新对话'))
  }
  version.value++
}
const MODES: { id: MemoryMode; label: string }[] = [{ id: 'book', label: '只用本书的' }, { id: 'all', label: '用全局的' }, { id: 'off', label: '不用' }]
function setMode(documentId: string, talk: ChatState, mode: MemoryMode) {
  const before = memoryMode(talk), kept = clone(memory.entries[talk.id]), id = talk.id
  if (before === mode) return
  flip(() => { setConversationMemory(documentId, id, mode); version.value++ })
  record(`记忆改为「${MODES.find(item => item.id === mode)!.label}」`, () => { setConversationMemory(documentId, id, before); if (kept) restoreMemory(id, kept) })
}
function forget(conversationId: string, index: number) {
  const kept = clone(memory.entries[conversationId])
  flip(() => forgetItem(conversationId, index))
  record('忘掉一条记忆', () => { if (kept) restoreMemory(conversationId, kept) })
}

// ---- 删除（先确认）----
const doomed = ref<string[]>()
// 已移除的书没有对话了，就不用再留着它的名字。
function prune() { for (const id of Object.keys(conversationBooks)) if (!shelf.value.has(id) && !recent(id).length) forgetBook(id) }
function remove() {
  const list = doomed.value || [], snap = snapshot(), before = clone(order.talks)
  const kept = list.map(id => { const { documentId, conversationId } = split(id); return { book: bookOf(documentId), conversationId, items: conversationBundle(documentId, conversationId), memory: clone(memory.entries[conversationId]) } })
  for (const id of list) { const { documentId, conversationId } = split(id); deleteConversation(documentId, conversationId); picked.delete(id) }
  prune(); doomed.value = undefined; version.value++
  void nextTick(() => glide(snap))
  record(`删除 ${list.length} 段对话`, () => {
    for (const item of kept) { rememberBook(item.book); restoreConversations(item.book.id, item.items); if (item.memory) restoreMemory(item.conversationId, item.memory) }
    order.talks = before; saveOrder()
  })
}

// ---- 移动和排序：拖到树上的某个位置，或者从名单里挑一本书（树上只有已经有对话的书）----
const moving = ref<string[]>(), query = ref('')
const targets = computed(() => { const text = query.value.trim().toLowerCase(); return props.documents.filter(doc => !text || doc.title.toLowerCase().includes(text)).slice(0, 80) })
/** at：放在目标书里第几个（不算正在拖的这些）。 */
async function moveKeys(keys: string[], doc: Book, at = 0) {
  const snap = snapshot(), before = clone(order.talks), booksBefore = [...order.books]
  const rest = talks(doc.id).map(item => item.id)
  const moved: { conversationId: string; from: Book }[] = [], ids: string[] = []
  let busy = 0
  for (const id of keys) {
    const { documentId, conversationId } = split(id)
    if (documentId === doc.id) { ids.push(conversationId); continue }
    const from = bookOf(documentId)
    if (await moveConversation(documentId, conversationId, doc)) { moved.push({ conversationId, from }); ids.push(conversationId); order.talks[documentId] = (order.talks[documentId] || []).filter(item => item !== conversationId) } else busy++
  }
  const others = rest.filter(id => !ids.includes(id)), next = [...others.slice(0, at), ...ids, ...others.slice(at)]
  const changed = moved.length > 0 || next.join() !== rest.join()
  order.talks[doc.id] = next
  if (!order.books.includes(doc.id)) order.books.push(doc.id)
  // 移过去以后它们还是选中的：可以接着拖。
  picked.clear(); for (const id of ids) picked.add(key(doc.id, id))
  prune(); moving.value = undefined; query.value = ''; folded.delete(doc.id); version.value++; saveOrder()
  await nextTick(); glide(snap)
  if (!changed) { if (busy) say(`${busy} 段正在回答，没有移动。`); return }
  record(moved.length ? `把 ${moved.length} 段对话移到《${doc.title}》${busy ? `（${busy} 段正在回答，没动）` : ''}` : '调整顺序', async () => {
    for (const item of moved) await moveConversation(doc.id, item.conversationId, item.from)
    order.talks = before; order.books = booksBefore; picked.clear(); prune(); saveOrder()
  })
}

// ---- 按下：落在节点上是拖着移动 / 排序，落在空白处是框选 ----
const dialog = ref<HTMLElement>(), tree = ref<HTMLElement>()
const OTHER = '::other'
const drag = ref<{ x: number; y: number; count: number }>()
const drop = ref<{ book: string; index: number; line?: { left: number; top: number; width: number } }>()
function startPointer(event: PointerEvent) {
  peekOut()
  if (event.button !== 0 || renaming.value) return
  const target = event.target as HTMLElement
  if (target.closest('input, .cm-act, .cm-item')) return
  const talk = target.closest<HTMLElement>('.cm-talk[data-key]'), root = target.closest<HTMLElement>('.cm-root[data-root]')
  if (talk) startDrag(event, [talk.dataset.key!])
  else if (root) startDrag(event, (roots.value.find(item => item.id === root.dataset.root)?.list || []).map(item => key(root.dataset.root!, item.id)))
  else startBand(event)
}
function aim(x: number, y: number): typeof drop.value {
  const under = document.elementFromPoint(x, y) as HTMLElement | null
  if (under?.closest('[data-drop]')) return { book: OTHER, index: 0 }
  const el = under?.closest<HTMLElement>('[data-book]'), book = el?.dataset.book
  if (!el || !book) return
  const foreign = [...picked].some(id => split(id).documentId !== book)
  // 别的书的对话不能移进一本已经移除的书；它自己里面可以排序。
  if (foreign && !shelf.value.has(book)) return
  const rows = [...el.querySelectorAll<HTMLElement>(':scope > .cm-kids > .cm-kid > .cm-talk')].filter(row => !picked.has(row.dataset.key!))
  const first = rows[0]?.getBoundingClientRect()
  // 落在书上（或者这本书收起着）：放到最前。
  if (!first || x < first.left - 26) return foreign ? { book, index: 0 } : undefined
  let index = rows.findIndex(row => { const box = row.getBoundingClientRect(); return y < box.top + box.height / 2 })
  if (index < 0) index = rows.length
  const host = tree.value!, frame = host.getBoundingClientRect(), near = (rows[index] || rows[rows.length - 1]!).getBoundingClientRect()
  return { book, index, line: { left: first.left - frame.left + host.scrollLeft, top: (index < rows.length ? near.top - 6 : near.bottom + 3) - frame.top + host.scrollTop, width: first.width } }
}
function startDrag(event: PointerEvent, own: string[]) {
  const start = { x: event.clientX, y: event.clientY }
  dragged = false
  const move = (next: PointerEvent) => {
    if (!dragged && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 6) return
    // 拖的是没选中的节点：就只移它（拖书是移它的全部对话）；拖的是选中的之一：整批一起走。
    if (!dragged) { dragged = true; menu.value = undefined; if (!own.every(id => picked.has(id))) { picked.clear(); for (const id of own) picked.add(id) } }
    drag.value = { x: next.clientX, y: next.clientY, count: picked.size }
    drop.value = aim(next.clientX, next.clientY)
    const host = tree.value!, box = host.getBoundingClientRect()
    if (host.scrollHeight > host.clientHeight) { if (next.clientY < box.top + 44) host.scrollTop -= 14; else if (next.clientY > box.bottom - 44) host.scrollTop += 14 }
    if (host.scrollWidth > host.clientWidth + 1) { if (next.clientX < box.left + 44) host.scrollLeft -= 14; else if (next.clientX > box.right - 44) host.scrollLeft += 14 }
  }
  const end = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end)
    const to = drop.value
    drag.value = undefined; drop.value = undefined
    if (!dragged) return
    // 松手后紧跟着的那一下 click 不算「进入」。
    setTimeout(() => { dragged = false }, 0)
    if (to?.book === OTHER) moving.value = pickedInOrder()
    else if (to) void moveKeys(pickedInOrder(), bookOf(to.book), to.index)
  }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
}
const band = ref<{ left: number; top: number; width: number; height: number }>()
function startBand(event: PointerEvent) {
  const host = tree.value!, start = { x: event.clientX, y: event.clientY }, more = event.ctrlKey || event.metaKey || event.shiftKey, keep = more ? new Set(picked) : new Set<string>()
  dragged = false
  const move = (next: PointerEvent) => {
    if (!dragged && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 6) return
    if (!dragged) { dragged = true; host.setPointerCapture(event.pointerId) }
    const box = host.getBoundingClientRect()
    const left = Math.min(start.x, next.clientX), top = Math.min(start.y, next.clientY), right = Math.max(start.x, next.clientX), bottom = Math.max(start.y, next.clientY)
    band.value = { left: left - box.left + host.scrollLeft, top: top - box.top + host.scrollTop, width: right - left, height: bottom - top }
    picked.clear(); for (const id of keep) picked.add(id)
    for (const row of host.querySelectorAll<HTMLElement>('.cm-talk[data-key]')) { const rect = row.getBoundingClientRect(); if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) picked.add(row.dataset.key!) }
  }
  const end = () => {
    host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', end); host.removeEventListener('pointercancel', end)
    band.value = undefined
    // 没拖动：就是在空白处点了一下，取消选中。
    if (dragged) setTimeout(() => { dragged = false }, 0)
    else if (!more) picked.clear()
  }
  host.addEventListener('pointermove', move); host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end)
}

// ---- 鼠标停在一段对话上：看它最后一轮问了什么、答了什么 ----
const peek = ref<{ x: number; y: number; title: string; question: string; answer: string }>()
let peekTimer: ReturnType<typeof setTimeout> | undefined
const plain = (text: string, length: number) => { const flat = text.replace(/```[\s\S]*?```/g, ' [代码] ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图] ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s{0,3}(#{1,6}|>|[-*+])\s+/gm, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim(); return flat.length > length ? `${flat.slice(0, length)}…` : flat }
function peekIn(talk: ChatState, event: PointerEvent) {
  clearTimeout(peekTimer)
  if (drag.value || band.value || menu.value || renaming.value || event.buttons) return
  const el = event.currentTarget as HTMLElement
  // 已经在看一段了，移到下一段马上换，不用再等。
  peekTimer = setTimeout(() => {
    let answerAt = talk.messages.length - 1
    while (answerAt >= 0 && !(talk.messages[answerAt]!.role === 'assistant' && talk.messages[answerAt]!.content && !talk.messages[answerAt]!.failed)) answerAt--
    const asked = talk.messages.slice(0, answerAt < 0 ? undefined : answerAt).reverse().find(message => message.role === 'user')
    if (!asked && answerAt < 0) return
    const box = el.getBoundingClientRect(), page = dialog.value!.getBoundingClientRect()
    const x = box.right + 380 < page.right ? box.right + 14 : Math.max(12, box.left - 374)
    peek.value = { x: x - page.left, y: Math.max(12, Math.min(box.top - page.top - 6, page.height - 270)), title: talk.title || '新对话', question: plain(asked?.content || '', 150), answer: answerAt < 0 ? '' : plain(talk.messages[answerAt]!.content, 300) }
  }, peek.value ? 60 : 420)
}
function peekOut() { clearTimeout(peekTimer); peek.value = undefined }

// ---- 右边一栏：现在记着的全部内容 ----
const groups = computed(() => roots.value.map(root => ({ root, rows: root.list.flatMap(talk => memoryMode(talk) === 'off' ? [] : itemsOf(talk.id).map((item, index) => ({ item, index, talk, id: key(root.id, talk.id) }))) })).filter(group => group.rows.length))
// 可以记、但还没整理过的对话（这个功能出来之前的那些）。
const pending = computed(() => roots.value.flatMap(root => root.list.filter(talk => memoryMode(talk) !== 'off' && !talk.request && talk.messages.length >= 2 && !memory.entries[talk.id]).map(talk => ({ root, talk }))))
const organizing = ref('')
async function organize() {
  if (organizing.value) return
  const list = pending.value, had = remembered.value
  let done = 0
  for (const { root, talk } of list) { organizing.value = `${++done} / ${list.length}`; await memorizeNow(root.id, talk.id).catch(() => {}) }
  organizing.value = ''; version.value++
  say(remembered.value > had ? `整理出 ${remembered.value - had} 条记忆` : '没有整理出内容。检查一下 AI 设置里阅读助手用的服务。')
}
const lit = ref('')
// 右边一栏：哪几本书的记忆收起来了。
const foldedMem = reactive(new Set<string>())
function foldMem(id: string) { if (foldedMem.has(id)) foldedMem.delete(id); else foldedMem.add(id) }
// 让助手改记忆：一句话说要怎么改。
const memAsk = ref(''), memBusy = ref(false)
let memRequest: AbortController | undefined
async function askMemory() {
  const text = memAsk.value.trim()
  if (!text || memBusy.value) return
  const before = snapshotMemory()
  memBusy.value = true; memRequest = new AbortController()
  try {
    const { changed, removed } = await reviseMemory(text, memRequest.signal)
    memAsk.value = ''
    if (changed || removed) record(`让助手改了记忆：改 ${changed} 条，删 ${removed} 条`, () => replaceMemory(before)); else say('助手看过了，没有需要改的')
  } catch (error: any) { if (!memRequest?.signal.aborted) say(error?.message || String(error)) }
  finally { memBusy.value = false; memRequest = undefined }
}
onBeforeUnmount(() => memRequest?.abort())
// 拖一条记忆调换位置：按住拖过 6 像素才算拖；红线是落点。
type MemRow = { talk: { id: string }; index: number; item: string; id: string }
const memDrag = ref<{ key: string; dy: number } | null>(null), memDrop = ref('')
let memDragged = false
function memDown(event: PointerEvent, row: MemRow, group: { rows: MemRow[] }) {
  if (event.button !== 0 || (event.target as Element).closest('button, input') || memEdit.value) return
  const origin = event.currentTarget as HTMLElement, list = origin.parentElement!, startY = event.clientY, key = `${row.talk.id}:${row.index}`
  let target: { row: MemRow; after: boolean } | null = null
  const move = (e: PointerEvent) => {
    if (!memDrag.value && Math.abs(e.clientY - startY) < 6) return
    memDrag.value = { key, dy: e.clientY - startY }
    const items = [...list.children] as HTMLElement[]
    target = null
    for (const [at, el] of items.entries()) { const box = el.getBoundingClientRect(); if (e.clientY < box.top + box.height / 2) { target = { row: group.rows[at]!, after: false }; break } }
    if (!target) target = { row: group.rows.at(-1)!, after: true }
    memDrop.value = `${target.row.talk.id}:${target.row.index}:${target.after ? 'after' : 'before'}`
  }
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
    const dragged = memDrag.value, to = target
    memDrag.value = null; memDrop.value = ''
    if (!dragged) return
    memDragged = true; setTimeout(() => { memDragged = false }, 0)
    if (!to || (to.row.talk.id === row.talk.id && (to.row.index + (to.after ? 1 : 0) === row.index || to.row.index + (to.after ? 1 : 0) === row.index + 1))) return
    const before = snapshotMemory()
    flip(() => moveItem(row.talk.id, row.index, to.row.talk.id, to.row.index + (to.after ? 1 : 0)))
    record('挪了一条记忆', () => replaceMemory(before))
  }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
}
// 右边一栏里正在改哪一条记忆。
const memEdit = ref(''), memText = ref('')
function startMemEdit(row: { talk: { id: string }; index: number; item: string }) { memEdit.value = `${row.talk.id}:${row.index}`; memText.value = row.item; void nextTick(() => document.querySelector<HTMLInputElement>('.cm-mem-edit')?.focus()) }
function saveMemEdit(row: { talk: { id: string }; index: number; item: string }) { if (memEdit.value !== `${row.talk.id}:${row.index}`) return; memEdit.value = ''; const next = memText.value.trim(); if (next && next !== row.item) editItem(row.talk.id, row.index, next) }
let litTimer: ReturnType<typeof setTimeout> | undefined
function reveal(id: string) {
  const { documentId } = split(id)
  if (folded.has(documentId)) folded.delete(documentId)
  lit.value = id
  clearTimeout(litTimer); litTimer = setTimeout(() => { lit.value = '' }, 1800)
  void nextTick(() => tree.value?.querySelector(`.cm-talk[data-key="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }))
}

// ---- 父子之间的折线：量出来画，位置变了跟着滑 ----
const GAP = 60
function draw(el: HTMLElement) {
  const svg = el.querySelector<SVGSVGElement>(':scope > svg.cm-links')
  if (!svg) return
  const mid = (el.offsetHeight / 2).toFixed(1)
  const lines = ([...el.children].filter(child => child.classList.contains('cm-kid')) as HTMLElement[]).map(kid => { const y = (kid.offsetTop + kid.offsetHeight / 2).toFixed(1); return `M0 ${mid}L${GAP * .3} ${mid}L${GAP * .7} ${y}L${GAP} ${y}` })
  if (svg.childElementCount !== lines.length) {
    svg.innerHTML = lines.map(d => `<path style='d:path("${d}")' d="${d}"/>`).join('')
    if (!opening.value) svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' })
  } else lines.forEach((d, index) => { const path = svg.children[index] as SVGPathElement; if (path.getAttribute('d') !== d) { path.setAttribute('d', d); path.style.setProperty('d', `path("${d}")`) } })
}
const vLinks = {
  mounted(el: HTMLElement & { _links?: ResizeObserver }) { draw(el); el._links = new ResizeObserver(() => draw(el)); el._links.observe(el) },
  updated(el: HTMLElement) { draw(el) },
  unmounted(el: HTMLElement & { _links?: ResizeObserver }) { el._links?.disconnect() },
}

function onKey(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest?.('input')) return
  const command = event.ctrlKey || event.metaKey, letter = event.key.toLowerCase()
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation()
    if (menu.value) menu.value = undefined
    else if (moving.value) moving.value = undefined
    else if (doomed.value) doomed.value = undefined
    else if (picked.size) picked.clear()
    else emit('close')
  } else if (event.key === 'Delete' && picked.size) { event.preventDefault(); doomed.value = [...picked] }
  else if (command && letter === 'z' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); void undoLast() }
  else if (command && letter === 'a') { event.preventDefault(); for (const root of roots.value) for (const talk of root.list) picked.add(key(root.id, talk.id)) }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey, true); clearTimeout(flashTimer); clearTimeout(peekTimer); clearTimeout(litTimer) })
</script>

<template>
  <section ref="dialog" class="cm-page" :class="{ opening }" role="dialog" aria-modal="true" aria-label="管理对话" tabindex="-1" @pointerdown="menu && !($event.target as HTMLElement).closest('.cm-menu') && (menu = undefined)" @contextmenu.prevent>
    <div class="cm-main">
      <svg class="cm-ground" viewBox="0 0 1000 800" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
        <defs><pattern id="cm-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0V7" /></pattern><pattern id="cm-hatch-red" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(28)"><path d="M0 0V6" /></pattern></defs>
        <path class="g-plane" d="M1000 70V800H290Z" />
        <path class="g-hatch" d="M1000 430V800H640Z" />
        <path class="g-rays" d="M290 800 1000 70M330 800 1000 111M370 800 1000 152" />
        <circle class="g-disc" cx="800" cy="548" r="210" />
        <path class="g-wedge" d="M1000 318 664 548 1000 690Z" />
        <circle class="g-ring" cx="800" cy="548" r="210" />
        <circle class="g-orbit" cx="800" cy="548" r="262" />
        <path class="g-beam" d="M604 800 886 380 906 393 632 800Z" />
        <path class="g-bits" d="M928 92h28v28h-28zM964 128h11v11h-11zM548 744h15v15h-15z" />
        <circle class="g-core" cx="800" cy="548" r="9" />
        <circle class="g-ball" cx="664" cy="548" r="9" />
      </svg>
      <div class="cm-tools">
        <button type="button" class="cm-tool" @click="emit('close')"><AppIcon name="arrow" :size="14" />返回</button>
        <button type="button" class="cm-tool" :disabled="!undoable" data-tip="撤销上一步" @click="undoLast"><AppIcon name="reset" :size="14" />撤销<kbd>Ctrl Z</kbd></button>
      </div>

      <div ref="tree" class="cm-tree" @pointerdown="startPointer" @scroll.passive="peekOut">
        <header class="cm-hero">
          <h2><i aria-hidden="true"></i>管理对话</h2>
          <dl v-if="ready && roots.length"><div><dt>{{ roots.length }}</dt><dd>本书</dd></div><div><dt>{{ total }}</dt><dd>段对话</dd></div><div class="red"><dt>{{ remembered }}</dt><dd>条记忆</dd></div></dl>
        </header>
        <p v-if="!ready" class="cm-empty">正在读取…</p>
        <p v-else-if="!roots.length" class="cm-empty">还没有对话。</p>
        <div class="cm-forest">
          <div v-for="(root, at) in roots" :key="root.id" class="cm-book" :class="{ gone: root.gone, drop: drop?.book === root.id && !drop.line }" :data-book="root.id" :data-f="`b:${root.id}`" :style="{ '--i': at }">
            <div class="cm-root" :data-root="root.id" :data-f="`r:${root.id}`" @contextmenu.prevent.stop="rootMenu(root, $event)">
              <button type="button" class="cm-root-open" :data-tip="root.gone ? '这本书已从文档库移除，对话和记忆仍然保留' : '打开这本书'" @click="openRoot(root)">
                <span class="cm-seal" :class="root.kind === 'pdf' ? 'square' : 'round'" aria-hidden="true"><AppIcon :name="root.kind === 'pdf' ? 'book' : 'doc'" :size="17" /></span>
                <span class="cm-text"><span class="cm-title">{{ root.title }}</span><small>{{ root.list.length }} 段对话<template v-if="memoryOf(root)"> · {{ memoryOf(root) }} 条记忆</template><em v-if="root.gone">已移除</em></small></span>
              </button>
            </div>
            <button type="button" class="cm-act cm-knob" :class="{ shut: folded.has(root.id) }" :data-f="`k:${root.id}`" :aria-expanded="!folded.has(root.id)" :aria-label="folded.has(root.id) ? '展开' : '收起'" @click="toggle(folded, root.id)"><template v-if="folded.has(root.id)">{{ root.list.length }}</template><AppIcon v-else name="arrow" :size="11" /></button>
            <div v-if="!folded.has(root.id)" v-links class="cm-kids">
              <svg class="cm-links" aria-hidden="true"></svg>
              <div v-for="(talk, index) in root.list" :key="talk.id" class="cm-kid" :data-f="`c:${talk.id}`" :style="{ '--i': at + 1 + Math.min(index, 8) * .6 }">
                <div class="cm-talk" :class="{ picked: picked.has(key(root.id, talk.id)), lifted: drag && picked.has(key(root.id, talk.id)), has: memoryMode(talk) !== 'off' && itemsOf(talk.id).length, mute: memoryMode(talk) === 'off', lit: lit === key(root.id, talk.id) }" :data-key="key(root.id, talk.id)" :data-f="`t:${talk.id}`" @contextmenu.prevent.stop="talkMenu(root, talk, $event)" @pointerenter="peekIn(talk, $event)" @pointerleave="peekOut">
                  <input v-if="renaming === key(root.id, talk.id)" ref="field" v-model="draft" class="cm-rename" maxlength="60" aria-label="对话名称" @keydown.enter.prevent="!$event.isComposing && $event.keyCode !== 229 && endRename(true)" @keydown.esc.prevent.stop="endRename(false)" @blur="endRename(true)" @pointerdown.stop />
                  <button v-else type="button" class="cm-talk-open" @click="openTalk(root, talk, $event)">
                    <AppIcon v-if="talk.branchOf" name="branch" :size="12" /><span class="cm-title">{{ talk.title || '新对话' }}</span>
                    <small><template v-if="talk.request">回答中 · </template>{{ Math.ceil(talk.messages.length / 2) }} 问 · {{ relative(talk.updatedAt) }}</small>
                  </button>
                </div>
                <template v-if="memoryMode(talk) !== 'off' && itemsOf(talk.id).length">
                  <button type="button" class="cm-act cm-knob has" :class="{ shut: !opened.has(talk.id) }" :data-f="`m:${talk.id}`" :aria-expanded="opened.has(talk.id)" :data-tip="opened.has(talk.id) ? '收起记忆' : '看这段对话记下了什么'" :aria-label="`记忆 ${itemsOf(talk.id).length} 条`" @click="toggle(opened, talk.id)"><AppIcon v-if="opened.has(talk.id)" name="arrow" :size="11" /><template v-else>{{ itemsOf(talk.id).length }}</template></button>
                  <div v-if="opened.has(talk.id)" v-links class="cm-kids">
                    <svg class="cm-links" aria-hidden="true"></svg>
                    <div v-for="(item, place) in itemsOf(talk.id)" :key="item" class="cm-kid" :data-f="`i:${talk.id}:${item}`"><div class="cm-item"><span><b>{{ parts(item)[0] }}</b><em v-if="parts(item)[1]">{{ parts(item)[1] }}</em></span><button type="button" class="cm-act" aria-label="忘掉这一条" data-tip="忘掉这一条" @click="forget(talk.id, place)"><AppIcon name="close" :size="11" /></button></div></div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
        <i v-if="drop?.line" class="cm-slot" :style="{ left: `${drop.line.left}px`, top: `${drop.line.top}px`, width: `${drop.line.width}px` }"></i>
        <i v-if="band" class="cm-band" :style="{ left: `${band.left}px`, top: `${band.top}px`, width: `${band.width}px`, height: `${band.height}px` }"></i>
      </div>

      <div class="cm-foot">
        <Transition name="cm-fade" mode="out-in">
          <p v-if="flash" :key="flash.text" class="cm-flash" role="status"><span>{{ flash.text }}</span><button v-if="flash.undo" type="button" @click="undoLast">撤销</button></p>
          <p v-else class="cm-hint">左键进入<i></i>右键操作<i></i>拖动移动或排序<i></i>空白处框选<i></i>Ctrl Z 撤销</p>
        </Transition>
      </div>

      <Transition name="cm-bar">
        <footer v-if="doomed || drag || picked.size" class="cm-bar">
          <template v-if="doomed">
            <span>删除 <b>{{ doomed.length }}</b> 段对话，它们记下的记忆一起删掉</span>
            <button type="button" class="cm-button" @click="doomed = undefined">取消</button><button type="button" class="cm-button danger" @click="remove">删除</button>
          </template>
          <template v-else-if="drag">
            <span>{{ drop?.line ? '松手放在红线处' : drop ? '松手移到这本书' : '拖到一本书或一段对话旁边' }}</span>
            <span class="cm-other" :class="{ on: drop?.book === OTHER }" data-drop><AppIcon name="folder" :size="14" />树上没有的书…</span>
          </template>
          <template v-else>
            <span><b>{{ picked.size }}</b> 段已选</span>
            <button type="button" class="cm-button" @click="moving = pickedInOrder()"><AppIcon name="folder" :size="14" />移到另一本书</button><button type="button" class="cm-button danger" @click="doomed = [...picked]"><AppIcon name="trash" :size="14" />删除</button><button type="button" class="cm-act" aria-label="取消选中" data-tip="取消选中" @click="picked.clear()"><AppIcon name="close" :size="13" /></button>
          </template>
        </footer>
      </Transition>
    </div>

    <aside class="cm-side">
      <svg class="cm-art" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g class="a-lines"><path d="M-10 196 420 42M-10 212 420 58M-10 228 420 74" /></g>
        <circle class="a-ring" cx="262" cy="118" r="86" />
        <circle class="a-dot" cx="262" cy="118" r="11" />
        <path class="a-wedge" d="M14 54 268 118 56 214Z" />
        <path class="a-beam" d="M196 250 372 18 392 33 216 265Z" />
        <path class="a-block" d="M330 180h44v44h-44zM24 20h18v18H24zM50 20h8v8h-8z" />
        <circle class="a-ball" cx="352" cy="62" r="13" />
      </svg>
      <header class="cm-side-head"><h3>记忆</h3><b>{{ remembered }}</b><span>条</span></header>
      <div class="cm-shelf">
        <p class="cm-side-note">一段对话答完，助手把你学了什么、掌握得怎样整理成几行记在这里；下次提问时它先看这些，决定从哪讲起、讲多细。<template v-if="ready && !remembered">现在还没有。</template></p>
        <button v-if="pending.length" type="button" class="cm-organize" :disabled="!!organizing" @click="organize"><AppIcon name="memory" :size="15" />{{ organizing ? `正在整理 ${organizing}` : `整理 ${pending.length} 段还没整理的对话` }}</button>
        <form v-if="remembered" class="cm-mem-ask" @submit.prevent="askMemory"><input v-model="memAsk" :disabled="memBusy" maxlength="500" placeholder="让助手改：比如 把循环相关的合并成一条" aria-label="让助手改记忆" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.preventDefault()" /><button type="submit" class="cm-act" :disabled="memBusy || !memAsk.trim()" :aria-label="memBusy ? '助手正在改' : '让助手改'" :data-tip="memBusy ? '助手正在改' : '让助手按这句话改记忆；改完可以撤销'"><AppIcon :name="memBusy ? 'clock' : 'arrow-up'" :size="13" /></button></form>
        <section v-for="group in groups" :key="group.root.id" class="cm-group" :class="{ folded: foldedMem.has(group.root.id) }">
          <h4><button type="button" class="cm-fold" :aria-expanded="!foldedMem.has(group.root.id)" :data-tip="foldedMem.has(group.root.id) ? '展开' : '收起'" @click="foldMem(group.root.id)"><span>{{ group.root.title }}</span><small>{{ group.rows.length }}</small><AppIcon name="arrow" :size="10" /></button></h4>
          <ul v-if="!foldedMem.has(group.root.id)"><li v-for="row in group.rows" :key="row.id + row.item" :class="{ on: lit === row.id, lifted: memDrag?.key === `${row.talk.id}:${row.index}`, 'drop-before': memDrop === `${row.talk.id}:${row.index}:before`, 'drop-after': memDrop === `${row.talk.id}:${row.index}:after` }" :style="memDrag?.key === `${row.talk.id}:${row.index}` ? { translate: `0 ${memDrag.dy}px` } : undefined" @pointerdown="memDown($event, row, group)" :data-tip="`来自「${row.talk.title || '新对话'}」 · ${memory.entries[row.talk.id]?.scope === 'book' ? '只留在本书' : '所有书共用'}`" @click="!memDragged && reveal(row.id)"><input v-if="memEdit === `${row.talk.id}:${row.index}`" v-model="memText" class="cm-mem-edit" maxlength="80" aria-label="修改这条记忆" @click.stop @keydown.enter.prevent="!$event.isComposing && $event.keyCode !== 229 && saveMemEdit(row)" @keydown.esc.prevent.stop="memEdit = ''" @blur="saveMemEdit(row)" /><span v-else><b>{{ parts(row.item)[0] }}</b><em v-if="parts(row.item)[1]">{{ parts(row.item)[1] }}</em></span><button type="button" class="cm-act" aria-label="修改这一条" data-tip="修改这一条" @click.stop="startMemEdit(row)"><AppIcon name="edit" :size="11" /></button><button type="button" class="cm-act" aria-label="忘掉这一条" data-tip="忘掉这一条" @click.stop="forget(row.talk.id, row.index)"><AppIcon name="close" :size="11" /></button></li></ul>
        </section>
      </div>
    </aside>

    <div v-if="drag" class="cm-ghost" :class="{ ok: drop }" :style="{ left: `${drag.x + 14}px`, top: `${drag.y + 12}px` }">{{ drag.count }} 段对话</div>
    <Transition name="cm-fade">
      <div v-if="peek" class="cm-peek" :style="{ left: `${peek.x}px`, top: `${peek.y}px` }">
        <h5>{{ peek.title }}</h5>
        <p v-if="peek.question"><i>问</i><span>{{ peek.question }}</span></p>
        <p v-if="peek.answer" class="answer"><i>答</i><span>{{ peek.answer }}</span></p>
      </div>
    </Transition>
    <Transition name="cm-pop">
      <div v-if="menu" class="cm-menu" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
        <button v-for="item in menu.items" :key="item.label" type="button" role="menuitem" :class="{ danger: item.danger, line: item.line }" :disabled="item.disabled" @click="run(item)"><AppIcon :name="item.icon" :size="14" />{{ item.label }}</button>
      </div>
    </Transition>
    <Transition name="cm-pop">
      <div v-if="moving" class="cm-move" role="dialog" aria-label="移到另一本书">
        <p>把 {{ moving.length }} 段对话移到哪本书</p>
        <input v-model="query" type="text" placeholder="搜索书名" aria-label="搜索书名" @keydown.esc.prevent.stop="moving = undefined" />
        <div class="cm-targets"><button v-for="doc in targets" :key="doc.id" type="button" @click="moveKeys(moving!, doc)"><AppIcon :name="doc.kind === 'pdf' ? 'book' : 'doc'" :size="14" /><span class="cm-title">{{ doc.title }}</span></button><p v-if="!targets.length" class="cm-empty">没有这本书。</p></div>
        <button type="button" class="cm-button" @click="moving = undefined">取消</button>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
/* 构成主义：红、黑、纸色三样，直角、粗线、斜线。整页盖在应用上面。 */
.cm-page{--cm-red:#d23f2a;--cm-line:color-mix(in srgb,var(--ink) 58%,transparent);--cm-side:clamp(300px,27vw,430px);position:fixed;inset:0;z-index:75;display:grid;grid-template-columns:minmax(0,1fr) var(--cm-side);background:var(--canvas);color:var(--ink);outline:0;animation:cm-in .3s var(--ease-out)}
@keyframes cm-in{from{opacity:0}}
.cm-main{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0}
.cm-tools{position:absolute;left:20px;top:16px;z-index:4;display:flex;gap:8px}
.cm-tool{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px 0 9px;border:1.5px solid var(--ink);border-radius:0;background:var(--canvas);box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;transition:background-color .14s var(--ease-out),color .14s var(--ease-out),opacity .14s}
.cm-tool:hover:not(:disabled){background:var(--ink);color:var(--canvas)}
.cm-tool:disabled{opacity:.3;cursor:default}
.cm-tool kbd{margin-left:3px;font:inherit;font-size:10.5px;font-weight:400;opacity:.6}
.cm-tree{position:relative;z-index:1;flex:1;min-height:0;overflow:auto;padding:78px clamp(36px,6vw,96px) 120px;user-select:none}

/* 底图：一幅淡的构成，靠右下，不跟着滚动。树从它上面经过，所以只有细线和小块是实色。 */
.cm-ground{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.g-plane{fill:color-mix(in srgb,var(--ink) 4%,transparent)}
.g-hatch{fill:url(#cm-hatch)}
.cm-ground pattern path{stroke:color-mix(in srgb,var(--ink) 20%,transparent);stroke-width:1}
.g-rays{fill:none;stroke:color-mix(in srgb,var(--ink) 34%,transparent);stroke-width:1;vector-effect:non-scaling-stroke}
.g-disc{fill:color-mix(in srgb,var(--canvas) 72%,transparent)}
.g-wedge{fill:url(#cm-hatch-red);stroke:var(--cm-red);stroke-width:1.5;vector-effect:non-scaling-stroke}
.cm-ground #cm-hatch-red path{stroke:color-mix(in srgb,var(--cm-red) 62%,transparent);stroke-width:1.1}
.g-ring{fill:none;stroke:color-mix(in srgb,var(--ink) 62%,transparent);stroke-width:2;vector-effect:non-scaling-stroke}
.g-orbit{fill:none;stroke:color-mix(in srgb,var(--ink) 40%,transparent);stroke-width:1;stroke-dasharray:2 9;vector-effect:non-scaling-stroke}
.g-beam{fill:color-mix(in srgb,var(--ink) 13%,transparent)}
.g-bits,.g-core{fill:var(--ink)}
.g-ball{fill:var(--cm-red)}
.cm-page.opening .g-plane,.cm-page.opening .g-hatch,.cm-page.opening .g-rays{animation:cm-in .7s var(--ease-out) both .1s}
.cm-page.opening .g-wedge{animation:g-wedge .9s cubic-bezier(.2,.9,.2,1) both .2s}
.cm-page.opening .g-beam{animation:a-beam .8s var(--ease-out) both .3s}
.cm-page.opening .g-ring{stroke-dasharray:1320;animation:g-ring 1.1s var(--ease-out) both .15s}
.cm-page.opening :is(.g-disc,.g-orbit,.g-bits,.g-core,.g-ball){animation:cm-in .5s var(--ease-out) both .6s}
@keyframes g-wedge{from{translate:220px 0;opacity:0}}
@keyframes g-ring{from{stroke-dashoffset:1320}to{stroke-dashoffset:0}}

/* 标题：红楔子、粗体字、一道粗黑线，三个数排在线上。 */
.cm-hero{display:flex;align-items:flex-end;gap:44px;width:max-content;max-width:100%;margin-bottom:46px;padding-bottom:16px;border-bottom:4px solid var(--ink)}
.cm-hero h2{display:flex;align-items:center;gap:14px;margin:0;font-size:34px;font-weight:800;letter-spacing:.1em;line-height:1}
.cm-hero h2 i{width:26px;height:30px;background:var(--cm-red);clip-path:polygon(0 0,100% 50%,0 100%)}
.cm-hero dl{display:flex;gap:28px;margin:0}
.cm-hero dl div{display:flex;align-items:baseline;gap:6px}
.cm-hero dt{font-size:24px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.cm-hero dd{margin:0;color:var(--muted);font-size:11.5px;letter-spacing:.14em}
.cm-hero .red dt{color:var(--cm-red)}
.cm-page.opening .cm-hero h2 i{animation:cm-wedge .6s var(--ease-out) both}
@keyframes cm-wedge{from{translate:-40px 0;opacity:0}}
.cm-empty{margin:60px 0;color:var(--muted);font-size:13px}
.cm-forest{display:flex;flex-direction:column;align-items:flex-start;gap:22px}
.cm-book{display:flex;align-items:center;margin-left:-12px;padding:10px 18px 10px 12px;transition:background-color .18s var(--ease-out),box-shadow .18s var(--ease-out)}
.cm-book.drop{background:color-mix(in srgb,var(--cm-red) 7%,transparent);box-shadow:inset 4px 0 0 var(--cm-red)}

/* 根：一本书。PDF 是黑方块，Markdown 是红圆。书很长时它跟着滚动留在视野里。 */
.cm-root{position:sticky;top:10px;bottom:10px;z-index:1;flex:none;width:252px}
.cm-root-open{display:flex;align-items:center;justify-content:flex-start;gap:13px;width:100%;min-height:54px;padding:6px 8px 6px 6px;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
.cm-seal{display:grid;place-items:center;flex:none;width:40px;height:40px;transition:rotate .3s var(--ease-spring),scale .3s var(--ease-spring)}
.cm-seal.square{background:var(--ink);color:var(--canvas)}
.cm-seal.round{border-radius:50%;background:var(--cm-red);color:#fff}
.cm-seal svg{transition:rotate .3s var(--ease-spring)}
.cm-root-open:hover .cm-seal.square,.cm-book.drop .cm-seal.square{rotate:45deg}
.cm-root-open:hover .cm-seal.square svg,.cm-book.drop .cm-seal.square svg{rotate:-45deg}
.cm-root-open:hover .cm-seal.round,.cm-book.drop .cm-seal.round{scale:1.12}
.cm-text{flex:1;min-width:0;display:grid;gap:5px}
.cm-title{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cm-root .cm-title{display:-webkit-box;white-space:normal;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:14.5px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.cm-text small{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:11.5px;white-space:nowrap}
.cm-text em{padding:0 6px;border:1px solid var(--cm-line);font-size:10.5px;font-style:normal}
/* 书已经不在文档库里：根节点压一层斜纹阴影。 */
.cm-book.gone .cm-root{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--ink) 16%,transparent) 0 5px,transparent 5px 11px)}
.cm-book.gone .cm-seal{border:1.5px dashed var(--cm-line);border-radius:0;background:var(--canvas);color:var(--muted)}
.cm-book.gone .cm-title{color:var(--secondary)}

.cm-act{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:var(--muted);cursor:pointer}
.cm-act:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 10%,transparent);color:var(--ink)}
/* 节点右边的小方钮：收起时写着里面有几个，展开后是收回去的箭头。 */
.cm-knob{width:20px;height:20px;margin-left:8px;border:1.5px solid var(--ink);background:var(--canvas);color:var(--ink);font:inherit;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;transition:background-color .14s var(--ease-out),color .14s var(--ease-out)}
.cm-knob:hover:not(:disabled){background:var(--ink);color:var(--canvas)}
.cm-knob.shut{background:var(--ink);color:var(--canvas)}
.cm-knob.has{border-color:var(--cm-red);color:var(--cm-red)}
.cm-knob.has.shut,.cm-knob.has:hover:not(:disabled){background:var(--cm-red);color:#fff}

/* 往右长的枝：先平、再斜、再平的折线（v-links 量出来画）。 */
.cm-kids{position:relative;display:flex;flex-direction:column;flex:none;gap:9px;margin-left:60px}
.cm-links{position:absolute;left:-60px;top:0;width:60px;height:100%;overflow:visible;pointer-events:none}
.cm-links :deep(path){fill:none;stroke:var(--cm-line);stroke-width:1.4;stroke-linejoin:miter;transition:d .36s cubic-bezier(.22,.9,.28,1)}
.cm-kid{display:flex;align-items:center}
.cm-page.opening .cm-root{animation:cm-node .5s var(--ease-out) both;animation-delay:calc(var(--i,0) * 70ms)}
.cm-page.opening .cm-kid{animation:cm-node .46s var(--ease-out) both;animation-delay:calc(var(--i,0) * 70ms + 90ms)}
.cm-page.opening .cm-links{animation:cm-in .5s var(--ease-out) both;animation-delay:calc(var(--i,0) * 70ms + 160ms)}
@keyframes cm-node{from{opacity:0;translate:-12px 0}}

/* 对话：直角的条，左边一道粗边；记下了东西的是红边，不记入记忆的是虚边。 */
.cm-talk{display:flex;align-items:center;flex:none;width:320px;height:40px;border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-left:5px solid var(--ink);background:var(--surface);transition:border-color .14s var(--ease-out),background-color .14s var(--ease-out),box-shadow .14s var(--ease-out),opacity .14s var(--ease-out)}
.cm-talk.has{border-left-color:var(--cm-red)}
.cm-talk.mute{border-left-style:dotted}
.cm-talk:hover{border-top-color:var(--ink);border-right-color:var(--ink);border-bottom-color:var(--ink)}
.cm-talk.picked{border-color:var(--cm-red);background:color-mix(in srgb,var(--cm-red) 10%,var(--surface));box-shadow:4px 4px 0 color-mix(in srgb,var(--cm-red) 30%,transparent)}
.cm-talk.lit{box-shadow:0 0 0 2px var(--canvas),0 0 0 4px var(--cm-red)}
.cm-talk.lifted{opacity:.35}
.cm-talk-open{flex:1;min-width:0;display:flex;align-items:center;justify-content:flex-start;gap:8px;height:38px;padding:0 12px;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.cm-talk-open small{flex:none;margin-left:auto;padding-left:10px;color:var(--muted);font-size:11px;white-space:nowrap}
.cm-rename{flex:1;min-width:0;height:30px;margin:0 5px;padding:0 9px;border:1.5px solid var(--cm-red);border-radius:0;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;outline:0}
.cm-item{display:flex;align-items:center;gap:4px;max-width:380px;min-height:26px;padding-left:10px;font-size:12.5px;line-height:1.5}
.cm-item::before{content:'';flex:none;width:6px;height:6px;margin-right:7px;background:var(--cm-red)}
.cm-item span{min-width:0;overflow-wrap:anywhere}
.cm-item b,.cm-group li b{font-weight:600}
.cm-item em,.cm-group li em{margin-left:9px;color:var(--muted);font-size:11.5px;font-style:normal}
.cm-item .cm-act,.cm-group li .cm-act{width:22px;height:22px;opacity:0}
.cm-item:hover .cm-act,.cm-group li:hover .cm-act,.cm-act:focus-visible{opacity:1}
.cm-band{position:absolute;z-index:3;border:1.5px solid var(--cm-red);background:color-mix(in srgb,var(--cm-red) 9%,transparent);pointer-events:none}
/* 拖动时：会落在哪儿，一道红线。 */
.cm-slot{position:absolute;z-index:3;height:3px;background:var(--cm-red);pointer-events:none;transition:top .12s var(--ease-out),left .12s var(--ease-out)}
.cm-slot::before{content:'';position:absolute;left:-9px;top:-3px;width:9px;height:9px;background:var(--cm-red)}

.cm-foot{position:relative;z-index:2;display:flex;align-items:center;flex:none;height:46px;padding:0 22px;border-top:1.5px solid var(--ink);background:var(--canvas)}
.cm-hint,.cm-flash{display:flex;align-items:center;margin:0;font-size:11.5px}
.cm-hint{color:var(--muted);letter-spacing:.04em;pointer-events:none}
.cm-hint i{width:1px;height:11px;margin:0 12px;background:var(--cm-line)}
.cm-flash{gap:14px;height:36px;padding:0 6px 0 14px;border-left:6px solid var(--cm-red);background:var(--ink);color:var(--canvas);font-size:12.5px}
.cm-flash button{height:26px;padding:0 10px;border:0;border-radius:0;background:var(--cm-red);box-shadow:none;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.cm-flash:not(:has(button)){padding-right:14px}

/* 选中后的操作条：一块黑板，浮在底部中间。 */
.cm-bar{position:absolute;left:50%;bottom:64px;z-index:5;display:flex;align-items:center;gap:8px;min-height:50px;max-width:calc(100% - 40px);padding:8px 10px 8px 18px;border-left:8px solid var(--cm-red);background:var(--ink);box-shadow:8px 8px 0 color-mix(in srgb,var(--ink) 16%,transparent);color:var(--canvas);font-size:12.5px;translate:-50% 0;white-space:nowrap}
.cm-bar>span:first-child{margin-right:8px}
.cm-bar b{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums}
.cm-bar .cm-act{color:var(--canvas)}
.cm-bar .cm-act:hover{background:color-mix(in srgb,var(--canvas) 18%,transparent);color:var(--canvas)}
.cm-other{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 15px;border:1.5px dashed color-mix(in srgb,var(--canvas) 60%,transparent);transition:border-color .14s,background-color .14s}
.cm-other.on{border-style:solid;border-color:var(--cm-red);background:var(--cm-red);color:#fff}
.cm-button{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border:1.5px solid var(--ink);border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.cm-button:hover{background:var(--ink);color:var(--canvas)}
.cm-bar .cm-button{border-color:color-mix(in srgb,var(--canvas) 55%,transparent);color:var(--canvas)}
.cm-bar .cm-button:hover{background:var(--canvas);color:var(--ink)}
.cm-button.danger,.cm-bar .cm-button.danger{border-color:var(--cm-red);background:var(--cm-red);color:#fff}
.cm-button.danger:hover,.cm-bar .cm-button.danger:hover{background:color-mix(in srgb,var(--cm-red) 82%,#000);color:#fff}
.cm-ghost{position:fixed;z-index:9;padding:4px 10px;background:var(--ink);color:var(--canvas);font-size:11.5px;font-weight:600;letter-spacing:.04em;opacity:.5;pointer-events:none;white-space:nowrap;transition:opacity .14s,background-color .14s}
.cm-ghost.ok{background:var(--cm-red);color:#fff;opacity:1}

/* 右边一栏：一幅构成，下面是现在记着的全部内容。 */
.cm-side{display:flex;flex-direction:column;min-height:0;border-left:4px solid var(--ink);background:color-mix(in srgb,var(--surface) 55%,var(--canvas))}
.cm-art{flex:none;display:block;width:100%;height:clamp(170px,26vh,260px);border-bottom:4px solid var(--ink);background:var(--canvas)}
.a-lines path{fill:none;stroke:var(--ink);stroke-width:1.2}
.a-ring{fill:none;stroke:var(--ink);stroke-width:3}
.a-dot,.a-beam,.a-block{fill:var(--ink)}
.a-wedge,.a-ball{fill:var(--cm-red)}
.cm-page.opening .a-wedge{animation:a-wedge .9s cubic-bezier(.2,.9,.2,1) both .15s}
.cm-page.opening .a-beam{animation:a-beam .8s var(--ease-out) both .3s}
.cm-page.opening .a-ring{stroke-dasharray:541;animation:a-ring 1s var(--ease-out) both .1s}
.cm-page.opening .a-ball,.cm-page.opening .a-block,.cm-page.opening .a-dot{animation:cm-in .5s var(--ease-out) both .55s}
@keyframes a-wedge{from{translate:-150px -36px;opacity:0}}
@keyframes a-beam{from{translate:-60px 80px;opacity:0}}
@keyframes a-ring{from{stroke-dashoffset:541}to{stroke-dashoffset:0}}
.cm-side-head{display:flex;align-items:baseline;gap:8px;flex:none;padding:20px 24px 12px}
.cm-side-head h3{margin:0 auto 0 0;font-size:22px;font-weight:800;letter-spacing:.12em}
.cm-side-head b{color:var(--cm-red);font-size:26px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.cm-side-head span{color:var(--muted);font-size:11.5px}
.cm-shelf{flex:1;min-height:0;overflow:auto;padding:0 24px 28px}
.cm-side-note{margin:4px 0 16px;color:var(--secondary);font-size:12.5px;line-height:1.7}
.cm-organize{display:flex;align-items:center;gap:8px;width:100%;height:38px;margin-bottom:18px;padding:0 13px;border:1.5px solid var(--ink);border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.cm-organize:hover:not(:disabled){background:var(--ink);color:var(--canvas)}
.cm-organize:disabled{opacity:.6;cursor:default}
.cm-group{margin-top:18px}
.cm-group h4{margin:0 0 6px}
/* 书名是一颗按钮：点一下收起、展开这本书的记忆。 */
.cm-fold{display:flex;align-items:center;gap:9px;width:100%;min-height:24px;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12px;font-weight:700;letter-spacing:.04em;text-align:left;cursor:pointer}
.cm-fold::before{content:'';flex:none;width:16px;height:5px;background:var(--ink);transition:width var(--dur-2) var(--ease-out)}
.cm-group.folded .cm-fold::before{width:8px}
.cm-fold span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cm-fold small{flex:none;color:var(--muted);font-size:11px;font-weight:400;font-variant-numeric:tabular-nums}
.cm-fold svg{flex:none;color:var(--muted);rotate:-90deg;transition:rotate var(--dur-2) var(--spring-snappy)}
.cm-group.folded .cm-fold svg{rotate:180deg}
.cm-group.folded{margin-bottom:6px}
/* 记忆的条目是拿来读的：不管哪种主题都用易读的字体。 */
.cm-group li,.cm-group li :is(span,b,em),.cm-mem-edit,.cm-mem-ask input,.cm-side-note{font-family:var(--font-formal);letter-spacing:0}
/* 让助手改记忆的那一行。 */
.cm-mem-ask{display:flex;align-items:center;gap:4px;margin:0 0 16px;border-bottom:1.5px solid var(--ink)}
.cm-mem-ask input{flex:1;min-width:0;height:32px;padding:0 2px;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;outline:0}
.cm-mem-ask input::placeholder{color:var(--muted)}
/* 拖一条记忆：拿着的那条浮起来，红线是落点。 */
.cm-group li{position:relative;touch-action:none}
.cm-group li.lifted{z-index:2;background:var(--surface,var(--canvas));box-shadow:4px 4px 0 color-mix(in srgb,var(--ink) 18%,transparent);cursor:grabbing}
.cm-group li.drop-before::before,.cm-group li.drop-after::after{content:'';position:absolute;left:0;right:0;height:2px;background:var(--cm-red)}
.cm-group li.drop-before::before{top:-1px}
.cm-group li.drop-after::after{bottom:-1px}
.cm-group ul{margin:0;padding:0;list-style:none}
.cm-group li{display:flex;align-items:center;gap:4px;min-height:30px;padding:3px 2px 3px 10px;border-left:2px solid transparent;font-size:12.5px;line-height:1.5;cursor:pointer}
.cm-group li span{flex:1;min-width:0;overflow-wrap:anywhere}
.cm-mem-edit{flex:1;min-width:0;height:26px;padding:0 6px;border:1.5px solid var(--ink);border-radius:0;background:var(--surface,var(--canvas));color:var(--ink);font:inherit;outline:0}
.cm-group li:hover,.cm-group li.on{border-left-color:var(--cm-red);background:color-mix(in srgb,var(--ink) 6%,transparent)}

/* 停在对话上时的预览：最后一轮问答。 */
.cm-peek{position:absolute;z-index:6;width:360px;padding:14px 16px 15px;border:1.5px solid var(--ink);background:var(--surface);box-shadow:7px 7px 0 color-mix(in srgb,var(--ink) 18%,transparent);pointer-events:none}
.cm-peek h5{margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid var(--cm-line);font-size:12.5px;font-weight:700;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cm-peek p{display:flex;align-items:flex-start;gap:10px;margin:0;font-size:12.5px;line-height:1.6}
.cm-peek p+p{margin-top:9px}
.cm-peek i{display:grid;place-items:center;flex:none;width:19px;height:19px;margin-top:1px;background:var(--ink);color:var(--canvas);font-size:11px;font-style:normal;font-weight:700}
.cm-peek .answer i{background:var(--cm-red);color:#fff}
.cm-peek span{min-width:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere}
.cm-peek .answer span{-webkit-line-clamp:7;color:var(--secondary)}

.cm-menu{position:absolute;z-index:7;display:grid;gap:1px;min-width:200px;padding:5px;border:1.5px solid var(--ink);border-radius:0;background:var(--surface);box-shadow:7px 7px 0 color-mix(in srgb,var(--ink) 18%,transparent)}
.cm-menu button{display:flex;align-items:center;justify-content:flex-start;gap:9px;height:31px;padding:0 10px;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;text-align:left;white-space:nowrap;cursor:pointer}
.cm-menu button:hover:not(:disabled){background:var(--ink);color:var(--canvas)}
.cm-menu button:disabled{opacity:.4;cursor:default}
.cm-menu button.danger{color:var(--cm-red)}
.cm-menu button.danger:hover{background:var(--cm-red);color:#fff}
.cm-menu button.line{margin-top:4px;border-top:1px solid var(--cm-line)}
.cm-move{position:absolute;left:calc((100% - var(--cm-side)) / 2);top:90px;z-index:8;display:flex;flex-direction:column;gap:9px;width:min(400px,calc(100% - 40px));max-height:calc(100% - 150px);padding:14px;border:1.5px solid var(--ink);background:var(--surface);box-shadow:8px 8px 0 color-mix(in srgb,var(--ink) 18%,transparent);translate:-50% 0}
.cm-move p{margin:0;font-size:13px;font-weight:700}
.cm-move input{height:32px;padding:0 10px;border:1.5px solid var(--ink);border-radius:0;background:var(--canvas);color:var(--ink);font:inherit;font-size:13px;outline:0}
.cm-targets{flex:1;min-height:0;overflow:auto;display:grid;gap:1px}
.cm-targets button{display:flex;align-items:center;justify-content:flex-start;gap:9px;height:32px;padding:0 9px;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.cm-targets button:hover{background:var(--ink);color:var(--canvas)}
.cm-move .cm-button{align-self:flex-end}
.cm-move .cm-empty{margin:14px 0;font-weight:400}
.cm-pop-enter-active{transition:opacity .14s var(--ease-out)}
.cm-pop-leave-active,.cm-fade-leave-active{transition:opacity .1s var(--ease-out)}
.cm-pop-enter-from,.cm-pop-leave-to,.cm-fade-leave-to,.cm-fade-enter-from{opacity:0}
.cm-fade-enter-active{transition:opacity .16s var(--ease-out)}
.cm-bar-enter-active,.cm-bar-leave-active{transition:opacity .16s var(--ease-out),translate .24s var(--ease-out)}
.cm-bar-enter-from,.cm-bar-leave-to{opacity:0;translate:-50% 14px}
@media (max-width:980px){.cm-page{--cm-side:0px}.cm-side{display:none}}
@media (prefers-reduced-motion:reduce){.cm-page,.cm-page *{animation:none!important}.cm-links :deep(path){transition:none}}

/* 草稿风格：红用红铅笔的红，线用铅笔的黑。 */
:root[data-style='sketch'] .cm-page{--cm-red:var(--red-pencil,#c0392b);--cm-line:color-mix(in srgb,var(--pencil,#2b2a27) 70%,transparent)}
:root[data-style='sketch'] .cm-root-open,:root[data-style='sketch'] .cm-talk-open,:root[data-style='sketch'] .cm-act,:root[data-style='sketch'] .cm-tool,:root[data-style='sketch'] .cm-button,:root[data-style='sketch'] .cm-organize,:root[data-style='sketch'] .cm-menu button,:root[data-style='sketch'] .cm-targets button,:root[data-style='sketch'] .cm-flash button{border-radius:0}
:root[data-style='sketch'] .cm-root-open:hover,:root[data-style='sketch'] .cm-talk-open:hover{background:none}
</style>
