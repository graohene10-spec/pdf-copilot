<script setup lang="ts">
// 解释卡片底部按钮行右边的一枚小签：「✻ 3s」，点开 / 收起写完后的思维链。没有思维链就不出现。
import { computed } from 'vue'
import type { Explain } from '../ai/explain'
const props = defineProps<{ item: Explain }>()
const seconds = computed(() => {
  const { firstTokenAt, startedAt, ms } = props.item
  const span = firstTokenAt && startedAt ? firstTokenAt - startedAt : ms
  return Math.max(1, Math.round((span || 0) / 1000))
})
</script>

<template>
  <button v-if="item.status !== 'running' && item.reasoning.trim()" type="button" class="ec-thought" :class="{ on: item.chainOpen }" :aria-expanded="Boolean(item.chainOpen)" :data-tip="item.chainOpen ? '收起思考过程' : '看思考过程'" data-tip-fast @click="item.chainOpen = !item.chainOpen"><span aria-hidden="true">✻</span>{{ seconds }}s</button>
</template>

<style>
.ec-foot{display:flex;align-items:center;gap:8px}
.ec-foot .ec-actions{flex:none}
.ec-thought{display:inline-flex;align-items:center;gap:4px;height:22px;margin:9px 0 -2px auto;padding:0 8px;border:0;border-radius:999px;background:none;box-shadow:none;color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums;letter-spacing:.02em;opacity:.7;cursor:pointer;transition:opacity .15s,color .15s,background-color .15s}
.ec-thought span{color:#d97757;font-size:12px}
.ec-thought:hover,.ec-thought.on{opacity:1;color:var(--ink);background:color-mix(in srgb,var(--ink) 6%,transparent)}
:root[data-style='sketch'] .ec-thought span{color:var(--red-pencil,#c0392b)}
</style>
