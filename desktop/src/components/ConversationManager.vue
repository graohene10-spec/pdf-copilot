<script setup lang="ts">
// 管理对话：单独一整页，一棵从左往右长的树。每本书是根（在左），右边是它的对话，再右边是从这段对话里记下的「记忆」。
// 左键进入那本书 / 那段对话；右键选中并弹出操作；按住节点拖到另一本书上是移动；空白处按住拖动是框选，点一下空白取消选中。
// 书从文档库移除后，对话和记忆还在，根节点打上阴影。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { booksReady, conversationBooks, conversations, deleteConversation, forgetBook, loadConversations, moveConversation, rememberBook, renameConversation, setConversationMemory, type ChatState } from '../ai/workspace'
import { forgetItem, memory, memoryReady } from '../ai/memory'

type Book = { id: string; title: string; kind: string }
const props = defineProps<{ documents: Book[] }>()
const emit = defineEmits<{ close: []; openConversation: [value: { documentId: string; conversationId: string }]; openDocument: [id: string]; notify: [text: string] }>()

const ready = ref(false)
const version = ref(0)
onMounted(async () => {
  await Promise.all([booksReady, memoryReady()])
  const ids = new Set([...props.documents.map(doc => doc.id), ...Object.keys(conversationBooks)])
  await Promise.all([...ids].map(id => loadConversations(id).catch(() => {})))
  // 以前的对话没有登记过属于哪本书：现在补上。
  for (const doc of props.documents) if (talks(doc.id).length) rememberBook(doc)
  ready.value = true
  void nextTick(() => dialog.value?.focus())
})
const talks = (id: string): ChatState[] => conversations(id).filter(item => item.messages.length)
const library = computed(() => new Map(props.documents.map(doc => [doc.id, doc])))
const roots = computed(() => {
  void version.value
  if (!ready.value) return []
  const ids = new Set([...props.documents.map(doc => doc.id), ...Object.keys(conversationBooks)])
  const list = [...ids].map(id => {
    const doc = library.value.get(id), known = conversationBooks[id]
    return { id, title: doc?.title || known?.title || '已移除的文档', kind: doc?.kind || known?.kind || 'pdf', gone: !doc, list: talks(id) }
  }).filter(root => root.list.length)
  return list.sort((a, b) => Number(a.gone) - Number(b.gone) || (b.list[0]?.updatedAt || 0) - (a.list[0]?.updatedAt || 0))
})
const total = computed(() => roots.value.reduce((sum, root) => sum + root.list.length, 0))
const remembered = computed(() => Object.values(memory.entries).reduce((sum, entry) => sum + entry.items.length, 0))
const key = (documentId: string, conversationId: string) => `${documentId}::${conversationId}`
const split = (value: string) => { const at = value.indexOf('::'); return { documentId: value.slice(0, at), conversationId: value.slice(at + 2) } }
const folded = reactive(new Set<string>()), opened = reactive(new Set<string>()), picked = reactive(new Set<string>())
const itemsOf = (id: string) => memory.entries[id]?.items || []
function relative(time: number) {
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} 小时前`
  const date = new Date(time)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

// ---- 左键进入；Ctrl / Shift + 左键加选 ----
let dragged = false
function openTalk(root: { id: string; gone: boolean }, talk: ChatState, event: MouseEvent) {
  if (dragged || renaming.value) return
  const id = key(root.id, talk.id)
  if (event.ctrlKey || event.metaKey || event.shiftKey) { if (picked.has(id)) picked.delete(id); else picked.add(id); return }
  if (root.gone) { emit('notify', '这本书已从文档库移除。把对话拖到另一本书上就能接着用。'); return }
  emit('openConversation', { documentId: root.id, conversationId: talk.id })
  emit('close')
}
function openRoot(root: { id: string; gone: boolean }) {
  if (dragged) return
  if (root.gone) { emit('notify', '这本书已从文档库移除，对话和记忆仍然保留。'); return }
  emit('openDocument', root.id)
  emit('close')
}

// ---- 右键：选中并弹出操作 ----
type Item = { label: string; icon: string; danger?: boolean; disabled?: boolean; line?: boolean; run: () => void }
const menu = ref<{ x: number; y: number; items: Item[] }>()
function place(event: MouseEvent, items: Item[]) {
  const box = dialog.value!.getBoundingClientRect()
  menu.value = { x: Math.min(event.clientX - box.left, box.width - 216), y: Math.min(event.clientY - box.top, box.height - items.length * 32 - 20), items }
}
function talkMenu(root: { id: string; gone: boolean }, talk: ChatState, event: MouseEvent) {
  const id = key(root.id, talk.id)
  if (!picked.has(id)) { picked.clear(); picked.add(id) }
  const many = picked.size > 1, on = talk.memory !== false
  place(event, many ? [
    { label: `移到另一本书…`, icon: 'folder', run: () => { moving.value = [...picked] } },
    { label: `删除所选 ${picked.size} 段`, icon: 'trash', danger: true, line: true, run: () => { doomed.value = [...picked] } },
  ] : [
    { label: '打开', icon: 'book', disabled: root.gone, run: () => { emit('openConversation', { documentId: root.id, conversationId: talk.id }); emit('close') } },
    { label: '重命名', icon: 'edit', run: () => startRename(root.id, talk) },
    { label: on ? '不再记入记忆' : '记入记忆', icon: 'memory', run: () => { setConversationMemory(root.id, talk.id, !on); version.value++ } },
    { label: '移到另一本书…', icon: 'folder', line: true, run: () => { moving.value = [id] } },
    { label: '删除', icon: 'trash', danger: true, run: () => { doomed.value = [id] } },
  ])
}
function rootMenu(root: { id: string; gone: boolean; list: ChatState[] }, event: MouseEvent) {
  const all = root.list.map(talk => key(root.id, talk.id))
  picked.clear(); for (const id of all) picked.add(id)
  place(event, [
    { label: '打开这本书', icon: 'book', disabled: root.gone, run: () => openRoot(root) },
    { label: '全部移到另一本书…', icon: 'folder', line: true, run: () => { moving.value = all } },
    { label: '删除这本书的全部对话', icon: 'trash', danger: true, run: () => { doomed.value = all } },
  ])
}
function run(item: Item) { if (item.disabled) return; menu.value = undefined; item.run() }

// ---- 重命名 ----
const renaming = ref(''), draft = ref(''), field = ref<HTMLInputElement[]>([])
function startRename(documentId: string, talk: ChatState) { renaming.value = key(documentId, talk.id); draft.value = talk.title || ''; void nextTick(() => { field.value[0]?.focus(); field.value[0]?.select() }) }
function endRename(save: boolean) {
  if (!renaming.value) return
  const { documentId, conversationId } = split(renaming.value)
  if (save && draft.value.trim()) renameConversation(documentId, conversationId, draft.value)
  renaming.value = ''; version.value++
}

// ---- 删除（先确认）----
const doomed = ref<string[]>()
// 已移除的书没有对话了，就不用再留着它的名字。
function prune() { for (const id of Object.keys(conversationBooks)) if (!library.value.has(id) && !talks(id).length) forgetBook(id) }
function remove() {
  for (const id of doomed.value || []) { const { documentId, conversationId } = split(id); deleteConversation(documentId, conversationId); picked.delete(id) }
  prune(); doomed.value = undefined; version.value++
}

// ---- 移到另一本书：拖到树上的另一本书，或者从名单里挑（树上只有已经有对话的书）----
const moving = ref<string[]>(), query = ref('')
const targets = computed(() => { const text = query.value.trim().toLowerCase(); return props.documents.filter(doc => !text || doc.title.toLowerCase().includes(text)).slice(0, 80) })
async function moveKeys(keys: string[], doc: Book) {
  let count = 0, busy = 0
  for (const id of keys) {
    const { documentId, conversationId } = split(id)
    if (documentId === doc.id) continue
    if (await moveConversation(documentId, conversationId, doc)) { count++; picked.delete(id) } else busy++
  }
  prune(); moving.value = undefined; query.value = ''; version.value++
  folded.delete(doc.id)
  if (count || busy) emit('notify', busy ? `移了 ${count} 段；${busy} 段正在回答，没有移动。` : `已把 ${count} 段对话移到《${doc.title}》。`)
}

// ---- 按下：落在节点上是拖着移动，落在空白处是框选 ----
const dialog = ref<HTMLElement>(), tree = ref<HTMLElement>()
const OTHER = '::other'
const drag = ref<{ x: number; y: number; count: number }>(), dropId = ref('')
function startPointer(event: PointerEvent) {
  if (event.button !== 0 || renaming.value) return
  const target = event.target as HTMLElement
  if (target.closest('input, .cm-act, .cm-item')) return
  const talk = target.closest<HTMLElement>('.cm-talk[data-key]'), root = target.closest<HTMLElement>('.cm-root[data-root]')
  if (talk) startDrag(event, [talk.dataset.key!])
  else if (root) startDrag(event, (roots.value.find(item => item.id === root.dataset.root)?.list || []).map(item => key(root.dataset.root!, item.id)))
  else startBand(event)
}
function startDrag(event: PointerEvent, own: string[]) {
  const start = { x: event.clientX, y: event.clientY }
  dragged = false
  const move = (next: PointerEvent) => {
    if (!dragged && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 6) return
    // 拖的是没选中的节点：就只移它（拖书是移它的全部对话）；拖的是选中的之一：整批一起走。
    if (!dragged) { dragged = true; menu.value = undefined; if (!own.every(id => picked.has(id))) { picked.clear(); for (const id of own) picked.add(id) } }
    drag.value = { x: next.clientX, y: next.clientY, count: picked.size }
    const under = document.elementFromPoint(next.clientX, next.clientY) as HTMLElement | null
    const book = under?.closest('[data-drop]') ? OTHER : under?.closest<HTMLElement>('[data-book]')?.dataset.book || ''
    dropId.value = book === OTHER || (book && library.value.has(book) && [...picked].some(id => split(id).documentId !== book)) ? book : ''
    const host = tree.value!, box = host.getBoundingClientRect()
    if (next.clientY < box.top + 44) host.scrollTop -= 14; else if (next.clientY > box.bottom - 44) host.scrollTop += 14
    if (next.clientX < box.left + 44) host.scrollLeft -= 14; else if (next.clientX > box.right - 44) host.scrollLeft += 14
  }
  const end = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end)
    const to = dropId.value
    drag.value = undefined; dropId.value = ''
    if (!dragged) return
    // 松手后紧跟着的那一下 click 不算「进入」。
    setTimeout(() => { dragged = false }, 0)
    if (to === OTHER) moving.value = [...picked]
    else if (to) { const doc = library.value.get(to); if (doc) void moveKeys([...picked], doc) }
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

function keydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest('input')) return
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation()
    if (menu.value) menu.value = undefined
    else if (moving.value) moving.value = undefined
    else if (doomed.value) doomed.value = undefined
    else if (picked.size) picked.clear()
    else emit('close')
  } else if (event.key === 'Delete' && picked.size) { event.preventDefault(); doomed.value = [...picked] }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); for (const root of roots.value) for (const talk of root.list) picked.add(key(root.id, talk.id)) }
}
// ---- 样子：根节点是细线圆环里的一枚图标；父子之间是量出来的曲线 ----
const memoryOf = (root: { list: ChatState[] }) => root.list.reduce((sum, talk) => sum + itemsOf(talk.id).length, 0)
// 记忆是「概念：掌握得怎样」一行：拆开，概念深一点，掌握情况淡一点。
const parts = (item: string) => { const at = item.search(/[：:]/); return at > 0 ? [item.slice(0, at), item.slice(at + 1).trim()] : [item, ''] }
const GAP = 56
function draw(el: HTMLElement) {
  const svg = el.querySelector(':scope > svg.cm-links')
  if (!svg) return
  const mid = (el.offsetHeight / 2).toFixed(1)
  const lines = ([...el.children].filter(child => child.classList.contains('cm-kid')) as HTMLElement[]).map(kid => { const y = (kid.offsetTop + kid.offsetHeight / 2).toFixed(1); return `M0 ${mid}C${GAP * .55} ${mid} ${GAP * .45} ${y} ${GAP} ${y}` })
  // 条数没变只改形状，不重建：重建会让「画出来」的动画重放。
  if (svg.childElementCount !== lines.length) svg.innerHTML = lines.map(d => `<path pathLength="1" d="${d}"/>`).join('')
  else lines.forEach((d, index) => { const path = svg.children[index]!; if (path.getAttribute('d') !== d) path.setAttribute('d', d) })
}
const vLinks = {
  mounted(el: HTMLElement & { _links?: ResizeObserver }) { draw(el); el._links = new ResizeObserver(() => draw(el)); el._links.observe(el) },
  updated(el: HTMLElement) { draw(el) },
  unmounted(el: HTMLElement & { _links?: ResizeObserver }) { el._links?.disconnect() },
}

function capture(event: KeyboardEvent) { if (event.key === 'Escape' || event.key === 'Delete') keydown(event) }
onMounted(() => window.addEventListener('keydown', capture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', capture, true))
</script>

<template>
  <section ref="dialog" class="cm-page" role="dialog" aria-modal="true" aria-label="管理对话" tabindex="-1" @keydown="keydown" @pointerdown="menu && !($event.target as HTMLElement).closest('.cm-menu') && (menu = undefined)" @contextmenu.prevent>
    <button type="button" class="cm-back" @click="emit('close')"><AppIcon name="arrow" :size="15" />返回</button>

    <div ref="tree" class="cm-tree" @pointerdown="startPointer">
      <header class="cm-hero">
        <h2>管理对话</h2>
        <p v-if="ready && roots.length"><b>{{ roots.length }}</b>本书<i></i><b>{{ total }}</b>段对话<i></i><b>{{ remembered }}</b>条记忆</p>
      </header>
      <p v-if="!ready" class="cm-empty">正在读取…</p>
      <p v-else-if="!roots.length" class="cm-empty">还没有对话。</p>
      <div class="cm-forest">
        <div v-for="(root, order) in roots" :key="root.id" class="cm-book" :class="{ gone: root.gone, drop: dropId === root.id }" :data-book="root.id" :style="{ '--i': order }">
          <div class="cm-root" :data-root="root.id" @contextmenu.prevent.stop="rootMenu(root, $event)">
            <button type="button" class="cm-root-open" :data-tip="root.gone ? '这本书已从文档库移除，对话和记忆仍然保留' : '打开这本书'" @click="openRoot(root)">
              <span class="cm-seal" aria-hidden="true"><AppIcon :name="root.kind === 'pdf' ? 'book' : 'doc'" :size="16" /></span>
              <span class="cm-text"><span class="cm-title">{{ root.title }}</span><small>{{ root.list.length }} 段对话<template v-if="memoryOf(root)"> · {{ memoryOf(root) }} 条记忆</template><em v-if="root.gone">已移除</em></small></span>
            </button>
          </div>
          <button type="button" class="cm-act cm-knob" :class="{ shut: folded.has(root.id) }" :aria-expanded="!folded.has(root.id)" :aria-label="folded.has(root.id) ? '展开' : '收起'" @click="folded.has(root.id) ? folded.delete(root.id) : folded.add(root.id)"><template v-if="folded.has(root.id)">{{ root.list.length }}</template><AppIcon v-else name="arrow" :size="11" /></button>
          <div v-if="!folded.has(root.id)" v-links class="cm-kids">
            <svg class="cm-links" aria-hidden="true"></svg>
            <div v-for="(talk, index) in root.list" :key="talk.id" class="cm-kid" :style="{ '--i': order + 1 + Math.min(index, 8) * .6 }">
              <div class="cm-talk" :class="{ picked: picked.has(key(root.id, talk.id)), lifted: drag && picked.has(key(root.id, talk.id)) }" :data-key="key(root.id, talk.id)" @contextmenu.prevent.stop="talkMenu(root, talk, $event)">
                <input v-if="renaming === key(root.id, talk.id)" ref="field" v-model="draft" class="cm-rename" maxlength="60" aria-label="对话名称" @keydown.enter.prevent="endRename(true)" @keydown.esc.prevent.stop="endRename(false)" @blur="endRename(true)" @pointerdown.stop />
                <button v-else type="button" class="cm-talk-open" @click="openTalk(root, talk, $event)">
                  <AppIcon v-if="talk.branchOf" name="branch" :size="12" /><span class="cm-title">{{ talk.title || '新对话' }}</span>
                  <small><template v-if="talk.request">回答中 · </template>{{ Math.ceil(talk.messages.length / 2) }} 问 · {{ relative(talk.updatedAt) }}</small>
                  <AppIcon v-if="talk.memory === false" class="cm-mute" name="memory" :size="13" data-tip="这段对话不记入记忆" />
                </button>
              </div>
              <template v-if="talk.memory !== false && itemsOf(talk.id).length">
                <button type="button" class="cm-act cm-knob has" :class="{ shut: !opened.has(talk.id) }" :aria-expanded="opened.has(talk.id)" :data-tip="opened.has(talk.id) ? '收起记忆' : '看这段对话记下了什么'" :aria-label="`记忆 ${itemsOf(talk.id).length} 条`" @click="opened.has(talk.id) ? opened.delete(talk.id) : opened.add(talk.id)"><AppIcon v-if="opened.has(talk.id)" name="arrow" :size="11" /><template v-else>{{ itemsOf(talk.id).length }}</template></button>
                <div v-if="opened.has(talk.id)" v-links class="cm-kids">
                  <svg class="cm-links" aria-hidden="true"></svg>
                  <div v-for="(item, at) in itemsOf(talk.id)" :key="item" class="cm-kid" :style="{ '--i': at * .6 }"><div class="cm-item"><span><b>{{ parts(item)[0] }}</b><em v-if="parts(item)[1]">{{ parts(item)[1] }}</em></span><button type="button" class="cm-act" aria-label="忘掉这一条" data-tip="忘掉这一条" @click="forgetItem(talk.id, at)"><AppIcon name="close" :size="11" /></button></div></div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
      <i v-if="band" class="cm-band" :style="{ left: `${band.left}px`, top: `${band.top}px`, width: `${band.width}px`, height: `${band.height}px` }"></i>
    </div>
    <p class="cm-hint">左键进入<i></i>右键操作<i></i>拖到另一本书上移动<i></i>空白处拖动框选</p>

    <Transition name="cm-bar">
      <footer v-if="doomed || drag || picked.size" class="cm-bar">
        <template v-if="doomed">
          <span class="cm-warn">删除 {{ doomed.length }} 段对话，它们记下的记忆一起删掉。</span>
          <button type="button" class="cm-button" @click="doomed = undefined">取消</button><button type="button" class="cm-button danger" @click="remove">删除</button>
        </template>
        <template v-else-if="drag">
          <span>拖到一本书上松手</span>
          <span class="cm-other" :class="{ on: dropId === OTHER }" data-drop><AppIcon name="folder" :size="14" />树上没有的书…</span>
        </template>
        <template v-else>
          <span><b>{{ picked.size }}</b> 段已选</span>
          <button type="button" class="cm-button" @click="moving = [...picked]"><AppIcon name="folder" :size="14" />移到另一本书</button><button type="button" class="cm-button danger" @click="doomed = [...picked]"><AppIcon name="trash" :size="14" />删除</button><button type="button" class="cm-act" aria-label="取消选中" data-tip="取消选中" @click="picked.clear()"><AppIcon name="close" :size="13" /></button>
        </template>
      </footer>
    </Transition>
    <div v-if="drag" class="cm-ghost" :class="{ ok: dropId }" :style="{ left: `${drag.x + 14}px`, top: `${drag.y + 12}px` }">{{ drag.count }} 段对话</div>

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
/* 整页盖在应用上面：一张带点阵的画布，树从左往右长。 */
.cm-page{--cm-line:color-mix(in srgb,var(--ink) 26%,transparent);--cm-tone:var(--accent);position:fixed;inset:0;z-index:75;display:flex;flex-direction:column;background:color-mix(in srgb,var(--canvas) 92%,transparent);backdrop-filter:blur(40px) saturate(1.15);color:var(--ink);outline:0;animation:cm-in .3s var(--ease-out)}
@keyframes cm-in{from{opacity:0}}
.cm-back{position:absolute;left:18px;top:16px;z-index:4;display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 13px 0 9px;border:1px solid color-mix(in srgb,var(--ink) 12%,transparent);border-radius:999px;background:color-mix(in srgb,var(--surface) 80%,transparent);box-shadow:none;color:var(--secondary);font:inherit;font-size:12.5px;cursor:pointer;transition:border-color .16s var(--ease-out),color .16s var(--ease-out)}
.cm-back:hover{border-color:color-mix(in srgb,var(--ink) 34%,transparent);color:var(--ink)}
.cm-back svg{transition:translate .2s var(--ease-out)}
.cm-back:hover svg{translate:-2px 0}
.cm-tree{position:relative;flex:1;min-height:0;overflow:auto;padding:76px clamp(40px,8vw,130px) 140px;user-select:none;background-image:radial-gradient(circle,color-mix(in srgb,var(--ink) 11%,transparent) 1px,transparent 1.5px);background-size:26px 26px;background-attachment:local}
.cm-hero{margin:0 0 44px 4px}
.cm-hero h2{margin:0;font-size:30px;font-weight:600;letter-spacing:.04em;line-height:1.2}
.cm-hero p{display:flex;align-items:baseline;margin:12px 0 0;color:var(--muted);font-size:12.5px;letter-spacing:.06em}
.cm-hero b{margin-right:5px;color:var(--ink);font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
.cm-hero i,.cm-hint i{width:1px;height:11px;margin:0 14px;background:var(--cm-line)}
.cm-empty{margin:80px 0;color:var(--muted);font-size:13px}
.cm-forest{display:flex;flex-direction:column;align-items:flex-start;gap:26px;width:max-content;min-width:100%}
.cm-book{display:flex;align-items:center;margin-left:-14px;padding:12px 22px 12px 14px;border-radius:22px;transition:background-color .2s var(--ease-out)}
.cm-book.drop{background:color-mix(in srgb,var(--cm-tone) 5%,transparent)}

/* 根：一本书。书很长时它跟着滚动留在视野里。 */
.cm-root{position:sticky;top:10px;bottom:10px;z-index:1;flex:none;width:248px;border-radius:14px;animation:cm-node .5s var(--ease-out) both;animation-delay:calc(var(--i,0) * 70ms)}
.cm-root-open{display:flex;align-items:center;justify-content:flex-start;gap:13px;width:100%;min-height:54px;padding:6px 8px 6px 6px;border:0;border-radius:14px;background:none;box-shadow:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
.cm-seal{display:grid;place-items:center;flex:none;width:38px;height:38px;border:1px solid color-mix(in srgb,var(--ink) 30%,transparent);border-radius:50%;color:var(--secondary);transition:border-color .2s var(--ease-out),color .2s var(--ease-out),background-color .2s var(--ease-out)}
.cm-root-open:hover .cm-seal{border-color:var(--ink);color:var(--ink)}
.cm-book.drop .cm-seal{border-color:var(--cm-tone);background:color-mix(in srgb,var(--cm-tone) 10%,transparent);color:var(--cm-tone)}
.cm-text{flex:1;min-width:0;display:grid;gap:5px}
.cm-title{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cm-root .cm-title{display:-webkit-box;white-space:normal;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:14.5px;font-weight:640;line-height:1.3;overflow-wrap:anywhere}
.cm-text small{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:11.5px;white-space:nowrap}
.cm-text em{padding:0 7px;border:1px solid var(--cm-line);border-radius:999px;font-size:10.5px;font-style:normal}
/* 书已经不在文档库里：根节点压一层斜纹阴影。 */
.cm-book.gone .cm-root{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--ink) 12%,transparent) 0 5px,color-mix(in srgb,var(--ink) 3%,transparent) 5px 11px)}
.cm-book.gone .cm-seal{border-style:dashed;color:var(--muted)}
.cm-book.gone .cm-title{color:var(--muted)}

.cm-act{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:none;box-shadow:none;color:var(--muted);cursor:pointer}
.cm-act:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
/* 节点右边的小圆钮：收起时写着里面有几个，展开后是收回去的箭头。 */
.cm-knob{width:22px;height:22px;margin-left:8px;border:1px solid var(--cm-line);background:var(--canvas);font:inherit;font-size:11px;font-variant-numeric:tabular-nums;line-height:1;transition:border-color .16s var(--ease-out),color .16s var(--ease-out),scale .2s var(--ease-spring)}
.cm-knob:hover:not(:disabled){border-color:color-mix(in srgb,var(--ink) 50%,transparent);background:var(--canvas);scale:1.1}
.cm-knob.has{border-color:color-mix(in srgb,var(--cm-tone) 55%,transparent);color:var(--cm-tone)}

/* 往右长的枝：曲线是量出来画的（v-links）。 */
.cm-kids{position:relative;display:flex;flex-direction:column;flex:none;gap:9px;margin-left:56px}
.cm-links{position:absolute;left:-56px;top:0;width:56px;height:100%;overflow:visible;pointer-events:none}
.cm-links :deep(path){fill:none;stroke:var(--cm-line);stroke-width:1;stroke-linecap:round;stroke-dasharray:1;animation:cm-draw .6s var(--ease-out) both}
@keyframes cm-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.cm-kid{display:flex;align-items:center;animation:cm-node .46s var(--ease-out) both;animation-delay:calc(var(--i,0) * 70ms + 90ms)}
@keyframes cm-node{from{opacity:0;translate:-10px 0}}

.cm-talk{display:flex;align-items:center;flex:none;width:312px;height:40px;border:1px solid color-mix(in srgb,var(--ink) 10%,transparent);border-radius:13px;background:color-mix(in srgb,var(--surface) 78%,transparent);box-shadow:0 1px 0 rgb(255 255 255 / .35) inset,0 8px 18px -16px rgb(0 0 0 / .5);transition:border-color .16s var(--ease-out),background-color .16s var(--ease-out),box-shadow .16s var(--ease-out),opacity .16s var(--ease-out)}
.cm-talk:hover{border-color:color-mix(in srgb,var(--ink) 30%,transparent);background:var(--surface)}
.cm-talk.picked{border-color:color-mix(in srgb,var(--cm-tone) 72%,transparent);background:color-mix(in srgb,var(--cm-tone) 12%,var(--surface));box-shadow:0 0 0 3px color-mix(in srgb,var(--cm-tone) 16%,transparent)}
.cm-talk.lifted{opacity:.4}
.cm-talk-open{flex:1;min-width:0;display:flex;align-items:center;justify-content:flex-start;gap:8px;height:38px;padding:0 13px 0 14px;border:0;border-radius:12px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.cm-talk-open small{flex:none;margin-left:auto;padding-left:10px;color:var(--muted);font-size:11px;white-space:nowrap}
.cm-mute{flex:none;opacity:.4}
.cm-rename{flex:1;min-width:0;height:30px;margin:0 5px;padding:0 9px;border:1px solid color-mix(in srgb,var(--cm-tone) 55%,transparent);border-radius:9px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px;outline:0}
.cm-item{display:flex;align-items:center;gap:4px;max-width:380px;min-height:26px;padding-left:10px;font-size:12.5px;line-height:1.5}
.cm-item::before{content:'';flex:none;width:5px;height:5px;margin-right:6px;border-radius:50%;background:var(--cm-tone)}
.cm-item span{min-width:0;overflow-wrap:anywhere}
.cm-item b{font-weight:560}
.cm-item em{margin-left:9px;color:var(--muted);font-size:11.5px;font-style:normal}
.cm-item .cm-act{width:22px;height:22px;opacity:0}
.cm-item:hover .cm-act,.cm-item .cm-act:focus-visible{opacity:1}
.cm-band{position:absolute;z-index:3;border:1px solid color-mix(in srgb,var(--cm-tone) 70%,transparent);border-radius:4px;background:color-mix(in srgb,var(--cm-tone) 10%,transparent);pointer-events:none}
.cm-hint{position:absolute;left:24px;bottom:16px;z-index:2;display:flex;align-items:center;margin:0;color:var(--muted);font-size:11.5px;letter-spacing:.04em;pointer-events:none}

/* 选中后的操作条：浮在底部中间。 */
.cm-bar{position:absolute;left:50%;bottom:30px;z-index:5;display:flex;align-items:center;gap:8px;min-height:50px;max-width:calc(100% - 40px);padding:8px 10px 8px 20px;border:1px solid var(--glass-outline,var(--separator));border-radius:999px;background:var(--popup-glass,var(--surface));box-shadow:0 26px 60px -24px rgb(0 0 0 / .5),0 2px 8px rgb(0 0 0 / .08);font-size:12.5px;color:var(--secondary);translate:-50% 0;white-space:nowrap}
.cm-bar>span:first-child{margin-right:8px}
.cm-bar b{color:var(--ink);font-size:14px;font-weight:620;font-variant-numeric:tabular-nums}
.cm-warn{color:var(--danger,#b3261e)}
.cm-other{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 15px;border:1px dashed color-mix(in srgb,var(--ink) 34%,transparent);border-radius:999px;color:var(--ink);transition:border-color .16s,background-color .16s}
.cm-other.on{border-color:color-mix(in srgb,var(--cm-tone) 75%,transparent);background:color-mix(in srgb,var(--cm-tone) 12%,transparent)}
.cm-ghost{position:fixed;z-index:9;padding:4px 11px;border-radius:999px;background:var(--ink);color:var(--canvas);font-size:11.5px;letter-spacing:.04em;opacity:.5;pointer-events:none;white-space:nowrap;transition:background-color .16s,opacity .16s}
.cm-ghost.ok{opacity:.92}
.cm-button{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border:1px solid var(--glass-outline,var(--separator));border-radius:999px;background:color-mix(in srgb,var(--ink) 4%,transparent);box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;cursor:pointer}
.cm-button:hover{background:color-mix(in srgb,var(--ink) 9%,transparent)}
.cm-button.danger{border-color:color-mix(in srgb,var(--danger,#b3261e) 45%,transparent);color:var(--danger,#b3261e)}
.cm-menu{position:absolute;z-index:6;display:grid;gap:1px;min-width:200px;padding:5px;border:1px solid var(--glass-outline,var(--separator));border-radius:12px;background:var(--popup-glass,var(--surface));box-shadow:0 22px 50px -20px rgb(0 0 0 / .5),0 2px 6px rgb(0 0 0 / .08)}
.cm-menu button{display:flex;align-items:center;justify-content:flex-start;gap:9px;height:31px;padding:0 10px;border:0;border-radius:7px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;text-align:left;white-space:nowrap;cursor:pointer}
.cm-menu button:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 8%,transparent)}
.cm-menu button:disabled{opacity:.4;cursor:default}
.cm-menu button.danger{color:var(--danger,#b3261e)}
.cm-menu button.line{margin-top:4px;border-top:1px solid var(--separator);border-radius:0 0 7px 7px}
.cm-move{position:absolute;left:50%;top:90px;z-index:7;display:flex;flex-direction:column;gap:9px;width:min(400px,calc(100% - 40px));max-height:calc(100% - 150px);padding:14px;border:1px solid var(--glass-outline,var(--separator));border-radius:16px;background:var(--popup-glass,var(--surface));box-shadow:0 30px 70px -24px rgb(0 0 0 / .55),0 2px 8px rgb(0 0 0 / .1);translate:-50% 0}
.cm-move p{margin:0;font-size:13px;font-weight:620}
.cm-move input{height:32px;padding:0 10px;border:1px solid var(--separator);border-radius:var(--r-sm,8px);background:var(--surface);color:var(--ink);font:inherit;font-size:13px;outline:0}
.cm-targets{flex:1;min-height:0;overflow:auto;display:grid;gap:1px}
.cm-targets button{display:flex;align-items:center;justify-content:flex-start;gap:9px;height:32px;padding:0 9px;border:0;border-radius:7px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.cm-targets button:hover{background:color-mix(in srgb,var(--ink) 8%,transparent)}
.cm-move .cm-button{align-self:flex-end}
.cm-move .cm-empty{margin:14px 0;font-weight:400}
.cm-pop-enter-active{transition:opacity .16s var(--ease-out),scale .22s var(--ease-spring)}
.cm-pop-leave-active{transition:opacity .12s var(--ease-out)}
.cm-pop-enter-from{opacity:0;scale:.94}.cm-pop-leave-to{opacity:0}
.cm-bar-enter-active,.cm-bar-leave-active{transition:opacity .18s var(--ease-out),translate .26s var(--ease-spring)}
.cm-bar-enter-from,.cm-bar-leave-to{opacity:0;translate:-50% 14px}
@media (prefers-reduced-motion:reduce){.cm-page,.cm-root,.cm-kid,.cm-links :deep(path){animation:none}}

/* 草稿风格：铅笔线，红铅笔只做强调。 */
:root[data-style='sketch'] .cm-page{--cm-line:color-mix(in srgb,var(--pencil,#2b2a27) 52%,transparent);--cm-tone:var(--red-pencil,#c0392b);background:var(--canvas);backdrop-filter:none}
:root[data-style='sketch'] .cm-seal{border-width:1.3px;border-color:color-mix(in srgb,var(--pencil,#2b2a27) 70%,transparent)}
:root[data-style='sketch'] .cm-root-open:hover{background:none}
:root[data-style='sketch'] .cm-talk{border:1.2px solid color-mix(in srgb,var(--pencil,#2b2a27) 55%,transparent);box-shadow:none}
:root[data-style='sketch'] .cm-talk.picked{box-shadow:0 0 0 3px color-mix(in srgb,var(--cm-tone) 14%,transparent)}
:root[data-style='sketch'] .cm-links :deep(path){stroke-width:1.2}
:root[data-style='sketch'] .cm-knob{border-width:1.3px}
</style>
