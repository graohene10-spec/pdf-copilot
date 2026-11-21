<script setup lang="ts">
// 总结的草稿面板：盖在阅读区上面的一整张纸，上边一条工具栏，下面是文档。助手写到哪显示到哪。
// 内容不另存一份：就是这段对话里各轮回答写的文档块拼出来的（见 summary.ts）。读者点了「存入文档库」才落成文件。
// 在纸上划选一段，旁边冒出一个小输入框：写一句要求，助手就照着改这一段。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import 'katex/dist/katex.min.css'
import AppIcon from './AppIcon.vue'
import { chatState } from '../ai/workspace'
import { summaryDraft } from '../ai/summary'
import { documentMarkdown } from '../reader/markdown-document'
import { mountIntelligentUi } from '../ai/intelligent-ui'

const props = defineProps<{ documentId: string; conversationId: string; title: string; saving?: boolean; saved?: string }>()
const emit = defineEmits<{ close: []; save: [text: string]; open: []; copied: []; revise: [value: { quote: string; instruction: string }] }>()
const state = computed(() => chatState(props.documentId, props.conversationId))
const draft = computed(() => summaryDraft(state.value.messages))
const size = computed(() => draft.value.text.replace(/\s+/g, '').length)
const busy = computed(() => Boolean(state.value.request))
/** 助手这会儿在干什么（读文档、查到第几段……），还没写出字的时候显示在纸上。 */
const activity = computed(() => busy.value ? state.value.messages.at(-1)?.activity || '正在准备' : '')
const name = computed(() => props.title.replace(/\.(pdf|md|markdown|mdown)$/i, ''))

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
  // 重排之后原来划选的那一段已经不在了。
  ask.value = null
  element.innerHTML = markdown.render(text)
  if (text.includes('```ui')) mountIntelligentUi(element, { streaming: writing })
  if (writing && atEnd) view.scrollTop = view.scrollHeight
}
watch(() => [draft.value.text, draft.value.writing] as const, ([, writing]) => {
  if (!writing) { clearTimeout(timer); timer = 0; void nextTick(render) }
  else if (!timer) timer = window.setTimeout(render, 140)
})
watch(() => props.conversationId, () => { shown = undefined; ask.value = null; void nextTick(render) })

