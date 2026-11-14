<script setup lang="ts">
// Markdown 里插在段落下面的一条释义：可以留在笔记里、换个讲法，或者丢掉。
import { onMounted, ref, watch } from 'vue'
import ExplainBody from './ExplainBody.vue'
import AppIcon from './AppIcon.vue'
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
      <button type="button" :class="{ on: saved }" :disabled="item.status !== 'done'" :aria-pressed="saved" :aria-label="saved ? '已记入文档' : '记入文档'" :data-tip="saved ? '已记入文档，点一下取消' : '记入文档'" @click="keep"><AppIcon name="bookmark" :size="15" /></button>
      <i aria-hidden="true"></i>
      <button type="button" :disabled="item.status === 'running'" aria-label="深入" data-tip="深入" @click="again('deeper')"><AppIcon name="deeper" :size="15" /></button>
      <button type="button" :disabled="item.status === 'running'" aria-label="简化" data-tip="简化" @click="again('simpler')"><AppIcon name="simpler" :size="15" /></button>
      <button type="button" :disabled="item.status === 'running'" aria-label="举例" data-tip="举例" @click="again('example')"><AppIcon name="example" :size="15" /></button>
      <button type="button" class="en-close" aria-label="关闭" data-tip="关闭" @click="discard"><AppIcon name="close" :size="13" /></button>
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
/* 选项是一排图标：液态玻璃收在一条胶囊里，关闭在右上角；暖色极简是细线上的一行；铅笔草稿是铅笔画的小记号。 */
.en-actions{display:inline-flex;align-items:center;gap:1px;width:fit-content;max-width:100%;margin-top:.8em!important;padding:2px;border-radius:999px;background:color-mix(in srgb,var(--ink) 6%,transparent);box-shadow:inset 0 0 0 1px var(--glass-outline)}
.en-actions button{display:grid;place-items:center;width:30px;height:24px;min-height:0;padding:0;border:0;border-radius:999px;background:none!important;box-shadow:none!important;color:var(--muted);cursor:pointer;transition:color .15s,background-color .15s,box-shadow .15s,scale .18s var(--spring-snappy,ease-out)}
.en-actions button:hover:not(:disabled){background:color-mix(in srgb,var(--surface,#fff) 78%,transparent)!important;box-shadow:0 1px 3px rgb(0 0 0 / .14)!important;color:var(--ink)}
.en-actions button:active:not(:disabled){scale:.9}
.en-actions button.on{color:var(--accent)}
.en-actions button.on svg{fill:color-mix(in srgb,currentColor 28%,transparent)}
.en-actions button:disabled{opacity:.4;cursor:default}
.en-actions i{width:1px;height:12px;margin:0 3px;background:var(--glass-outline)}
.en-actions .en-close{position:absolute;top:.55em;right:.6em;width:22px;height:22px;border-radius:50%;opacity:.5}
.en-actions .en-close:hover{opacity:1}
:root:is([data-style='warm'],[data-style='sketch']) .en-actions{display:flex;width:auto;gap:.35em;padding:.45em 0 0;border-radius:0;background:none;box-shadow:none}
:root:is([data-style='warm'],[data-style='sketch']) .en-actions button{width:26px;border-radius:5px}
:root:is([data-style='warm'],[data-style='sketch']) .en-actions button:hover:not(:disabled){background:none!important;box-shadow:none!important}
:root:is([data-style='warm'],[data-style='sketch']) .en-actions .en-close{position:static;margin-left:auto;opacity:.7}
:root:is([data-style='warm'],[data-style='sketch']) .en-actions i{display:none}
:root[data-style='warm'] .en-actions{border-top:.5px solid var(--warm-rule,rgb(31 30 29 / .14))}
:root[data-style='warm'] .en-actions button:hover:not(:disabled){color:var(--accent)}
:root[data-style='sketch'] .en-actions{padding-top:.25em}
:root[data-style='sketch'] .en-actions button{color:var(--pencil,#2b2a27);opacity:.75}
:root[data-style='sketch'] .en-actions button:hover:not(:disabled),:root[data-style='sketch'] .en-actions button.on{color:var(--red-pencil,#c0392b);opacity:1;rotate:-6deg}
/* 暖色极简：象牙白，细线，陶土色竖线，衬线字；选项是一行用间隔号分开的文字。 */
:root[data-style='warm'] .explain-note{padding:.75em 1.1em .65em 1.2em;border:.5px solid var(--warm-rule,rgb(31 30 29 / .18));border-left:2px solid var(--accent);border-radius:6px;background:var(--surface);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:0 8px 22px -16px rgb(31 30 29 / .35);font-family:var(--font-reading)}
:root[data-style='warm'] .en-head span{padding:0;border-radius:0;background:none;font-style:italic;font-weight:500;letter-spacing:.14em}
:root[data-style='warm'] .en-head span::after{content:'—';margin-left:.6em;opacity:.5}
:root[data-style='warm'] .en-head{gap:0}
/* 铅笔草稿：撕下来的便签，贴着胶带，微微歪着；「释义」用铅笔圈起来，选项下面划波浪线。 */
:root[data-style='sketch'] .explain-note{margin:1.1em 0 1.4em;padding:1.05em 1.05em .65em;border:0;border-radius:2px;background:color-mix(in srgb,var(--paper,#fdfaf0) 72%,#f3d260);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:1px 2px 0 rgb(60 50 30 / .1),5px 9px 18px -10px rgb(60 50 30 / .5);color:var(--pencil,#2b2a27);font-family:var(--font-answer,var(--font));font-size:1em;rotate:-.35deg}
:root[data-style='sketch'] .explain-note::before{content:'';position:absolute;left:38px;top:-9px;width:70px;height:18px;background:var(--tape,rgb(170 200 225 / .7));rotate:-2.5deg;clip-path:polygon(3% 10%,97% 0,100% 90%,0 100%)}
:root[data-style='sketch'] .en-head span{padding:0 .6em;border:1.5px solid var(--pencil,#2b2a27);border-radius:55% 45% 52% 48% / 48% 56% 44% 52%;background:none;color:var(--pencil,#2b2a27);letter-spacing:.05em;rotate:-2deg}
:root[data-style='sketch'] .en-head b{color:var(--pencil-soft,rgb(46 45 42 / .6))}
:root:is([data-style='warm'],[data-style='sketch']) .en-head{padding-right:0}
:root[data-style='warm'] .en-head span,:root[data-style='sketch'] .en-head span{font-size:1em;line-height:inherit}
:root[data-style='warm'] .en-head span{background:none;color:var(--accent)}
:root:is([data-style='warm'],[data-style='sketch']) .en-head{font-size:.82em}
:root:is([data-style='warm'],[data-style='sketch']) .en-head b{font-size:1em;font-weight:600;color:var(--muted)}
@keyframes en-in{from{opacity:0;translate:0 -6px}}
@media(prefers-reduced-motion:reduce){.explain-note{animation:none}}
</style>
