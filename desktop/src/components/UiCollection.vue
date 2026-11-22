<script setup lang="ts">
import { hintLearned, offerSpaced } from '../ui/hints'
offerSpaced('collection-pick', ['拖动'], '框选，Delete 删除')
// Intelligent UI 合集：文档库里的一个分类（和「我的收藏」并列），钉住的 PDF 卡片、记入文档的 Markdown 释义里带界面的那些，按书归在一起。
// 每一个都照样能操作；点页码跳回原处；单击标题选中（Ctrl / Shift 多选），在空白处按住左键拖出框也能选，Delete 删除。
// 删除是真删：文档里那张卡片 / 那条释义也一起没了。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import ExplainBody from './ExplainBody.vue'
import { removeUiEntries, uiEntries, uiReady, uiVersion, type Explain, type UiEntry } from '../ai/explain'

const props = defineProps<{ documents: { id: string; name: string; kind: string }[]; query?: string }>()
const emit = defineEmits<{ jump: [entry: UiEntry] }>()

const entries = ref<UiEntry[]>([])
const load = () => { entries.value = uiEntries() }
void uiReady.then(load)
watch(uiVersion, load)

const key = (entry: UiEntry) => `${entry.kind}:${entry.id}`
// 每个界面用一份「已经写完」的解释来画（同一份对象反复用，界面里拖过的参数不会因为刷新而重来）。
const items = new Map<string, Explain>()
function itemOf(entry: UiEntry) {
  let item = items.get(key(entry))
  if (!item || item.text !== entry.text) { item = reactive<Explain>({ id: entry.id, term: entry.term, context: '', mode: 'visual', text: entry.text, reasoning: '', status: 'done', error: '', startedAt: 0, ms: 0 }); items.set(key(entry), item) }
  return item
}
const name = (doc: string) => props.documents.find(item => item.id === doc)?.name.replace(/\.(pdf|md|markdown)$/i, '') || '已移除的文档'
// 文档库的搜索框也管这里：按词条、书名、内容筛。
const shown = computed(() => {
  const needle = (props.query || '').trim().toLowerCase()
  return needle ? entries.value.filter(entry => `${entry.term}\n${name(entry.doc)}\n${entry.text}`.toLowerCase().includes(needle)) : entries.value
})
const groups = computed(() => {
  const byDoc = new Map<string, UiEntry[]>()
  for (const entry of shown.value) byDoc.set(entry.doc, [...(byDoc.get(entry.doc) || []), entry])
  return [...byDoc.entries()].map(([doc, list]) => ({ doc, name: name(doc), list: list.sort((a, b) => (a.page ?? a.line ?? 0) - (b.page ?? b.line ?? 0)) }))
})
const where = (entry: UiEntry) => entry.kind === 'card' ? (entry.page ? `第 ${entry.page} 页` : '') : `第 ${entry.line} 行`

