<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'

withDefaults(defineProps<{ modelValue: string; busy?: boolean; current: number; total: number; status?: string; shortcut?: string }>(), { busy: false, status: '', shortcut: 'Ctrl + F' })
const emit = defineEmits<{ 'update:modelValue': [value: string]; next: []; previous: []; clear: [] }>()
const input = ref<HTMLInputElement>()
function focus() { input.value?.focus(); input.value?.select(); input.value?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) emit('previous'); else emit('next') }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('clear'); input.value?.blur() }
}
defineExpose({ focus })
</script>

<template>
  <div class="reader-search" role="search" :aria-busy="busy" :data-tip="status || '搜索本文'" :data-tip-key="status ? undefined : shortcut || undefined">
    <AppIcon name="search" :size="14" />
    <input ref="input" type="text" aria-label="文档内搜索" placeholder="搜索本文…" :value="modelValue" autocomplete="off" spellcheck="false" maxlength="256" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @keydown="keydown" />
    <template v-if="modelValue">
      <span class="reader-find-count reader-search-count" role="status" aria-live="polite">{{ current }} / {{ total }}{{ busy ? '…' : '' }}</span>
      <button type="button" aria-label="上一个搜索结果" data-tip="上一个匹配" data-tip-key="Shift + Enter" :disabled="!total" @click="emit('previous')"><AppIcon name="down" :size="13" class="reader-search-previous" /></button>
      <button type="button" aria-label="下一个搜索结果" data-tip="下一个匹配" data-tip-key="Enter" :disabled="!total" @click="emit('next')"><AppIcon name="down" :size="13" /></button>
      <button type="button" aria-label="清除搜索" data-tip="清除搜索" data-tip-key="Esc" @click="emit('clear')"><AppIcon name="close" :size="13" /></button>
    </template>
  </div>
</template>

<style scoped>
/* 工具条里的搜索框是一段灰色填充胶囊，不再叠一层玻璃。 */
.reader-search { display: flex; align-items: center; gap: 4px; height: 36px; flex: 0 1 320px; width: clamp(170px, 25vw, 320px); min-width: 170px; margin-left: auto; padding: 0 4px 0 12px; border: 1px solid transparent; border-radius: var(--r-control); background-color: var(--fill-3); color: var(--control-ink); transition: background-color var(--dur-1) var(--ease-soft), border-color var(--dur-1) var(--ease-soft), box-shadow var(--dur-2) var(--ease-soft); }
.reader-search:hover:not(:focus-within) { background-color: var(--fill-2); }
.reader-search:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, transparent); background-color: var(--fill-4); box-shadow: 0 0 0 4px var(--accent-ring); }
.reader-search > svg { flex: 0 0 auto; opacity: .62; }
.reader-search input { flex: 1; min-width: 24px; width: 100%; height: 100%; padding: 0 0 0 3px; border: 0; border-radius: 0; outline: 0; background: transparent; box-shadow: none; color: inherit; font-size: 12px; text-shadow: inherit; }
.reader-search input:hover:not(:disabled):not(:focus), .reader-search input:focus { outline: 0; box-shadow: none; border: 0; background: transparent; }
.reader-search input::placeholder { color: inherit; opacity: .58; }
.reader-search-count { flex: 0 0 auto; font-size: 10.5px; white-space: nowrap; font-variant-numeric: tabular-nums; opacity: .72; padding: 0 3px; }
.reader-search button { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; min-width: 26px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; box-shadow: none; }
.reader-search button:hover:not(:disabled) { background: var(--fill-2); color: inherit; }
.reader-search button:disabled { opacity: .3; }
.reader-search-previous { transform: rotate(180deg); }
</style>
