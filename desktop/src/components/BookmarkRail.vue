<script setup lang="ts">
// 阅读区里的书签：每个书签是一枚小书签，上面是一小幅画，画风取自艺术史上的一个流派（library/bookmark-art.ts）。
// 书签所在的位置看得见时，它夹在那一页的页边上，跟着书页走；翻走以后右侧只留一条细线，颜色取自那幅画，位置对应它在整本书里的地方。
// 指到细线上，那幅画会伸出来。挨得太近的互相让开，不叠在一起。
// 左键跳过去，右键命名、换画风、删除；在书签旁边的空白处按住左键拖动可以框选几个，一起删除或换画风。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { BookmarkArt } from '../library/bookmark-art'

type Mark = { id: string; name: string; ratio: number; hint: string; art: BookmarkArt }
type Spot = { top: number; left?: number }
type Placed = { key: string; mark: Mark; top: number; page: boolean; left?: number }
const props = defineProps<{ marks: Mark[]; editing?: string | null; spot?: (id: string) => { x: number; y: number } | null }>()
const emit = defineEmits<{ jump: [id: string]; menu: [id: string, event: MouseEvent]; batch: [ids: string[], event: MouseEvent]; rename: [id: string, name: string]; remove: [id: string]; removeMany: [ids: string[]]; cancel: [] }>()
const layer = ref<HTMLElement>(), field = ref<HTMLInputElement[]>()
const draft = ref(''), paneHeight = ref(0)
const spots = reactive(new Map<string, Spot>()), picked = reactive(new Set<string>())
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

// ---- 哪些书签现在夹在页边上 ----
const TOP = 84, RAIL_TOP = 72, RAIL_BOTTOM = 22
function measure() {
  const box = layer.value?.getBoundingClientRect()
  if (!box || !props.spot) { spots.clear(); return }
  const seen = new Set<string>()
  for (const mark of props.marks) {
    const at = props.spot(mark.id)
    if (!at) continue
    seen.add(mark.id)
    const room = box.right - at.x, top = Math.round(Math.max(TOP, Math.min(box.height - 34, at.y - box.top)))
    // 页边右面够宽就从页边伸出去；不够（页面铺满了）就压在页面右缘上。
    // 页边右面够宽就从页边伸出去；不够（页面快铺满了）就留在右侧那一列里，跟着书页上下走。
    const next: Spot = room >= 112 ? { top, left: Math.round(at.x - box.left - 5) } : { top }
    const old = spots.get(mark.id)
    if (!old || old.top !== next.top || old.left !== next.left) spots.set(mark.id, next)
  }
  for (const id of [...spots.keys()]) if (!seen.has(id)) spots.delete(id)
}
let frame = 0, timer: ReturnType<typeof setInterval> | undefined, resize: ResizeObserver | undefined
function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure() }) }
watch(() => props.marks, schedule, { deep: false })

