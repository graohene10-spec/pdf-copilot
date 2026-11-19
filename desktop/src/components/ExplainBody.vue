<script setup lang="ts">
// 一条解释的正文：思考时是助手的形象 + Thinking… + 用时；出字后是渲染好的 Markdown（公式也渲染）。超过 10 秒提示换个更快的服务商。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { mountIntelligentUi } from '../ai/intelligent-ui'
import 'katex/dist/katex.min.css'
import { renderMarkdown } from '../ai/render'
import { thinkingTitle, writingUi } from '../ai/greeting'
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
// 思维链整条留着：思考时放在一个固定高度的小窗里，新内容从底下往上滚；写完折成「思考了 N 秒」，点开看全文。
// 以前只显示最后一行，那一行忽长忽短、时有时无，卡片跟着跳。
const chain = computed(() => props.item.reasoning.trim().slice(-900))
// 思考中那一行：模型给了思考简述就显示简述的小标题，正在写界面块时显示「正在生成 Intelligent UI」。
const thinking = computed(() => props.item.status === 'running' && (!props.item.text || writingUi(props.item.text)))
const title = computed(() => thinkingTitle(props.item.id, props.item.reasoning, props.item.text))
// 解释里的 ```ui 块画成可以操作的界面（Intelligent UI）。
const body = ref<HTMLElement>()
watch(() => [props.item.text, props.item.status], () => { void nextTick(() => { if (body.value && props.item.text.includes('```ui')) mountIntelligentUi(body.value, { streaming: props.item.status === 'running' }) }) }, { immediate: true, flush: 'post' })
function openSettings() { window.dispatchEvent(new CustomEvent('kaizhi:open-ai-settings')) }
</script>

<template>
  <div class="explain-body">
    <p v-if="item.question" class="ex-question">{{ item.question }}</p>
    <p v-if="thinking && !item.text" class="ex-think"><AssistantMark :kind="avatar.kind" :image="avatar.image" :size="18" /><span class="ex-verb">{{ title }}…</span><span class="ex-time">{{ elapsed }}s</span></p>
    <div v-if="item.status === 'running' && !item.text && chain" class="ex-chain" aria-live="off"><p>{{ chain }}</p></div>
    <div v-if="item.text" ref="body" class="ex-text" v-html="renderMarkdown(item.text)"></div>
    <p v-if="thinking && item.text" class="ex-think"><AssistantMark :kind="avatar.kind" :image="avatar.image" :size="18" /><span class="ex-verb">{{ title }}…</span><span class="ex-time">{{ elapsed }}s</span></p>
    <!-- 写完之后的思维链：底部那枚「✻ N s」点开才出现。 -->
    <div v-if="item.chainOpen && item.status !== 'running' && item.reasoning.trim()" class="ex-chain open"><p>{{ item.reasoning.trim() }}</p></div>
    <p v-if="item.status === 'error'" class="ex-error">{{ item.error || '解释失败' }}</p>
    <p v-if="item.status === 'running' && elapsed >= 10 && (item.mode === 'visual' || item.text.includes('```ui'))" class="ex-slow">Intelligent UI 比较复杂，可能会慢一些</p>
    <p v-else-if="item.status === 'running' && elapsed >= 10" class="ex-slow">有点慢，<button type="button" @click="openSettings">换个更快的服务商</button></p>
  </div>
</template>

<style>
.explain-body p{margin:0}
.ex-think{display:flex;align-items:center;gap:7px;font-size:.92em}
.ex-think .assistant-mark{flex:none}
.ex-verb{--shimmer-base:color-mix(in srgb,var(--muted) 72%,transparent);font-weight:600;background:linear-gradient(90deg,var(--shimmer-base) 0%,var(--shimmer-base) 38%,var(--ink) 47%,var(--ink) 53%,var(--shimmer-base) 62%,var(--shimmer-base) 100%);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:ex-shimmer 2.2s linear infinite}
.ex-time{color:var(--muted);font-size:.9em;font-variant-numeric:tabular-nums}
/* 思维链小窗：固定高度，内容贴着底边往上长，顶上淡出；不参与卡片宽度的计算。 */
.ex-chain{display:flex;flex-direction:column;justify-content:flex-end;height:4.6em;margin-top:4px;padding-left:9px;border-left:2px solid color-mix(in srgb,var(--ink) 14%,transparent);overflow:hidden;contain:inline-size;color:var(--muted);font-size:.82em;line-height:1.55;-webkit-mask-image:linear-gradient(transparent,#000 45%);mask-image:linear-gradient(transparent,#000 45%)}
.ex-chain p{white-space:pre-wrap;overflow-wrap:anywhere}
.ex-chain.open{animation:chain-open .28s var(--ease-out,ease) both;display:block;height:auto;max-height:12em;margin:10px 0 0;overflow:auto;-webkit-mask-image:none;mask-image:none}
.ex-text p+p,.ex-text ul,.ex-text ol{margin-top:.45em}
.ex-text ul,.ex-text ol{margin-bottom:0;padding-left:1.3em}
.ex-text .katex-display{margin:.4em 0;overflow-x:auto;overflow-y:hidden}
.ex-error{color:var(--danger)}
.ex-slow{margin-top:5px!important;color:var(--muted);font-size:.85em}
.ex-slow button{padding:0;border:0;background:none;color:var(--accent);font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
@keyframes ex-shimmer{from{background-position:100% 0}to{background-position:0% 0}}
@media(prefers-reduced-motion:reduce){.ex-verb{animation:none}}
@keyframes chain-open{from{opacity:0;transform:translateY(-5px);max-height:0}}
@media(prefers-reduced-motion:reduce){.ex-chain.open{animation:none}}
</style>
