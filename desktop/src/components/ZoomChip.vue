<script setup lang="ts">
import { nextTick, ref } from 'vue'

// 缩放比例：单击走原来的动作，双击改成输入框，直接写比例和步长。
const props = defineProps<{ label: string; percent: number; min: number; max: number; step: number; pressed?: boolean; tip: string; tipKey?: string }>()
const emit = defineEmits<{ tap: []; set: [value: number]; step: [value: number] }>()
const editing = ref(false), text = ref(''), stepText = ref('')
const field = ref<HTMLInputElement>()
let timer = 0
function tap() { clearTimeout(timer); timer = window.setTimeout(() => emit('tap'), 220) }
function open() {
  clearTimeout(timer)
  text.value = String(Math.round(props.percent)); stepText.value = String(Math.round(props.step)); editing.value = true
  void nextTick(() => { field.value?.focus(); field.value?.select() })
}
function commit() {
  if (!editing.value) return
  editing.value = false
  const value = Number.parseFloat(text.value), step = Number.parseFloat(stepText.value)
  if (Number.isFinite(step) && Math.round(step) !== Math.round(props.step)) emit('step', Math.max(5, Math.min(50, Math.round(step))))
  if (Number.isFinite(value) && Math.round(value) !== Math.round(props.percent)) emit('set', Math.max(props.min, Math.min(props.max, value)))
}
function leave(event: FocusEvent) { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) commit() }
</script>

<template>
  <button v-if="!editing" class="zoom-fit" :aria-pressed="pressed" :data-tip="`${tip} · 双击输入`" :aria-label="`缩放比例，点击${tip}，双击输入`" :data-tip-key="tipKey" @click="tap" @dblclick="open">{{ label }}</button>
  <span v-else class="zoom-edit" @focusout="leave" @keydown.enter.prevent="commit" @keydown.esc.stop.prevent="editing = false" @keydown.stop>
    <input ref="field" v-model="text" inputmode="decimal" aria-label="缩放比例" /><i>%</i>
    <i class="zoom-sep">±</i><input v-model="stepText" inputmode="numeric" data-tip="每次缩放的步长 %" aria-label="缩放步长" />
  </span>
</template>

<style>
.reader-zoom > .zoom-edit { display: flex; align-items: center; gap: 2px; height: 30px; padding: 0 6px; }
.zoom-edit input { width: 34px; height: 22px; padding: 0 2px; border: 0; border-bottom: 1px solid var(--control-ink); border-radius: 0; background: transparent; box-shadow: none; color: var(--control-ink); font: inherit; font-size: 12px; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; outline: 0; }
.zoom-edit input:last-child { width: 24px; text-align: left; opacity: .75; }
.zoom-edit input:focus { opacity: 1; }
.zoom-edit i { font-style: normal; opacity: .6; }
.zoom-edit .zoom-sep { margin-left: 6px; }
</style>
