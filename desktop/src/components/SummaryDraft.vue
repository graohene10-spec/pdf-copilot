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
const emit = defineEmits<{ close: []; save: [text: string]; open: []; copied: []; revise: [value: { quote: string; instruction: string }]; /** 有修改没对上原文：让助手把那几处重新给一遍。 */ retry: [] }>()
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
  // 局部修改：记下改之前每一块的字，改完比一比，哪几块变了就标出来，并把第一块带到眼前。
  const before = draft.value.last === 'edit' ? [...element.children].map(node => node.textContent || '') : null
  element.innerHTML = markdown.render(text)
  if (text.includes('```ui')) mountIntelligentUi(element, { streaming: writing })
  if (before?.length) showChange(element, view, before)
  else if (writing && atEnd) view.scrollTop = view.scrollHeight
}
let lastChanged = -1
function showChange(element: HTMLElement, view: HTMLElement, before: string[]) {
  const now = [...element.children] as HTMLElement[]
  let head = 0, tail = 0
  while (head < now.length && head < before.length && now[head]!.textContent === before[head]) head++
  while (tail < now.length - head && tail < before.length - head && now[now.length - 1 - tail]!.textContent === before[before.length - 1 - tail]) tail++
  const changed = now.slice(head, now.length - tail)
  if (!changed.length) { if (head < now.length && before.length > now.length) lastChanged = -1; return }
  for (const node of changed.slice(0, 40)) node.classList.add('draft-changed')
  // 同一处一直在写的时候不反复滚；换了地方、或者它不在眼前，才滚过去。
  const box = changed[0]!.getBoundingClientRect(), frame = view.getBoundingClientRect()
  if (head !== lastChanged || box.bottom < frame.top + 40 || box.top > frame.bottom - 40) view.scrollTo({ top: view.scrollTop + box.top - frame.top - frame.height * .3 })
  lastChanged = head
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
  ask.value = { quote: text.slice(0, 800), left: Math.max(16, Math.min(base.width - ASK_WIDTH - 16, last.right - base.left - ASK_WIDTH / 2)), top: Math.min(base.height - 64, last.bottom - base.top + 8) }
  instruction.value = ''
  void nextTick(() => field.value?.focus({ preventScroll: true }))
}
// 小输入框的宽：面板窄的时候跟着收。
const ASK_WIDTH = 440
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
    <header class="draft-head" :class="{ running: busy }">
      <div class="draft-title"><h3>总结草稿</h3><p :title="title">{{ name }}</p></div>
      <button v-if="!busy && draft.missed" type="button" class="draft-warn" data-tip="助手抄的原文和草稿对不上，那几处没有改动。点一下让它对照草稿重新给" @click="emit('retry')">{{ draft.missed }} 处没改成 · 让助手重来</button>
      <!-- 助手在忙的时候不在这里写它读到第几段：表头下沿一道流光就够了（和快速解释卡片上的那道一样）。 -->
      <span v-if="!busy && size" class="draft-state">{{ size }} 字</span>
      <span v-else-if="busy" class="draft-live" role="status">{{ draft.writing ? (draft.last === 'edit' ? '正在改' : '正在写') : '助手在忙' }}</span>
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
      <input ref="field" v-model="instruction" type="text" maxlength="400" placeholder="这一段怎么改？比如：展开讲、换个例子" aria-label="这一段怎么改" @keydown.enter="($event.isComposing || $event.keyCode === 229) && $event.stopPropagation()" @keydown.esc.prevent.stop="ask = null" />
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
/* 只给读屏听的：正在写 / 正在改。看得见的是表头下沿那道流光。 */
.draft-live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.draft-head{position:relative}
.draft-head.running::after{content:'';position:absolute;left:0;bottom:-1px;width:38%;height:2px;border-radius:1px;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:draft-run 1.15s cubic-bezier(.45,0,.55,1) infinite;pointer-events:none}
@keyframes draft-run{from{translate:-110% 0}to{translate:290% 0}}
.draft-warn{flex:none;height:28px;padding:0 10px;border:1px solid color-mix(in srgb,#c0392b 55%,transparent);border-radius:8px;background:color-mix(in srgb,#c0392b 8%,transparent);box-shadow:none;color:#b03a2e;font:inherit;font-size:12.5px}
.draft-warn:hover{background:color-mix(in srgb,#c0392b 14%,transparent)}
/* 刚改过的那几块：淡淡地亮一下，再褪掉。 */
.draft-paper :deep(.draft-changed){border-radius:4px;animation:draft-changed 2.4s ease-out 1 both}
@keyframes draft-changed{from{background:color-mix(in srgb,var(--accent) 20%,transparent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 20%,transparent)}to{background:transparent;box-shadow:0 0 0 6px transparent}}
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
.draft-ask{position:absolute;z-index:3;display:flex;align-items:center;gap:8px;box-sizing:border-box;width:min(440px,calc(100% - 32px));height:46px;padding:0 7px 0 16px;border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-radius:12px;background:var(--surface,var(--canvas));box-shadow:0 12px 30px -12px rgb(0 0 0 / .4);animation:draft-in var(--dur-2) var(--ease-out) both}
.draft-ask input{flex:1;min-width:0;height:100%;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13.5px;outline:0;text-overflow:ellipsis}
.draft-ask input::placeholder{color:var(--muted)}
.draft-ask button{display:grid;place-items:center;flex:none;width:32px;height:32px;padding:0;border:0;border-radius:50%;background:var(--accent);box-shadow:none;color:var(--accent-on,#fff)}
.draft-ask button:disabled{opacity:.35}
@media (prefers-reduced-motion:reduce){.draft-head.running::after{animation:none;width:100%;opacity:.5}.draft-pane,.draft-ask,.draft-blank-state i,.draft-lines i{animation:none}.draft-paper :deep(.draft-changed){animation-duration:.01s}}
/* 草稿风格：一张铅笔框的稿纸。面板的框、表头、按钮、空白时的示意都是手画手写的；
   文档正文是要读、要改的东西，用正经字体，只在标题上留铅笔和荧光笔的痕迹。字都摆正。 */
:root[data-style='sketch'] .draft-pane{border:1.5px solid var(--pencil);border-radius:var(--r-bar);background:var(--paper);box-shadow:3px 4px 0 color-mix(in srgb,var(--pencil) 15%,transparent);font-family:var(--font-formal)}
:root[data-style='sketch'] .draft-head{height:56px;border-bottom:1.5px solid var(--pencil)}
:root[data-style='sketch'] .draft-title{align-items:center;gap:14px}
:root[data-style='sketch'] .draft-title h3{font-family:var(--font-display);font-size:24px;font-weight:400;line-height:1.1;letter-spacing:.06em;text-decoration:underline wavy var(--red-pencil) 1.1px;text-underline-offset:5px}
:root[data-style='sketch'] .draft-title p{font-family:var(--font-formal)}
:root[data-style='sketch'] .draft-state,:root[data-style='sketch'] .draft-link,:root[data-style='sketch'] .draft-warn{font-family:var(--font);font-size:17px}
:root[data-style='sketch'] .draft-head.running::after{bottom:-2px;height:2.5px;background:linear-gradient(90deg,transparent,var(--red-pencil),transparent)}
:root[data-style='sketch'] .draft-save{height:34px;padding:0 18px;border:1.5px solid var(--pencil);border-radius:var(--r-control);background:var(--pencil);box-shadow:2px 3px 0 color-mix(in srgb,var(--pencil) 26%,transparent);color:var(--paper);font-family:var(--font);font-size:17.5px;font-weight:400;letter-spacing:.05em}
:root[data-style='sketch'] .draft-icon{border-radius:var(--r-control)}
:root[data-style='sketch'] .draft-warn{height:30px;border:1.4px solid var(--red-pencil);border-radius:var(--r-control);background:none;color:var(--red-pencil)}
/* 还没有字：标题下面一道铅笔线，等着的时候是几行波浪线——还没写出来的字。 */
:root[data-style='sketch'] .draft-blank-kicker{font-family:var(--font);font-size:19px;font-weight:400;letter-spacing:.2em;color:var(--red-pencil)}
:root[data-style='sketch'] .draft-blank h1{font-family:var(--font-formal);border-bottom:1.5px solid var(--pencil)}
:root[data-style='sketch'] .draft-blank-state{font-family:var(--font);font-size:18px}
:root[data-style='sketch'] .draft-blank-state i{width:10px;height:10px;border:1.5px solid var(--red-pencil);background:none}
:root[data-style='sketch'] .draft-lines{gap:17px}
:root[data-style='sketch'] .draft-lines i{height:8px;border-radius:0;background:color-mix(in srgb,var(--pencil) 34%,transparent);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 8'%3E%3Cpath d='M0 4c5.500-4.200 11 4.200 16.500 0s11 4.200 16.500 0 5.500-2.100 11 0' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") 0 50% / 44px 8px repeat-x;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 8'%3E%3Cpath d='M0 4c5.500-4.200 11 4.200 16.500 0s11 4.200 16.500 0 5.500-2.100 11 0' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") 0 50% / 44px 8px repeat-x}
:root[data-style='sketch'] .draft-steps li::before{border:1.5px solid var(--pencil);border-radius:48% 52% 50% 50% / 52% 48% 52% 48%;font-family:var(--font);font-size:16px;font-weight:400}
:root[data-style='sketch'] .draft-steps b{font-family:var(--font);font-size:19px;font-weight:400;letter-spacing:.04em}
/* 文档：一级标题下面一道铅笔线，二级标题像用荧光笔划过。 */
:root[data-style='sketch'] .draft-paper{border:0;background:none;box-shadow:none}
:root[data-style='sketch'] .draft-paper :deep(:is(h1,h2,h3,h4,h5,h6)){font-family:var(--font-formal);font-weight:650;letter-spacing:0}
:root[data-style='sketch'] .draft-paper :deep(h1){padding-bottom:12px;border-bottom:1.5px solid var(--pencil)}
:root[data-style='sketch'] .draft-paper :deep(h2){width:fit-content;max-width:100%;padding:0 8px 0 3px;margin-left:-3px;border:0;background:linear-gradient(transparent 56%,color-mix(in srgb,var(--sticky) 80%,transparent) 56% 94%,transparent 94%)}
:root[data-style='sketch'][data-theme='dark'] .draft-paper :deep(h2){background:linear-gradient(transparent 56%,color-mix(in srgb,var(--sticky) 26%,transparent) 56% 94%,transparent 94%)}
:root[data-style='sketch'] .draft-paper :deep(blockquote){border-left:2.5px solid var(--pencil);border-radius:0;background:none}
:root[data-style='sketch'] .draft-paper :deep(hr){height:0;border:0;border-top:1.4px dashed color-mix(in srgb,var(--pencil) 45%,transparent);background:none}
:root[data-style='sketch'] .draft-paper :deep(:is(th,td)){border-color:color-mix(in srgb,var(--pencil) 55%,transparent)}
/* 划选后的小输入框：一张铅笔框的小纸条。 */
:root[data-style='sketch'] .draft-ask{border:1.5px solid var(--pencil);border-radius:var(--r-control);background:var(--paper);box-shadow:2px 3px 0 color-mix(in srgb,var(--pencil) 22%,transparent)}
:root[data-style='sketch'] .draft-ask input{font-family:var(--font-formal);font-size:14px}
:root[data-style='sketch'] .draft-ask button:disabled{background:color-mix(in srgb,var(--pencil) 35%,transparent);opacity:1}
:root[data-style='sketch'] .draft-ask button{border-radius:50%;background:var(--pencil);color:var(--paper)}
</style>
