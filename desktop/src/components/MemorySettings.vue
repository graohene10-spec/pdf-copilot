<script setup lang="ts">
// 设置里的「记忆」：先用三句话说清它是什么，再把记着的每一条按书列出来——点一条就能改，叉掉就是忘掉。
// 这里改了立刻生效，不跟着设置的「保存」走。
import { computed, nextTick, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { editItem, forgetItem, memory, restoreMemory, retagMemory, type MemoryEntry } from '../ai/memory'

const emit = defineEmits<{ manage: [] }>()
type Row = { id: string; index: number; text: string; talk: string; scope: 'book' | 'all' }
const books = computed(() => {
  const map = new Map<string, { title: string; rows: Row[] }>()
  for (const [id, entry] of Object.entries(memory.entries).sort(([, a], [, b]) => b.at - a.at)) {
    if (!entry.items.length) continue
    const key = entry.documentId || entry.documentTitle
    if (!map.has(key)) map.set(key, { title: entry.documentTitle || '已移除的文档', rows: [] })
    entry.items.forEach((text, index) => map.get(key)!.rows.push({ id, index, text, talk: entry.title || '新对话', scope: entry.scope === 'book' ? 'book' : 'all' }))
  }
  return [...map.values()]
})
const total = computed(() => books.value.reduce((sum, book) => sum + book.rows.length, 0))
// 正在改哪一条。
const editing = ref('')
const text = ref('')
const field = ref<HTMLTextAreaElement[]>([])
const keyOf = (row: Row) => `${row.id}:${row.index}`
function edit(row: Row) { editing.value = keyOf(row); text.value = row.text; void nextTick(() => { const el = field.value[0]; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length) }) }
function save(row: Row) {
  if (editing.value !== keyOf(row)) return
  editing.value = ''
  const next = text.value.replace(/\s+/g, ' ').trim()
  if (next && next !== row.text) editItem(row.id, row.index, next)
}
function editKey(event: KeyboardEvent, row: Row) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter') { event.preventDefault(); save(row) }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editing.value = '' }
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
function flipScope(row: Row) { retagMemory(row.id, { scope: row.scope === 'book' ? 'all' : 'book' }) }
</script>

<template>
  <section class="mem" aria-label="记忆">
    <div class="mem-head"><h3>记忆</h3><span v-if="total">{{ total }} 条</span><button type="button" class="text-action" @click="emit('manage')">管理对话…</button></div>
    <ol class="mem-how">
      <li><b>记什么</b>一段对话答完，助手把你在里面学了什么、掌握得怎样整理成几行。只记学习内容，不记你是谁。</li>
      <li><b>怎么用</b>你下次提问时，助手先看这些，决定从哪讲起、讲多细：已弄懂的一笔带过，还不熟的多讲两句。</li>
      <li><b>读哪些</b>新对话下面选「本书」只用这本书里记的，「全局」连别的书里共用的也用，「不用」既不读也不记。</li>
    </ol>
    <p v-if="!memory.ready" class="mem-empty">正在读取…</p>
    <p v-else-if="!total" class="mem-empty">还没有记忆。和助手聊过几轮之后，这里会出现它记下的内容。</p>
    <div v-for="book in books" :key="book.title" class="mem-book">
      <h4 :title="book.title">{{ book.title }}</h4>
      <ul>
        <li v-for="row in book.rows" :key="keyOf(row)">
          <textarea v-if="editing === keyOf(row)" ref="field" v-model="text" rows="2" maxlength="80" aria-label="修改这条记忆" @keydown="editKey($event, row)" @blur="save(row)"></textarea>
          <button v-else type="button" class="mem-text" :data-tip="`点一下修改 · 来自「${row.talk}」`" @click="edit(row)">{{ row.text }}</button>
          <button type="button" class="mem-scope" :data-tip="row.scope === 'book' ? '只在这本书里用。点一下改成所有书共用' : '所有书共用。点一下改成只在这本书里用'" @click="flipScope(row)">{{ row.scope === 'book' ? '本书' : '全局' }}</button>
          <button type="button" class="mem-x" aria-label="忘掉这一条" data-tip="忘掉这一条" @click="forget(row)"><AppIcon name="close" :size="12" /></button>
        </li>
      </ul>
    </div>
    <p v-if="undo" class="mem-undo" role="status">已忘掉一条。<button type="button" class="text-action" @click="restore">撤销</button></p>
  </section>
</template>

<style scoped>
.mem-head{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.mem-head h3{margin:0}
.mem-head span{margin-right:auto;color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
.mem-head h3:last-of-type:not(:has(+span)){margin-right:auto}
/* 三句说明：左边一个短词，右边一句话。 */
.mem-how{display:grid;gap:7px;margin:0 0 20px;padding:13px 15px;border:1px solid var(--separator);border-radius:var(--r-md,10px);list-style:none;color:var(--secondary);font-size:12.5px;line-height:1.65}
.mem-how li{display:grid;grid-template-columns:4.2em 1fr;gap:6px}
.mem-how b{color:var(--ink);font-weight:600;white-space:nowrap}
.mem-empty{margin:0;color:var(--muted);font-size:13px}
.mem-book{margin-top:16px}
.mem-book h4{margin:0 0 4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12.5px;font-weight:650;color:var(--secondary)}
.mem-book ul{margin:0;padding:0;list-style:none}
.mem-book li{display:flex;align-items:center;gap:6px;min-height:34px;border-bottom:1px solid var(--separator)}
.mem-text{flex:1;min-width:0;height:auto;min-height:32px;padding:5px 6px;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;line-height:1.5;text-align:left;white-space:normal;overflow-wrap:anywhere;cursor:text;user-select:text}
.mem-text{display:block;justify-content:flex-start}
:root[data-style='sketch'] .mem-text:hover:not(:disabled){rotate:none}
.mem-text:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
.mem-book textarea{flex:1;min-width:0;margin:4px 0;padding:5px 7px;border:1px solid var(--accent);border-radius:6px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;line-height:1.5;resize:none;outline:0}
.mem-scope{flex:none;height:22px;padding:0 8px;border:1px solid var(--separator);border-radius:999px;background:none;box-shadow:none;color:var(--muted);font:inherit;font-size:11.5px;white-space:nowrap}
.mem-scope:hover{border-color:color-mix(in srgb,var(--ink) 40%,transparent);color:var(--ink)}
.mem-x{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:none;box-shadow:none;color:var(--muted)}
.mem-x:hover{background:color-mix(in srgb,var(--danger,#c0392b) 12%,transparent);color:var(--danger,#c0392b)}
.mem-undo{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;margin:14px 0 0;padding:8px 12px;border:1px solid var(--separator);border-radius:8px;background:var(--surface,var(--canvas));font-size:12.5px}
</style>
