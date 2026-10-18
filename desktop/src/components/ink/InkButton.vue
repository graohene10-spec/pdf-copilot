<script setup lang="ts">
// Toolbar entry for hand-drawn markup, styled like the neighbouring 框选 toggle.
import InkIcon from './InkIcon.vue'
defineProps<{ active: boolean; tipKey?: string }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button class="quiet-button ink-toggle" :class="{ active }" type="button" aria-label="标记" :aria-pressed="active" data-tip="在页面上手写记号、划线（Esc 退出）" :data-tip-key="tipKey" @click="$emit('click')"><InkIcon name="markup" :size="17" />标记</button>
</template>

<style scoped>
@media (max-width: 850px) {
  .ink-toggle { font-size: 0; gap: 0; width: 36px; padding: 0; }
}
</style>
