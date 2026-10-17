<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import AppIcon from './AppIcon.vue'
import { vLiquidSelection } from '../ui/liquid-selection'
const props = defineProps<{ tabs: { id: string; name: string; kind: string; phase: string }[]; activeId?: string; group?: string[]; visible?: string[] }>()
const emit = defineEmits<{
  select: [id: string]; close: [id: string]; library: []
  menu: [value: { id: string; x: number; y: number }]
  drag: [value: { id: string; x: number; y: number; phase: 'move' | 'end' | 'cancel' }]
  reorder: [value: { from: string; to: string; after: boolean }]
}>()
const strip = ref<any>()
const stripElement = () => (strip.value?.$el ?? strip.value) as HTMLElement | undefined
watch(() => props.activeId, async () => { await nextTick(); stripElement()?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) })
// A closing tab stays only for its exit animation: hide it from tab order and assistive technology at once.
function retire(element: Element) { element.setAttribute('aria-hidden', 'true'); (element as HTMLElement).inert = true }
function navigate(event: KeyboardEvent, index: number) {
  const next = event.key === 'ArrowRight' ? (index + 1) % props.tabs.length : event.key === 'ArrowLeft' ? (index + props.tabs.length - 1) % props.tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? props.tabs.length - 1 : -1
  if (next < 0) return
  event.preventDefault(); emit('select', props.tabs[next].id)
  void nextTick(() => (stripElement()?.querySelectorAll('[role="tab"]')[next] as HTMLElement)?.focus())
}
const inGroup = (id: string) => (props.group || []).includes(id)

/* 并排的一组标签：用一个圆角框把它们框在一起。 */
const frame = ref<{ left: number; width: number } | null>(null)
function measureFrame() {
  const element = stripElement()
  const ids = props.group || []
  if (!element || ids.length < 2) { frame.value = null; return }
  const tabs = [...element.querySelectorAll<HTMLElement>('.file-tab[data-id]')].filter(tab => ids.includes(tab.dataset.id || '') && !tab.inert)
  if (tabs.length < 2) { frame.value = null; return }
  const left = Math.min(...tabs.map(tab => tab.offsetLeft)), right = Math.max(...tabs.map(tab => tab.offsetLeft + tab.offsetWidth))
  frame.value = { left: left - 2, width: right - left + 4 }
}
watch(() => [props.tabs.map(tab => tab.id).join(), (props.group || []).join()], () => { void nextTick(measureFrame); setTimeout(measureFrame, 420) })
let resizeObserver: ResizeObserver | undefined
onMounted(() => { measureFrame(); resizeObserver = new ResizeObserver(measureFrame); const element = stripElement(); if (element) resizeObserver.observe(element) })

