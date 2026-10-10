<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ tabs: { id: string; name: string; kind: string; phase: string }[]; activeId?: string }>()
const emit = defineEmits<{ select: [id: string]; close: [id: string]; library: [] }>()
const strip = ref<HTMLElement>()
watch(() => props.activeId, async () => { await nextTick(); strip.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) })
function navigate(event: KeyboardEvent, index: number) {
  const next = event.key === 'ArrowRight' ? (index + 1) % props.tabs.length : event.key === 'ArrowLeft' ? (index + props.tabs.length - 1) % props.tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? props.tabs.length - 1 : -1
  if (next < 0) return
  event.preventDefault(); emit('select', props.tabs[next].id)
  void nextTick(() => (strip.value?.querySelectorAll('[role="tab"]')[next] as HTMLElement)?.focus())
}
</script>

<template>
  <div class="file-tabs">
    <button class="tab-library" data-glass-interactive @click="emit('library')" :class="{ selected: !activeId }" title="文档库"><AppIcon name="library" :size="16" /><span>文档库</span></button>
    <div ref="strip" class="tab-strip" role="tablist" aria-label="打开的文件">
      <div v-for="(tab, index) in tabs" :key="tab.id" class="file-tab" data-glass-interactive="folder" :class="{ selected: tab.id === activeId }" @auxclick.prevent="$event.button === 1 && emit('close', tab.id)">
        <svg class="folder-shape" viewBox="0 0 180 34" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs><linearGradient :id="`folder-shine-${tab.id}`" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style="stop-color:var(--glass-rim)" />
            <stop offset=".4" stop-color="#fff" stop-opacity="0" />
            <stop offset=".75" style="stop-color:var(--glass-rim-soft)" />
            <stop offset="1" stop-color="#000" stop-opacity=".03" />
          </linearGradient></defs>
          <path class="folder-fill" d="M.5 33.5V6.5C.5 2.5 2.5 .5 6.5 .5H155C159 .5 162 2.5 163 6L169 24C171 30 174 33.5 180 33.5Z" />
          <path class="folder-sheen" :fill="`url(#folder-shine-${tab.id})`" d="M.5 33.5V6.5C.5 2.5 2.5 .5 6.5 .5H155C159 .5 162 2.5 163 6L169 24C171 30 174 33.5 180 33.5Z" />
          <path class="folder-edge" d="M.5 33.5V6.5C.5 2.5 2.5 .5 6.5 .5H155C159 .5 162 2.5 163 6L169 24C171 30 174 33.5 180 33.5" vector-effect="non-scaling-stroke" />
          <path class="folder-highlight" d="M1.5 27V6.5C1.5 3.5 3.5 1.5 6.5 1.5H155C158.5 1.5 161 3.5 162 6.5L164 13" vector-effect="non-scaling-stroke" />
          <path class="folder-base" d="M.5 33.5H180" vector-effect="non-scaling-stroke" />
        </svg>
        <button role="tab" :aria-label="tab.name" :aria-description="tab.phase ? (tab.phase === 'queued' ? 'AI 等待中' : 'AI 回答中') : undefined" :aria-selected="tab.id === activeId" :tabindex="tab.id === activeId || (!activeId && index === 0) ? 0 : -1" :title="tab.name" @click="emit('select', tab.id)" @keydown="navigate($event, index)"><AppIcon :name="tab.kind === 'pdf' ? 'file' : 'markdown'" :size="14" /><span>{{ tab.name }}</span><i v-if="tab.phase" class="tab-task" :class="tab.phase" :title="tab.phase === 'queued' ? 'AI 等待中' : 'AI 回答中'" aria-hidden="true"></i></button>
        <button class="close-tab" :aria-label="`关闭 ${tab.name} 标签`" :title="`关闭 ${tab.name}`" @click="emit('close', tab.id)"><AppIcon name="close" :size="13" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-tabs{display:flex;align-items:center;min-width:0;flex:1;gap:8px;height:100%}
/* 「文档库」选中时只调整灰度底色，文字与文件标签保持一致。 */
.tab-library{border:1px solid var(--glass-outline);background-color:var(--glass-1);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);color:var(--control-ink);font-size:11px;padding:6px 9px;flex-shrink:0;gap:6px;border-radius:0;transition:background-color var(--dur-1) var(--ease-soft)}
.tab-library:hover:not(:disabled){background-color:var(--control-hover);color:var(--control-ink)}
.tab-library.selected{background-color:var(--control-selected);background-image:var(--glass-sheen);color:var(--control-ink);font-weight:550;box-shadow:var(--glass-control-shadow)}
.tab-library.selected:hover:not(:disabled){background-color:var(--control-selected-hover);color:var(--control-ink)}
.tab-strip{display:flex;gap:0;overflow-x:auto;overflow-y:hidden;min-width:0;height:100%;align-items:flex-end;padding-inline:3px;padding-bottom:4px;scrollbar-width:thin}
/* 左边缘竖直，后一张压住前一张的右肩；点击区域避开重叠部分。 */
.file-tab{--tab-fill:var(--glass-1);--tab-line:var(--glass-outline);position:relative;isolation:isolate;display:flex;align-items:center;flex:0 0 175px;min-width:0;height:34px;padding-inline:4px 16px;color:var(--control-ink)}
.file-tab+.file-tab{margin-left:-14px}
.file-tab:hover{--tab-fill:var(--control-hover);color:var(--control-ink);z-index:1}
.file-tab.selected{--tab-fill:var(--control-selected);--tab-line:var(--glass-outline);color:var(--control-ink);font-weight:600;z-index:2}
.file-tab.selected:hover{--tab-fill:var(--control-selected-hover);color:var(--control-ink)}
.folder-shape{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1;overflow:visible;filter:var(--folder-shadow)}
.folder-fill{fill:var(--tab-fill);transition:fill var(--dur-2) var(--ease-out)}
.folder-sheen{opacity:calc(var(--glass-reflection) * .3);pointer-events:none}
.folder-edge,.folder-base{fill:none;stroke:var(--tab-line);stroke-width:1;transition:stroke var(--dur-2) var(--ease-out)}
.folder-highlight{fill:none;stroke:var(--glass-rim);stroke-width:1;opacity:.8}
.file-tab.selected .folder-base{stroke:var(--glass-rim-soft)}
.file-tab>[role=tab]{min-width:0;flex:1;height:30px;border:0;background:transparent;box-shadow:none;border-radius:0;justify-content:flex-start;gap:7px;font-size:11px;color:var(--control-ink);padding:6px 3px 6px 8px}
.file-tab>[role=tab]:hover:not(:disabled){background:transparent}
.file-tab>[role=tab]>span{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.file-tab svg{flex-shrink:0}
.close-tab{flex:0 0 24px;height:24px;padding:3px;border:0;background:none;box-shadow:none;color:var(--control-ink);margin-right:3px;border-radius:var(--r-xs);transition:background var(--dur-1) var(--ease-soft)}
.close-tab:hover:not(:disabled){background:var(--control-hover);color:var(--control-ink)}
.tab-task{width:5px;height:5px;border-radius:50%;background:var(--accent);flex-shrink:0}
.tab-task.queued{background:var(--warning)}
.tab-task.running,.tab-task.preparing{animation:zg-breathe 1.5s infinite}
@media(prefers-reduced-motion:reduce){.tab-task{animation:none!important}}
@media(max-width:1100px){.file-tab{flex-basis:145px}.tab-library>span{display:none}.file-tabs{gap:4px}}
</style>
