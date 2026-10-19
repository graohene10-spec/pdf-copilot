<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

type Candidate = { id: string; name: string; kind: string; open: boolean }
const props = defineProps<{ anchor: { left: number; top: number; right: number; bottom: number }; candidates: Candidate[]; full: boolean; limit: number }>()
const emit = defineEmits<{ pick: [id: string]; close: [] }>()
const query = ref('')
const cursor = ref(0)
const panel = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const filtered = computed(() => {
  const value = query.value.trim().toLowerCase()
  return props.candidates.filter(item => !value || item.name.toLowerCase().includes(value))
})
const groups = computed(() => [
  { label: '已打开', items: filtered.value.filter(item => item.open) },
  { label: '文档库', items: filtered.value.filter(item => !item.open) },
].filter(group => group.items.length))
const flat = computed(() => groups.value.flatMap(group => group.items))
const style = computed(() => {
  const width = 312
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, props.anchor.right - width))
  return { left: `${left}px`, top: `${props.anchor.bottom + 8}px`, width: `${width}px`, transformOrigin: `${props.anchor.right - left - 18}px 0` }
})
watch(query, () => { cursor.value = 0 })
function pick(id: string) { if (!props.full) emit('pick', id) }
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') }
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!flat.value.length) return
    cursor.value = (cursor.value + (event.key === 'ArrowDown' ? 1 : -1) + flat.value.length) % flat.value.length
    void nextTick(() => panel.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
  } else if (event.key === 'Enter') {
    const item = flat.value[cursor.value]
    if (item) { event.preventDefault(); pick(item.id) }
  }
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !panel.value?.contains(event.target) && !(event.target instanceof Element && event.target.closest('[data-split-anchor]'))) emit('close')
}
onMounted(() => { document.addEventListener('pointerdown', outside, true); input.value?.focus() })
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true))
</script>

<template>
  <section ref="panel" class="split-picker" :style="style" role="dialog" aria-label="并排阅读" data-glass-interactive="panel" @keydown="keydown">
    <header><span class="split-picker-mark"><AppIcon name="split-add" :size="16" /></span><div><strong>并排阅读</strong><small>{{ full ? `最多同时并排 ${limit} 份文档` : '选择一份文档，放在当前文档右侧' }}</small></div></header>
    <label class="split-picker-search"><AppIcon name="search" :size="14" /><input ref="input" v-model="query" type="text" placeholder="搜索文档" aria-label="搜索要并排的文档" /></label>
    <div class="split-picker-list" role="listbox" aria-label="可并排的文档">
      <template v-for="group in groups" :key="group.label">
        <p class="split-picker-group">{{ group.label }}</p>
        <button v-for="item in group.items" :key="item.id" role="option" :aria-selected="flat[cursor]?.id === item.id" :data-active="flat[cursor]?.id === item.id" :disabled="full" @pointerenter="cursor = flat.indexOf(item)" @click="pick(item.id)"><AppIcon :name="item.kind === 'pdf' ? 'file' : 'markdown'" :size="15" /><span>{{ item.name }}</span><em>{{ item.kind === 'pdf' ? 'PDF' : 'MD' }}</em></button>
      </template>
      <p v-if="!flat.length" class="split-picker-empty">{{ query ? '没有匹配的文档' : '文档库里没有其他文档' }}</p>
    </div>
  </section>
</template>

<style scoped>
.split-picker{position:fixed;z-index:60;display:flex;flex-direction:column;max-height:min(440px,calc(100vh - 80px));padding:10px;border:1px solid var(--glass-outline);border-radius:var(--r-xl);background-color:var(--popup-glass);background-image:var(--popup-sheen);--lens-blur:var(--popup-blur);--lens-saturate:var(--glass-sat);-webkit-backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));box-shadow:var(--shadow-3),var(--glass-edge);color:var(--ink);animation:zg-pop-in var(--dur-bounce) var(--spring-bouncy) both}
header{display:flex;align-items:center;gap:10px;padding:4px 6px 10px}
header strong{display:block;font-size:13.5px;font-weight:650}
header small{display:block;font-size:11px;color:var(--muted);margin-top:2px}
.split-picker-mark{display:grid;place-items:center;flex:0 0 32px;height:32px;border-radius:10px;color:var(--brand-ink);background:var(--brand-gradient);box-shadow:inset 0 1px 0 rgb(255 255 255 / .4),0 6px 14px -6px color-mix(in srgb,var(--brand-b) 70%,transparent)}
.split-picker-search{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;margin-bottom:6px;border-radius:var(--r-control);background:var(--fill-3);color:var(--muted)}
.split-picker-search input{flex:1;min-width:0;height:100%;padding:0;border:0;background:none;box-shadow:none;font-size:12.5px;color:var(--control-ink);outline:none}
.split-picker-list{overflow:auto;min-height:0;scrollbar-width:thin}
.split-picker-group{margin:8px 10px 4px;font-size:10.5px;font-weight:600;letter-spacing:.3px;color:var(--muted)}
.split-picker-list button{display:flex;align-items:center;justify-content:flex-start;gap:9px;width:100%;height:38px;padding:0 12px;border:0;background:none;box-shadow:none;border-radius:var(--r-md);font-size:12.5px;color:var(--control-ink);text-align:left;animation:zg-rise-in var(--dur-3) var(--ease-out) both}
.split-picker-list button[data-active='true']:not(:disabled){background:var(--control-hover)}
.split-picker-list button svg{flex-shrink:0;color:var(--accent)}
.split-picker-list button span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.split-picker-list em{font-style:normal;font-size:9.5px;font-weight:650;letter-spacing:.4px;color:var(--muted);padding:2px 7px;border-radius:999px;background:var(--fill-4)}
.split-picker-empty{margin:18px 0;text-align:center;font-size:12px;color:var(--muted)}
</style>
