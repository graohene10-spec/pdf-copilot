<script setup lang="ts">
// Markdown 里插在段落下面的一条释义：可以留在笔记里、换个讲法，或者丢掉。
import { onMounted, ref, watch } from 'vue'
import ExplainBody from './ExplainBody.vue'
import { dropNote, keepNote, rerunExplain, type Explain, type ExplainMode } from '../ai/explain'

const props = defineProps<{ item: Explain; kept: boolean; doc: string; line: number }>()
const emit = defineEmits<{ close: [] }>()
// 解释写完就自动记下来，关掉文档再打开还在；不想留的点一下「已记入」取消，或者直接「关闭」。
const saved = ref(true)
const leaving = ref(false)
function keep() { if (props.item.status !== 'done') return; saved.value = !saved.value; if (saved.value) keepNote(props.doc, props.line, props.item); else dropNote(props.doc, props.item.id) }
function again(mode: ExplainMode) { rerunExplain(props.item, mode) }
// 留下的释义换了讲法，存的也跟着换。
watch(() => props.item.status, status => { if (status === 'done' && saved.value) keepNote(props.doc, props.line, props.item) }, { immediate: !props.kept })
// 出现和关闭都带着高度一起变：下面的正文被慢慢推开、慢慢合拢，不会一下子跳。
const root = ref<HTMLElement>()
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const folded = { height: '0px', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 }
function open() { const style = getComputedStyle(root.value!); return { height: `${root.value!.offsetHeight}px`, marginTop: style.marginTop, marginBottom: style.marginBottom, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, opacity: 1 } }
onMounted(() => { if (root.value && !props.kept && !still()) { root.value.style.overflow = 'hidden'; root.value.animate([folded, open()], { duration: 280, easing: 'cubic-bezier(.22,.9,.28,1)' }).finished.then(() => { if (root.value) root.value.style.overflow = '' }, () => {}) } })
function discard() {
  dropNote(props.doc, props.item.id)
  if (!root.value || still()) { emit('close'); return }
  leaving.value = true
  root.value.style.overflow = 'hidden'
  const done = () => emit('close')
  root.value.animate([open(), folded], { duration: 240, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished.then(done, done)
}
</script>

<template>
  <aside ref="root" class="explain-note" :class="{ leaving, saved }" contenteditable="false">
    <p class="en-head"><span>释义</span><b>{{ item.term.length > 60 ? item.term.slice(0, 60) + '…' : item.term }}</b></p>
    <ExplainBody :item="item" />
    <p class="en-actions">
      <button type="button" :class="{ on: saved }" :disabled="item.status !== 'done'" @click="keep">{{ saved ? '已记入' : '记入文档' }}</button>
      <button type="button" :disabled="item.status === 'running'" @click="again('deeper')">深入</button>
      <button type="button" :disabled="item.status === 'running'" @click="again('simpler')">简化</button>
      <button type="button" :disabled="item.status === 'running'" @click="again('example')">举例</button>
      <button type="button" class="en-close" @click="discard">关闭</button>
    </p>
  </aside>
</template>

<style>
/* 释义卡片跟着界面风格走：液态玻璃是一块磨砂卡片，暖色极简是带陶土色竖线的象牙白纸，铅笔草稿是一张贴着胶带的便签。 */
.explain-host{display:block}
.explain-note{position:relative;margin:.9em 0 1.4em;padding:.85em 1.1em .8em;border:1px solid var(--glass-outline);border-radius:var(--r-lg,16px);background-color:var(--popup-glass);background-image:radial-gradient(90% 120% at 0 0,color-mix(in srgb,var(--accent) 12%,transparent),transparent 55%),var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));box-shadow:0 14px 30px -20px rgb(0 0 0 / .45),var(--glass-edge);color:var(--ink);font-size:.92em;line-height:1.65;user-select:text;transform-origin:0 0}
.explain-note.leaving{pointer-events:none}
.explain-note p{margin:0}
.en-head{display:flex;align-items:center;gap:.55em;margin-bottom:.35em!important;padding-right:1.8em}
.en-head span{flex:none;padding:.1em .7em;border-radius:999px;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 62%,#fff));color:#fff;font-size:.72em;font-weight:650;letter-spacing:.1em;line-height:1.6}
.en-head b{color:var(--ink);font-size:.98em;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 选项收在一条分段的玻璃胶囊里；关闭是右上角的一个小叉。 */
.en-actions{display:inline-flex;align-items:center;gap:1px;width:fit-content;max-width:100%;margin-top:.8em!important;padding:2px;border-radius:999px;background:color-mix(in srgb,var(--ink) 6%,transparent);box-shadow:inset 0 0 0 1px var(--glass-outline);font-size:.8em}
.en-actions button{min-height:0;padding:.2em .95em;border:0;border-radius:999px;background:none!important;box-shadow:none!important;color:var(--muted);font:inherit;line-height:1.55;cursor:pointer;transition:color .15s,background-color .15s,box-shadow .15s}
.en-actions button:hover:not(:disabled){background:color-mix(in srgb,var(--surface,#fff) 78%,transparent)!important;box-shadow:0 1px 3px rgb(0 0 0 / .14)!important;color:var(--ink)}
.en-actions button.on{color:var(--accent);font-weight:600}
.en-actions button.on::before{content:'✓ '}
.en-actions button:disabled{opacity:.45;cursor:default}
.en-actions .en-close{position:absolute;top:.6em;right:.65em;width:22px;height:22px;padding:0;border-radius:50%;font-size:0;opacity:.5}
.en-actions .en-close::before{content:'✕';font-size:11px;line-height:22px}
.en-actions .en-close:hover{opacity:1}
/* 暖色极简：象牙白，细线，陶土色竖线，衬线字；选项是一行用间隔号分开的文字。 */
:root[data-style='warm'] .explain-note{padding:.75em 1.1em .65em 1.2em;border:.5px solid var(--warm-rule,rgb(31 30 29 / .18));border-left:2px solid var(--accent);border-radius:6px;background:var(--surface);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:0 8px 22px -16px rgb(31 30 29 / .35);font-family:var(--font-reading)}
:root[data-style='warm'] .en-head span{padding:0;border-radius:0;background:none;font-style:italic;font-weight:500;letter-spacing:.14em}
:root[data-style='warm'] .en-head span::after{content:'—';margin-left:.6em;opacity:.5}
:root[data-style='warm'] .en-head{gap:0}
:root[data-style='warm'] .en-actions{display:flex;width:auto;gap:0;border-radius:0;background:none;box-shadow:none;padding-top:.5em;border-top:.5px solid var(--warm-rule,rgb(31 30 29 / .14))}
:root[data-style='warm'] .en-actions button{padding:0;border:0;border-radius:0;background:none!important;text-underline-offset:3px}
:root[data-style='warm'] .en-actions button:not(:first-child):not(.en-close)::before{content:'·';display:inline-block;margin:0 .7em;color:var(--muted);opacity:.6;text-decoration:none}
:root[data-style='warm'] .en-actions button:hover:not(:disabled){background:none!important;color:var(--accent);text-decoration:underline}
:root[data-style='warm'] .en-actions button.on{background:none!important;color:var(--accent);font-style:italic}
/* 铅笔草稿：撕下来的便签，贴着胶带，微微歪着；「释义」用铅笔圈起来，选项下面划波浪线。 */
:root[data-style='sketch'] .explain-note{margin:1.1em 0 1.4em;padding:1.05em 1.05em .65em;border:0;border-radius:2px;background:color-mix(in srgb,var(--paper,#fdfaf0) 72%,#f3d260);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:1px 2px 0 rgb(60 50 30 / .1),5px 9px 18px -10px rgb(60 50 30 / .5);color:var(--pencil,#2b2a27);font-family:var(--font-answer,var(--font));font-size:1em;rotate:-.35deg}
:root[data-style='sketch'] .explain-note::before{content:'';position:absolute;left:38px;top:-9px;width:70px;height:18px;background:var(--tape,rgb(170 200 225 / .7));rotate:-2.5deg;clip-path:polygon(3% 10%,97% 0,100% 90%,0 100%)}
:root[data-style='sketch'] .en-head span{padding:0 .6em;border:1.5px solid var(--pencil,#2b2a27);border-radius:55% 45% 52% 48% / 48% 56% 44% 52%;background:none;color:var(--pencil,#2b2a27);letter-spacing:.05em;rotate:-2deg}
:root[data-style='sketch'] .en-head b{color:var(--pencil-soft,rgb(46 45 42 / .6))}
:root[data-style='sketch'] .en-actions{display:flex;flex-wrap:wrap;width:auto;padding:0;border-radius:0;background:none;box-shadow:none;gap:.2em 1.1em;font-size:.88em}
:root[data-style='sketch'] .en-actions button{padding:0;border:0;border-radius:0;background:none!important;color:var(--pencil,#2b2a27);text-decoration:underline wavy var(--pencil-soft,rgb(46 45 42 / .45));text-underline-offset:4px}
:root[data-style='sketch'] .en-actions button:hover:not(:disabled),:root[data-style='sketch'] .en-actions button.on{background:none!important;color:var(--red-pencil,#c0392b);text-decoration-color:currentColor}
:root:is([data-style='warm'],[data-style='sketch']) .en-head{padding-right:0}
:root:is([data-style='warm'],[data-style='sketch']) .en-actions .en-close{position:static;width:auto;height:auto;margin-left:auto;border-radius:0;font-size:inherit;opacity:1}
:root:is([data-style='warm'],[data-style='sketch']) .en-actions .en-close::before{content:none}
:root:is([data-style='warm'],[data-style='sketch']) .en-actions button.on::before{content:none}
:root:is([data-style='warm'],[data-style='sketch']) .en-actions button:hover:not(:disabled){box-shadow:none!important}
:root[data-style='warm'] .en-head span,:root[data-style='sketch'] .en-head span{font-size:1em;line-height:inherit}
:root[data-style='warm'] .en-head span{background:none;color:var(--accent)}
:root:is([data-style='warm'],[data-style='sketch']) .en-head{font-size:.82em}
:root:is([data-style='warm'],[data-style='sketch']) .en-head b{font-size:1em;font-weight:600;color:var(--muted)}
@keyframes en-in{from{opacity:0;translate:0 -6px}}
@media(prefers-reduced-motion:reduce){.explain-note{animation:none}}
</style>
