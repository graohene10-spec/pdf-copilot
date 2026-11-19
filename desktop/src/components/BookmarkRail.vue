<script setup lang="ts">
// 阅读区里的书签：每个书签是一枚小书签，上面是一小幅画，画风取自艺术史上的一个流派（library/bookmark-art.ts）。
// 每个书签都夹在它那一页的页边上，和书页在同一层：跟着书页滚，滚到工具栏下面就被挡住。
// 它不在视野里时，滚动条左边多一道刻度，颜色取自那幅画，高度和滚动条滑块走到那里时对齐；指到刻度上，那幅画会伸出来。
// 刻度都挂在一根贴着滚动条的发丝细线上，像尺子的刻度，不是飘在半空的短线。
// 挨得太近的互相让开，不叠在一起。
// 左键跳过去，右键命名、换画风、删除；在书签旁边的空白处按住左键拖动可以框选几个，一起删除或换画风。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { BookmarkArt } from '../library/bookmark-art'

type Mark = { id: string; name: string; ratio: number; hint: string; art: BookmarkArt }
type Place = { host: HTMLElement; scroller: HTMLElement; shift: number; top: number; left: number; width: number; height: number }
type Spot = { top: number; left: number; inward: boolean }
type Placed = { key: string; mark: Mark; top: number; page: boolean; left?: number; inward?: boolean }
const props = defineProps<{ marks: Mark[]; editing?: string | null; place?: (id: string) => Place | null }>()
const emit = defineEmits<{ jump: [id: string]; menu: [id: string, event: MouseEvent]; batch: [ids: string[], event: MouseEvent]; rename: [id: string, name: string]; remove: [id: string]; removeMany: [ids: string[]]; cancel: [] }>()
const layer = ref<HTMLElement>(), field = ref<HTMLInputElement[]>()
const draft = ref(''), paneHeight = ref(0)
const spots = reactive(new Map<string, Spot>()), away = reactive(new Set<string>()), picked = reactive(new Set<string>())
const host = shallowRef<HTMLElement | null>(null), sheet = ref({ width: 0, height: 0 })
let scroller: HTMLElement | null = null, shift = 0
const band = ref<{ left: number; top: number; width: number; height: number } | null>(null)

watch(() => props.editing, async id => {
  if (!id) return
  draft.value = props.marks.find(mark => mark.id === id)?.name || ''
  await nextTick()
  field.value?.[0]?.focus(); field.value?.[0]?.select()
})
function commit(id: string) { emit('rename', id, draft.value) }
function key(event: KeyboardEvent, id: string) {
  if (event.isComposing) return
  if (event.key === 'Enter') { event.preventDefault(); commit(id) }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('cancel') }
}

// ---- 书签在书页那一层里的位置 ----
// 书签记的是「当时窗口顶端」那一行；小书签画在它下面一点，刚加上、刚跳过去时正好露在工具栏下面。
const DROP = 36
// 刻度挂的那根线：贴着滚动条左边，和滚动区域一样高，所以刻度和滑块对得上。
const rail = ref({ top: 72, height: 0, right: 12 })
function relayout() {
  const seen = new Set<string>()
  let first: Place | null = null
  for (const mark of props.marks) {
    const at = props.place?.(mark.id)
    if (!at) continue
    first ||= at
    seen.add(mark.id)
    // 页边右面够宽就从页边伸出去；不够（页面比窗口还宽）就压在页面右缘里面。
    const inward = at.width - at.left < 50
    const next: Spot = { top: Math.round(at.top + DROP), left: Math.round(inward ? at.left - 46 : at.left - 5), inward }
    const old = spots.get(mark.id)
    if (!old || old.top !== next.top || old.left !== next.left || old.inward !== next.inward) spots.set(mark.id, next)
  }
  for (const id of [...spots.keys()]) if (!seen.has(id)) spots.delete(id)
  if (first) {
    if (host.value !== first.host) host.value = first.host
    scroller = first.scroller; shift = first.shift
    const box = layer.value?.getBoundingClientRect(), view = scroller.getBoundingClientRect()
    if (box) {
      const next = { top: Math.round(view.top - box.top), height: scroller.clientHeight, right: Math.max(4, Math.round(box.right - (view.left + scroller.clientLeft + scroller.clientWidth))) }
      if (next.top !== rail.value.top || next.height !== rail.value.height || next.right !== rail.value.right) rail.value = next
    }
    if (sheet.value.width !== first.width || sheet.value.height !== first.height) sheet.value = { width: first.width, height: first.height }
  } else if (!props.marks.length || !props.place) host.value = null
  rescan()
}
/* 滚动时只判断每个书签在不在视野里（不在的，右侧补一条细线）；位置不用动，书签本来就跟着书页滚。 */
function rescan() {
  const top = scroller?.scrollTop ?? 0, height = scroller?.clientHeight ?? 0
  for (const mark of props.marks) {
    const spot = spots.get(mark.id), y = spot ? spot.top + shift - top : -1
    const gone = !spot || y < 6 || y > height - 8
    if (gone !== away.has(mark.id)) { if (gone) away.add(mark.id); else away.delete(mark.id) }
  }
  for (const id of [...away]) if (!props.marks.some(mark => mark.id === id)) away.delete(id)
}
let frame = 0, timer: ReturnType<typeof setInterval> | undefined, resize: ResizeObserver | undefined
function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; rescan() }) }
watch(() => props.marks, () => void nextTick(relayout), { deep: false })

