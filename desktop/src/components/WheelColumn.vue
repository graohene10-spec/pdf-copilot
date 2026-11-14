<script setup lang="ts">
// 一列滚轮（像系统时钟里选时间的鼓轮）：拖动、滚轮、点某一行、方向键都能转，停下时吸到最近的一格。
// loop 的一列首尾相接：列表重复几遍，停下后悄悄挪回中间那一遍。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ items: string[]; modelValue: number; loop?: boolean; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const ROW = 30
const copies = computed(() => props.loop ? 5 : 1)
const rows = computed(() => Array.from({ length: props.items.length * copies.value }, (_, index) => index))
const box = ref<HTMLElement>()
const size = () => props.items.length
const wrap = (index: number) => ((index % size()) + size()) % size()
const home = () => props.loop ? size() * 2 : 0
const indexNow = () => Math.round((box.value?.scrollTop || 0) / ROW)
const last = () => rows.value.length - 1

let settle: ReturnType<typeof setTimeout> | undefined
let aim: number | undefined
let dragging = false, dragged = false
function pick(row: number) { if (!dragged) go(row) }
function go(index: number, smooth = true) {
  aim = Math.min(last(), Math.max(0, index))
  box.value?.scrollTo({ top: aim * ROW, behavior: smooth ? 'smooth' : 'auto' })
}
function scrolled() {
  const value = wrap(indexNow())
  if (value !== props.modelValue) emit('update:modelValue', value)
  clearTimeout(settle); settle = setTimeout(rest, 150)
}
// 停稳了：首尾相接的一列挪回中间那一遍（内容一样，看不出来）。
function rest() {
  aim = undefined
  if (!box.value || dragging || !props.loop) return
  const index = indexNow(), target = home() + wrap(index)
  if (target !== index) box.value.scrollTop += (target - index) * ROW
}
function step(by: number) { go((aim ?? indexNow()) + by) }
// 鼠标滚轮一格转一行；触控板的细碎滚动交给浏览器自己滚。
function wheel(event: WheelEvent) { if (Math.abs(event.deltaY) < 50) return; event.preventDefault(); step(event.deltaY > 0 ? 1 : -1) }
function key(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') step(1); else if (event.key === 'ArrowUp') step(-1); else return
  event.preventDefault()
}
// 鼠标按住拖：跟手转，松开时带一点惯性，再吸到最近的一格。
function press(event: PointerEvent) {
  if (event.button !== 0 || event.pointerType === 'touch' || !box.value) return
  const element = box.value, startY = event.clientY, startTop = element.scrollTop
  let lastY = startY, lastAt = event.timeStamp, speed = 0, moved = false
  const move = (next: PointerEvent) => {
    if (!moved && Math.abs(next.clientY - startY) < 4) return
    if (!moved) { moved = true; dragging = true; element.setPointerCapture(event.pointerId); element.classList.add('dragging') }
    element.scrollTop = startTop - (next.clientY - startY)
    const elapsed = next.timeStamp - lastAt
    if (elapsed > 0) speed = speed * .6 + ((lastY - next.clientY) / elapsed) * .4
    lastY = next.clientY; lastAt = next.timeStamp
  }
  const end = (final: PointerEvent) => {
    element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end)
    if (!moved) return
    dragging = false; element.classList.remove('dragging')
    go(Math.round((element.scrollTop + (final.timeStamp - lastAt < 80 ? speed * 160 : 0)) / ROW))
    // 拖完不算点了某一行。
    dragged = true; setTimeout(() => { dragged = false }, 0)
  }
  element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end)
}
onMounted(() => go(home() + props.modelValue, false))
watch(() => props.modelValue, value => { if (wrap(indexNow()) !== value) go(home() + value, false) })
onBeforeUnmount(() => clearTimeout(settle))
</script>

<template>
  <div ref="box" class="wheel" tabindex="0" role="listbox" :aria-label="label" :aria-activedescendant="undefined" @scroll.passive="scrolled" @wheel="wheel" @keydown="key" @pointerdown="press">
    <span v-for="row in rows" :key="row" class="wheel-row" role="option" :aria-selected="row % items.length === modelValue" @click="pick(row)">{{ items[row % items.length] }}</span>
  </div>
</template>

<style>
.wheel{position:relative;z-index:1;box-sizing:border-box;height:150px;padding-block:60px;overflow-y:auto;overscroll-behavior:contain;scroll-snap-type:y mandatory;scrollbar-width:none;outline:none!important;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:pan-y;-webkit-mask-image:linear-gradient(transparent,#000 34%,#000 66%,transparent);mask-image:linear-gradient(transparent,#000 34%,#000 66%,transparent)}
.wheel::-webkit-scrollbar{display:none}
.wheel.dragging{scroll-snap-type:none;cursor:grabbing}
.wheel-row{display:grid;place-items:center;height:30px;scroll-snap-align:center;color:var(--wheel-off,var(--muted));font-size:20px;font-variant-numeric:tabular-nums;white-space:nowrap;animation:wheel-turn linear both;animation-timeline:view(block)}
/* 每一行随它在窗口里的位置转：正中间平放、最清楚，往上往下向后倒、变淡，像一只鼓轮。 */
@keyframes wheel-turn{0%{opacity:.2;transform:perspective(260px) rotateX(-62deg) scale(.84)}38%{color:var(--wheel-off,var(--muted))}50%{opacity:1;transform:none;color:var(--wheel-on,var(--ink))}62%{color:var(--wheel-off,var(--muted))}100%{opacity:.2;transform:perspective(260px) rotateX(62deg) scale(.84)}}
</style>
