<script setup lang="ts">
// 学习进度：所有学习对话按书排在一起，每段一张卡片——学到哪个阶段、过了几个节点、现在在哪一个。
// 点卡片接着学；右键或卡片角上的按钮改名、删除。
import { computed, nextTick, ref } from 'vue'
import type { Doc } from '../sdk'
import { sessions, type LearnSession } from '../ai/learning-map'
import { deleteConversation, loadConversations, renameConversation } from '../ai/workspace'
import AppIcon from './AppIcon.vue'
import ContextMenu from './ContextMenu.vue'

const props = defineProps<{ documents: Doc[]; query: string }>()
const emit = defineEmits<{ open: [target: { documentId: string; conversationId: string }] }>()

const PHASE: Record<string, string> = { probe: '摸底中', plan: '等确认大纲', teach: '带读中', done: '学完了' }
type Row = LearnSession & { id: string }
const books = computed(() => {
  const word = props.query.trim().toLowerCase(), map = new Map<string, { id: string; title: string; here: boolean; rows: Row[] }>()
  for (const [id, item] of Object.entries(sessions).sort(([, a], [, b]) => b.at - a.at)) {
    const doc = props.documents.find(entry => entry.id === item.documentId), book = (doc?.name || item.documentTitle || '已移除的文档').replace(/\.(pdf|md|markdown)$/i, '')
    if (word && !`${item.title} ${book} ${item.goal}`.toLowerCase().includes(word)) continue
    if (!map.has(item.documentId)) map.set(item.documentId, { id: item.documentId, title: book, here: Boolean(doc), rows: [] })
    map.get(item.documentId)!.rows.push({ ...item, id })
  }
  return [...map.values()]
})
const day = (at: number) => { const days = Math.floor((Date.now() - at) / 86400000); return days < 1 ? '今天' : days < 2 ? '昨天' : days < 30 ? `${days} 天前` : new Date(at).toLocaleDateString() }
const way = (goal: string) => goal.split('：')[0] || ''

const menu = ref<{ x: number; y: number; row: Row; here: boolean } | null>(null)
function menuAt(row: Row, here: boolean, event: MouseEvent) { const box = (event.currentTarget as HTMLElement).getBoundingClientRect(); menu.value = { x: event.type === 'contextmenu' ? event.clientX : box.left, y: event.type === 'contextmenu' ? event.clientY : box.bottom + 4, row, here } }
const menuItems = computed(() => {
  const now = menu.value
  if (!now) return []
  return [
    { label: '接着学', icon: 'play', action: () => open(now.row), disabled: !now.here },
    { label: '改名', icon: 'edit', action: () => startRename(now.row) },
    { label: '', separator: true, action: () => {} },
    { label: '删除', icon: 'trash', danger: true, action: () => { confirming.value = now.row.id } },
  ]
})
function open(row: Row) { emit('open', { documentId: row.documentId, conversationId: row.id }) }

const renaming = ref(''), name = ref(''), field = ref<HTMLInputElement[]>([])
function startRename(row: Row) { renaming.value = row.id; name.value = row.title; void nextTick(() => { field.value[0]?.focus(); field.value[0]?.select() }) }
async function commitRename(row: Row) {
  if (renaming.value !== row.id) return
  renaming.value = ''
  const next = name.value.trim()
  if (!next || next === row.title) return
  await loadConversations(row.documentId); renameConversation(row.documentId, row.id, next)
}
// 删除要再点一次确认：一段学习对话删了就找不回来。
const confirming = ref('')
async function remove(row: Row) { confirming.value = ''; await loadConversations(row.documentId); deleteConversation(row.documentId, row.id) }
</script>

<template>
  <section class="board" aria-label="学习进度">
    <p v-if="!books.length" class="board-empty">{{ query ? '没有找到。' : '还没有学习。在阅读助手里点「学习这一段」开始。' }}</p>
    <div v-for="book in books" :key="book.id" class="board-book">
      <h2><AppIcon name="book" :size="15" /><span>{{ book.title }}</span><small>{{ book.rows.length }}</small></h2>
      <div class="board-grid">
        <article v-for="row in book.rows" :key="row.id" class="board-card" :class="{ done: row.phase === 'done', gone: !book.here }" @contextmenu.prevent="menuAt(row, book.here, $event)">
          <header>
            <input v-if="renaming === row.id" ref="field" v-model="name" maxlength="60" aria-label="名字" spellcheck="false" @keydown.enter.prevent="commitRename(row)" @keydown.esc.prevent="renaming = ''" @blur="commitRename(row)" />
            <h3 v-else :title="row.title" @dblclick="startRename(row)">{{ row.title || '学习' }}</h3>
            <button type="button" class="board-more" aria-label="更多" @click.stop="menuAt(row, book.here, $event)"><AppIcon name="more" :size="15" /></button>
          </header>
          <p class="board-meta"><span v-if="way(row.goal)" class="board-way">{{ way(row.goal) }}</span><span>{{ PHASE[row.phase] || '' }}</span><span>{{ day(row.at) }}</span></p>
          <!-- 一个节点一格：过了的涂上颜色。 -->
          <div v-if="row.total" class="board-steps" role="progressbar" :aria-valuenow="row.passed" aria-valuemin="0" :aria-valuemax="row.total" :aria-label="`过了 ${row.passed} / ${row.total} 个节点`"><i v-for="step in row.total" :key="step" :class="{ on: step <= row.passed }" /></div>
          <div v-else class="board-steps none"><i /></div>
          <p class="board-now"><b>{{ row.total ? `${row.passed} / ${row.total}` : '—' }}</b><span v-if="row.current && row.phase !== 'done'">{{ row.current.replace(/\$/g, '') }}</span></p>
          <footer v-if="confirming === row.id" class="board-confirm"><span>删除这段学习？</span><button type="button" class="text-action" @click="confirming = ''">取消</button><button type="button" class="frost-button danger" @click="remove(row)">删除</button></footer>
          <footer v-else><button type="button" class="frost-button primary" :disabled="!book.here" @click="open(row)">{{ row.phase === 'done' ? '回顾' : '接着学' }}</button></footer>
        </article>
      </div>
    </div>
    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @close="menu = null" />
  </section>
