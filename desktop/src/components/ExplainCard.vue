<script setup lang="ts">
// PDF 里的解释卡片：出现在鼠标旁。没钉住时点别处就消失；按下图钉后留在原处，默认跟着书页走，
// 可以拖到别的地方，也可以改成停在屏幕上不动。拔下图钉后再点别处才消失。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import 'katex/dist/katex.min.css'
import { renderMarkdown } from '../ai/render'
import AppIcon from './AppIcon.vue'
import ExplainBody from './ExplainBody.vue'
import type { ExplainCardState } from '../ai/explain'

const props = defineProps<{ card: ExplainCardState }>()
const emit = defineEmits<{ close: [] }>()
const box = ref<HTMLElement>()
const place = ref({ left: props.card.x, top: props.card.y })
const hidden = ref(false)
const dragging = ref(false)
// 从翻译卡片变过来：先显示译文，挂上去之后换成解释。
const showFrom = ref(Boolean(props.card.from))
const following = computed(() => props.card.pinned && props.card.follow === 'page' && Boolean(props.card.anchor))
// 钉在书页上的位置：相对那一页左上角的比例，翻页、缩放后还在原来的字旁边。
let relative = { x: 0, y: 0 }
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
  if (rect?.width) relative = { x: (place.value.left - rect.left) / rect.width, y: (place.value.top - rect.top) / rect.height }
}
let frame = 0
function follow() {
  frame = 0
  if (!following.value) return
  const anchor = props.card.anchor!, rect = anchor.getBoundingClientRect(), pane = anchor.closest('.reader-pane')?.getBoundingClientRect()
  if (!dragging.value && anchor.isConnected && rect.width) {
    const left = rect.left + relative.x * rect.width, top = rect.top + relative.y * rect.height
    if (Math.abs(left - place.value.left) > .25 || Math.abs(top - place.value.top) > .25) place.value = { left, top }
    // 那一页滚出阅读区，卡片也跟着出去，不盖在别的栏目上。
    const out = !pane || top < pane.top - 4 || top > pane.bottom - 24 || left < pane.left - 40 || left > pane.right - 40
    if (out !== hidden.value) hidden.value = out
  } else if (!anchor.isConnected && !hidden.value) hidden.value = true
  frame = requestAnimationFrame(follow)
}
watch(following, value => { if (value) { remember(); if (!frame) frame = requestAnimationFrame(follow) } else { cancelAnimationFrame(frame); frame = 0; hidden.value = false } })
function togglePin() { props.card.pinned = !props.card.pinned }
function toggleFollow() { props.card.follow = props.card.follow === 'page' ? 'screen' : 'page' }
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
  const handle = event.currentTarget as HTMLElement, dx = event.clientX - place.value.left, dy = event.clientY - place.value.top
  handle.setPointerCapture(event.pointerId); dragging.value = true; event.preventDefault()
  const move = (next: PointerEvent) => { place.value = { left: Math.min(innerWidth - 40, Math.max(8 - (box.value?.offsetWidth || 0) + 40, next.clientX - dx)), top: Math.min(innerHeight - 30, Math.max(4, next.clientY - dy)) } }
  const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); dragging.value = false; remember() }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end)
}
// 中键是「解释」：不当作点了外面。
function outside(event: Event) { if (props.card.pinned || (event as PointerEvent).button === 1) return; if (!box.value?.contains(event.target as Node)) emit('close') }
function key(event: KeyboardEvent) { if (event.key === 'Escape' && !props.card.pinned) emit('close') }
onMounted(() => {
  settle(); document.addEventListener('pointerdown', outside, true); document.addEventListener('wheel', outside, { capture: true, passive: true }); document.addEventListener('keydown', key)
  if (showFrom.value) void nextTick(() => requestAnimationFrame(() => { showFrom.value = false }))
})
onBeforeUnmount(() => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('wheel', outside, true); document.removeEventListener('keydown', key) })
watch(() => [props.card.item.text, props.card.item.status, props.card.item.reasoning, showFrom.value], () => { void nextTick(settle) })
</script>

