<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import AppIcon from './AppIcon.vue'
import { vLiquidSelection } from '../ui/liquid-selection'
const props = defineProps<{ tabs: { id: string; name: string; kind: string; phase: string; beside?: boolean }[]; activeId?: string }>()
const emit = defineEmits<{ select: [id: string]; close: [id: string]; library: [] }>()
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
</script>

<template>
  <div class="file-tabs">
    <button class="tab-library" data-glass-interactive @click="emit('library')" :class="{ selected: !activeId }" data-tip="文档库" aria-label="文档库"><AppIcon name="library" :size="16" /><span>文档库</span></button>
    <TransitionGroup ref="strip" v-liquid-selection="'.file-tab.selected'" tag="div" name="tab" class="tab-strip" @before-leave="retire" role="tablist" aria-label="打开的文件">
      <div v-for="(tab, index) in tabs" :key="tab.id" class="file-tab" data-glass-interactive="tab" :class="{ selected: tab.id === activeId, beside: tab.beside && tab.id !== activeId }" @auxclick.prevent="$event.button === 1 && emit('close', tab.id)">
        <button role="tab" :aria-label="tab.name" :aria-description="[tab.beside ? '并排显示中' : '', tab.phase ? (tab.phase === 'queued' ? 'AI 等待中' : 'AI 回答中') : ''].filter(Boolean).join('，') || undefined" :aria-selected="tab.id === activeId" :tabindex="tab.id === activeId || (!activeId && index === 0) ? 0 : -1" :data-tip="tab.name" @click="emit('select', tab.id)" @keydown="navigate($event, index)"><AppIcon :name="tab.kind === 'pdf' ? 'file' : 'markdown'" :size="14" /><span>{{ tab.name }}</span><i v-if="tab.beside" class="tab-beside" data-tip="并排显示中" aria-hidden="true"></i><i v-if="tab.phase" class="tab-task" :class="tab.phase" :data-tip="tab.phase === 'queued' ? 'AI 等待中' : 'AI 回答中'" aria-hidden="true"></i></button>
        <button class="close-tab" :aria-label="`关闭 ${tab.name} 标签`" :data-tip="`关闭 ${tab.name}`" @click="emit('close', tab.id)"><AppIcon name="close" :size="12" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.file-tabs{display:flex;align-items:center;min-width:0;flex:1;gap:8px;height:100%}
/* 「文档库」选中时只调整灰度底色，文字与文件标签保持一致。 */
.tab-library{height:40px;border:1px solid var(--glass-outline);background-color:var(--glass-2);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink);font-size:12px;font-weight:550;padding:6px 14px 6px 11px;flex-shrink:0;gap:7px;border-radius:var(--r-full);transition:background-color var(--dur-1) var(--ease-soft)}
.tab-library:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.tab-library.selected{background-color:var(--control-selected);background-image:var(--glass-sheen);color:var(--control-ink);font-weight:600;box-shadow:var(--glass-control-shadow)}
.tab-library.selected:hover:not(:disabled){background-color:var(--control-selected-hover);color:var(--control-ink)}
/* 标签条是一段凹进顶栏的灰色槽，选中的一滴玻璃在标签之间滑动。 */
.tab-strip{display:flex;gap:2px;overflow-x:auto;overflow-y:hidden;min-width:0;height:40px;align-items:center;padding:2px;border-radius:var(--r-full);background:var(--fill-4);scrollbar-width:none}
.tab-strip::-webkit-scrollbar{display:none}
.file-tab{position:relative;display:flex;align-items:center;flex:0 0 172px;min-width:0;height:36px;padding-inline:2px 4px;border-radius:var(--r-full);color:var(--control-ink);transition:background-color var(--dur-1) var(--ease-soft)}
.file-tab:hover{background-color:var(--control-hover);color:var(--control-ink)}
.file-tab.selected{background-color:var(--control-selected);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink);font-weight:600}
.file-tab.selected:hover{background-color:var(--control-selected-hover)}
.has-indicator>.file-tab.selected:hover{background-color:transparent}
/* 未选中标签之间的细分隔，与选中项相邻时隐藏，读起来像 iOS 分段控件。 */
.file-tab+.file-tab::before{content:'';position:absolute;left:-2px;top:11px;bottom:11px;width:1px;background:var(--separator);transition:opacity var(--dur-2) var(--ease-out)}
.file-tab.selected::before,.file-tab.selected+.file-tab::before,.file-tab:hover::before,.file-tab:hover+.file-tab::before{opacity:0}
.file-tab>[role=tab]{min-width:0;flex:1;height:32px;border:0;background:transparent;box-shadow:none;border-radius:var(--r-full);justify-content:flex-start;gap:7px;font-size:12px;font-weight:inherit;color:var(--control-ink);padding:6px 4px 6px 11px}
.file-tab>[role=tab]:hover:not(:disabled){background:transparent}
.file-tab>[role=tab]>span{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.file-tab svg{flex-shrink:0}
.close-tab{flex:0 0 22px;width:22px;height:22px;padding:0;border:0;background:none;box-shadow:none;color:var(--control-ink);border-radius:50%;opacity:.55;transition:background var(--dur-1) var(--ease-soft),opacity var(--dur-1) var(--ease-soft)}
.file-tab:hover .close-tab,.file-tab.selected .close-tab{opacity:.85}
.close-tab:hover:not(:disabled){background:var(--fill-2);color:var(--control-ink);opacity:1}
/* 并排显示中的标签：一道主色细边与小小的双栏记号。 */
.file-tab.beside{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 30%,transparent)}
.tab-beside{flex-shrink:0;width:10px;height:8px;border-radius:2px;border:1.5px solid color-mix(in srgb,var(--accent) 80%,transparent);background:linear-gradient(90deg,transparent calc(50% - .75px),color-mix(in srgb,var(--accent) 80%,transparent) calc(50% - .75px) calc(50% + .75px),transparent calc(50% + .75px))}
.tab-task{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 22%,transparent);flex-shrink:0}
.tab-task.queued{background:var(--warning);box-shadow:0 0 0 2px color-mix(in srgb,var(--warning) 22%,transparent)}
.tab-task.running,.tab-task.preparing{animation:zg-breathe 1.5s infinite}
@media(prefers-reduced-motion:reduce){.tab-task{animation:none!important}}
@media(max-width:1100px){.file-tab{flex-basis:146px}.tab-library{width:40px;padding:0}.tab-library>span{display:none}.file-tabs{gap:5px}}
</style>