// 同一列里挨得太近的书签互相让开：先各就各位，从上往下推开；推出底边就从下往上再收一遍。放不下时间距缩小。
// 刻度占 5px，带画的小书签占 18px；两枚之间再留 3px。
const tall = (item: Placed) => item.page ? 18 : 5
function spread(list: Placed[], min: number, max: number) {
  list.sort((a, b) => a.top - b.top)
  if (list.length < 2) return
  const need = list.reduce((sum, item) => sum + tall(item) + 3, 0), squeeze = Math.min(1, Math.max(.2, (max - min) / need))
  const gap = (a: Placed, b: Placed) => ((tall(a) + tall(b)) / 2 + 3) * squeeze
  for (let index = 1; index < list.length; index++) list[index].top = Math.max(list[index].top, list[index - 1].top + gap(list[index - 1], list[index]))
  if (list[list.length - 1].top > max) {
    list[list.length - 1].top = max
    for (let index = list.length - 2; index >= 0; index--) list[index].top = Math.min(list[index].top, list[index + 1].top - gap(list[index], list[index + 1]))
  }
}
// 右侧的细线：只给不在视野里的书签。
const lines = computed(() => {
  const { top, height } = rail.value, span = height || Math.max(0, paneHeight.value - top - 22)
  const list: Placed[] = props.marks.filter(mark => away.has(mark.id) || !spots.has(mark.id)).map(mark => ({ key: mark.id, mark, top: top + mark.ratio * span, page: false }))
  spread(list, top + 4, top + span - 4)
  return list
})
// 书页上的小书签：每个书签一枚，一直在它那一页上。
const tabs = computed(() => {
  const list: Placed[] = []
  for (const mark of props.marks) { const spot = spots.get(mark.id); if (spot) list.push({ key: mark.id, mark, top: spot.top, left: spot.left, inward: spot.inward, page: true }) }
  spread(list, 12, Math.max(12, sheet.value.height - 12))
  return list
})