// 同一列里挨得太近的书签互相让开：先各就各位，从上往下推开；推出底边就从下往上再收一遍。放不下时间距缩小。
// 细线占 4px，带画的小书签占 18px；两枚之间再留 3px。
const tall = (item: Placed) => item.page ? 18 : 4
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
const placed = computed(() => {
  const height = paneHeight.value, span = Math.max(0, height - RAIL_TOP - RAIL_BOTTOM)
  const column: Placed[] = [], outside: Placed[] = []
  for (const mark of props.marks) {
    const spot = spots.get(mark.id)
    if (!spot) column.push({ key: `${mark.id}:rail`, mark, top: RAIL_TOP + mark.ratio * span, page: false })
    else if (spot.left === undefined) column.push({ key: `${mark.id}:page`, mark, top: spot.top, page: true })
    else outside.push({ key: `${mark.id}:page`, mark, top: spot.top, page: true, left: spot.left })
  }
  spread(column, RAIL_TOP, height - RAIL_BOTTOM)
  spread(outside, TOP, height - 34)
  return [...column, ...outside]
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
    for (const node of layer.value?.querySelectorAll<HTMLElement>('.bookmark[data-mark]') || []) {
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
  resize = new ResizeObserver(() => { paneHeight.value = layer.value?.clientHeight || 0; schedule() })
  if (layer.value) resize.observe(layer.value)
  // 缩放、换页面视图不一定带来滚动事件，隔一会儿对一次。
  timer = setInterval(schedule, 600)
  schedule()
})
onBeforeUnmount(() => {
  pane?.removeEventListener('scroll', schedule, true); pane?.removeEventListener('pointerdown', paneDown, true); pane?.removeEventListener('mousedown', paneMouseDown, true)
  resize?.disconnect(); clearInterval(timer); cancelAnimationFrame(frame)
})
</script>

<template>
  <div ref="layer" class="bookmark-layer" tabindex="-1" aria-label="书签" @keydown="layerKey">
    <TransitionGroup name="bookmark">
      <div v-for="item in placed" :key="item.key" class="bookmark" :class="{ named: item.mark.name, editing: editing === item.mark.id, picked: picked.has(item.mark.id), 'on-page': item.page, outward: item.left !== undefined }" :data-mark="item.mark.id" :style="{ top: `${item.top}px`, left: item.left === undefined ? undefined : `${item.left}px` }">
        <input v-if="editing === item.mark.id" ref="field" v-model="draft" class="bookmark-field" maxlength="40" placeholder="给书签起个名字" aria-label="书签名称" @keydown="key($event, item.mark.id)" @blur="commit(item.mark.id)" />
        <button v-else type="button" class="bookmark-hit" :aria-label="item.mark.name ? `书签：${item.mark.name}` : `书签 · ${item.mark.hint}`" :data-tip="`${item.mark.art.name} · ${item.mark.hint}`" @click="click(item.mark, $event)" @keydown.delete.prevent="remove(item.mark)" @contextmenu.prevent.stop="menu(item.mark, $event)">
          <span v-if="item.mark.name" class="bookmark-label">{{ item.mark.name }}</span>
          <i v-if="!item.page" class="bookmark-line" :style="{ background: item.mark.art.tint }" aria-hidden="true"></i>
          <span class="bookmark-art" aria-hidden="true"><svg :key="item.mark.art.id" viewBox="0 0 96 40" :preserveAspectRatio="item.left === undefined ? 'xMaxYMid slice' : 'xMinYMid slice'" v-html="item.mark.art.svg" /></span>
        </button>
      </div>
    </TransitionGroup>
    <i v-if="band" class="mark-band" :style="{ left: `${band.left}px`, top: `${band.top}px`, width: `${band.width}px`, height: `${band.height}px` }"></i>
  </div>
</template>

<style scoped>
/* 整层盖在阅读区上，本身不挡鼠标，只有书签可以点。 */
.bookmark-layer{position:absolute;inset:0;z-index:8;pointer-events:none;outline:none}
/* 默认贴着阅读区右边一列、让开滚动条一段距离；夹在页边上的（outward）用 left 定位，从页边伸出去。 */
.bookmark{position:absolute;right:14px;display:flex;justify-content:flex-end;transform:translateY(-50%);pointer-events:auto;transition:top var(--dur-3) var(--ease-out)}
.bookmark.on-page{transition:none}
.bookmark.outward{right:auto;justify-content:flex-start}
.bookmark.outward .bookmark-hit{flex-direction:row-reverse}
/* 翻走的书签：右侧一条细线，颜色取自那幅画；指上去线变长，画从左边伸出来。 */
.bookmark:not(.on-page) .bookmark-hit{position:relative;height:10px;gap:0}
.bookmark-line{display:block;width:18px;height:2px;border-radius:1px;background:var(--accent);box-shadow:0 0 0 .5px rgb(255 255 255 / .55),0 1px 2px rgb(0 0 0 / .28);transition:width var(--dur-2) var(--ease-out),height var(--dur-2) var(--ease-out)}
.bookmark:not(.on-page) .bookmark-hit:hover .bookmark-line,.bookmark:not(.on-page) .bookmark-hit:focus-visible .bookmark-line,.bookmark.picked .bookmark-line{width:26px;height:3px}
.bookmark:not(.on-page) .bookmark-art{position:absolute;right:32px;top:50%;width:96px;height:40px;opacity:0;translate:10px -50%;scale:.9;transform-origin:100% 50%;pointer-events:none;transition:opacity var(--dur-2) var(--ease-out),translate var(--dur-3) var(--ease-out),scale var(--dur-3) var(--ease-out)}
.bookmark:not(.on-page) .bookmark-art svg{clip-path:polygon(0 0,100% 0,100% 100%,0 100%,9px 50%)}
.bookmark:not(.on-page) .bookmark-hit:hover .bookmark-art,.bookmark:not(.on-page) .bookmark-hit:focus-visible .bookmark-art{opacity:1;translate:0 -50%;scale:1}
.bookmark:not(.on-page) .bookmark-label{position:absolute;right:32px;top:50%;translate:0 -50%;opacity:0;pointer-events:none;transition:opacity var(--dur-2) var(--ease-out)}
.bookmark:not(.on-page) .bookmark-hit:hover .bookmark-label{right:136px;opacity:1}
.bookmark.picked:not(.on-page) .bookmark-line{box-shadow:0 0 0 2px var(--surface,#fff),0 0 0 3.5px var(--accent)}
.bookmark:hover,.bookmark:focus-within{z-index:2}
.bookmark-hit{display:flex;align-items:center;gap:7px;padding:0;border:0;background:none;box-shadow:none;cursor:pointer}
.bookmark-hit:focus-visible{outline:none}
/* 一枚小书签：一端剪出燕尾。压在白纸上、也可能压在深色底图上，所以带一圈投影和一圈浅色光晕，哪种底色上都看得清。 */
.bookmark-art{display:block;width:34px;height:15px;border-radius:2px;filter:drop-shadow(0 1px 2px rgb(0 0 0 / .42)) drop-shadow(0 0 3px rgb(255 255 255 / .5));transition:width var(--dur-3) var(--ease-out),height var(--dur-3) var(--ease-out)}
.bookmark-art svg{display:block;width:100%;height:100%;clip-path:polygon(0 0,100% 0,100% 100%,0 100%,6px 50%);border-radius:0 2px 2px 0}
.bookmark-hit:hover .bookmark-art,.bookmark-hit:focus-visible .bookmark-art{width:96px;height:40px}
.bookmark-hit:hover .bookmark-art svg,.bookmark-hit:focus-visible .bookmark-art svg{clip-path:polygon(0 0,100% 0,100% 100%,0 100%,9px 50%)}
/* 跟着书页走的稍大一点；夹在页边上的平的一头压在纸上，燕尾朝外。 */
.on-page .bookmark-art{width:44px;height:18px}
.outward .bookmark-art svg{clip-path:polygon(0 0,100% 0,calc(100% - 7px) 50%,100% 100%,0 100%);border-radius:2px 0 0 2px}
.outward .bookmark-hit:hover .bookmark-art svg,.outward .bookmark-hit:focus-visible .bookmark-art svg{clip-path:polygon(0 0,100% 0,calc(100% - 10px) 50%,100% 100%,0 100%)}
.bookmark.picked .bookmark-art{outline:2px solid var(--accent);outline-offset:2px}
:root[data-style='sketch'] .bookmark.picked .bookmark-art{outline:1.6px dashed var(--red-pencil,#c0392b)}
.bookmark-label{max-width:150px;height:20px;padding:0 8px;overflow:hidden;border:1px solid rgb(20 24 30 / .26);border-radius:999px;background:rgb(255 255 255 / .86);-webkit-backdrop-filter:blur(10px) saturate(1.6);backdrop-filter:blur(10px) saturate(1.6);box-shadow:0 1px 5px rgb(0 0 0 / .28);color:#1d2128;font:600 11px/18px var(--font-ui);white-space:nowrap;text-overflow:ellipsis}
.bookmark-field{width:150px;height:26px;padding:0 9px;border:1px solid rgb(20 24 30 / .3);border-radius:999px;background:var(--surface);color:var(--surface-ink);box-shadow:0 0 12px 1px rgb(255 255 255 / .55),0 8px 20px -10px rgb(0 0 0 / .35);font:12px var(--font-ui);outline:none}
.bookmark-enter-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-bounce) var(--spring-bouncy)}
.bookmark-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-2) var(--ease-out)}
.bookmark-enter-from,.bookmark-leave-to{opacity:0;transform:translate(24px,-50%)}
.bookmark.outward.bookmark-enter-from{transform:translate(-14px,-50%)}
.bookmark.on-page.bookmark-leave-active{transition:opacity var(--dur-1) var(--ease-out)}
.bookmark.on-page.bookmark-leave-to{transform:translateY(-50%)}
@media(prefers-reduced-motion:reduce){.bookmark,.bookmark-enter-active,.bookmark-leave-active,.bookmark-art{transition:none}}
</style>
