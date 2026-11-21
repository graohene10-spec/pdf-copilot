<script setup lang="ts">
// 总结的草稿面板：盖在阅读区上面的一张纸，助手写到哪显示到哪。
// 内容不另存一份：就是这段对话里各轮回答写的文档块拼出来的（见 summary.ts）。读者点了「存入文档库」才落成文件。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import 'katex/dist/katex.min.css'
import AppIcon from './AppIcon.vue'
import { chatState } from '../ai/workspace'
import { summaryDraft } from '../ai/summary'
import { documentMarkdown } from '../reader/markdown-document'
import { mountIntelligentUi } from '../ai/intelligent-ui'

const props = defineProps<{ documentId: string; conversationId: string; title: string; saving?: boolean; saved?: string }>()
const emit = defineEmits<{ close: []; save: [text: string]; open: []; copied: [] }>()
const draft = computed(() => summaryDraft(chatState(props.documentId, props.conversationId).messages))
const size = computed(() => draft.value.text.replace(/\s+/g, '').length)

// ---- 位置：正好盖住阅读区的那几栏，助手栏留在旁边。阅读栏变宽变窄（拖助手宽度、开关侧栏）时跟着变。 ----
const root = ref<HTMLElement>(), box = ref({ left: 0, width: 0 })
let observer: ResizeObserver | undefined, mutations: MutationObserver | undefined
function place() {
  const host = root.value?.parentElement
  if (!host) return
  const base = host.getBoundingClientRect()
  let left = Infinity, right = -Infinity
  for (const pane of host.querySelectorAll<HTMLElement>(':scope > .reader-pane')) { const rect = pane.getBoundingClientRect(); if (rect.width) { left = Math.min(left, rect.left); right = Math.max(right, rect.right) } }
  if (right > left) { const next = { left: Math.round(left - base.left), width: Math.round(right - left) }; if (next.left !== box.value.left || next.width !== box.value.width) box.value = next }
}
function watchPanes() {
  const host = root.value?.parentElement
  if (!host || !observer) return
  observer.disconnect(); observer.observe(host)
  for (const pane of host.querySelectorAll<HTMLElement>(':scope > .reader-pane')) observer.observe(pane)
  place()
}

// ---- 内容：写的过程中隔一小会儿重排一次，写完立刻排最后一次。读者停在末尾时跟着往下走，往回翻了就不动他。 ----
const paper = ref<HTMLElement>(), scroller = ref<HTMLElement>()
const markdown = documentMarkdown()
let timer = 0, shown: string | undefined
function render() {
  timer = 0
  const element = paper.value, view = scroller.value
  if (!element || !view) return
  const { text, writing } = draft.value
  if (text === shown) return
  const atEnd = view.scrollHeight - view.scrollTop - view.clientHeight < 90
  shown = text
  element.innerHTML = markdown.render(text)
  if (text.includes('```ui')) mountIntelligentUi(element, { streaming: writing })
  if (writing && atEnd) view.scrollTop = view.scrollHeight
}
watch(() => [draft.value.text, draft.value.writing] as const, ([, writing]) => {
  if (!writing) { clearTimeout(timer); timer = 0; void nextTick(render) }
  else if (!timer) timer = window.setTimeout(render, 140)
})
watch(() => props.conversationId, () => { shown = undefined; void nextTick(render) })
onMounted(() => {
  observer = new ResizeObserver(place); mutations = new MutationObserver(watchPanes)
  if (root.value?.parentElement) mutations.observe(root.value.parentElement, { childList: true })
  watchPanes(); render()
})
onBeforeUnmount(() => { observer?.disconnect(); mutations?.disconnect(); clearTimeout(timer) })
async function copy() {
  try { await navigator.clipboard.writeText(draft.value.text); emit('copied') } catch { /* 剪贴板不可用 */ }
}
</script>