// ---- 选中与框选 ----
watch(() => props.marks, list => { for (const id of [...picked]) if (!list.some(mark => mark.id === id)) picked.delete(id) })
function click(mark: Mark, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey) { if (!picked.delete(mark.id)) picked.add(mark.id); layer.value?.focus({ preventScroll: true }); return }
  picked.clear()
  emit('jump', mark.id)
}
function menu(mark: Mark, event: MouseEvent) {
  if (picked.size > 1 && picked.has(mark.id)) emit('batch', [...picked], event)
  else { picked.clear(); emit('menu', mark.id, event) }
}
function remove(mark: Mark) {
  if (picked.size > 1 && picked.has(mark.id)) emit('removeMany', [...picked])
  else emit('remove', mark.id)
}
function layerKey(event: KeyboardEvent) {
  if (!picked.size || event.target !== layer.value) return
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); emit('removeMany', [...picked]) }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); picked.clear() }
}
let swallow = false
function paneDown(event: PointerEvent) {
  const box = layer.value?.getBoundingClientRect(), target = event.target as HTMLElement | null
  if (!box || event.button !== 0 || !target) return
  if (target.closest('.bookmark')) return
  // 书签旁边的空白：阅读区右缘一条，让开滚动条；底下是书页或别的控件时不算。
  const blank = props.marks.length > 0 && event.clientX >= box.right - 140 && event.clientX <= box.right - 12 && event.clientY >= box.top + 56
    && !target.closest('.page-slot, .markdown-paper, button, input, textarea, a, .explain-card, .reading-pill, .document-outline')
  if (!blank) { if (picked.size) picked.clear(); return }
  event.preventDefault(); event.stopPropagation(); swallow = true
  window.getSelection()?.removeAllRanges()
  const startX = event.clientX, startY = event.clientY, keep = event.ctrlKey || event.shiftKey ? new Set(picked) : new Set<string>()
  let moved = false
  const move = (now: PointerEvent) => {
    if (!moved && Math.hypot(now.clientX - startX, now.clientY - startY) < 4) return
    moved = true
    const left = Math.min(startX, now.clientX), top = Math.min(startY, now.clientY), width = Math.abs(now.clientX - startX), height = Math.abs(now.clientY - startY)
    band.value = { left, top, width, height }
    picked.clear()
    for (const id of keep) picked.add(id)
    for (const node of pane?.querySelectorAll<HTMLElement>('.bookmark[data-mark]') || []) {
      const rect = node.getBoundingClientRect()
      if (rect.left < left + width && rect.right > left && rect.top < top + height && rect.bottom > top) picked.add(node.dataset.mark!)
    }
  }
  const up = () => {
    document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true)
    band.value = null; swallow = false
    if (!moved) picked.clear()
    else if (picked.size) layer.value?.focus({ preventScroll: true })
  }
  document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true)
}
// 框选开始的那一下不让书页开始选字。
function paneMouseDown(event: MouseEvent) { if (swallow) { event.preventDefault(); event.stopPropagation() } }

let pane: HTMLElement | null = null
onMounted(() => {
  pane = layer.value?.parentElement || null
  pane?.addEventListener('scroll', schedule, true)
  pane?.addEventListener('pointerdown', paneDown, true)
  pane?.addEventListener('mousedown', paneMouseDown, true)
  resize = new ResizeObserver(() => { paneHeight.value = layer.value?.clientHeight || 0; relayout() })
  if (layer.value) resize.observe(layer.value)
  // 缩放、换页面视图会改变书页的位置，隔一会儿重新量一次。
  timer = setInterval(relayout, 600)
  relayout()
})
onBeforeUnmount(() => {
  pane?.removeEventListener('scroll', schedule, true); pane?.removeEventListener('pointerdown', paneDown, true); pane?.removeEventListener('mousedown', paneMouseDown, true)
  resize?.disconnect(); clearInterval(timer); cancelAnimationFrame(frame)
})
</script>

