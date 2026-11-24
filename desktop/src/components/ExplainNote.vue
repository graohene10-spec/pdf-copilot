<script setup lang="ts">
// Markdown 里插在段落下面的一条释义：可以留在笔记里、换个讲法，或者丢掉。
import { computed, onMounted, ref, watch } from 'vue'
import ExplainBody from './ExplainBody.vue'
import ThoughtChip from './ThoughtChip.vue'
import AppIcon from './AppIcon.vue'
// 标题、细线、按钮的样子写在 PDF 的解释卡片里，这里共用。
import './ExplainCard.vue'
import ExplainTitle from './ExplainTitle.vue'
import { askExplain, dropNote, keepNote, rerunExplain, type Explain, type ExplainMode } from '../ai/explain'

const props = defineProps<{ item: Explain; kept: boolean; doc: string; line: number; size?: { width?: number; height?: number } }>()
const emit = defineEmits<{ close: [] }>()
// 解释写完就自动记下来，关掉文档再打开还在；不想留的点一下「已记入」取消，或者直接「关闭」。
const saved = ref(true)
const leaving = ref(false)
function keep() { if (props.item.status !== 'done') return; saved.value = !saved.value; if (saved.value) keepNote(props.doc, props.line, props.item, size.value); else dropNote(props.doc, props.item.id) }
// 大小：和 PDF 的卡片一样拖右下角调整（宽度最多到正文那么宽，高一点就只有正文滚动），记入文档时一起存下。
const size = ref<{ width?: number; height?: number }>({ ...(props.size || {}) })
const noteStyle = computed(() => ({ width: size.value.width ? `${size.value.width}px` : undefined, height: size.value.height ? `${size.value.height}px` : undefined }))
function startResize(event: PointerEvent) {
  if (event.button !== 0 || !root.value) return
  const handle = event.currentTarget as HTMLElement, paper = root.value.closest<HTMLElement>('.markdown-paper')
  let x = event.clientX, y = event.clientY, width = root.value.offsetWidth, height = root.value.offsetHeight
  const widest = paper ? paper.clientWidth - 2 * parseFloat(getComputedStyle(paper).paddingLeft || '0') : innerWidth - 40
  handle.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation()
  const move = (next: PointerEvent) => {
    width = Math.min(widest, Math.max(240, width + next.clientX - x)); height = Math.max(120, height + next.clientY - y); x = next.clientX; y = next.clientY
    size.value = { width: Math.round(width), height: Math.round(height) }
  }
  const end = () => { handle.removeEventListener('pointermove', move); if (saved.value && props.item.status === 'done') keepNote(props.doc, props.line, props.item, size.value) }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end, { once: true }); handle.addEventListener('pointercancel', end, { once: true })
}
function resetSize() { size.value = {}; if (saved.value && props.item.status === 'done') keepNote(props.doc, props.line, props.item, {}) }
function menu(event: MouseEvent) { window.dispatchEvent(new CustomEvent('kaizhi:explain-menu', { detail: { kind: 'note', id: props.item.id, x: event.clientX, y: event.clientY } })) }
function again(mode: Exclude<ExplainMode, 'ask'>) { rerunExplain(props.item, mode) }
// 双击标题那一行（按钮除外）：自己问一句。
const title = ref<{ begin: () => void }>()
function startAsk(event: MouseEvent) { if (!(event.target as HTMLElement).closest('button, input')) title.value?.begin() }
// 留下的释义换了讲法，存的也跟着换。
watch(() => props.item.status, status => { if (status === 'done' && saved.value) keepNote(props.doc, props.line, props.item, size.value) }, { immediate: !props.kept })
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
  <!-- 和 PDF 里的解释卡片是同一套：词条像被荧光笔划过，标题下一道细线，追问按钮收在一枚小药丸里。 -->
  <aside ref="root" class="explain-note" :class="{ leaving, saved, sized: Boolean(size.width || size.height) }" :style="noteStyle" contenteditable="false" @contextmenu.stop.prevent="menu">
    <div class="ec-head" @dblclick.stop="startAsk">
      <AppIcon class="ec-spark" name="sparkle" :size="13" />
      <ExplainTitle ref="title" :item="item" :limit="60" @ask="askExplain(item, $event)" />
      <button type="button" class="ec-tool en-keep" :class="{ on: saved }" :disabled="item.status !== 'done'" :aria-pressed="saved" :aria-label="saved ? '已记入文档' : '记入文档'" :data-tip="saved ? '已记入文档，点击取消' : '记入文档'" @click="keep"><AppIcon name="bookmark" :size="13" /></button>
      <button type="button" class="ec-tool" aria-label="关闭" data-tip="关闭" @click="discard"><AppIcon name="close" :size="12" /></button>
    </div>
    <i class="ec-rule" :class="{ running: item.status === 'running' }" aria-hidden="true"></i>
    <ExplainBody :item="item" />
    <div class="ec-foot"><p class="ec-actions">
      <button type="button" class="ec-tool" :disabled="item.status === 'running'" aria-label="深入" data-tip="深入" data-tip-fast @click="again('deeper')"><AppIcon name="deeper" :size="16" /></button>
      <button type="button" class="ec-tool" :disabled="item.status === 'running'" aria-label="简化" data-tip="简化" data-tip-fast @click="again('simpler')"><AppIcon name="simpler" :size="16" /></button>
      <button type="button" class="ec-tool" :disabled="item.status === 'running'" aria-label="举例" data-tip="举例" data-tip-fast @click="again('example')"><AppIcon name="example" :size="16" /></button>
      <button type="button" class="ec-tool" :disabled="item.status === 'running'" aria-label="可视化讲解" data-tip="可视化讲解" data-tip-fast @click="again('visual')"><AppIcon name="visual" :size="16" /></button>
    </p><ThoughtChip :item="item" /></div>
    <i class="en-resize" aria-hidden="true" data-tip="拖动调整大小，双击恢复" @pointerdown="startResize" @dblclick="resetSize"></i>
  </aside>
