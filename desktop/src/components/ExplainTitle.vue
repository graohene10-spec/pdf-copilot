<script setup lang="ts">
// 解释卡片的标题：平时是被荧光笔划过的词条；双击变成一行输入框，就这段内容自己问一句。
import { computed, nextTick, ref } from 'vue'
import type { Explain } from '../ai/explain'

const props = defineProps<{ item: Explain; limit: number }>()
const emit = defineEmits<{ ask: [question: string] }>()
const editing = ref(false), draft = ref(''), field = ref<HTMLInputElement>()
const short = computed(() => props.item.term.length > props.limit ? props.item.term.slice(0, props.limit) + '…' : props.item.term)
function begin() { if (editing.value) return; editing.value = true; draft.value = ''; void nextTick(() => field.value?.focus()) }
function send() { const text = draft.value.trim(); if (!text) return; editing.value = false; emit('ask', text) }
function keydown(event: KeyboardEvent) {
  // 输入框里打字不触发阅读器的快捷键。
  event.stopPropagation()
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter') { event.preventDefault(); send() }
  else if (event.key === 'Escape') { event.preventDefault(); editing.value = false }
}
defineExpose({ begin })
</script>

<template>
  <input v-if="editing" ref="field" v-model="draft" class="ec-ask" type="text" maxlength="400" placeholder="就这段内容提问，回车发送" aria-label="就这段内容提问" @keydown="keydown" @keyup.stop @blur="!draft.trim() && (editing = false)" @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop />
  <span v-else class="st-term" data-tip="双击提问"><mark>{{ short }}</mark></span>
</template>
