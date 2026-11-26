<script setup lang="ts">
// 设置里的「记忆」：先用三句话说清它是什么，再把记着的每一条按书列出来——点一条就能改，叉掉就是忘掉。
// 这里改了立刻生效，不跟着设置的「保存」走。
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { editItem, forgetItem, memory, restoreMemory, type MemoryEntry } from '../ai/memory'
import { forgetPoint, loadAllMaps, maps, mapTitles } from '../ai/learning-map'
import type { MapNode } from '../ai/learning'

const emit = defineEmits<{ manage: [] }>()
type Row = { id: string; index: number; text: string; talk: string; scope: 'book' | 'all' }
const books = computed(() => {
  const map = new Map<string, { key: string; title: string; rows: Row[]; points: MapNode[] }>()
  for (const [id, entry] of Object.entries(memory.entries).sort(([, a], [, b]) => b.at - a.at)) {
    if (!entry.items.length) continue
    const key = entry.documentId || entry.documentTitle
    if (!map.has(key)) map.set(key, { key, title: entry.documentTitle || '已移除的文档', rows: [], points: [] })
    entry.items.forEach((text, index) => map.get(key)!.rows.push({ id, index, text, talk: entry.title || '新对话', scope: entry.scope === 'book' ? 'book' : 'all' }))
  }
  // 学习对话里学过的要点排在这本书的记忆下面。
  for (const [id, book] of Object.entries(maps)) {
    if (!book.nodes.length) continue
    if (!map.has(id)) map.set(id, { key: id, title: mapTitles[id] || '已移除的文档', rows: [], points: [] })
    map.get(id)!.points = book.nodes
  }
  return [...map.values()]
})
onMounted(() => { void loadAllMaps() })
const total = computed(() => books.value.reduce((sum, book) => sum + book.rows.length + book.points.length, 0))
// 哪几本书收起来了（和管理对话页右边那一栏一样，点书名收起、展开）。
const folded = reactive(new Set<string>())
function fold(key: string) { if (folded.has(key)) folded.delete(key); else folded.add(key) }
// 正在改哪一条。
const editing = ref('')
const text = ref('')
const field = ref<HTMLTextAreaElement[]>([])
const keyOf = (row: Row) => `${row.id}:${row.index}`
/** 改的框跟着字长高，不留空行，也不出滚动条。 */
function grow(el?: HTMLTextAreaElement) { if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px` }
function edit(row: Row) { editing.value = keyOf(row); text.value = row.text; void nextTick(() => { const el = field.value[0]; grow(el); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length) }) }
/** 改完（Enter 或 Esc）焦点回到这一条上，键盘可以接着往下走。 */
function refocus(row: Row) { void nextTick(() => document.querySelector<HTMLElement>(`.mem [data-mem="${CSS.escape(keyOf(row))}"]`)?.focus()) }
function save(row: Row) {
  if (editing.value !== keyOf(row)) return
  editing.value = ''
  const next = text.value.replace(/\s+/g, ' ').trim()
  if (next && next !== row.text) editItem(row.id, row.index, next)
}
function editKey(event: KeyboardEvent, row: Row) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter') { event.preventDefault(); save(row); refocus(row) }
  // 只退出这一条的修改，不往上传：外面的设置窗口按 Esc 会整个关掉。
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editing.value = ''; refocus(row) }
}
// 忘掉一条之后留几秒可以撤销。
const undo = ref<{ id: string; entry: MemoryEntry } | null>(null)
let undoTimer = 0
function forget(row: Row) {
  const entry = memory.entries[row.id]
  if (!entry) return
  undo.value = { id: row.id, entry: JSON.parse(JSON.stringify(entry)) }
  forgetItem(row.id, row.index)
  clearTimeout(undoTimer); undoTimer = window.setTimeout(() => { undo.value = null }, 6000)
}
function restore() { if (undo.value) restoreMemory(undo.value.id, undo.value.entry); undo.value = null }
</script>

<template>
  <section class="mem" aria-label="记忆">
    <div class="mem-head"><h3>记忆</h3><i class="mem-what" tabindex="0" role="note" aria-label="记忆是什么" data-tip="从对话里自动整理，助手回答时参考">?</i><span v-if="total">{{ total }} 条</span><button type="button" class="text-action" @click="emit('manage')">管理对话…</button></div>
    <p v-if="!memory.ready" class="mem-empty">正在读取…</p>
    <p v-else-if="!total" class="mem-empty">还没有记忆。</p>
    <div v-for="book in books" :key="book.key" class="mem-book" :class="{ folded: folded.has(book.key) }">
      <h4><button type="button" class="mem-fold" :title="book.title" :aria-expanded="!folded.has(book.key)" @click="fold(book.key)"><span>{{ book.title }}</span><small>{{ book.rows.length + book.points.length }}</small><AppIcon name="arrow" :size="10" /></button></h4>
      <ul v-if="!folded.has(book.key)">
        <li v-for="row in book.rows" :key="keyOf(row)">
          <textarea v-if="editing === keyOf(row)" ref="field" v-model="text" rows="1" maxlength="80" aria-label="修改这条记忆" @input="grow($event.target as HTMLTextAreaElement)" @keydown="editKey($event, row)" @blur="save(row)"></textarea>
          <button v-else type="button" class="mem-text" :data-mem="keyOf(row)" :data-tip="`点一下修改 · 来自「${row.talk}」`" @click="edit(row)">{{ row.text }}</button>
          <button type="button" class="mem-x" aria-label="忘掉这一条" data-tip="忘掉这一条" @click="forget(row)"><AppIcon name="close" :size="12" /></button>
        </li>
      </ul>
      <template v-if="!folded.has(book.key) && book.points.length">
        <p class="mem-sub">学过的要点</p>
        <ul>
          <li v-for="point in book.points" :key="point.id">
            <span class="mem-point" :data-tip="point.sources[0]?.text.slice(0, 300)"><b>{{ point.title }}</b><template v-if="point.statement !== point.title">{{ point.statement }}</template></span>
            <button type="button" class="mem-x" aria-label="忘掉这个要点" data-tip="忘掉这个要点" @click="forgetPoint(book.key, point.id)"><AppIcon name="close" :size="12" /></button>
          </li>
        </ul>
      </template>
    </div>
    <p v-if="undo" class="mem-undo" role="status">已忘掉一条。<button type="button" class="text-action" @click="restore">撤销</button></p>
  </section>
</template>

<style scoped>
.mem-head{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.mem-head h3{margin:0}
.mem-head span{margin-right:auto;color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
.mem-head h3:last-of-type:not(:has(+span)){margin-right:auto}
.mem-what{display:grid;place-items:center;flex:none;width:16px;height:16px;border:1px solid var(--separator);border-radius:50%;color:var(--muted);font-family:var(--font-formal);font-size:11px;font-style:normal;line-height:1;cursor:help}
.mem-empty{margin:0;color:var(--muted);font-size:13px}
.mem-book{margin-top:16px}
.mem-book h4{margin:0 0 4px;font-size:12.5px;font-weight:650;color:var(--secondary)}
/* 书名是一颗按钮：点一下收起、展开这本书的记忆。 */
.mem-fold{display:flex;align-items:center;gap:8px;width:100%;height:auto;min-height:26px;padding:0 4px 0 0;border:0;border-radius:6px;background:none;box-shadow:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mem-fold span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.mem-fold small{flex:none;color:var(--muted);font-size:11.5px;font-weight:400;font-variant-numeric:tabular-nums}
.mem-fold svg{flex:none;color:var(--muted);rotate:-90deg;transition:rotate var(--dur-2) var(--spring-snappy)}
.mem-book.folded .mem-fold svg{rotate:180deg}
.mem-fold:hover{color:var(--ink)}
:root[data-style='sketch'] .mem-fold:hover:not(:disabled){rotate:none}
.mem-book ul{margin:0;padding:0;list-style:none}
.mem-book li{display:flex;align-items:center;gap:6px;min-height:34px;border-bottom:1px solid var(--separator)}
.mem-text{flex:1;min-width:0;height:auto;min-height:32px;padding:5px 6px;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;line-height:1.5;text-align:left;white-space:normal;overflow-wrap:anywhere;cursor:text;user-select:text}
.mem-text{display:block;justify-content:flex-start}
/* 这一页是拿来读和改的：不管哪种主题，条目、说明、书名都用正经字体；长的条目换行，不伸到右边的按钮底下。 */
.mem,.mem :is(button,textarea){font-family:var(--font-formal)}
.mem .mem-text,:root[data-style='sketch'] .mem .mem-text{white-space:normal;overflow:visible;overflow-wrap:anywhere;text-overflow:clip;letter-spacing:0}
.mem-book li{align-items:flex-start}
:root[data-style='sketch'] .mem-text:hover:not(:disabled){rotate:none}
.mem-text:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
.mem-book textarea{flex:1;min-width:0;height:auto;min-height:0;margin:4px 0;padding:5px 7px;border:1px solid var(--accent);border-radius:6px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;line-height:1.5;resize:none;overflow:hidden;outline:0;box-sizing:border-box}
.mem-sub{margin:10px 0 2px;color:var(--muted);font-size:12px}
.mem-point{display:flex;flex-direction:column;flex:1;min-width:0;padding:5px 6px;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.mem-point b{font-weight:650}
.mem-x{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--muted)}
.mem-x:hover{background:color-mix(in srgb,var(--danger,#c0392b) 12%,transparent);color:var(--danger,#c0392b)}
.mem-undo{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;margin:14px 0 0;padding:8px 12px;border:1px solid var(--separator);border-radius:8px;background:var(--surface,var(--canvas));font-size:12.5px}
</style>