// ---- 选中与删除 ----
const selected = ref(new Set<string>())
let anchor = ''
function pick(entry: UiEntry, event: MouseEvent) {
  // 选中后 Delete 要能用：焦点可能还停在搜索框里。
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  const id = key(entry), next = new Set(event.ctrlKey || event.metaKey ? selected.value : [])
  if (event.shiftKey && anchor) {
    const flat = groups.value.flatMap(group => group.list.map(key)), a = flat.indexOf(anchor), b = flat.indexOf(id)
    for (const item of flat.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(item)
  } else if ((event.ctrlKey || event.metaKey) && next.has(id)) next.delete(id)
  else next.add(id)
  anchor = id; selected.value = next
}
const confirming = ref<UiEntry[] | null>(null)
function askRemove(list: UiEntry[]) { if (list.length) confirming.value = list }
function remove() {
  if (!confirming.value) return
  removeUiEntries(confirming.value)
  hintLearned('collection-pick')
  const gone = new Set(confirming.value.map(key))
  selected.value = new Set([...selected.value].filter(id => !gone.has(id)))
  confirming.value = null
  load()
}
const chosen = () => shown.value.filter(entry => selected.value.has(key(entry)))

// 在空白处按住左键拖出一个框：框到的都选上（按住 Ctrl 是加选）。
const list = ref<HTMLElement>()
const band = ref<{ left: number; top: number; width: number; height: number } | null>(null)
function startBand(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('.ui-item, button, input, select, textarea')) return
  // 坐标都相对合集这一块自己（文档库整页会滚动，每次按当时的位置换算）。
  const host = list.value!, at = (e: PointerEvent) => { const origin = host.getBoundingClientRect(); return [e.clientX - origin.left, e.clientY - origin.top] }
  const [startX, startY] = at(event)
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  const keep = event.ctrlKey || event.metaKey ? new Set(selected.value) : new Set<string>()
  host.setPointerCapture(event.pointerId); event.preventDefault()
  const move = (next: PointerEvent) => {
    const [x, y] = at(next), origin = host.getBoundingClientRect()
    band.value = { left: Math.min(x, startX!), top: Math.min(y!, startY!), width: Math.abs(x! - startX!), height: Math.abs(y! - startY!) }
    const hit = new Set(keep)
    for (const element of host.querySelectorAll<HTMLElement>('.ui-item')) {
      const r = element.getBoundingClientRect(), left = r.left - origin.left, top = r.top - origin.top
      const b = band.value
      if (left < b.left + b.width && left + r.width > b.left && top < b.top + b.height && top + r.height > b.top) hit.add(element.dataset.key!)
    }
    selected.value = hit
  }
  const end = () => { band.value = null; host.removeEventListener('pointermove', move) }
  host.addEventListener('pointermove', move); host.addEventListener('pointerup', end, { once: true }); host.addEventListener('pointercancel', end, { once: true })
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { if (confirming.value) { confirming.value = null; event.stopPropagation() } else if (selected.value.size) { selected.value = new Set(); event.stopPropagation() } return }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selected.value.size && !(event.target as HTMLElement).closest('input, textarea, select')) { askRemove(chosen()); event.preventDefault() }
  if (event.key === 'Enter' && confirming.value) { remove(); event.preventDefault() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !(event.target as HTMLElement).closest('input, textarea')) { selected.value = new Set(shown.value.map(key)); event.preventDefault() }
}
onMounted(() => document.addEventListener('keydown', keydown, true))
onBeforeUnmount(() => document.removeEventListener('keydown', keydown, true))
</script>

<template>
  <div class="ui-collection">
    <div class="uc-bar">
      <span class="uc-hint"></span>
      <button v-if="selected.size" type="button" class="uc-remove" @click="askRemove(chosen())"><AppIcon name="trash" :size="14" />删除所选 {{ selected.size }}</button>
    </div>
    <Transition name="uc-confirm"><div v-if="confirming" class="uc-confirm" role="alertdialog">
      <span>删除 {{ confirming.length }} 个？文档里对应的卡片 / 释义也会一起删掉。</span>
      <button type="button" class="uc-danger" @click="remove">删除</button><button type="button" @click="confirming = null">取消</button>
    </div></Transition>
    <div ref="list" class="uc-list" @pointerdown.stop="startBand">
      <p v-if="!shown.length" class="uc-empty">{{ query ? `没有和「${query}」相关的 Intelligent UI。` : '还没有。' }}</p>
      <section v-for="group in groups" :key="group.doc" class="uc-group">
        <h3><AppIcon name="book" :size="14" />{{ group.name }}<span>{{ group.list.length }}</span></h3>
        <TransitionGroup tag="div" class="uc-grid" name="uc-item" appear>
          <article v-for="(entry, index) in group.list" :key="key(entry)" class="ui-item" :style="{ '--i': Math.min(index, 8) }" :class="{ selected: selected.has(key(entry)) }" :data-key="key(entry)">
            <header class="ui-item-head" @click="pick(entry, $event)">
              <span class="ui-item-term">{{ entry.term }}</span>
              <button type="button" class="ui-item-where" :data-tip="`跳到《${group.name}》${where(entry)}`" @click.stop="emit('jump', entry)">{{ where(entry) || '打开' }}<AppIcon name="arrow-up" :size="11" /></button>
              <button type="button" class="ui-item-drop" aria-label="删除" data-tip="删除（文档里的也会删掉）" @click.stop="askRemove([entry])"><AppIcon name="trash" :size="13" /></button>
            </header>
            <ExplainBody :item="itemOf(entry)" />
          </article>
        </TransitionGroup>
      </section>
      <i v-if="band" class="uc-band" :style="{ left: `${band.left}px`, top: `${band.top}px`, width: `${band.width}px`, height: `${band.height}px` }"></i>
    </div>
  </div>
</template>