// ---- 划选一段，让助手改 ----
const ask = ref<{ quote: string; left: number; top: number } | null>(null)
const instruction = ref(''), field = ref<HTMLInputElement>()
// 输入框一拿到焦点，纸上的选区就没了：用自定义高亮把那一段继续标着，读者看得见自己要改的是哪儿。
const HIGHLIGHT = 'draft-ask'
const mark = (range?: Range) => { const registry = (CSS as any).highlights, Highlight = (window as any).Highlight; if (!registry || !Highlight) return; if (range) registry.set(HIGHLIGHT, new Highlight(range)); else registry.delete(HIGHLIGHT) }
/** 选中的文字：公式在页面上是一堆拆开的小块，直接取字会变成一行一个符号，换回它的 TeX 源码。 */
function quoteOf(range: Range) {
  const fragment = range.cloneContents()
  for (const formula of fragment.querySelectorAll('.katex')) { const tex = formula.querySelector('annotation')?.textContent; formula.replaceWith(document.createTextNode(tex ? `$${tex}$` : '')) }
  return (fragment.textContent || '').split('\n').map(line => line.trim()).filter(Boolean).join('\n')
}
function selected() {
  const selection = window.getSelection(), element = paper.value, host = root.value
  if (!selection || selection.isCollapsed || !selection.rangeCount || !element || !host || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return
  const range = selection.getRangeAt(0).cloneRange(), text = quoteOf(range)
  const rects = range.getClientRects(), last = rects[rects.length - 1], base = host.getBoundingClientRect()
  if (!text || !last) return
  mark(range)
  // 小输入框放在选区最后一行的下面，别伸出面板。
  ask.value = { quote: text.slice(0, 800), left: Math.max(12, Math.min(base.width - 372, last.right - base.left - 180)), top: Math.min(base.height - 64, last.bottom - base.top + 8) }
  instruction.value = ''
  void nextTick(() => field.value?.focus({ preventScroll: true }))
}
function send() {
  const text = instruction.value.trim()
  if (!ask.value || !text) return
  emit('revise', { quote: ask.value.quote, instruction: text })
  ask.value = null; window.getSelection()?.removeAllRanges()
}
watch(ask, value => { if (!value) mark() })
function away(event: PointerEvent) { if (ask.value && !(event.target as Element).closest('.draft-ask')) ask.value = null }

onMounted(() => {
  observer = new ResizeObserver(place); mutations = new MutationObserver(watchPanes)
  if (root.value?.parentElement) mutations.observe(root.value.parentElement, { childList: true })
  watchPanes(); render()
  document.addEventListener('pointerdown', away, true)
})
onBeforeUnmount(() => { observer?.disconnect(); mutations?.disconnect(); clearTimeout(timer); mark(); document.removeEventListener('pointerdown', away, true) })
async function copy() {
  try { await navigator.clipboard.writeText(draft.value.text); emit('copied') } catch { /* 剪贴板不可用 */ }
}
</script>

<template>
  <section ref="root" class="draft-pane" :style="{ left: `${box.left}px`, width: `${box.width}px` }" role="region" aria-label="总结草稿" @keydown.esc.stop="ask ? (ask = null) : emit('close')">
    <header class="draft-head">
      <div class="draft-title"><h3>总结草稿</h3><p :title="title">{{ name }}</p></div>
      <span class="draft-state" :class="{ live: busy }" role="status">{{ busy ? (draft.writing ? '正在写' : activity) : size ? `${size} 字` : '' }}</span>
      <button v-if="saved" type="button" class="draft-link" :data-tip="`已存为 ${saved}`" @click="emit('open')">已存 · 打开</button>
      <button type="button" class="draft-icon" :disabled="!size" aria-label="复制" data-tip="复制 Markdown 原文" @click="copy"><AppIcon name="copy" :size="15" /></button>
      <button type="button" class="draft-save" :disabled="!size || busy || saving" :data-tip="saved ? '再存一次，覆盖上次存的那份' : '存成 Markdown，放在原文档的文件夹里，并加入文档库'" @click="emit('save', draft.text)">{{ saving ? '正在存…' : saved ? '再存一次' : '存入文档库' }}</button>
      <button type="button" class="draft-icon" aria-label="收起草稿" data-tip="收起草稿，回到原文" @click="emit('close')"><AppIcon name="close" :size="15" /></button>
    </header>
    <div ref="scroller" class="draft-scroll" @scroll.passive="ask = null">
      <!-- 还没有字的时候纸上不留一片空白：助手在忙就显示它在做什么，没在忙就写明接下来怎么用。 -->
      <div v-if="!size" class="draft-blank">
        <p class="draft-blank-kicker">总结</p>
        <h1>{{ name }}</h1>
        <template v-if="busy">
          <p class="draft-blank-state"><i aria-hidden="true"></i>{{ activity }}</p>
          <div class="draft-lines" aria-hidden="true"><i v-for="n in 7" :key="n" :style="{ '--w': `${[92, 78, 86, 64, 90, 72, 48][n - 1]}%`, '--i': n }"></i></div>
        </template>
        <ol v-else class="draft-steps">
          <li><b>开始</b>在右边的表里选好范围和要求，点「开始总结」。</li>
          <li><b>边写边改</b>助手写到哪，这里显示到哪。可以随时打断它，接着提要求；也可以在纸上划选一段，直接写怎么改。</li>
          <li><b>存下来</b>满意后点右上角「存入文档库」，存成 Markdown，放在原文档的文件夹里。</li>
        </ol>
      </div>
      <article v-show="size" ref="paper" class="markdown-paper draft-paper" @mouseup="selected"></article>
    </div>
    <form v-if="ask" class="draft-ask" :style="{ left: `${ask.left}px`, top: `${ask.top}px` }" @submit.prevent="send">
      <input ref="field" v-model="instruction" type="text" maxlength="400" placeholder="这一段怎么改？比如：展开讲、换个例子、删掉" aria-label="这一段怎么改" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.stopPropagation()" @keydown.esc.prevent.stop="ask = null" />
      <button type="submit" :disabled="!instruction.trim()" aria-label="让助手改" data-tip="让助手改这一段"><AppIcon name="arrow-up" :size="14" /></button>
    </form>
  </section>
</template>

<style scoped>
/* 整个面板是一张纸：不再是空桌面上漂着一行字。盖在书签轨道上面（它的层级是 8）。 */
.draft-pane{position:absolute;top:0;bottom:0;z-index:9;display:flex;flex-direction:column;min-width:0;overflow:hidden;border:1px solid var(--hairline);border-radius:var(--r-xl);background:var(--surface,var(--canvas));box-shadow:0 1px 2px rgb(0 0 0 / .05),0 18px 44px -24px rgb(0 0 0 / .3);color:var(--ink);animation:draft-in var(--dur-3) var(--ease-out) both}
@keyframes draft-in{from{opacity:0;translate:0 8px}}
.draft-head{display:flex;align-items:center;gap:10px;flex:none;height:52px;padding:0 12px 0 22px;border-bottom:1px solid var(--hairline)}
.draft-title{display:flex;align-items:baseline;gap:12px;flex:1;min-width:0}
.draft-title h3{flex:none;margin:0;font-size:14.5px;font-weight:650}
.draft-title p{min-width:0;margin:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted);font-size:12.5px}
.draft-state{flex:none;max-width:40%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
.draft-state.live{color:var(--accent)}
.draft-save{flex:none;height:32px;padding:0 16px;border:0;border-radius:9px;background:var(--accent);box-shadow:none;color:var(--accent-on,#fff);font:inherit;font-size:13px;font-weight:600}
.draft-save:hover:not(:disabled){filter:brightness(1.06)}
.draft-save:disabled{opacity:.4}
.draft-link{flex:none;height:30px;padding:0 4px;border:0;background:none;box-shadow:none;color:var(--secondary);font:inherit;font-size:12.5px;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--hairline)}
.draft-link:hover{color:var(--ink)}
.draft-icon{display:grid;place-items:center;flex:none;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--secondary)}
.draft-icon:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink)}
.draft-icon:disabled{opacity:.35}
.draft-scroll{flex:1;min-height:0;overflow:auto}
/* 文档本身：面板就是纸，里面这一层不再画边框和阴影，只管一栏不太宽的正文。 */
.draft-paper{max-width:820px;margin:0 auto;padding:34px 44px 72px;border:0;border-radius:0;background:none;box-shadow:none}
/* 还没有字时纸上的内容。 */
.draft-blank{max-width:820px;margin:0 auto;padding:44px 44px 72px}
.draft-blank-kicker{margin:0 0 6px;color:var(--accent);font-size:12.5px;font-weight:650;letter-spacing:.18em}
.draft-blank h1{margin:0 0 22px;padding-bottom:16px;border-bottom:1px solid var(--hairline);font-size:26px;font-weight:650;line-height:1.35;overflow-wrap:anywhere}
.draft-blank-state{display:flex;align-items:center;gap:10px;margin:0 0 22px;color:var(--secondary);font-size:13.5px}
.draft-blank-state i{flex:none;width:8px;height:8px;border-radius:50%;background:var(--accent);animation:draft-pulse 1.1s ease-in-out 40 alternate}
@keyframes draft-pulse{from{opacity:.25;scale:.8}to{opacity:1;scale:1}}
.draft-lines{display:flex;flex-direction:column;gap:14px}
.draft-lines i{width:var(--w);height:11px;border-radius:6px;background:color-mix(in srgb,var(--ink) 8%,transparent);animation:draft-line 1.4s ease-in-out 30 alternate;animation-delay:calc(var(--i) * 90ms)}
@keyframes draft-line{from{opacity:.45}to{opacity:1}}
.draft-steps{display:flex;flex-direction:column;gap:16px;margin:0;padding:0;list-style:none;counter-reset:step;color:var(--secondary);font-size:14px;line-height:1.75}
.draft-steps li{position:relative;padding-left:40px;counter-increment:step}
.draft-steps li::before{content:counter(step);position:absolute;left:0;top:1px;display:grid;place-items:center;width:24px;height:24px;border:1px solid color-mix(in srgb,var(--ink) 26%,transparent);border-radius:50%;color:var(--ink);font-size:12.5px;font-weight:600}
.draft-steps b{display:block;color:var(--ink);font-weight:650}
/* 划选之后冒出来的小输入框。 */
.draft-ask{position:absolute;z-index:3;display:flex;align-items:center;gap:6px;width:360px;height:44px;padding:0 6px 0 14px;border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-radius:12px;background:var(--surface,var(--canvas));box-shadow:0 12px 30px -12px rgb(0 0 0 / .4);animation:draft-in var(--dur-2) var(--ease-out) both}
.draft-ask input{flex:1;min-width:0;height:100%;padding:0;border:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13.5px;outline:0}
.draft-ask input::placeholder{color:var(--muted)}
.draft-ask button{display:grid;place-items:center;flex:none;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:var(--accent);box-shadow:none;color:var(--accent-on,#fff)}
.draft-ask button:disabled{opacity:.35}
@media (prefers-reduced-motion:reduce){.draft-pane,.draft-ask,.draft-blank-state i,.draft-lines i{animation:none}}
/* 草稿风格：这一块不用手写体，也不描铅笔边——是要读、要改的正式文档。标题同样用正经的字体。 */
:root[data-style='sketch'] .draft-pane{font-family:var(--font-formal);background:var(--paper,#fdfaf0);border-color:color-mix(in srgb,var(--pencil,#2b2a27) 28%,transparent);border-radius:10px}
:root[data-style='sketch'] .draft-pane :is(button,input){font-family:var(--font-formal)}
:root[data-style='sketch'] .draft-pane button:hover:not(:disabled){rotate:none}
:root[data-style='sketch'] .draft-save,:root[data-style='sketch'] .draft-icon{border-radius:8px}
:root[data-style='sketch'] .draft-ask button{border-radius:50%}
:root[data-style='sketch'] .draft-paper :deep(:is(h1,h2,h3,h4,h5,h6)){font-family:var(--font-formal);letter-spacing:0}
</style>