<template>
  <div ref="layer" class="bookmark-layer" tabindex="-1" aria-label="书签" @keydown="layerKey">
    <Transition name="bookmark-guide"><i v-if="lines.length" class="bookmark-guide" :style="{ top: `${rail.top + 6}px`, height: `${Math.max(0, (rail.height || paneHeight - rail.top - 22) - 12)}px`, right: `${rail.right}px` }" aria-hidden="true"></i></Transition>
    <TransitionGroup name="bookmark">
      <div v-for="item in lines" :key="item.key" class="bookmark" :class="{ picked: picked.has(item.mark.id) }" :data-mark="item.mark.id" :style="{ top: `${item.top}px`, right: `${rail.right}px` }">
        <button type="button" class="bookmark-hit" :aria-label="item.mark.name ? `书签：${item.mark.name}` : `书签 · ${item.mark.hint}`" :data-tip="`${item.mark.art.name} · ${item.mark.hint}`" @click="click(item.mark, $event)" @keydown.delete.prevent="remove(item.mark)" @contextmenu.prevent.stop="menu(item.mark, $event)">
          <span v-if="item.mark.name" class="bookmark-label">{{ item.mark.name }}</span>
          <i class="bookmark-line" :style="{ color: item.mark.art.tint }" aria-hidden="true"></i>
          <span class="bookmark-art" aria-hidden="true"><svg :key="item.mark.art.id" viewBox="0 0 96 40" preserveAspectRatio="xMaxYMid slice" v-html="item.mark.art.svg" /></span>
        </button>
      </div>
    </TransitionGroup>
    <i v-if="band" class="mark-band" :style="{ left: `${band.left}px`, top: `${band.top}px`, width: `${band.width}px`, height: `${band.height}px` }"></i>
    <!-- 小书签挂进书页所在的滚动内容里：和书页一层，跟着滚，被上面的工具栏挡住。 -->
    <Teleport v-if="host" :to="host">
      <div class="bookmark-sheet" :style="{ width: `${sheet.width}px`, height: `${sheet.height}px` }">
        <TransitionGroup name="bookmark-tab">
          <div v-for="item in tabs" :key="item.key" class="bookmark on-page" :class="{ named: item.mark.name, editing: editing === item.mark.id, picked: picked.has(item.mark.id), inward: item.inward }" :data-mark="item.mark.id" :style="{ top: `${item.top}px`, left: `${item.left}px` }">
            <input v-if="editing === item.mark.id" ref="field" v-model="draft" class="bookmark-field" maxlength="40" placeholder="给书签起个名字" aria-label="书签名称" @keydown="key($event, item.mark.id)" @blur="commit(item.mark.id)" />
            <button v-else type="button" class="bookmark-hit" :aria-label="item.mark.name ? `书签：${item.mark.name}` : `书签 · ${item.mark.hint}`" :data-tip="`${item.mark.art.name} · ${item.mark.hint}`" @click="click(item.mark, $event)" @keydown.delete.prevent="remove(item.mark)" @contextmenu.prevent.stop="menu(item.mark, $event)">
              <span class="bookmark-art" aria-hidden="true"><svg :key="item.mark.art.id" viewBox="0 0 96 40" preserveAspectRatio="xMinYMid slice" v-html="item.mark.art.svg" /></span>
              <span v-if="item.mark.name" class="bookmark-label">{{ item.mark.name }}</span>
            </button>
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 细线那一层盖在阅读区上，本身不挡鼠标，只有细线可以点。 */
.bookmark-layer{position:absolute;inset:0;z-index:8;pointer-events:none;outline:none}
.bookmark{position:absolute;right:12px;display:flex;justify-content:flex-end;transform:translateY(-50%);pointer-events:auto;transition:top var(--dur-3) var(--ease-out)}
.bookmark:hover,.bookmark:focus-within{z-index:2}
.bookmark-hit{display:flex;align-items:center;gap:7px;padding:0;border:0;background:none;box-shadow:none;cursor:pointer}
.bookmark-hit:focus-visible{outline:none}
.bookmark-art{display:block;border-radius:2px;filter:drop-shadow(0 1px 2px rgb(0 0 0 / .42)) drop-shadow(0 0 3px rgb(255 255 255 / .5))}
.bookmark-art svg{display:block;width:100%;height:100%}

