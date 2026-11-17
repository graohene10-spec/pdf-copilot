<script setup lang="ts">
// PDF 里的解释卡片：出现在鼠标旁。没钉住时点别处就消失；按下图钉后留在原处，默认跟着书页走，
// 可以拖到别的地方，也可以改成停在屏幕上不动。拔下图钉后再点别处才消失。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import 'katex/dist/katex.min.css'
import { renderMarkdown } from '../ai/render'
import AppIcon from './AppIcon.vue'
import { hintLearned, offerHint } from '../ui/hints'
import ThoughtChip from './ThoughtChip.vue'
import ExplainBody from './ExplainBody.vue'
import { rerunExplain, type ExplainCardState } from '../ai/explain'

const props = defineProps<{ card: ExplainCardState }>()
const emit = defineEmits<{ close: [] }>()
const box = ref<HTMLElement>()
const place = ref(props.card.pinned && props.card.screen ? { ...props.card.screen } : { left: props.card.x, top: props.card.y })
const dragging = ref(false)
// 从翻译卡片变过来：先显示译文，挂上去之后换成解释。
const showFrom = ref(Boolean(props.card.from))
const following = computed(() => props.card.pinned && props.card.follow === 'page' && Boolean(props.card.anchor))
// 钉在书页上的位置：相对那一页左上角的比例，翻页、缩放后还在原来的字旁边。
const relative = () => props.card.rel || { x: 0, y: 0 }
function settle() {
  const element = box.value
  if (!element || props.card.pinned) return
  const width = element.offsetWidth, height = element.offsetHeight, gap = 14
  let left = props.card.x + gap, top = props.card.y + gap
  if (left + width > innerWidth - 8) left = Math.max(8, props.card.x - gap - width)
  // 下面放不下就放到上面；上面也放不下（解释很长）就贴着窗口边，整张都露出来。
  if (top + height > innerHeight - 8) top = props.card.y - gap - height >= 8 ? props.card.y - gap - height : Math.max(8, innerHeight - 8 - height)
  place.value = { left, top }
}
function remember() {
  const rect = props.card.anchor?.getBoundingClientRect()
  if (rect?.width) props.card.rel = { x: (place.value.left - rect.left) / rect.width, y: (place.value.top - rect.top) / rect.height }
}
// 跟着书页走时，卡片就放进书页的滚动层里（和页面同一层）：滚动、缩放由浏览器带着走，完全跟手，
// 也会被工具栏、别的栏目正常遮住。位置按那一页的比例换算，页面尺寸变了（缩放、重排）再算一次。
const host = computed(() => following.value ? props.card.anchor!.closest<HTMLElement>('.pdf-scroll') : null)
const inPage = ref({ left: 0, top: 0 })
function locate() {
  const anchor = props.card.anchor, layer = host.value
  if (!anchor?.isConnected || !layer) return
  const slot = anchor.getBoundingClientRect(), base = layer.getBoundingClientRect()
  if (!slot.width) return
  inPage.value = { left: slot.left - base.left - layer.clientLeft + layer.scrollLeft + relative().x * slot.width, top: slot.top - base.top - layer.clientTop + layer.scrollTop + relative().y * slot.height }
}
let observer: ResizeObserver | undefined, first = true
watch(host, (layer, previous) => {
  observer?.disconnect(); observer = undefined
  // 从记录里放回来的便签已经带着位置，不用再量。
  const restored = first && Boolean(props.card.rel)
  first = false
  if (layer) {
    if (!restored) remember()
    locate()
    observer = new ResizeObserver(() => { if (!dragging.value) locate() })
    observer.observe(props.card.anchor!); if (props.card.anchor!.parentElement) observer.observe(props.card.anchor!.parentElement)
  } else if (previous && box.value) {
    // 回到屏幕上：停在眼下看到的位置。
    const base = previous.getBoundingClientRect(); place.value = { left: inPage.value.left + base.left + previous.clientLeft - previous.scrollLeft, top: inPage.value.top + base.top + previous.clientTop - previous.scrollTop }
  }
}, { flush: 'sync', immediate: true })
// 钉住的便签记下它在屏幕上的位置（停在屏幕上的那种靠它放回原处）。
watch(() => [place.value.left, place.value.top, props.card.pinned] as const, () => { if (props.card.pinned && !host.value) props.card.screen = { ...place.value } }, { flush: 'sync' })
// 没手动拉过大小时，纸条的宽度跟着字数走：一两句话是窄窄一张，长解释宽一些，尽量一眼看全、不用在纸条里滚动。
const fit = computed(() => {
  const text = showFrom.value ? props.card.from || '' : props.card.item.text
  let units = 0
  for (const char of text) units += char.charCodeAt(0) > 0x2e7f ? 1 : .55
  // 带界面的讲解（图表、可调的模拟）要宽一些才摆得开。
  if (text.includes('```ui') || (props.card.item.mode === 'visual' && !showFrom.value)) return Math.min(680, innerWidth - 40)
  return Math.min(600, Math.max(300, Math.round(Math.sqrt(units * 900) / 40) * 40))
})
const position = computed(() => ({
  '--ec-fit': `${fit.value}px`,
  ...(host.value ? { position: 'absolute' as const, left: `${inPage.value.left}px`, top: `${inPage.value.top}px` } : { left: `${place.value.left}px`, top: `${place.value.top}px` }),
  ...(size.value.width ? { width: `${size.value.width}px`, maxWidth: 'none' } : {}),
  ...(size.value.height ? { height: `${size.value.height}px`, maxHeight: 'none' } : {}),
}))
function togglePin() {
  props.card.pinned = !props.card.pinned
  // 钉住之后能切换「跟着书页走 / 停在屏幕上」：没用过的话提一句（一共两次）。
  if (props.card.pinned && props.card.anchor) offerHint('explain-layer', ['📄'], '点卡片右上角这个图标：跟着书页走 / 停在屏幕上')
}
function toggleFollow() { props.card.follow = props.card.follow === 'page' ? 'screen' : 'page'; hintLearned('explain-layer') }
// 右键：交给应用的菜单（复制、换个讲法、钉住、图层、关闭），不弹浏览器自带的那个。
function menu(event: MouseEvent) { window.dispatchEvent(new CustomEvent('kaizhi:explain-menu', { detail: { kind: 'card', id: props.card.id, x: event.clientX, y: event.clientY } })) }
// 拖动只按指针走过的距离挪，不去量卡片的外框：草稿主题的便签是歪着贴的，量出来的外框比它实际的位置偏一点，松手时会跳一下。
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
  const handle = event.currentTarget as HTMLElement
  let x = event.clientX, y = event.clientY
  handle.setPointerCapture(event.pointerId); dragging.value = true; event.preventDefault()
  const move = (next: PointerEvent) => {
    const dx = next.clientX - x, dy = next.clientY - y
    x = next.clientX; y = next.clientY
    if (host.value) inPage.value = { left: inPage.value.left + dx, top: inPage.value.top + dy }
    else place.value = { left: Math.min(innerWidth - 40, Math.max(48 - (box.value?.offsetWidth || 0), place.value.left + dx)), top: Math.min(innerHeight - 30, Math.max(4, place.value.top + dy)) }
  }
  const end = () => {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end)
    dragging.value = false
    // 跟着书页时，记下它现在相对那一页的位置。
    const anchor = props.card.anchor, layer = host.value
    if (anchor?.isConnected && layer) {
      const slot = anchor.getBoundingClientRect(), base = layer.getBoundingClientRect()
      if (slot.width) props.card.rel = { x: (inPage.value.left - (slot.left - base.left - layer.clientLeft + layer.scrollLeft)) / slot.width, y: (inPage.value.top - (slot.top - base.top - layer.clientTop + layer.scrollTop)) / slot.height }
    }
  }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end)
}
// 拉右边、下边或右下角改便签的大小；内容放不下时在便签里滚动。
const size = computed<{ width?: number; height?: number }>({ get: () => props.card.size || {}, set: value => { props.card.size = value } })
function startResize(event: PointerEvent, edge: 'e' | 's' | 'se') {
  if (event.button !== 0 || !box.value) return
  const handle = event.currentTarget as HTMLElement
  let x = event.clientX, y = event.clientY, width = size.value.width ?? box.value.offsetWidth, height = size.value.height ?? box.value.offsetHeight
  handle.setPointerCapture(event.pointerId); dragging.value = true; event.preventDefault(); event.stopPropagation()
  const move = (next: PointerEvent) => {
    if (edge !== 's') width = Math.min(innerWidth - 24, Math.max(180, width + next.clientX - x))
    if (edge !== 'e') height = Math.min(innerHeight - 24, Math.max(72, height + next.clientY - y))
    x = next.clientX; y = next.clientY
    size.value = { width: edge === 's' ? size.value.width : width, height: edge === 'e' ? size.value.height : height }
  }
  const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); dragging.value = false }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end)
}
// 中键是「解释」：不当作点了外面。
function outside(event: Event) { if (props.card.pinned || (event as PointerEvent).button === 1) return; if (!box.value?.contains(event.target as Node)) emit('close') }
function key(event: KeyboardEvent) { if (event.key === 'Escape' && !props.card.pinned) emit('close') }
onMounted(() => {
  settle(); document.addEventListener('pointerdown', outside, true); document.addEventListener('wheel', outside, { capture: true, passive: true }); document.addEventListener('keydown', key)
  if (showFrom.value) void nextTick(() => requestAnimationFrame(() => { showFrom.value = false }))
})
onBeforeUnmount(() => { clearTimeout(sheenTimer); observer?.disconnect(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('wheel', outside, true); document.removeEventListener('keydown', key) })
watch(() => [props.card.item.text, props.card.item.status, props.card.item.reasoning, showFrom.value], () => { void nextTick(settle) })
// 解释写完的那一刻，一道高光从卡片上滑过去。
const sheen = ref(false)
let sheenTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.card.item.status, (status, previous) => { if (previous === 'running' && status === 'done') { sheen.value = true; clearTimeout(sheenTimer); sheenTimer = setTimeout(() => { sheen.value = false }, 1300) } })
</script>

