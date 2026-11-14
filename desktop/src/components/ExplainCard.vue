<script setup lang="ts">
// PDF 里的解释卡片：出现在鼠标旁。没钉住时点别处就消失；按下图钉后留在原处，默认跟着书页走，
// 可以拖到别的地方，也可以改成停在屏幕上不动。拔下图钉后再点别处才消失。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import 'katex/dist/katex.min.css'
import { renderMarkdown } from '../ai/render'
import AppIcon from './AppIcon.vue'
import ExplainBody from './ExplainBody.vue'
import { rerunExplain, type ExplainCardState } from '../ai/explain'

const props = defineProps<{ card: ExplainCardState }>()
const emit = defineEmits<{ close: [] }>()
const box = ref<HTMLElement>()
const place = ref(props.card.pinned && props.card.screen ? { ...props.card.screen } : { left: props.card.x, top: props.card.y })
const dragging = ref(false)
// 从翻译卡片变过来：先显示译文，挂上去之后换成解释。
const showFrom = ref(Boolean(props.card.from))
const following = computed(() => props.card.pinned && props.card.follow === 'page' && Boolean(props.card.anchor))
// 钉在书页上的位置：相对那一页左上角的比例，翻页、缩放后还在原来的字旁边。
const relative = () => props.card.rel || { x: 0, y: 0 }
function settle() {
  const element = box.value
  if (!element || props.card.pinned) return
  const width = element.offsetWidth, height = element.offsetHeight, gap = 14
  let left = props.card.x + gap, top = props.card.y + gap
  if (left + width > innerWidth - 8) left = Math.max(8, props.card.x - gap - width)
  if (top + height > innerHeight - 8) top = Math.max(8, props.card.y - gap - height)
  place.value = { left, top }
}
function remember() {
  const rect = props.card.anchor?.getBoundingClientRect()
  if (rect?.width) props.card.rel = { x: (place.value.left - rect.left) / rect.width, y: (place.value.top - rect.top) / rect.height }
}
// 跟着书页走时，卡片就放进书页的滚动层里（和页面同一层）：滚动、缩放由浏览器带着走，完全跟手，
// 也会被工具栏、别的栏目正常遮住。位置按那一页的比例换算，页面尺寸变了（缩放、重排）再算一次。
const host = computed(() => following.value ? props.card.anchor!.closest<HTMLElement>('.pdf-scroll') : null)
const inPage = ref({ left: 0, top: 0 })
function locate() {
  const anchor = props.card.anchor, layer = host.value
  if (!anchor?.isConnected || !layer) return
  const slot = anchor.getBoundingClientRect(), base = layer.getBoundingClientRect()
  if (!slot.width) return
  inPage.value = { left: slot.left - base.left - layer.clientLeft + layer.scrollLeft + relative().x * slot.width, top: slot.top - base.top - layer.clientTop + layer.scrollTop + relative().y * slot.height }
}
let observer: ResizeObserver | undefined, first = true
watch(host, (layer, previous) => {
  observer?.disconnect(); observer = undefined
  // 从记录里放回来的便签已经带着位置，不用再量。
  const restored = first && Boolean(props.card.rel)
  first = false
  if (layer) {
    if (!restored) remember()
    locate()
    observer = new ResizeObserver(() => { if (!dragging.value) locate() })
    observer.observe(props.card.anchor!); if (props.card.anchor!.parentElement) observer.observe(props.card.anchor!.parentElement)
  } else if (previous && box.value) {
    // 回到屏幕上：停在眼下看到的位置。
    const base = previous.getBoundingClientRect(); place.value = { left: inPage.value.left + base.left + previous.clientLeft - previous.scrollLeft, top: inPage.value.top + base.top + previous.clientTop - previous.scrollTop }
  }
}, { flush: 'sync', immediate: true })
// 钉住的便签记下它在屏幕上的位置（停在屏幕上的那种靠它放回原处）。
watch(() => [place.value.left, place.value.top, props.card.pinned] as const, () => { if (props.card.pinned && !host.value) props.card.screen = { ...place.value } }, { flush: 'sync' })
const position = computed(() => ({
  ...(host.value ? { position: 'absolute' as const, left: `${inPage.value.left}px`, top: `${inPage.value.top}px` } : { left: `${place.value.left}px`, top: `${place.value.top}px` }),
  ...(size.value.width ? { width: `${size.value.width}px`, maxWidth: 'none' } : {}),
  ...(size.value.height ? { height: `${size.value.height}px`, maxHeight: 'none' } : {}),
}))
function togglePin() { props.card.pinned = !props.card.pinned }
function toggleFollow() { props.card.follow = props.card.follow === 'page' ? 'screen' : 'page' }
// 拖动只按指针走过的距离挪，不去量卡片的外框：草稿主题的便签是歪着贴的，量出来的外框比它实际的位置偏一点，松手时会跳一下。
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
  const handle = event.currentTarget as HTMLElement
  let x = event.clientX, y = event.clientY
  handle.setPointerCapture(event.pointerId); dragging.value = true; event.preventDefault()
  const move = (next: PointerEvent) => {
    const dx = next.clientX - x, dy = next.clientY - y
    x = next.clientX; y = next.clientY
    if (host.value) inPage.value = { left: inPage.value.left + dx, top: inPage.value.top + dy }
    else place.value = { left: Math.min(innerWidth - 40, Math.max(48 - (box.value?.offsetWidth || 0), place.value.left + dx)), top: Math.min(innerHeight - 30, Math.max(4, place.value.top + dy)) }
  }
  const end = () => {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end)
    dragging.value = false
    // 跟着书页时，记下它现在相对那一页的位置。
    const anchor = props.card.anchor, layer = host.value
    if (anchor?.isConnected && layer) {
      const slot = anchor.getBoundingClientRect(), base = layer.getBoundingClientRect()
      if (slot.width) props.card.rel = { x: (inPage.value.left - (slot.left - base.left - layer.clientLeft + layer.scrollLeft)) / slot.width, y: (inPage.value.top - (slot.top - base.top - layer.clientTop + layer.scrollTop)) / slot.height }
    }
  }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end)
}
// 拉右边、下边或右下角改便签的大小；内容放不下时在便签里滚动。
const size = computed<{ width?: number; height?: number }>({ get: () => props.card.size || {}, set: value => { props.card.size = value } })
function startResize(event: PointerEvent, edge: 'e' | 's' | 'se') {
  if (event.button !== 0 || !box.value) return
  const handle = event.currentTarget as HTMLElement
  let x = event.clientX, y = event.clientY, width = size.value.width ?? box.value.offsetWidth, height = size.value.height ?? box.value.offsetHeight
  handle.setPointerCapture(event.pointerId); dragging.value = true; event.preventDefault(); event.stopPropagation()
  const move = (next: PointerEvent) => {
    if (edge !== 's') width = Math.min(innerWidth - 24, Math.max(180, width + next.clientX - x))
    if (edge !== 'e') height = Math.min(innerHeight - 24, Math.max(72, height + next.clientY - y))
    x = next.clientX; y = next.clientY
    size.value = { width: edge === 's' ? size.value.width : width, height: edge === 'e' ? size.value.height : height }
  }
  const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); dragging.value = false }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end)
}
// 中键是「解释」：不当作点了外面。
function outside(event: Event) { if (props.card.pinned || (event as PointerEvent).button === 1) return; if (!box.value?.contains(event.target as Node)) emit('close') }
function key(event: KeyboardEvent) { if (event.key === 'Escape' && !props.card.pinned) emit('close') }
onMounted(() => {
  settle(); document.addEventListener('pointerdown', outside, true); document.addEventListener('wheel', outside, { capture: true, passive: true }); document.addEventListener('keydown', key)
  if (showFrom.value) void nextTick(() => requestAnimationFrame(() => { showFrom.value = false }))
})
onBeforeUnmount(() => { observer?.disconnect(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('wheel', outside, true); document.removeEventListener('keydown', key) })
watch(() => [props.card.item.text, props.card.item.status, props.card.item.reasoning, showFrom.value], () => { void nextTick(settle) })
</script>

<template>
  <Teleport :to="host || 'body'">
  <div ref="box" class="selection-translation explain-card" :class="{ pinned: card.pinned, dragging, sized: Boolean(size.width || size.height), 'in-page': Boolean(host), morph: Boolean(card.from) }" role="status" aria-live="polite" :style="position" @pointerdown.stop="$event.target === box && startDrag($event)" @mousedown.stop @click.stop @dblclick.stop @contextmenu.stop>
    <Transition name="st-swap" mode="out-in" @after-enter="settle">
      <div v-if="showFrom" key="from" class="st-text" v-html="renderMarkdown(card.from || '')"></div>
      <div v-else key="explain" class="st-explain">
        <div class="ec-head" @pointerdown.stop="startDrag">
          <span class="st-term">{{ card.item.term.length > 48 ? card.item.term.slice(0, 48) + '…' : card.item.term }}</span>
          <button v-if="card.pinned && card.anchor" type="button" class="ec-tool" :aria-label="card.follow === 'page' ? '跟着书页走' : '停在屏幕上'" :data-tip="card.follow === 'page' ? '现在跟着书页走，点一下改成停在屏幕上' : '现在停在屏幕上，点一下改成跟着书页走'" @click="toggleFollow"><AppIcon :name="card.follow === 'page' ? 'doc' : 'fullscreen'" :size="13" /></button>
          <button type="button" class="ec-tool ec-pin" :class="{ on: card.pinned }" :aria-pressed="card.pinned" :aria-label="card.pinned ? '拔下图钉' : '钉住'" :data-tip="card.pinned ? '拔下图钉（之后点别处就消失）' : '钉住：不会自己消失，可以拖动'" @click="togglePin"><AppIcon name="pin" :size="13" /></button>
        </div>
        <ExplainBody :item="card.item" />
        <p v-if="card.item.status !== 'error' || card.item.text" class="ec-actions">
          <button type="button" class="ec-tool" :disabled="card.item.status === 'running'" aria-label="深入" data-tip="深入" @click="rerunExplain(card.item, 'deeper')"><AppIcon name="deeper" :size="14" /></button>
          <button type="button" class="ec-tool" :disabled="card.item.status === 'running'" aria-label="简化" data-tip="简化" @click="rerunExplain(card.item, 'simpler')"><AppIcon name="simpler" :size="14" /></button>
          <button type="button" class="ec-tool" :disabled="card.item.status === 'running'" aria-label="举例" data-tip="举例" @click="rerunExplain(card.item, 'example')"><AppIcon name="example" :size="14" /></button>
        </p>
      </div>
    </Transition>
    <i class="ec-resize ec-e" @pointerdown="startResize($event, 'e')"></i><i class="ec-resize ec-s" @pointerdown="startResize($event, 's')"></i><i class="ec-resize ec-se" @pointerdown="startResize($event, 'se')"></i>
  </div>
  </Teleport>
</template>

<style>
.explain-card{min-width:180px;display:flex;flex-direction:column;overflow:visible!important}
.explain-card > :is(.st-explain,.st-text){min-height:0;overflow:auto}
.explain-card .st-explain{display:flex;flex-direction:column;flex:1}
.explain-card .explain-body{flex:1;min-height:0;overflow:auto}
.explain-card.sized .st-explain{max-height:none!important}
/* 右边、下边各一条看不见的把手，右下角一个小角标。 */
.ec-resize{position:absolute;z-index:2;touch-action:none}
.ec-e{top:8px;bottom:14px;right:-4px;width:9px;cursor:ew-resize}
.ec-s{left:8px;right:14px;bottom:-4px;height:9px;cursor:ns-resize}
.ec-se{right:-3px;bottom:-3px;width:16px;height:16px;cursor:nwse-resize}
.ec-se::after{content:'';position:absolute;right:5px;bottom:5px;width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;opacity:0;transition:opacity .15s}
.explain-card:hover .ec-se::after,.explain-card.dragging .ec-se::after{opacity:.4}
.explain-card.morph{animation:none}
/* 跟着书页走时压在工具栏的毛边（z-index 4）下面、书页上面。 */
.explain-card.in-page{z-index:3;animation:none}
.explain-card.dragging{transition:none;cursor:grabbing;user-select:none}
.ec-head{display:flex;align-items:center;gap:4px;margin:-3px -5px 4px 0;cursor:grab;touch-action:none}
.ec-head .st-term{flex:1;min-width:0;margin:0!important}
.ec-tool{display:grid;place-items:center;flex:none;width:22px;height:22px;min-height:0;padding:0;border:0;border-radius:50%;background:none!important;box-shadow:none!important;color:var(--muted);opacity:.55;cursor:pointer;transition:opacity .15s,color .15s,rotate .2s var(--spring-snappy,ease-out),background-color .15s}
.ec-tool:hover{opacity:1;background:color-mix(in srgb,var(--ink) 8%,transparent)!important}
.ec-actions{display:flex;align-items:center;gap:2px;flex:none;margin:6px 0 -5px -5px!important}
.ec-actions .ec-tool{width:24px;height:22px;border-radius:6px}
.ec-actions .ec-tool:disabled{opacity:.25;cursor:default}
.ec-actions .ec-tool:active:not(:disabled){scale:.9}
:root[data-style='sketch'] .ec-actions .ec-tool{color:var(--pencil,#2b2a27)}
:root[data-style='sketch'] .ec-actions .ec-tool:hover:not(:disabled){background:none!important;color:var(--red-pencil,#c0392b);rotate:-6deg}
:root[data-style='warm'] .ec-actions .ec-tool:hover:not(:disabled){background:none!important;color:var(--accent)}
.ec-pin{rotate:35deg}
.ec-pin.on{opacity:1;color:var(--accent);rotate:0deg}
.explain-card.pinned{box-shadow:var(--shadow-3),var(--glass-edge),0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent)}
/* 液态玻璃：圆角更大的一片玻璃，词条是标题，左上一抹强调色的光。 */
:root:not([data-style='warm']):not([data-style='sketch']) .explain-card{max-width:min(400px,calc(100vw - 16px));padding:12px 15px 13px;background-color:color-mix(in srgb,var(--surface,#fff) 86%,transparent);border-radius:var(--r-lg,16px);background-image:radial-gradient(120% 90% at 0 0,color-mix(in srgb,var(--accent) 13%,transparent),transparent 60%),var(--popup-sheen)}
:root:not([data-style='warm']):not([data-style='sketch']) .explain-card .st-term{color:var(--ink);font-size:.95em;font-weight:650}
:root[data-style='sketch'] .explain-card.pinned{box-shadow:1px 2px 0 rgb(60 50 30 / .1),5px 9px 18px -8px rgb(60 50 30 / .5)}
:root[data-style='sketch'] .ec-pin.on{color:var(--red-pencil,#c0392b)}
</style>
