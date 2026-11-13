<script setup lang="ts">
// 翻译模式的浮窗：选中文字后译文出现在鼠标旁，外框随界面风格变化（草稿主题是一张贴着胶带的纸片）。
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import 'katex/dist/katex.min.css'
import { renderMarkdown } from '../ai/render'
import type { Translation } from '../ai/translate'

const props = defineProps<{ item: Translation; x: number; y: number }>()
const emit = defineEmits<{ close: [] }>()
const box = ref<HTMLElement>()
const place = ref({ left: props.x, top: props.y })
// 默认在鼠标右下方；放不下就翻到左边 / 上边，始终留在窗口里。
function settle() {
  const element = box.value
  if (!element) return
  const width = element.offsetWidth, height = element.offsetHeight, gap = 14
  let left = props.x + gap, top = props.y + gap
  if (left + width > innerWidth - 8) left = Math.max(8, props.x - gap - width)
  if (top + height > innerHeight - 8) top = Math.max(8, props.y - gap - height)
  place.value = { left, top }
}
function outside(event: Event) { if (!box.value?.contains(event.target as Node)) emit('close') }
function key(event: KeyboardEvent) { if (event.key === 'Escape') emit('close') }
onMounted(() => { settle(); document.addEventListener('pointerdown', outside, true); document.addEventListener('wheel', outside, { capture: true, passive: true }); document.addEventListener('keydown', key) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('wheel', outside, true); document.removeEventListener('keydown', key) })
watch(() => [props.item.result, props.item.status, props.x, props.y], () => { void nextTick(settle) })
</script>

<template>
  <Teleport to="body">
  <div ref="box" class="selection-translation" role="status" aria-live="polite" :style="{ left: `${place.left}px`, top: `${place.top}px` }">
    <div v-if="item.result" class="st-text" v-html="renderMarkdown(item.result)"></div>
    <p v-else-if="item.status === 'error'" class="st-error">{{ item.error || '翻译失败' }}</p>
    <p v-else class="st-wait"><i></i><i></i><i></i></p>
  </div>
  </Teleport>
</template>

<style>
.selection-translation{position:fixed;z-index:420;max-width:min(380px,calc(100vw - 16px));max-height:min(46vh,360px);overflow:auto;padding:10px 13px;border:1px solid var(--glass-outline);border-radius:var(--r-md);background-color:var(--popup-glass);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));box-shadow:var(--shadow-3),var(--glass-edge);color:var(--ink);font-size:14px;line-height:1.6;animation:st-in var(--dur-2) var(--spring-snappy) both;transform-origin:0 0}
.selection-translation p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.st-text p+p,.st-text ul,.st-text ol{margin-top:.45em}
.st-text ul,.st-text ol{margin-bottom:0;padding-left:1.3em}
.st-text .katex-display{margin:.4em 0;overflow-x:auto;overflow-y:hidden}
.st-error{color:var(--danger)}
.st-wait{display:flex;gap:5px;padding:5px 2px}
.st-wait i{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.3;animation:st-dot 1s var(--ease-out) infinite}
.st-wait i:nth-child(2){animation-delay:.15s}
.st-wait i:nth-child(3){animation-delay:.3s}
@keyframes st-in{from{opacity:0;scale:.94;translate:0 4px}}
@keyframes st-dot{0%,100%{opacity:.25}40%{opacity:.9}}
/* 暖色极简：象牙白卡片，细线，左边一道陶土色的竖线，衬线字。 */
:root[data-style='warm'] .selection-translation{border:.5px solid var(--warm-rule,rgb(31 30 29 / .18));border-left:2px solid var(--accent);border-radius:6px;background:var(--surface);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:0 8px 24px -12px rgb(31 30 29 / .35);font-family:var(--font-reading)}
/* 铅笔草稿：一张撕下来的便签纸，顶上贴着胶带，微微歪着，手写字。 */
:root[data-style='sketch'] .selection-translation{overflow:visible;padding:16px 14px 11px;border:0;border-radius:2px;background:color-mix(in srgb,var(--paper,#fdfaf0) 72%,#f3d260);-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:1px 2px 0 rgb(60 50 30 / .1),5px 9px 18px -8px rgb(60 50 30 / .5);color:var(--pencil,#2b2a27);font-family:var(--font-answer,var(--font));font-size:15.5px;rotate:-1.2deg;clip-path:none}
:root[data-style='sketch'] .selection-translation::before{content:'';position:absolute;left:50%;top:-8px;width:64px;height:17px;margin-left:-32px;background:var(--tape,rgb(170 200 225 / .7));rotate:2deg;clip-path:polygon(3% 10%,97% 0,100% 90%,0 100%)}
:root[data-style='sketch'] .selection-translation .st-text{max-height:min(44vh,330px);overflow:auto}
@media(prefers-reduced-motion:reduce){.selection-translation,.st-wait i{animation:none}}
</style>