/* 拖动标签：在标签条里左右拖动排序；向下拖出标签条，可以放到某一栏的左边或右边并排。 */
let drag: { id: string; startX: number; startY: number; pointer: number; element: HTMLElement; moved: boolean; detached: boolean; ghost?: HTMLElement } | undefined
let suppressClick = false
function down(event: PointerEvent, id: string) {
  if (event.button !== 0 || (event.target as Element).closest('.close-tab')) return
  const element = (event.currentTarget as HTMLElement).closest<HTMLElement>('.file-tab')
  if (!element) return
  drag = { id, startX: event.clientX, startY: event.clientY, pointer: event.pointerId, element, moved: false, detached: false }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
}
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 6) return
    drag.moved = true
    drag.element.classList.add('dragging')
  }
  const bounds = stripElement()?.getBoundingClientRect()
  const outside = !!bounds && event.clientY > bounds.bottom + 18
  if (outside !== drag.detached) {
    drag.detached = outside
    drag.element.style.transform = ''
    if (outside) {
      const ghost = document.createElement('div')
      ghost.className = 'tab-drag-ghost'
      ghost.textContent = props.tabs.find(tab => tab.id === drag!.id)?.name || ''
      document.body.append(ghost); drag.ghost = ghost
    } else { drag.ghost?.remove(); drag.ghost = undefined; emit('drag', { id: drag.id, x: event.clientX, y: event.clientY, phase: 'cancel' }) }
  }
  if (drag.detached) {
    if (drag.ghost) drag.ghost.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 10}px)`
    emit('drag', { id: drag.id, x: event.clientX, y: event.clientY, phase: 'move' })
  } else drag.element.style.transform = `translateX(${dx}px)`
}
function finish(event: PointerEvent, cancelled: boolean) {
  const current = drag
  drag = undefined
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', up)
  window.removeEventListener('pointercancel', cancel)
  if (!current?.moved) return
  suppressClick = true; setTimeout(() => { suppressClick = false }, 0)
  current.element.classList.remove('dragging')
  current.ghost?.remove()
  if (current.detached) { emit('drag', { id: current.id, x: event.clientX, y: event.clientY, phase: cancelled ? 'cancel' : 'end' }); current.element.style.transform = ''; return }
  const from = current.element.getBoundingClientRect()
  current.element.style.transform = ''
  if (cancelled) return
  // Drop where the dragged tab's centre lands among the other tabs.
  const centre = from.left + from.width / 2
  const others = [...(stripElement()?.querySelectorAll<HTMLElement>('.file-tab[data-id]') || [])].filter(tab => tab !== current.element && !tab.inert)
  let target: HTMLElement | undefined, after = false
  for (const tab of others) {
    const box = tab.getBoundingClientRect()
    if (centre >= box.left && centre <= box.right) { target = tab; after = centre > box.left + box.width / 2; break }
  }
  if (!target && others.length) { const last = others.at(-1)!; if (centre > last.getBoundingClientRect().right) { target = last; after = true } else { const first = others[0]; if (centre < first.getBoundingClientRect().left) { target = first; after = false } } }
  if (target?.dataset.id) emit('reorder', { from: current.id, to: target.dataset.id, after })
}
function up(event: PointerEvent) { finish(event, false) }
function cancel(event: PointerEvent) { finish(event, true) }
function click(id: string) { if (!suppressClick) emit('select', id) }
onBeforeUnmount(() => { resizeObserver?.disconnect(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); drag?.ghost?.remove() })
</script>

<template>
  <div class="file-tabs">
    <button class="tab-library" data-glass-interactive @click="emit('library')" :class="{ selected: !activeId }" data-tip="文档库" aria-label="文档库"><AppIcon name="library" :size="16" /><span>文档库</span></button>
    <TransitionGroup ref="strip" v-liquid-selection="'.file-tab.selected'" tag="div" name="tab" class="tab-strip" role="tablist" aria-label="打开的文件" @before-leave="retire">
      <div v-if="frame" key="__group-frame" class="group-frame" :style="{ left: `${frame.left}px`, width: `${frame.width}px` }" aria-hidden="true" />
      <div v-for="(tab, index) in tabs" :key="tab.id" :data-id="tab.id" class="file-tab" data-glass-interactive="tab" :class="{ selected: tab.id === activeId, grouped: inGroup(tab.id), 'on-screen': (visible || []).includes(tab.id) && tab.id !== activeId }" @auxclick.prevent="$event.button === 1 && emit('close', tab.id)" @contextmenu.prevent="emit('menu', { id: tab.id, x: $event.clientX, y: $event.clientY })" @pointerdown="down($event, tab.id)">
        <button role="tab" :aria-label="tab.name" :aria-description="[inGroup(tab.id) ? '并排组' : '', tab.phase ? (tab.phase === 'queued' ? 'AI 等待中' : 'AI 回答中') : ''].filter(Boolean).join('，') || undefined" :aria-selected="tab.id === activeId" :tabindex="tab.id === activeId || (!activeId && index === 0) ? 0 : -1" :data-tip="`${tab.name}`" @click="click(tab.id)" @keydown="navigate($event, index)"><AppIcon :name="tab.kind === 'pdf' ? 'file' : 'markdown'" :size="14" /><span>{{ tab.name }}</span><i v-if="tab.phase" class="tab-task" :class="tab.phase" :data-tip="tab.phase === 'queued' ? 'AI 等待中' : 'AI 回答中'" aria-hidden="true"></i></button>
        <button class="close-tab" :aria-label="`关闭 ${tab.name} 标签`" :data-tip="`关闭 ${tab.name}`" @click="emit('close', tab.id)"><AppIcon name="close" :size="12" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.file-tabs{display:flex;align-items:center;min-width:0;flex:1;gap:8px;height:100%}
.tab-library{height:40px;border:1px solid var(--glass-outline);background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink);font-size:12px;font-weight:550;padding:6px 14px 6px 11px;flex-shrink:0;gap:7px;border-radius:var(--r-full);transition:background-color var(--dur-1) var(--ease-soft)}
.tab-library:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.tab-library.selected{background-color:var(--control-selected);background-image:var(--glass-sheen);color:var(--control-ink);font-weight:600;box-shadow:var(--glass-control-shadow)}
.tab-library.selected:hover:not(:disabled){background-color:var(--control-selected-hover);color:var(--control-ink)}
.tab-strip{position:relative;display:flex;gap:2px;overflow-x:auto;overflow-y:hidden;min-width:0;height:40px;align-items:center;padding:2px;border-radius:var(--r-full);background:var(--fill-4);scrollbar-width:none}
.tab-strip::-webkit-scrollbar{display:none}
.file-tab{position:relative;z-index:1;display:flex;align-items:center;flex:0 0 172px;min-width:0;height:36px;padding-inline:2px 4px;border-radius:var(--r-full);color:var(--control-ink);transition:background-color var(--dur-1) var(--ease-soft);touch-action:none}
.file-tab:hover{background-color:var(--control-hover);color:var(--control-ink)}
.file-tab.selected{background-color:var(--control-selected);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink);font-weight:600}
.file-tab.selected:hover{background-color:var(--control-selected-hover)}
.has-indicator>.file-tab.selected:hover{background-color:transparent}
/* 同在屏幕上的并排标签：字重稍重，表示它也开着。 */
.file-tab.on-screen{font-weight:600}
.file-tab+.file-tab::before{content:'';position:absolute;left:-2px;top:11px;bottom:11px;width:1px;background:var(--separator);transition:opacity var(--dur-2) var(--ease-out)}
.file-tab.selected::before,.file-tab.selected+.file-tab::before,.file-tab:hover::before,.file-tab:hover+.file-tab::before,.file-tab.grouped+.file-tab.grouped::before{opacity:0}
/* 拖动中的标签浮起，其余标签让位。 */
.file-tab.dragging{z-index:5;background-color:var(--surface);box-shadow:0 8px 20px -6px rgb(0 0 0 / .3);transition:none;cursor:grabbing}
/* 并排组的外框。 */
.group-frame{position:absolute;top:1px;bottom:1px;z-index:0;border-radius:var(--r-full);border:1.5px solid color-mix(in srgb,var(--accent) 55%,transparent);background:color-mix(in srgb,var(--accent) 8%,transparent);pointer-events:none;transition:left var(--dur-smooth) var(--spring-smooth),width var(--dur-smooth) var(--spring-smooth)}
.file-tab>[role=tab]{min-width:0;flex:1;height:32px;border:0;background:transparent;box-shadow:none;border-radius:var(--r-full);justify-content:flex-start;gap:7px;font-size:12px;font-weight:inherit;color:var(--control-ink);padding:6px 4px 6px 11px}
.file-tab>[role=tab]:hover:not(:disabled){background:transparent}
.file-tab>[role=tab]>span{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.file-tab svg{flex-shrink:0}
.close-tab{flex:0 0 22px;width:22px;height:22px;padding:0;border:0;background:none;box-shadow:none;color:var(--control-ink);border-radius:50%;opacity:.55;transition:background var(--dur-1) var(--ease-soft),opacity var(--dur-1) var(--ease-soft)}
.file-tab:hover .close-tab,.file-tab.selected .close-tab{opacity:.85}
.close-tab:hover:not(:disabled){background:var(--fill-2);color:var(--control-ink);opacity:1}
.tab-task{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 22%,transparent);flex-shrink:0}
.tab-task.queued{background:var(--warning);box-shadow:0 0 0 2px color-mix(in srgb,var(--warning) 22%,transparent)}
.tab-task.running,.tab-task.preparing{animation:zg-breathe 1.5s infinite}
@media(prefers-reduced-motion:reduce){.tab-task{animation:none!important}.group-frame{transition:none}}
@media(max-width:1100px){.file-tab{flex-basis:146px}.tab-library{width:40px;padding:0}.tab-library>span{display:none}.file-tabs{gap:5px}}
</style>
