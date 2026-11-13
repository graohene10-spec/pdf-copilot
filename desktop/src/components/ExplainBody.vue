<script setup lang="ts">
// 一条解释的正文：思考时是助手的形象 + Thinking… + 用时；出字后是渲染好的 Markdown（公式也渲染）。超过 10 秒提示换个更快的服务商。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import 'katex/dist/katex.min.css'
import { renderMarkdown } from '../ai/render'
import { thinkingVerb } from '../ai/greeting'
import { useSettings } from '../settings'
import AssistantMark from './AssistantMark.vue'
import type { Explain } from '../ai/explain'

const props = defineProps<{ item: Explain }>()
const { preferences } = useSettings()
const avatar = computed(() => preferences.value.assistant.avatar)
const now = ref(Date.now())
let ticker = 0
watch(() => props.item.status, status => { clearInterval(ticker); if (status === 'running') { now.value = Date.now(); ticker = window.setInterval(() => { now.value = Date.now() }, 500) } }, { immediate: true })
onBeforeUnmount(() => clearInterval(ticker))
const elapsed = computed(() => Math.max(0, Math.floor((now.value - props.item.startedAt) / 1000)))
const thought = computed(() => props.item.reasoning.trim().split(/\n+/).filter(Boolean).at(-1)?.slice(0, 120) || '')
function openSettings() { window.dispatchEvent(new CustomEvent('kaizhi:open-ai-settings')) }
</script>

<template>
  <div class="explain-body">
    <p v-if="item.status === 'running' && !item.text" class="ex-think"><AssistantMark :kind="avatar.kind" :image="avatar.image" :size="18" /><span class="ex-verb">{{ thinkingVerb(item.id) }}…</span><span class="ex-time">{{ elapsed }}s</span></p>
    <p v-if="item.status === 'running' && !item.text && thought" class="ex-thought">{{ thought }}</p>
    <div v-if="item.text" class="ex-text" v-html="renderMarkdown(item.text)"></div>
    <p v-if="item.status === 'error'" class="ex-error">{{ item.error || '解释失败' }}</p>
    <p v-if="item.status === 'running' && elapsed >= 10" class="ex-slow">有点慢，<button type="button" @click="openSettings">换个更快的服务商</button></p>
  </div>
</template>

<style>
.explain-body p{margin:0}
.ex-think{display:flex;align-items:center;gap:7px;font-size:.92em}
.ex-think .assistant-mark{flex:none}
.ex-verb{--shimmer-base:color-mix(in srgb,var(--muted) 72%,transparent);font-weight:600;background:linear-gradient(90deg,var(--shimmer-base) 0%,var(--shimmer-base) 38%,var(--ink) 47%,var(--ink) 53%,var(--shimmer-base) 62%,var(--shimmer-base) 100%);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ex-shimmer 2.2s linear infinite}
.ex-time{color:var(--muted);font-size:.9em;font-variant-numeric:tabular-nums}
.ex-thought{margin-top:3px!important;color:var(--muted);font-size:.85em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ex-text p+p,.ex-text ul,.ex-text ol{margin-top:.45em}
.ex-text ul,.ex-text ol{margin-bottom:0;padding-left:1.3em}
.ex-text .katex-display{margin:.4em 0;overflow-x:auto;overflow-y:hidden}
.ex-error{color:var(--danger)}
.ex-slow{margin-top:5px!important;color:var(--muted);font-size:.85em}
.ex-slow button{padding:0;border:0;background:none;color:var(--accent);font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
@keyframes ex-shimmer{from{background-position:100% 0}to{background-position:0% 0}}
@media(prefers-reduced-motion:reduce){.ex-verb{animation:none}}
</style>