/* 贴着滚动条的那根发丝线：两头淡出。 */
.bookmark-guide{position:absolute;width:1px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--ink) 20%,transparent) 18px,color-mix(in srgb,var(--ink) 20%,transparent) calc(100% - 18px),transparent)}
.bookmark-guide-enter-active,.bookmark-guide-leave-active{transition:opacity var(--dur-3) var(--ease-out)}
.bookmark-guide-enter-from,.bookmark-guide-leave-to{opacity:0}
/* 不在视野里的书签：线上的一道刻度，一头搭在线上，另一头是个小圆点，颜色取自那幅画；指上去刻度变长，画从左边伸出来。 */
.bookmark:not(.on-page) .bookmark-hit{position:relative;height:10px;gap:0}
.bookmark-line{position:relative;display:block;width:11px;height:1.5px;border-radius:1px;background:currentColor;color:var(--accent);transition:width var(--dur-2) var(--ease-out)}
.bookmark-line::before{content:'';position:absolute;left:-2px;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:currentColor;box-shadow:0 0 0 1.5px var(--canvas,#fff)}
.bookmark:not(.on-page) .bookmark-hit:hover .bookmark-line,.bookmark:not(.on-page) .bookmark-hit:focus-visible .bookmark-line,.bookmark.picked .bookmark-line{width:18px}
.bookmark:not(.on-page) .bookmark-art{position:absolute;right:28px;top:50%;width:96px;height:40px;opacity:0;translate:10px -50%;scale:.9;transform-origin:100% 50%;pointer-events:none;transition:opacity var(--dur-2) var(--ease-out),translate var(--dur-3) var(--ease-out),scale var(--dur-3) var(--ease-out)}
.bookmark:not(.on-page) .bookmark-art svg{clip-path:polygon(0 0,100% 0,100% 100%,0 100%,9px 50%);border-radius:0 2px 2px 0}
.bookmark:not(.on-page) .bookmark-hit:hover .bookmark-art,.bookmark:not(.on-page) .bookmark-hit:focus-visible .bookmark-art{opacity:1;translate:0 -50%;scale:1}
.bookmark:not(.on-page) .bookmark-label{position:absolute;right:132px;top:50%;translate:0 -50%;opacity:0;pointer-events:none;transition:opacity var(--dur-2) var(--ease-out)}
.bookmark:not(.on-page) .bookmark-hit:hover .bookmark-label{opacity:1}
.bookmark.picked:not(.on-page) .bookmark-line::before{box-shadow:0 0 0 1.5px var(--canvas,#fff),0 0 0 3px var(--accent)}

/* 书页上的小书签：整张「纸」和滚动内容一样大，只是垫在上面，不挡鼠标、也不把滚动范围撑大。 */
.bookmark-sheet{position:absolute;left:0;top:0;z-index:3;overflow:clip;pointer-events:none}
.bookmark.on-page{right:auto;justify-content:flex-start;transition:none}
.bookmark.on-page .bookmark-art{width:44px;height:18px;transition:width var(--dur-3) var(--ease-out),height var(--dur-3) var(--ease-out)}
/* 平的一头压在纸上，燕尾朝外。 */
.bookmark.on-page .bookmark-art svg{clip-path:polygon(0 0,100% 0,calc(100% - 7px) 50%,100% 100%,0 100%);border-radius:2px 0 0 2px}
.bookmark.on-page .bookmark-hit:hover .bookmark-art,.bookmark.on-page .bookmark-hit:focus-visible .bookmark-art{width:96px;height:40px}
.bookmark.on-page .bookmark-hit:hover .bookmark-art svg,.bookmark.on-page .bookmark-hit:focus-visible .bookmark-art svg{clip-path:polygon(0 0,100% 0,calc(100% - 10px) 50%,100% 100%,0 100%)}
/* 页面比窗口还宽时压在页面右缘里面：指上去不再变宽，免得伸出去被裁掉。 */
.bookmark.on-page.inward .bookmark-hit:hover .bookmark-art,.bookmark.on-page.inward .bookmark-hit:focus-visible .bookmark-art{width:44px;height:18px}
.bookmark.picked.on-page .bookmark-art{outline:2px solid var(--accent);outline-offset:2px}
:root[data-style='sketch'] .bookmark.picked.on-page .bookmark-art{outline:1.6px dashed var(--red-pencil,#c0392b)}
.bookmark-label{max-width:150px;height:20px;padding:0 8px;overflow:hidden;border:1px solid rgb(20 24 30 / .26);border-radius:999px;background:rgb(255 255 255 / .86);box-shadow:0 1px 5px rgb(0 0 0 / .28);color:#1d2128;font:600 11px/18px var(--font-ui);white-space:nowrap;text-overflow:ellipsis}
.bookmark-field{width:150px;height:26px;padding:0 9px;border:1px solid rgb(20 24 30 / .3);border-radius:999px;background:var(--surface);color:var(--surface-ink);box-shadow:0 0 12px 1px rgb(255 255 255 / .55),0 8px 20px -10px rgb(0 0 0 / .35);font:12px var(--font-ui);outline:none}

.bookmark-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-3) var(--ease-out)}
.bookmark-leave-active{transition:opacity var(--dur-1) var(--ease-out),transform var(--dur-2) var(--ease-out)}
.bookmark-enter-from,.bookmark-leave-to{opacity:0;transform:translate(14px,-50%)}
.bookmark-tab-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-bouncy)}
.bookmark-tab-leave-active{transition:opacity var(--dur-2) var(--ease-out)}
.bookmark-tab-enter-from{opacity:0;transform:translate(-16px,-50%)}
.bookmark-tab-leave-to{opacity:0}
@media(prefers-reduced-motion:reduce){.bookmark,.bookmark-enter-active,.bookmark-leave-active,.bookmark-tab-enter-active,.bookmark-art,.bookmark-line{transition:none}}
</style>