<template>
  <section ref="root" class="draft-pane" :style="{ left: `${box.left}px`, width: `${box.width}px` }" role="region" aria-label="总结草稿" @keydown.esc.stop="emit('close')">
    <header class="draft-head">
      <AppIcon name="doc" :size="16" />
      <h3>总结草稿</h3>
      <p class="draft-of" :title="title">{{ title }}</p>
      <span class="draft-state" :class="{ writing: draft.writing }" role="status">{{ draft.writing ? '正在写' : size ? `${size} 字` : '' }}</span>
      <button v-if="saved" type="button" class="draft-link" :data-tip="`已存为 ${saved}`" @click="emit('open')">已存 · 打开</button>
      <button type="button" class="draft-close" :disabled="!size" aria-label="复制" data-tip="复制 Markdown 原文" @click="copy"><AppIcon name="copy" :size="15" /></button>
      <button type="button" class="draft-button primary" :disabled="!size || draft.writing || saving" :data-tip="saved ? '再存一次，覆盖上次存的那份' : '存成 Markdown，放在原文档的文件夹里，并加入文档库'" @click="emit('save', draft.text)">{{ saving ? '正在存…' : saved ? '再存一次' : '存入文档库' }}</button>
      <button type="button" class="draft-close" aria-label="收起草稿" data-tip="收起草稿，回到原文" @click="emit('close')"><AppIcon name="close" :size="15" /></button>
    </header>
    <div ref="scroller" class="draft-scroll">
      <p v-if="!size" class="draft-empty">{{ draft.writing ? '助手正在读文档，写出来的内容会出现在这里。' : '还没有内容。助手开始写之后，文档会出现在这里。' }}</p>
      <article v-show="size" ref="paper" class="markdown-paper draft-paper"></article>
    </div>
  </section>
</template>

<style scoped>
.draft-pane{position:absolute;top:0;bottom:0;z-index:6;display:flex;flex-direction:column;min-width:0;border-radius:var(--r-xl);background:var(--canvas);animation:draft-in var(--dur-3) var(--ease-out) both}
@keyframes draft-in{from{opacity:0;translate:0 8px}}
.draft-head{display:flex;align-items:center;gap:9px;flex:none;height:48px;padding:0 10px 0 16px;color:var(--ink)}
.draft-head h3{flex:none;margin:0;font-size:14px;font-weight:700;letter-spacing:.06em}
.draft-of{flex:1;min-width:0;margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--secondary);font-size:12.5px}
.draft-state{flex:none;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.draft-state.writing{color:var(--accent)}
.draft-state.writing::after{content:'…';display:inline-block;width:1em;animation:draft-dots 1.2s steps(4,end) 20}
@keyframes draft-dots{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
.draft-button{display:inline-flex;align-items:center;gap:6px;flex:none;height:30px;padding:0 12px;border:1px solid var(--hairline);border-radius:999px;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px}
.draft-button:hover:not(:disabled){border-color:color-mix(in srgb,var(--ink) 36%,transparent)}
.draft-button:disabled{opacity:.45}
.draft-button.primary{border-color:transparent;background:var(--accent);color:var(--accent-on,#fff);font-weight:650}
.draft-button.primary:hover:not(:disabled){filter:brightness(1.06)}
.draft-link{flex:none;height:30px;padding:0 4px;border:0;background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:12px;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--hairline)}
.draft-link:hover{color:var(--ink)}
.draft-close:disabled{opacity:.4}
.draft-close{display:grid;place-items:center;flex:none;width:32px;height:32px;padding:0;border:0;border-radius:50%;background:none;box-shadow:none;color:var(--secondary)}
.draft-close:hover{background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.draft-scroll{flex:1;min-height:0;overflow:auto;padding:14px 30px 40px}
.draft-empty{margin:18vh 0 0;color:var(--muted);font-size:13px;text-align:center}
@media (prefers-reduced-motion:reduce){.draft-pane,.draft-state.writing::after{animation:none}}
</style>
