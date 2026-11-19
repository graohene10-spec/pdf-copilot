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
function capture(event: KeyboardEvent) { if (event.key === 'Escape' || event.key === 'Delete') keydown(event) }
onMounted(() => window.addEventListener('keydown', capture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', capture, true))
</script>

<template>
  <section ref="dialog" class="cm-page" role="dialog" aria-modal="true" aria-label="管理对话" tabindex="-1" @keydown="keydown" @pointerdown="menu && !($event.target as HTMLElement).closest('.cm-menu') && (menu = undefined)" @contextmenu.prevent>
    <header class="cm-head">
      <button type="button" class="cm-back" @click="emit('close')"><AppIcon name="arrow" :size="15" />返回</button>
      <h2>管理对话</h2>
      <span v-if="ready" class="cm-count">{{ roots.length }} 本书 · {{ total }} 段对话 · {{ remembered }} 条记忆</span>
      <span class="cm-hint">左键进入 · 右键选中 · 拖到另一本书上移动 · 空白处拖动框选</span>
    </header>

    <div ref="tree" class="cm-tree" @pointerdown="startPointer">
      <p v-if="!ready" class="cm-empty">正在读取…</p>
      <p v-else-if="!roots.length" class="cm-empty">还没有对话。</p>
      <div class="cm-forest">
        <div v-for="root in roots" :key="root.id" class="cm-book" :class="{ gone: root.gone, drop: dropId === root.id }" :data-book="root.id">
          <div class="cm-root" :data-root="root.id" @contextmenu.prevent.stop="rootMenu(root, $event)">
            <button type="button" class="cm-root-open" :data-tip="root.gone ? '这本书已从文档库移除，对话和记忆仍然保留' : '打开这本书'" @click="openRoot(root)">
              <AppIcon :name="root.kind === 'pdf' ? 'book' : 'doc'" :size="16" />
              <span class="cm-text"><span class="cm-title">{{ root.title }}</span><small>{{ root.list.length }} 段对话<em v-if="root.gone">已移除</em></small></span>
            </button>
            <button type="button" class="cm-act cm-fold" :aria-expanded="!folded.has(root.id)" :aria-label="folded.has(root.id) ? '展开' : '收起'" @click="folded.has(root.id) ? folded.delete(root.id) : folded.add(root.id)"><AppIcon name="arrow" :size="13" /></button>
          </div>
          <div v-if="!folded.has(root.id)" class="cm-kids">
            <div v-for="talk in root.list" :key="talk.id" class="cm-kid">
              <div class="cm-talk" :class="{ picked: picked.has(key(root.id, talk.id)), lifted: drag && picked.has(key(root.id, talk.id)) }" :data-key="key(root.id, talk.id)" @contextmenu.prevent.stop="talkMenu(root, talk, $event)">
                <input v-if="renaming === key(root.id, talk.id)" ref="field" v-model="draft" class="cm-rename" maxlength="60" aria-label="对话名称" @keydown.enter.prevent="endRename(true)" @keydown.esc.prevent.stop="endRename(false)" @blur="endRename(true)" @pointerdown.stop />
                <button v-else type="button" class="cm-talk-open" @click="openTalk(root, talk, $event)">
                  <span class="cm-text"><span class="cm-title"><AppIcon v-if="talk.branchOf" name="branch" :size="12" />{{ talk.title || '新对话' }}</span>
                  <small>{{ Math.ceil(talk.messages.length / 2) }} 问 · {{ relative(talk.updatedAt) }}<template v-if="talk.request"> · 回答中</template></small></span>
                </button>
                <button type="button" class="cm-act cm-memory" :class="{ off: talk.memory === false, has: itemsOf(talk.id).length }" :aria-pressed="opened.has(talk.id)" :disabled="talk.memory === false || !itemsOf(talk.id).length" :data-tip="talk.memory === false ? '这段对话不记入记忆' : itemsOf(talk.id).length ? '看这段对话记下了什么' : '还没有整理出记忆'" :aria-label="`记忆 ${itemsOf(talk.id).length} 条`" @click="opened.has(talk.id) ? opened.delete(talk.id) : opened.add(talk.id)"><AppIcon name="memory" :size="14" /><i v-if="itemsOf(talk.id).length">{{ itemsOf(talk.id).length }}</i></button>
              </div>
              <div v-if="opened.has(talk.id) && itemsOf(talk.id).length" class="cm-kids">
                <div v-for="(item, index) in itemsOf(talk.id)" :key="item" class="cm-kid"><div class="cm-item"><span>{{ item }}</span><button type="button" class="cm-act" aria-label="忘掉这一条" data-tip="忘掉这一条" @click="forgetItem(talk.id, index)"><AppIcon name="close" :size="11" /></button></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <i v-if="band" class="cm-band" :style="{ left: `${band.left}px`, top: `${band.top}px`, width: `${band.width}px`, height: `${band.height}px` }"></i>
    </div>

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
          <span>已选 {{ picked.size }} 段</span>
          <button type="button" class="cm-button" @click="moving = [...picked]"><AppIcon name="folder" :size="14" />移到另一本书</button><button type="button" class="cm-button danger" @click="doomed = [...picked]"><AppIcon name="trash" :size="14" />删除</button><button type="button" class="cm-button" @click="picked.clear()">取消选中</button>
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
/* 整页盖在应用上面：不是弹窗，也不占侧栏。 */
.cm-page{--cm-line:color-mix(in srgb,var(--ink) 30%,transparent);position:fixed;inset:0;z-index:75;display:flex;flex-direction:column;background:color-mix(in srgb,var(--canvas) 90%,transparent);backdrop-filter:blur(36px) saturate(1.15);color:var(--ink);outline:0;animation:cm-in .26s var(--ease-out)}
@keyframes cm-in{from{opacity:0;transform:translateY(10px)}}
.cm-head{display:flex;align-items:center;gap:14px;flex:none;height:56px;padding:0 24px 0 14px;border-bottom:1px solid var(--separator)}
.cm-head h2{margin:0;font-size:16px;font-weight:650}
.cm-back{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 12px 0 8px;border:0;border-radius:var(--r-control);background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:13px;cursor:pointer}
.cm-back:hover{background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.cm-count{color:var(--muted);font-size:12px}
.cm-hint{margin-left:auto;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-tree{position:relative;flex:1;min-height:0;overflow:auto;padding:26px 36px 110px;user-select:none}
.cm-empty{margin:80px 0;text-align:center;color:var(--muted);font-size:13px}
.cm-forest{display:flex;flex-direction:column;align-items:flex-start;gap:14px;width:max-content;min-width:100%}
.cm-book{display:flex;align-items:center;padding:8px 14px 8px 8px;border-radius:18px;outline:1.5px dashed transparent;transition:background-color .16s var(--ease-out),outline-color .16s var(--ease-out)}
.cm-book.drop{background:color-mix(in srgb,var(--accent) 10%,transparent);outline-color:color-mix(in srgb,var(--accent) 65%,transparent)}

/* 根：一本书。书很长时它跟着滚动留在视野里。 */
.cm-root{position:sticky;top:8px;bottom:8px;z-index:1;display:flex;align-items:center;flex:none;width:238px;min-height:52px;border:1px solid color-mix(in srgb,var(--ink) 20%,transparent);border-radius:14px;background:var(--surface);box-shadow:0 1px 2px rgb(0 0 0 / .05),0 10px 24px -18px rgb(0 0 0 / .35)}
.cm-root-open{flex:1;min-width:0;display:flex;align-items:center;justify-content:flex-start;gap:10px;min-height:50px;padding:7px 4px 7px 13px;border:0;border-radius:13px;background:none;box-shadow:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
.cm-text{flex:1;min-width:0;display:grid;gap:2px}
.cm-title{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cm-root .cm-title{font-size:13.5px;font-weight:640}
.cm-text small{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:11.5px;font-weight:400;white-space:nowrap}
.cm-text em{padding:0 6px;border-radius:999px;background:color-mix(in srgb,var(--ink) 12%,transparent);font-size:10.5px;font-style:normal}
/* 书已经不在文档库里：根节点压一层斜纹阴影，字也淡一些。 */
.cm-book.gone .cm-root{border-style:dashed;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--ink) 13%,var(--surface)) 0 6px,color-mix(in srgb,var(--ink) 5%,var(--surface)) 6px 12px);box-shadow:none}
.cm-book.gone .cm-root-open{color:var(--muted)}
.cm-act{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:var(--r-sm,8px);background:none;box-shadow:none;color:var(--muted);cursor:pointer}
.cm-act:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.cm-fold{margin-right:5px}
.cm-fold svg{transition:rotate .2s var(--ease-out)}
.cm-fold[aria-expanded='false'] svg{rotate:180deg}

/* 往右长的枝：父节点右边一段横线接到竖线上，竖线再分给每个孩子。 */
.cm-kids{position:relative;display:flex;flex-direction:column;flex:none;margin-left:26px}
.cm-kids::before{content:'';position:absolute;left:-26px;top:50%;width:26px;border-top:1px solid var(--cm-line);pointer-events:none}
.cm-kid{position:relative;display:flex;align-items:center;padding:4px 0 4px 24px}
.cm-kid::before{content:'';position:absolute;left:0;top:0;bottom:0;width:24px;border-left:1px solid var(--cm-line);pointer-events:none}
.cm-kid::after{content:'';position:absolute;left:0;top:50%;width:24px;border-top:1px solid var(--cm-line);pointer-events:none}
.cm-kid:first-child::before{top:50%;border-top:1px solid var(--cm-line);border-top-left-radius:11px}
.cm-kid:last-child::before{bottom:50%;border-bottom:1px solid var(--cm-line);border-bottom-left-radius:11px}
.cm-kid:first-child::after,.cm-kid:last-child::after{display:none}
.cm-kid:only-child::before{top:50%;bottom:auto;border-left:0;border-bottom:0;border-radius:0}

.cm-talk{display:flex;align-items:center;flex:none;width:292px;min-height:46px;border:1px solid color-mix(in srgb,var(--ink) 13%,transparent);border-radius:12px;background:color-mix(in srgb,var(--surface) 82%,transparent);transition:border-color .14s var(--ease-out),background-color .14s var(--ease-out),opacity .14s var(--ease-out)}
.cm-talk:hover{border-color:color-mix(in srgb,var(--ink) 30%,transparent)}
.cm-talk.picked{border-color:color-mix(in srgb,var(--accent) 70%,transparent);background:color-mix(in srgb,var(--accent) 14%,var(--surface));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent)}
.cm-talk.lifted{opacity:.45}
.cm-talk-open{flex:1;min-width:0;display:flex;align-items:center;justify-content:flex-start;min-height:44px;padding:6px 4px 6px 13px;border:0;border-radius:11px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.cm-talk .cm-title{display:block}
.cm-talk .cm-title svg{margin-right:5px;vertical-align:-1px}
.cm-memory{position:relative;width:40px;margin-right:4px;justify-content:start;display:flex;align-items:center;gap:2px;padding-left:7px}
.cm-memory.has{color:var(--accent)}
.cm-memory.off{opacity:.35}
.cm-memory:disabled{cursor:default}
.cm-memory i{font-size:10.5px;font-style:normal;font-variant-numeric:tabular-nums}
.cm-rename{flex:1;min-width:0;height:32px;margin:0 6px;padding:0 8px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:var(--r-sm,8px);background:var(--surface);color:var(--ink);font:inherit;font-size:13px;outline:0}
.cm-item{display:flex;align-items:center;gap:6px;max-width:340px;min-height:30px;padding:4px 4px 4px 11px;border-radius:10px;background:color-mix(in srgb,var(--accent) 9%,transparent);color:var(--secondary);font-size:12.5px;line-height:1.5}
.cm-item span{flex:1;min-width:0;overflow-wrap:anywhere}
.cm-item .cm-act{width:22px;height:22px;opacity:0}
.cm-item:hover .cm-act,.cm-item .cm-act:focus-visible{opacity:1}
.cm-band{position:absolute;z-index:3;border:1px solid color-mix(in srgb,var(--accent) 70%,transparent);border-radius:3px;background:color-mix(in srgb,var(--accent) 12%,transparent);pointer-events:none}

/* 选中后的操作条：浮在底部中间。 */
.cm-bar{position:absolute;left:50%;bottom:26px;z-index:5;display:flex;align-items:center;gap:8px;min-height:50px;max-width:calc(100% - 40px);padding:8px 10px 8px 18px;border:1px solid var(--glass-outline,var(--separator));border-radius:16px;background:var(--popup-glass,var(--surface));box-shadow:0 26px 60px -24px rgb(0 0 0 / .5),0 2px 8px rgb(0 0 0 / .08);font-size:12.5px;color:var(--secondary);translate:-50% 0;white-space:nowrap}
.cm-bar>span:first-child{margin-right:8px}
.cm-warn{color:var(--danger,#b3261e)}
.cm-other{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border:1.5px dashed color-mix(in srgb,var(--ink) 30%,transparent);border-radius:11px;color:var(--ink)}
.cm-other.on{border-color:color-mix(in srgb,var(--accent) 70%,transparent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
.cm-ghost{position:fixed;z-index:9;padding:5px 11px;border-radius:999px;background:var(--ink);color:var(--canvas);font-size:12px;opacity:.72;pointer-events:none;white-space:nowrap}
.cm-ghost.ok{background:var(--accent);color:#fff;opacity:1}
.cm-button{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border:1px solid var(--glass-outline,var(--separator));border-radius:var(--r-control);background:color-mix(in srgb,var(--ink) 4%,transparent);box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;cursor:pointer}
.cm-button:hover{background:color-mix(in srgb,var(--ink) 9%,transparent)}
.cm-button.danger{border-color:color-mix(in srgb,var(--danger,#b3261e) 45%,transparent);color:var(--danger,#b3261e)}
.cm-menu{position:absolute;z-index:6;display:grid;gap:1px;min-width:200px;padding:5px;border:1px solid var(--glass-outline,var(--separator));border-radius:12px;background:var(--popup-glass,var(--surface));box-shadow:0 22px 50px -20px rgb(0 0 0 / .5),0 2px 6px rgb(0 0 0 / .08)}
.cm-menu button{display:flex;align-items:center;justify-content:flex-start;gap:9px;height:31px;padding:0 10px;border:0;border-radius:7px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;text-align:left;white-space:nowrap;cursor:pointer}
.cm-menu button:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 8%,transparent)}
.cm-menu button:disabled{opacity:.4;cursor:default}
.cm-menu button.danger{color:var(--danger,#b3261e)}
.cm-menu button.line{margin-top:4px;border-top:1px solid var(--separator);border-radius:0 0 7px 7px}
.cm-move{position:absolute;left:50%;top:90px;z-index:7;display:flex;flex-direction:column;gap:9px;width:min(400px,calc(100% - 40px));max-height:calc(100% - 150px);padding:14px;border:1px solid var(--glass-outline,var(--separator));border-radius:14px;background:var(--popup-glass,var(--surface));box-shadow:0 30px 70px -24px rgb(0 0 0 / .55),0 2px 8px rgb(0 0 0 / .1);translate:-50% 0}
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
.cm-bar-enter-active,.cm-bar-leave-active{transition:opacity .18s var(--ease-out),translate .24s var(--ease-out)}
.cm-bar-enter-from,.cm-bar-leave-to{opacity:0;translate:-50% 12px}
@media (prefers-reduced-motion:reduce){.cm-page{animation:none}}
:root[data-style='sketch'] .cm-page{--cm-line:color-mix(in srgb,var(--pencil,#2b2a27) 55%,transparent);background:var(--canvas);backdrop-filter:none}
:root[data-style='sketch'] .cm-talk.picked{border-color:color-mix(in srgb,var(--red-pencil,#c0392b) 70%,transparent);background:color-mix(in srgb,var(--red-pencil,#c0392b) 9%,var(--surface));box-shadow:0 0 0 1px color-mix(in srgb,var(--red-pencil,#c0392b) 45%,transparent)}
:root[data-style='sketch'] .cm-memory.has{color:var(--red-pencil,#c0392b)}
:root[data-style='sketch'] .cm-book.drop{background:color-mix(in srgb,var(--red-pencil,#c0392b) 7%,transparent);outline-color:color-mix(in srgb,var(--red-pencil,#c0392b) 60%,transparent)}
:root[data-style='sketch'] .cm-ghost.ok{background:var(--red-pencil,#c0392b)}
</style>