</template>

<style>
/* 释义卡片跟着界面风格走：液态玻璃是一块磨砂卡片，暖色极简是带陶土色竖线的象牙白纸，铅笔草稿是一张贴着胶带的便签。 */
.explain-host{display:block}
.explain-note{position:relative;margin:.9em 0 1.4em;padding:.85em 1.1em .8em;border:1px solid var(--glass-outline);border-radius:var(--r-lg,16px);background-color:var(--popup-glass);background-image:radial-gradient(90% 120% at 0 0,color-mix(in srgb,var(--accent) 12%,transparent),transparent 55%),var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));box-shadow:0 14px 30px -20px rgb(0 0 0 / .45),var(--glass-edge);color:var(--ink);font-size:.92em;line-height:1.65;user-select:text;transform-origin:0 0}
.explain-note.leaving{pointer-events:none}
.explain-note p{margin:0}
.explain-note{display:flex;flex-direction:column}
.explain-note .ec-head{margin:0;cursor:default;touch-action:auto}
.explain-note .ec-actions{margin:.7em 0 0 -3px!important}
.en-keep.on{opacity:1;color:var(--accent)}
.en-keep.on svg{fill:color-mix(in srgb,currentColor 28%,transparent)}
:root[data-style='sketch'] .en-keep.on{color:var(--red-pencil,#c0392b)}
/* 暖色极简：象牙白，细线，陶土色竖线，衬线字；选项是一行用间隔号分开的文字。 */
:root[data-style='warm'] .explain-note{padding:.75em 1.1em .65em 1.2em;border:.5px solid var(--warm-rule,rgb(31 30 29 / .18));border-left:2px solid var(--accent);border-radius:6px;background:var(--surface);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:0 8px 22px -16px rgb(31 30 29 / .35);font-family:var(--font-reading)}
/* 铅笔草稿：撕下来的便签，贴着胶带，微微歪着；「释义」用铅笔圈起来，选项下面划波浪线。 */
:root[data-style='sketch'] .explain-note{margin:1.1em 0 1.4em;padding:1.05em 1.05em .65em;border:0;border-radius:2px;background:color-mix(in srgb,var(--paper,#fdfaf0) 72%,#f3d260);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:1px 2px 0 rgb(60 50 30 / .1),5px 9px 18px -10px rgb(60 50 30 / .5);color:var(--pencil,#2b2a27);font-family:var(--font-answer,var(--font));font-size:1em;rotate:-.35deg}
:root[data-style='sketch'] .explain-note::before{content:'';position:absolute;left:38px;top:-9px;width:70px;height:18px;background:var(--tape,rgb(170 200 225 / .7));rotate:-2.5deg;clip-path:polygon(3% 10%,97% 0,100% 90%,0 100%)}
@keyframes en-in{from{opacity:0;translate:0 -6px}}
@media(prefers-reduced-motion:reduce){.explain-note{animation:none}}
/* 调整大小：右下角一个小三角；设了高度后只有正文滚动。 */
.explain-note.sized{max-width:100%;box-sizing:border-box}
.explain-note.sized .explain-body{flex:1;min-height:0;overflow:auto}
.en-resize{position:absolute;right:3px;bottom:3px;width:12px;height:12px;cursor:nwse-resize;opacity:.35;background:linear-gradient(135deg,transparent 50%,color-mix(in srgb,var(--ink) 55%,transparent) 50% 58%,transparent 58% 70%,color-mix(in srgb,var(--ink) 55%,transparent) 70% 78%,transparent 78%);transition:opacity .15s}
.explain-note:hover .en-resize{opacity:.7}
</style>