</template>

<style scoped>
/* 卡片用和文档库一样的料：主题的玻璃底、描边、圆角和字体。 */
.board{display:flex;flex-direction:column;gap:26px;padding:6px 2px 40px}
.board-empty{margin:60px auto;color:var(--muted);font-size:14px;text-align:center}
h2{display:flex;align-items:center;gap:8px;margin:0 0 12px;color:var(--secondary);font-size:14px;font-weight:650}
h2 span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
h2 small{color:var(--muted);font-size:12px;font-weight:400;font-variant-numeric:tabular-nums}
.board-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.board-card{display:flex;flex-direction:column;gap:10px;min-width:0;padding:16px 16px 14px;border:1px solid var(--glass-outline);border-radius:var(--r-lg);background-color:var(--glass-2);box-shadow:var(--shadow-pane),var(--glass-edge);transition:translate var(--dur-2) var(--spring-snappy),box-shadow var(--dur-2) var(--ease-soft)}
.board-card:hover{translate:0 -2px}
.board-card.gone{opacity:.6}
.board-card header{display:flex;align-items:center;gap:6px;min-width:0}
h3{flex:1;min-width:0;margin:0;overflow:hidden;font-size:15.5px;white-space:nowrap;text-overflow:ellipsis}
.board-card input{flex:1;min-width:0;height:26px;padding:0 6px;border:1px solid var(--accent);border-radius:var(--r-sm,8px);background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:15px;outline:0}
.board-more{display:grid;place-items:center;flex:none;width:26px;height:26px;padding:0;border:0;border-radius:var(--r-sm,8px);background:none;box-shadow:none;color:var(--muted);opacity:0;transition:opacity var(--dur-1) var(--ease-soft)}
.board-card:hover .board-more,.board-more:focus-visible{opacity:1}
.board-more:hover{background:var(--frost-hover,color-mix(in srgb,var(--ink) 8%,transparent));color:var(--ink)}
.board-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0;color:var(--muted);font-size:12px}
.board-way{padding:1px 7px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:6px;color:var(--accent)}
.board-steps{display:flex;gap:3px;margin-top:4px}
.board-steps i{flex:1;height:6px;border-radius:3px;background:var(--fill-2,color-mix(in srgb,var(--ink) 10%,transparent));transition:background var(--dur-2) var(--ease-soft)}
.board-steps i.on{background:var(--accent)}
.board-steps.none i{opacity:.5}
.board-now{display:flex;align-items:baseline;gap:8px;min-width:0;margin:0;color:var(--secondary);font-size:13px}
.board-now b{flex:none;color:var(--ink);font-size:14px;font-variant-numeric:tabular-nums}
.board-now span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.board-card.done .board-now b{color:var(--accent)}
.board-card footer{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:auto;padding-top:4px}
.frost-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--hairline);border-radius:var(--r-control);background:var(--frost);box-shadow:inset 0 1px 0 var(--glass-rim-soft);font-size:12px;font-weight:600;color:var(--ink)}
.frost-button:hover:not(:disabled){background:var(--frost-hover)}
.frost-button.primary{background:color-mix(in srgb,var(--accent) 82%,transparent);border-color:transparent;color:var(--accent-on,#fff)}
.frost-button.primary:hover:not(:disabled){background:var(--accent)}
.frost-button.danger{border-color:transparent;background:var(--danger,#c0392b);color:#fff}
.frost-button:disabled{opacity:.45}
.text-action{height:26px;padding:0 9px;border:0;border-radius:var(--r-control);background:none;box-shadow:none;color:var(--accent);font-size:12px;font-weight:600}
.text-action:hover:not(:disabled){background-color:color-mix(in srgb,var(--accent) 10%,transparent)}
.text-action:disabled{opacity:.45}
.board-confirm span{margin-right:auto;color:var(--secondary);font-size:13px}
</style>