<template>
  <Teleport :to="host || 'body'">
  <div ref="box" class="selection-translation explain-card" :class="{ pinned: card.pinned, dragging, sized: Boolean(size.width || size.height), 'in-page': Boolean(host), morph: Boolean(card.from) }" role="status" aria-live="polite" :style="position" @pointerdown.stop="$event.target === box && startDrag($event)" @mousedown.stop @click.stop @dblclick.stop @contextmenu.stop.prevent="menu">
    <Transition name="st-swap" mode="out-in" @after-enter="settle">
      <div v-if="showFrom" key="from" class="st-text" v-html="renderMarkdown(card.from || '')"></div>
      <div v-else key="explain" class="st-explain">
        <div class="ec-head" @pointerdown.stop="startDrag">
          <AppIcon class="ec-spark" name="sparkle" :size="13" />
          <span class="st-term"><mark>{{ card.item.term.length > 48 ? card.item.term.slice(0, 48) + '…' : card.item.term }}</mark></span>
          <button v-if="card.pinned && card.anchor" type="button" class="ec-tool" :aria-label="card.follow === 'page' ? '跟着书页走' : '停在屏幕上'" :data-tip="card.follow === 'page' ? '现在跟着书页走，点一下改成停在屏幕上' : '现在停在屏幕上，点一下改成跟着书页走'" @click="toggleFollow"><AppIcon :name="card.follow === 'page' ? 'doc' : 'fullscreen'" :size="13" /></button>
          <button type="button" class="ec-tool ec-pin" :class="{ on: card.pinned }" :aria-pressed="card.pinned" :aria-label="card.pinned ? '拔下图钉' : '钉住'" :data-tip="card.pinned ? '拔下图钉（之后点别处就消失）' : '钉住：不会自己消失，可以拖动'" @click="togglePin"><AppIcon name="pin" :size="13" /></button>
        </div>
        <!-- 标题下面一道细线；解释还在写的时候有一点光顺着它滑过去。 -->
        <i class="ec-rule" :class="{ running: card.item.status === 'running' }" aria-hidden="true"></i>
        <ExplainBody :item="card.item" />
        <div v-if="card.item.status !== 'error' || card.item.text" class="ec-foot"><p class="ec-actions">
          <button type="button" class="ec-tool" :disabled="card.item.status === 'running'" aria-label="深入" data-tip="深入" data-tip-fast @click="rerunExplain(card.item, 'deeper')"><AppIcon name="deeper" :size="16" /></button>
          <button type="button" class="ec-tool" :disabled="card.item.status === 'running'" aria-label="简化" data-tip="简化" data-tip-fast @click="rerunExplain(card.item, 'simpler')"><AppIcon name="simpler" :size="16" /></button>
          <button type="button" class="ec-tool" :disabled="card.item.status === 'running'" aria-label="举例" data-tip="举例" data-tip-fast @click="rerunExplain(card.item, 'example')"><AppIcon name="example" :size="16" /></button>
          <button type="button" class="ec-tool" :disabled="card.item.status === 'running'" aria-label="可视化讲解" data-tip="可视化讲解（Intelligent UI）" data-tip-fast @click="rerunExplain(card.item, 'visual')"><AppIcon name="visual" :size="16" /></button>
        </p><ThoughtChip :item="card.item" /></div>
      </div>
    </Transition>
    <i class="ec-halo" aria-hidden="true"></i><i v-if="sheen" class="ec-sheen" aria-hidden="true"></i>
    <i class="ec-resize ec-e" @pointerdown="startResize($event, 'e')"></i><i class="ec-resize ec-s" @pointerdown="startResize($event, 's')"></i><i class="ec-resize ec-se" @pointerdown="startResize($event, 'se')"></i>
  </div>
  </Teleport>
