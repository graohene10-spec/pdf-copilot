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
  <div class="reader-search" role="search" :aria-busy="busy" :title="status || `搜索本文${shortcut ? ` · ${shortcut}` : ''}`">
    <AppIcon name="search" :size="14" />
    <input ref="input" type="text" aria-label="文档内搜索" placeholder="搜索本文…" :value="modelValue" autocomplete="off" spellcheck="false" maxlength="256" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @keydown="keydown" />
    <template v-if="modelValue">
      <span class="reader-find-count reader-search-count" role="status" aria-live="polite">{{ current }} / {{ total }}{{ busy ? '…' : '' }}</span>
      <button type="button" aria-label="上一个搜索结果" title="上一个匹配 · Shift + Enter" :disabled="!total" @click="emit('previous')"><AppIcon name="down" :size="13" class="reader-search-previous" /></button>
      <button type="button" aria-label="下一个搜索结果" title="下一个匹配 · Enter" :disabled="!total" @click="emit('next')"><AppIcon name="down" :size="13" /></button>
      <button type="button" aria-label="清除搜索" title="清除搜索 · Esc" @click="emit('clear')"><AppIcon name="close" :size="13" /></button>
    </template>
  </div>
</template>

<style scoped>
.reader-search { display: flex; align-items: center; gap: 5px; height: 29px; flex: 0 1 320px; width: clamp(170px, 25vw, 320px); min-width: 170px; margin-left: auto; padding: 0 6px; border: 1px solid var(--glass-outline); border-radius: 0; background-color: var(--glass-2); background-image: var(--glass-sheen); box-shadow: var(--glass-control-shadow); color: var(--control-ink); }
.reader-search:focus-within { border-color: var(--accent); box-shadow: var(--glass-control-shadow), 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent); }
.reader-search > svg { flex: 0 0 auto; opacity: .7; }
.reader-search input { flex: 1; min-width: 24px; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 0; outline: 0; background: transparent; box-shadow: none; color: inherit; font-size: 11px; text-shadow: inherit; }
.reader-search input::placeholder { color: inherit; opacity: .62; }
.reader-search input:focus { outline: 0; box-shadow: none; }
.reader-search-count { flex: 0 0 auto; font-size: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; opacity: .76; }
.reader-search button { display: inline-flex; align-items: center; justify-content: center; width: 21px; height: 24px; min-width: 21px; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; box-shadow: none; }
.reader-search button:hover:not(:disabled) { background: var(--control-hover); color: inherit; }
.reader-search button:disabled { opacity: .3; }
.reader-search-previous { transform: rotate(180deg); }
</style>
