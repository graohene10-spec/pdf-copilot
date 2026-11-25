<script setup lang="ts">
import { ref } from 'vue'

// 模型名：可以直接写，也可以点开列表选。列表总是列出这家服务的全部模型，不随已填的字过滤。
const props = defineProps<{ modelValue: string; models: { id: string; name?: string }[]; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [] }>()
const open = ref(false), root = ref<HTMLElement>()
function pick(id: string) { emit('update:modelValue', id); emit('change'); open.value = false }
function leave(event: FocusEvent) { if (!root.value?.contains(event.relatedTarget as Node | null)) open.value = false }
</script>

<template>
  <span ref="root" class="model-combo" :class="{ open }" @focusout="leave" @keydown.esc="open && ($event.stopPropagation(), open = false)">
    <input :value="modelValue" :aria-label="label" placeholder="模型名称" autocomplete="off" spellcheck="false" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @change="emit('change')" />
    <button v-if="models.length" type="button" class="combo-toggle" :aria-expanded="open" :aria-label="`选择${label}`" @click.prevent="open = !open"><i aria-hidden="true"></i></button>
    <span v-if="open" class="combo-list" role="listbox">
      <button v-for="item in models" :key="item.id" type="button" role="option" :aria-selected="item.id === modelValue" :class="{ on: item.id === modelValue }" @click.prevent="pick(item.id)"><b>{{ item.name || item.id }}</b><small v-if="item.name && item.name !== item.id">{{ item.id }}</small></button>
    </span>
  </span>
</template>

<style scoped>
.model-combo{position:relative;display:flex;align-items:flex-start}
.model-combo input{flex:1;min-width:0;padding-right:36px}
.combo-toggle{position:absolute;right:4px;top:4px;display:grid;place-items:center;width:30px;height:30px;min-width:0;padding:0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--secondary)}
.combo-toggle:hover{background:var(--control-hover)}
.combo-toggle i{width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;rotate:45deg;translate:0 -2px;transition:rotate var(--dur-2,.16s) var(--ease-out,ease-out),translate var(--dur-2,.16s) var(--ease-out,ease-out)}
.model-combo.open .combo-toggle i{rotate:225deg;translate:0 2px}
.combo-list{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:20;display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto;padding:5px;border:1px solid var(--hairline);border-radius:var(--r-control,12px);background:var(--surface);box-shadow:0 14px 34px -16px rgb(0 0 0 / .35)}
.combo-list button{display:flex;align-items:baseline;justify-content:space-between;gap:12px;height:auto;min-height:34px;padding:6px 10px;border:0;border-radius:8px;background:none;box-shadow:none;text-align:left;white-space:normal;color:var(--control-ink)}
.combo-list button:hover,.combo-list button:focus-visible{background:var(--control-hover)}
.combo-list button.on{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.combo-list b{font-weight:600;font-size:13px}
.combo-list small{font-size:11px;color:var(--muted);font-family:ui-monospace,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style>