<style>
.ui-collection{display:flex;flex-direction:column;margin-top:14px;min-height:0}
.uc-bar{display:flex;align-items:center;gap:12px;min-height:30px}
.uc-hint{flex:1;color:var(--muted);font-size:12px}
.uc-remove{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;color:var(--danger)}
.uc-confirm{display:flex;align-items:center;gap:10px;margin-top:8px;padding:10px 16px;border-radius:12px;background:color-mix(in srgb,var(--danger) 9%,transparent);font-size:13px}
.uc-confirm span{flex:1}
.uc-confirm-enter-active,.uc-confirm-leave-active{transition:opacity var(--dur-2,.18s) var(--ease-out,ease),transform var(--dur-3,.26s) var(--ease-out,ease)}
.uc-confirm-enter-from,.uc-confirm-leave-to{opacity:0;transform:translateY(-6px)}
/* 进来：一张张浮上来；删掉：缩一点淡出，剩下的滑过去补位。 */
.uc-item-enter-active{transition:opacity .34s var(--ease-out,ease),transform .42s var(--ease-out,ease);transition-delay:calc(var(--i,0)*45ms)}
.uc-item-enter-from{opacity:0;transform:translateY(12px)}
.uc-item-leave-active{transition:opacity .2s ease,transform .24s ease}
.uc-item-leave-to{opacity:0;transform:scale(.96)}
.uc-item-move{transition:transform .36s var(--ease-out,ease)}
.uc-group h3{animation:uc-head .4s var(--ease-out,ease) both}
@keyframes uc-head{from{opacity:0;transform:translateX(-6px)}}
@media (prefers-reduced-motion:reduce){.uc-item-enter-active,.uc-item-leave-active,.uc-item-move,.uc-confirm-enter-active,.uc-confirm-leave-active{transition:none}.uc-group h3{animation:none}}
.uc-confirm button{height:28px;padding:0 14px;border-radius:999px}
.uc-confirm .uc-danger{background:var(--danger);color:#fff;border-color:transparent}
.uc-list{position:relative;min-height:calc(100vh - 260px);padding:0 0 28px;user-select:none}
.uc-list .ex-text{user-select:text}
.uc-empty{margin:60px auto;max-width:420px;text-align:center;color:var(--surface-muted,var(--muted));font-size:13px;line-height:1.7}
.uc-group h3{display:flex;align-items:center;gap:8px;margin:18px 0 10px;font-size:14px;font-weight:650}
.uc-group h3 span{color:var(--surface-muted,var(--muted));font-size:12px;font-weight:500}
.uc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px;align-items:start}
.ui-item{min-width:0;padding:10px 14px 14px;border:1px solid var(--line-soft,var(--hairline));border-radius:var(--r-lg,16px);background:var(--surface);color:var(--surface-ink,var(--ink));box-shadow:0 10px 26px -20px rgb(0 0 0 / .35);transition:border-color .15s,box-shadow .15s}
.ui-item.selected{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent),0 0 18px -4px color-mix(in srgb,var(--accent) 45%,transparent)}
/* 铅笔草稿：一张张贴在方格纸上的纸片，铅笔描边、略歪一点；图自己不再套一层框。 */
:root[data-style='sketch'] .ui-item{border:1.4px solid color-mix(in srgb,var(--pencil,#2b2a27) 72%,transparent);border-radius:7px 12px 8px 13px/12px 7px 13px 8px;box-shadow:2px 3px 0 color-mix(in srgb,var(--pencil,#2b2a27) 12%,transparent)}
:root[data-style='sketch'] .ui-item-head{border-bottom:1.2px dashed color-mix(in srgb,var(--pencil,#2b2a27) 34%,transparent)}
.ui-item .iui>.iui-card:only-child{padding:6px 0 0;border:0;background:none}
:root[data-style='sketch'] .ui-item.selected{border-color:var(--red-pencil,#c0392b);box-shadow:0 0 0 2px color-mix(in srgb,var(--red-pencil,#c0392b) 22%,transparent)}
.ui-item-head{display:flex;align-items:center;gap:8px;margin:0 0 6px;padding:2px 0 6px;border-bottom:1px solid var(--line-soft,var(--hairline));cursor:pointer}
.ui-item-term{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px;font-weight:600}
.ui-item-where{display:inline-flex;align-items:center;gap:3px;height:24px;padding:0 9px;border-radius:999px;font-size:11.5px;color:var(--accent)}
.ui-item-where svg{rotate:45deg}
.ui-item-drop{width:26px;height:24px;padding:0;border-radius:999px;opacity:.55}
.ui-item-drop:hover{opacity:1;color:var(--danger)}
.uc-band{position:absolute;z-index:3;border:1px solid var(--accent);border-radius:6px;background:color-mix(in srgb,var(--accent) 10%,transparent);box-shadow:0 0 14px -2px color-mix(in srgb,var(--accent) 45%,transparent);pointer-events:none}
</style>
