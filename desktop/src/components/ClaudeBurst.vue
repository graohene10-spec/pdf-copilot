<script setup lang="ts">
// 「阅读助手」按钮上的 Claude 式菊花：十二道粗细、长短略有不同的光芒，从中心向外收尖。
import { computed } from 'vue'
const props = withDefaults(defineProps<{ size?: number }>(), { size: 17 })
const LENGTHS = [10.4, 8.6, 9.8, 8.2, 10.1, 8.9, 9.6, 8.4, 10.3, 8.7, 9.5, 8.5]
const path = computed(() => LENGTHS.map((length, index) => {
  const angle = (index * 30 - 90 + (index % 2 ? 4 : -3)) * Math.PI / 180
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux
  const point = (radius: number, half: number, side: number) => `${(12 + ux * radius + nx * half * side).toFixed(2)},${(12 + uy * radius + ny * half * side).toFixed(2)}`
  const base = 1.05 + (index % 3) * .12
  return `M${point(1.2, base, 1)} L${point(length - .9, .42, 1)} Q${(12 + ux * (length + .2)).toFixed(2)},${(12 + uy * (length + .2)).toFixed(2)} ${point(length - .9, .42, -1)} L${point(1.2, base, -1)} Z`
}).join(' '))
</script>

<template>
  <svg class="claude-burst" :width="props.size" :height="props.size" viewBox="0 0 24 24" aria-hidden="true"><path :d="path" /></svg>
</template>

<style scoped>
.claude-burst { flex-shrink: 0; fill: #d97757; }
</style>