</template>

<style>
/* 初始大小跟着文字走（--ec-fit 由字数算出），高度最多到窗口那么高；真的放不下时只有正文那一块滚动，标题和按钮不动。 */
.selection-translation.explain-card{min-width:180px;max-width:min(var(--ec-fit,380px),calc(100vw - 16px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:visible!important}
.explain-card > .st-text{min-height:0;overflow:auto}
.explain-card > .st-explain{min-height:0;overflow:visible!important}
:root[data-style='sketch'] .selection-translation.explain-card :is(.st-text,.st-explain){max-height:calc(100vh - 56px)}
.explain-card .st-explain{display:flex;flex-direction:column;flex:1}
.explain-card .explain-body{flex:1;min-height:0;overflow:hidden auto}
.explain-card.sized .st-explain{max-height:none!important}
/* 右边、下边各一条看不见的把手，右下角一个小角标。 */
.ec-resize{position:absolute;z-index:2;touch-action:none}
.ec-e{top:8px;bottom:14px;right:-4px;width:9px;cursor:ew-resize}
.ec-s{left:8px;right:14px;bottom:-4px;height:9px;cursor:ns-resize}
.ec-se{right:-3px;bottom:-3px;width:16px;height:16px;cursor:nwse-resize}
.ec-se::after{content:'';position:absolute;right:5px;bottom:5px;width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;opacity:0;transition:opacity .15s}
.explain-card:hover .ec-se::after,.explain-card.dragging .ec-se::after{opacity:.4}
/* 发光，和框选截图是同一种语言：出现时从略大处收拢，外面一圈主色的光晕呼吸两下再收成淡淡的一圈；写完时一道高光滑过。
   光晕单独放在一层上，只动透明度，不重画卡片。 */
.explain-card{--ec-glow:color-mix(in srgb,var(--accent) 46%,transparent)}
.explain-card:not(.morph):not(.in-page){animation:ec-focus var(--dur-bounce,.4s) var(--spring-snappy,ease-out) both}
@keyframes ec-focus{from{opacity:0;scale:1.07}}
.ec-halo{position:absolute;inset:0;z-index:-1;border-radius:inherit;box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 42%,transparent),0 0 30px 2px var(--ec-glow);opacity:.32;pointer-events:none;animation:ec-halo 2.4s var(--ease-soft,ease-in-out) .3s 2 backwards}
@keyframes ec-halo{0%,100%{opacity:.32}50%{opacity:1}}
.explain-card.pinned .ec-halo{opacity:.6}
.ec-sheen{position:absolute;inset:0;z-index:1;border-radius:inherit;overflow:hidden;pointer-events:none}
.ec-sheen::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 34%,color-mix(in srgb,var(--accent) 22%,rgb(255 255 255 / .62)) 50%,transparent 66%);translate:-100% 0;animation:ec-sweep 1.15s cubic-bezier(.3,0,.2,1) both}
@keyframes ec-sweep{to{translate:100% 0}}
.ec-spark{filter:drop-shadow(0 0 4px color-mix(in srgb,var(--accent) 70%,transparent))}
:root[data-style='sketch'] .explain-card{--ec-glow:color-mix(in srgb,var(--red-pencil,#c0392b) 26%,transparent)}
:root[data-style='sketch'] .ec-halo{box-shadow:0 0 34px 4px var(--ec-glow);opacity:.25}
:root[data-style='sketch'] .ec-spark{filter:none}
.explain-card.morph{animation:none}
/* 跟着书页走时压在工具栏的毛边（z-index 4）下面、书页上面。 */
.explain-card.in-page{z-index:3;animation:none}
.explain-card.dragging{transition:none;cursor:grabbing;user-select:none}
.ec-head{display:flex;align-items:center;gap:5px;margin:-3px -5px 0 0;cursor:grab;touch-action:none}
.ec-head .st-term{flex:1;min-width:0;margin:0!important;color:var(--ink);font-size:.95em;font-weight:650}
/* 词条像被荧光笔划过一道。 */
.ec-head mark{padding:0 .2em;border-radius:.25em;background:linear-gradient(transparent 56%,color-mix(in srgb,var(--accent) 26%,transparent) 56%);color:inherit}
.ec-spark{flex:none;color:var(--accent);animation:ec-twinkle .9s var(--spring-snappy,ease-out) .12s both}
@keyframes ec-twinkle{from{opacity:0;scale:.2;rotate:-90deg}}
.ec-rule{position:relative;display:block;flex:none;height:1px;margin:7px 0 8px;overflow:hidden;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 55%,transparent),color-mix(in srgb,var(--ink) 10%,transparent) 45%,transparent)}
.ec-rule.running{height:2px;margin:6px 0 8px;border-radius:1px;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.ec-rule.running::after{content:'';position:absolute;inset:0;width:38%;border-radius:1px;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:ec-run 1.15s cubic-bezier(.45,0,.55,1) infinite}
@keyframes ec-run{from{translate:-110% 0}to{translate:290% 0}}
.ec-tool{display:grid;place-items:center;flex:none;width:22px;height:22px;min-height:0;padding:0;border:0;border-radius:50%;background:none!important;box-shadow:none!important;color:var(--muted);opacity:.55;cursor:pointer;transition:opacity .15s,color .15s,rotate .2s var(--spring-snappy,ease-out),background-color .15s}
.ec-tool:hover{opacity:1;background:color-mix(in srgb,var(--ink) 8%,transparent)!important}
/* 三个追问按钮收在一枚小药丸里，和 Markdown 里的解释纸条是同一套。 */
.ec-actions{display:inline-flex;align-items:center;align-self:flex-start;gap:1px;flex:none;margin:9px 0 -2px -3px!important;padding:2px;border-radius:999px;background:color-mix(in srgb,var(--ink) 6%,transparent);box-shadow:inset 0 0 0 1px var(--glass-outline)}
.ec-actions .ec-tool{width:30px;height:24px;border-radius:999px;opacity:.75;transition:opacity .15s,color .15s,background-color .15s,box-shadow .15s,scale .18s var(--spring-snappy,ease-out),rotate .2s var(--spring-snappy,ease-out),translate .18s var(--spring-snappy,ease-out)}
.ec-actions .ec-tool:hover:not(:disabled){background:color-mix(in srgb,var(--surface,#fff) 82%,transparent)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 26%,transparent),0 0 14px color-mix(in srgb,var(--accent) 42%,transparent)!important;color:var(--accent);translate:0 -1px}
.ec-actions .ec-tool:disabled{opacity:.25;cursor:default}
.ec-actions .ec-tool:active:not(:disabled){scale:.9}
:root:is([data-style='warm'],[data-style='sketch']) .ec-actions{gap:.3em;margin:8px 0 -3px -4px!important;padding:0;border-radius:0;background:none;box-shadow:none}
:root[data-style='sketch'] .ec-actions .ec-tool{color:var(--pencil,#2b2a27)}
:root[data-style='sketch'] .ec-actions .ec-tool:hover:not(:disabled){background:none!important;box-shadow:none!important;color:var(--red-pencil,#c0392b);rotate:-8deg;translate:0 -1px}
:root[data-style='warm'] .ec-actions .ec-tool:hover:not(:disabled){background:none!important;box-shadow:none!important;color:var(--accent)}
/* 暖色极简：词条是衬线斜体，下面一道陶土色细线。 */
:root[data-style='warm'] .ec-head .st-term{font-style:italic;font-weight:600}
:root[data-style='warm'] .ec-head mark{padding:0;background:none}
:root[data-style='warm'] .ec-rule{background:linear-gradient(90deg,var(--accent),transparent 70%)}
/* 铅笔草稿：便签「啪」地贴上去；词条下面是红铅笔划的一道，标题下是铅笔虚线，右下角微微翘起（那里可以拉大小）。 */
:root[data-style='sketch'] .explain-card:not(.morph):not(.in-page){animation:ec-stick .46s var(--spring-snappy,ease-out) both}
@keyframes ec-stick{from{opacity:0;scale:1.1;rotate:-6deg;translate:0 -14px}45%{opacity:1}}
:root[data-style='sketch'] .ec-head .st-term{color:var(--pencil,#2b2a27);font-size:1em;font-weight:600}
/* 草稿主题：词条不再用红铅笔划线，标题下只有那根分隔线（正在写时是流光）。 */
:root[data-style='sketch'] .ec-head mark{padding:0;border-radius:0;background:none}
:root[data-style='sketch'] .ec-spark{color:var(--red-pencil,#c0392b)}
:root[data-style='sketch'] .ec-rule{height:0;margin:8px 0 8px;border-top:1.2px solid color-mix(in srgb,var(--pencil,#2b2a27) 38%,transparent);background:none}
:root[data-style='sketch'] .ec-rule.running{height:2px;border-top:0;background:color-mix(in srgb,var(--pencil,#2b2a27) 12%,transparent)}
:root[data-style='sketch'] .ec-rule.running::after{background:linear-gradient(90deg,transparent,var(--red-pencil,#c0392b),transparent)}
:root[data-style='sketch'] .explain-card::after{content:'';position:absolute;right:0;bottom:0;width:26px;height:26px;background:linear-gradient(315deg,rgb(60 50 30 / .2),transparent 52%);pointer-events:none}
@media(prefers-reduced-motion:reduce){.ec-halo,.ec-sheen::after,.explain-card,.ec-spark,.ec-rule.running::after,:root[data-style='sketch'] .explain-card{animation:none!important}}
.ec-pin{rotate:35deg}
.ec-pin.on{opacity:1;color:var(--accent);rotate:0deg}
.explain-card.pinned{box-shadow:var(--shadow-3),var(--glass-edge),0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent)}
/* 液态玻璃：圆角更大的一片玻璃，词条是标题，左上一抹强调色的光。 */
:root:not([data-style='warm']):not([data-style='sketch']) .explain-card{padding:12px 15px 13px;background-color:color-mix(in srgb,var(--surface,#fff) 86%,transparent);border-radius:var(--r-lg,16px);background-image:radial-gradient(120% 90% at 0 0,color-mix(in srgb,var(--accent) 13%,transparent),transparent 60%),var(--popup-sheen)}
:root[data-style='sketch'] .explain-card.pinned{box-shadow:1px 2px 0 rgb(60 50 30 / .1),5px 9px 18px -8px rgb(60 50 30 / .5)}
:root[data-style='sketch'] .ec-pin.on{color:var(--red-pencil,#c0392b)}
</style>