<template>
  <Teleport to="body">
  <div ref="box" class="selection-translation explain-card" :class="{ pinned: card.pinned, dragging, hidden, morph: Boolean(card.from) }" role="status" aria-live="polite" :style="{ left: `${place.left}px`, top: `${place.top}px` }">
    <Transition name="st-swap" mode="out-in" @after-enter="settle">
      <div v-if="showFrom" key="from" class="st-text" v-html="renderMarkdown(card.from || '')"></div>
      <div v-else key="explain" class="st-explain">
        <div class="ec-head" @pointerdown="startDrag">
          <span class="st-term">{{ card.item.term.length > 48 ? card.item.term.slice(0, 48) + '…' : card.item.term }}</span>
          <button v-if="card.pinned && card.anchor" type="button" class="ec-tool" :aria-label="card.follow === 'page' ? '跟着书页走' : '停在屏幕上'" :data-tip="card.follow === 'page' ? '现在跟着书页走，点一下改成停在屏幕上' : '现在停在屏幕上，点一下改成跟着书页走'" @click="toggleFollow"><AppIcon :name="card.follow === 'page' ? 'doc' : 'fullscreen'" :size="13" /></button>
          <button type="button" class="ec-tool ec-pin" :class="{ on: card.pinned }" :aria-pressed="card.pinned" :aria-label="card.pinned ? '拔下图钉' : '钉住'" :data-tip="card.pinned ? '拔下图钉（之后点别处就消失）' : '钉住：不会自己消失，可以拖动'" @click="togglePin"><AppIcon name="pin" :size="13" /></button>
        </div>
        <ExplainBody :item="card.item" />
      </div>
    </Transition>
  </div>
  </Teleport>
</template>

<style>
.explain-card{min-width:220px}
.explain-card.morph{animation:none}
.explain-card.hidden{visibility:hidden}
.explain-card.dragging{transition:none;cursor:grabbing;user-select:none}
.ec-head{display:flex;align-items:center;gap:4px;margin:-3px -5px 4px 0;cursor:grab;touch-action:none}
.ec-head .st-term{flex:1;min-width:0;margin:0!important}
.ec-tool{display:grid;place-items:center;flex:none;width:22px;height:22px;min-height:0;padding:0;border:0;border-radius:50%;background:none!important;box-shadow:none!important;color:var(--muted);opacity:.55;cursor:pointer;transition:opacity .15s,color .15s,rotate .2s var(--spring-snappy,ease-out),background-color .15s}
.ec-tool:hover{opacity:1;background:color-mix(in srgb,var(--ink) 8%,transparent)!important}
.ec-pin{rotate:35deg}
.ec-pin.on{opacity:1;color:var(--accent);rotate:0deg}
.explain-card.pinned{box-shadow:var(--shadow-3),var(--glass-edge),0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent)}
/* 液态玻璃：圆角更大的一片玻璃，词条是标题，左上一抹强调色的光。 */
:root:not([data-style='warm']):not([data-style='sketch']) .explain-card{max-width:min(400px,calc(100vw - 16px));padding:12px 15px 13px;background-color:color-mix(in srgb,var(--surface,#fff) 86%,transparent);border-radius:var(--r-lg,16px);background-image:radial-gradient(120% 90% at 0 0,color-mix(in srgb,var(--accent) 13%,transparent),transparent 60%),var(--popup-sheen)}
:root:not([data-style='warm']):not([data-style='sketch']) .explain-card .st-term{color:var(--ink);font-size:.95em;font-weight:650}
:root[data-style='sketch'] .explain-card.pinned{box-shadow:1px 2px 0 rgb(60 50 30 / .1),5px 9px 18px -8px rgb(60 50 30 / .5)}
:root[data-style='sketch'] .ec-pin.on{color:var(--red-pencil,#c0392b)}
</style>
