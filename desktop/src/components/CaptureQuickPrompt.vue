<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

type CaptureFrame = { left: number; top: number; width: number; height: number }
type Side = 'right' | 'left' | 'below' | 'above'
const props = defineProps<{ frame: CaptureFrame; prompts: { label: string; question: string }[]; busy: boolean; status: string }>()
const emit = defineEmits<{ ask: [question: string]; continue: []; cancel: [] }>()
const panel = ref<HTMLElement>()
const overlay = ref<HTMLElement>()
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const panelSize = ref({ width: 236, height: 220 })
const asked = ref(-1)
let observer: ResizeObserver | undefined
let previousFocus: HTMLElement | undefined

// 选区四周留出羽化带：虚化从选区外约 20px 处开始渐强，选区本身保持清晰。
const FEATHER = 20
const GAP = 34
const MARGIN = 12
const holeStyle = computed(() => ({ left: `${props.frame.left}px`, top: `${props.frame.top}px`, width: `${props.frame.width}px`, height: `${props.frame.height}px` }))
/* 虚化层的遮罩：整屏不透明，选区处挖一个高斯模糊过的圆角洞，得到柔和的清晰—虚化过渡。 */
const veilMask = computed(() => {
  const { width, height } = viewport.value
  const frame = props.frame
  const x = frame.left - FEATHER, y = frame.top - FEATHER, w = frame.width + FEATHER * 2, h = frame.height + FEATHER * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${FEATHER * .55}"/></filter><mask id="m"><rect width="100%" height="100%" fill="#fff"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${FEATHER + 6}" fill="#000" filter="url(#f)"/></mask></defs><rect width="100%" height="100%" fill="#000" mask="url(#m)"/></svg>`
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
  return { WebkitMaskImage: url, maskImage: url }
})
const placement = computed<{ side: Side; left: number; top: number }>(() => {
  const { width, height } = panelSize.value
  const vw = viewport.value.width, vh = viewport.value.height, frame = props.frame
  const centerY = frame.top + frame.height / 2 - height / 2
  const centerX = frame.left + frame.width / 2 - width / 2
  const clampX = (value: number) => Math.max(MARGIN, Math.min(vw - width - MARGIN, value))
  const clampY = (value: number) => Math.max(MARGIN, Math.min(vh - height - MARGIN, value))
  if (frame.left + frame.width + GAP + width <= vw - MARGIN) return { side: 'right', left: frame.left + frame.width + GAP, top: clampY(centerY) }
  if (frame.left - GAP - width >= MARGIN) return { side: 'left', left: frame.left - GAP - width, top: clampY(centerY) }
  if (frame.top + frame.height + GAP + height <= vh - MARGIN) return { side: 'below', left: clampX(centerX), top: frame.top + frame.height + GAP }
  if (frame.top - GAP - height >= MARGIN) return { side: 'above', left: clampX(centerX), top: frame.top - GAP - height }
  return { side: 'right', left: clampX(vw - width - MARGIN), top: clampY(vh - height - MARGIN) }
})
const panelStyle = computed(() => ({ left: `${placement.value.left}px`, top: `${placement.value.top}px`, '--count': props.prompts.length }))
function resize() { viewport.value = { width: window.innerWidth, height: window.innerHeight } }
function focusable() { return [...(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])] }
function retainFocus(event: FocusEvent) {
  if (event.target instanceof Node && overlay.value && !overlay.value.contains(event.target)) focusable()[0]?.focus({ preventScroll: true })
}
watch(() => props.busy, async busy => {
  if (!busy) asked.value = -1
  await nextTick()
  if (document.activeElement instanceof HTMLButtonElement && document.activeElement.disabled) focusable()[0]?.focus({ preventScroll: true })
})
function ask(index: number) {
  const prompt = props.prompts[index]
  if (!prompt || props.busy) return
  asked.value = index
  emit('ask', prompt.question)
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('cancel'); return }
  // 数字键直接发送对应的提问（与气泡旁的按键提示一致）。
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : undefined)
  if (digit && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault(); event.stopPropagation()
    ask(Number(digit) - 1)
    return
  }
  if (event.key !== 'Tab') return
  const buttons = focusable()
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  event.preventDefault(); event.stopPropagation()
  buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
}
onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  window.addEventListener('resize', resize)
  document.addEventListener('focusin', retainFocus)
  observer = new ResizeObserver(() => {
    if (panel.value) panelSize.value = { width: panel.value.offsetWidth, height: panel.value.offsetHeight }
  })
  if (panel.value) observer.observe(panel.value)
  await nextTick()
  focusable()[0]?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  observer?.disconnect(); window.removeEventListener('resize', resize); document.removeEventListener('focusin', retainFocus)
  // Do not pull focus back out of settings or the AI composer when continuing.
  if (overlay.value?.contains(document.activeElement) && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <div ref="overlay" class="capture-quick-overlay" role="dialog" aria-modal="true" aria-label="框选快捷提问" @click.self="emit('cancel')" @keydown="keydown" @wheel.prevent.stop>
    <div class="capture-focus-veil" :style="veilMask" aria-hidden="true" @click="emit('cancel')" />
    <div class="capture-quick-hole" :style="holeStyle" aria-hidden="true"><i v-for="corner in 4" :key="corner" class="hole-corner" /></div>
    <section ref="panel" class="capture-quick-actions" :class="`side-${placement.side}`" :style="panelStyle" aria-label="对截图提问">
      <p class="capture-thinking"><AppIcon name="sparkle" :size="13" /><span>想问点什么</span><i class="thinking-dots" aria-hidden="true"><b></b><b></b><b></b></i></p>
      <div class="capture-quick-buttons">
        <div v-for="(prompt, index) in prompts" :key="index" class="thought-row" :class="{ asking: busy && asked === index }" :style="{ '--i': index }">
          <i class="thought-tail" aria-hidden="true"><b></b><b></b></i>
          <button class="thought-bubble" :aria-label="prompt.label" :aria-keyshortcuts="index < 9 ? String(index + 1) : undefined" :data-tip="prompt.question" :disabled="busy" @click="ask(index)"><span>{{ prompt.label }}</span><i v-if="busy && asked === index" class="thinking-dots" aria-hidden="true"><b></b><b></b><b></b></i></button>
          <kbd v-if="index < 9" class="thought-key" aria-hidden="true">{{ index + 1 }}</kbd>
        </div>
      </div>
      <div class="capture-quick-footer">
        <button class="capture-continue" aria-label="继续到阅读助手" @click="emit('continue')"><AppIcon name="sparkle" :size="14" />自己提问<AppIcon class="continue-arrow" name="arrow" :size="14" /></button>
        <button class="capture-cancel" aria-label="取消框选提问" data-tip="取消" data-tip-key="Esc" @click="emit('cancel')"><kbd>Esc</kbd></button>
      </div>
      <p v-if="status" class="capture-quick-status" role="status">{{ status }}</p>
    </section>
  </div>
</template>

<style scoped>
.capture-quick-overlay{position:fixed;inset:0;z-index:70;overflow:hidden;isolation:isolate;cursor:default;touch-action:none}
/* 聚焦：选区以外的画面虚化并压暗，羽化遮罩让清晰与虚化之间平滑过渡。 */
.capture-focus-veil{position:absolute;inset:0;z-index:0;background:color-mix(in srgb,var(--canvas-deep) 30%,rgb(12 16 26 / .3));-webkit-backdrop-filter:blur(9px) saturate(120%);backdrop-filter:blur(9px) saturate(120%);-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;animation:capture-veil-in var(--dur-4) var(--ease-out) both}
@keyframes capture-veil-in{from{opacity:0}to{opacity:1}}
/* 选区：一圈白色细线与主色辉光，从略大处收拢到位，四角有取景框记号。 */
.capture-quick-hole{position:absolute;z-index:1;box-sizing:border-box;pointer-events:none;border:1.5px solid rgb(255 255 255 / .92);border-radius:7px;box-shadow:0 0 0 1px rgb(0 0 0 / .22),0 0 26px 2px color-mix(in srgb,var(--accent) 45%,transparent),inset 0 0 0 1px rgb(255 255 255 / .2);animation:capture-focus-in var(--dur-bounce) var(--spring-snappy) both,capture-glow 2.6s var(--ease-soft) var(--dur-bounce) 2}
@keyframes capture-focus-in{from{opacity:0;transform:scale(1.08)}to{opacity:1;transform:none}}
@keyframes capture-glow{0%,100%{box-shadow:0 0 0 1px rgb(0 0 0 / .22),0 0 22px 1px color-mix(in srgb,var(--accent) 38%,transparent),inset 0 0 0 1px rgb(255 255 255 / .2)}50%{box-shadow:0 0 0 1px rgb(0 0 0 / .22),0 0 34px 4px color-mix(in srgb,var(--accent) 55%,transparent),inset 0 0 0 1px rgb(255 255 255 / .2)}}
.hole-corner{position:absolute;width:14px;height:14px;border:3px solid #fff;filter:drop-shadow(0 1px 2px rgb(0 0 0 / .35))}
.hole-corner:nth-child(1){left:-5px;top:-5px;border-right:0;border-bottom:0;border-top-left-radius:8px}
.hole-corner:nth-child(2){right:-5px;top:-5px;border-left:0;border-bottom:0;border-top-right-radius:8px}
.hole-corner:nth-child(3){right:-5px;bottom:-5px;border-left:0;border-top:0;border-bottom-right-radius:8px}
.hole-corner:nth-child(4){left:-5px;bottom:-5px;border-right:0;border-top:0;border-bottom-left-radius:8px}
/* 思考气泡组：不再是一张卡片，而是一串从选区「冒出」的气泡。 */
.capture-quick-actions{position:absolute;z-index:2;box-sizing:border-box;width:max-content;min-width:196px;max-width:min(300px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:visible;display:flex;flex-direction:column;gap:10px;}
.capture-thinking{align-self:flex-start;display:flex;align-items:center;gap:6px;margin:0 0 2px;padding:5px 11px 5px 9px;border-radius:999px;font-size:11.5px;font-weight:600;letter-spacing:.3px;color:var(--surface-ink);background-color:var(--popup-glass);border:1px solid var(--glass-outline);box-shadow:0 6px 16px -8px rgb(0 0 0 / .4),var(--glass-edge);--lens-blur:var(--popup-blur);--lens-saturate:var(--glass-sat);-webkit-backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));animation:zg-rise-in var(--dur-3) var(--ease-out) both}
.side-left .capture-thinking{align-self:flex-end}
.capture-thinking svg{color:var(--accent);animation:zg-twinkle 2.4s var(--ease-soft) .4s 2}
.capture-thinking .thinking-dots{color:var(--accent)}
.capture-quick-buttons{display:flex;flex-direction:column;gap:9px}
.thought-row{position:relative;display:flex;align-items:center;gap:9px;animation:thought-pop var(--dur-bounce) var(--spring-bouncy) both;animation-delay:calc(90ms + var(--i) * 55ms)}
@keyframes thought-pop{from{opacity:0;transform:translateX(var(--from-x,-18px)) translateY(var(--from-y,0)) scale(.6)}to{opacity:1;transform:none}}
.side-right .thought-row{--from-x:-22px;transform-origin:0 50%}
.side-left .thought-row{--from-x:22px;flex-direction:row-reverse;transform-origin:100% 50%}
.side-below .thought-row{--from-x:0;--from-y:-14px;transform-origin:50% 0}
.side-above .thought-row{--from-x:0;--from-y:14px;transform-origin:50% 100%}
/* 气泡：一枚厚玻璃胶囊，边缘有一道缓慢流过的「思考」高光。 */
.thought-bubble{position:relative;flex:1;display:flex;align-items:center;justify-content:space-between;gap:10px;box-sizing:border-box;min-width:0;min-height:42px;padding:9px 18px;font:inherit;font-size:13.5px;font-weight:600;line-height:20px;color:var(--surface-ink);border:1px solid var(--glass-outline);border-radius:22px;background-color:var(--popup-glass);background-image:var(--popup-sheen);--lens-blur:var(--popup-blur);--lens-saturate:var(--glass-sat);-webkit-backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));box-shadow:0 12px 30px -10px rgb(0 0 0 / .45),var(--glass-edge);cursor:pointer;overflow:hidden;transition:transform var(--dur-press) var(--spring-press),box-shadow var(--dur-2) var(--ease-out),background-color var(--dur-1) var(--ease-soft)}
.thought-bubble::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(105deg,transparent 30%,color-mix(in srgb,var(--accent) 22%,rgb(255 255 255 / .55)) 48%,transparent 66%) no-repeat;background-size:220% 100%;mix-blend-mode:soft-light;animation:zg-shimmer 3.2s var(--ease-soft) 2;animation-delay:calc(.6s + var(--i) * .35s)}
.thought-bubble span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thought-bubble:hover:not(:disabled){transform:scale(1.035);box-shadow:0 16px 34px -10px rgb(0 0 0 / .5),0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent),var(--glass-edge)}
.thought-bubble:active:not(:disabled){transform:scale(.97)}
.thought-bubble:focus-visible{outline:none;box-shadow:0 0 0 3px var(--accent),0 12px 30px -10px rgb(0 0 0 / .45),var(--glass-edge)}
.thought-bubble:disabled{cursor:default}
.thought-row:not(.asking) .thought-bubble:disabled{opacity:.55}
.asking .thought-bubble{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 45%,transparent),0 12px 30px -10px rgb(0 0 0 / .45),var(--glass-edge)}
/* 气泡尾巴：两颗由小到大的圆点，指向选区。 */
.thought-tail{position:absolute;top:50%;width:18px;height:12px;pointer-events:none}
.thought-tail b{position:absolute;border-radius:50%;background-color:var(--popup-glass);border:1px solid var(--glass-outline);box-shadow:0 3px 8px -2px rgb(0 0 0 / .35),var(--glass-edge);animation:zg-dot-pulse 2.4s var(--ease-soft) 3}
.thought-tail b:first-child{width:7px;height:7px;animation-delay:calc(var(--i) * .2s)}
.thought-tail b:last-child{width:11px;height:11px;animation-delay:calc(var(--i) * .2s + .3s)}
.side-right .thought-tail{left:-24px;translate:0 -50%}
.side-right .thought-tail b:first-child{left:0;top:4px}
.side-right .thought-tail b:last-child{left:8px;top:1px}
.side-left .thought-tail{right:-24px;translate:0 -50%}
.side-left .thought-tail b:first-child{right:0;top:4px}
.side-left .thought-tail b:last-child{right:8px;top:1px}
.side-below .thought-row:not(:first-child) .thought-tail,.side-above .thought-row:not(:last-child) .thought-tail{display:none}
.side-below .thought-tail{top:-22px;left:28px;width:12px;height:20px}
.side-below .thought-tail b:first-child{left:3px;top:0}
.side-below .thought-tail b:last-child{left:1px;top:8px}
.side-above .thought-tail{top:auto;bottom:-22px;left:28px;width:12px;height:20px}
.side-above .thought-tail b:first-child{left:3px;bottom:0}
.side-above .thought-tail b:last-child{left:1px;bottom:8px}
/* 气泡旁的确认快捷键。 */
.thought-key{flex:0 0 auto;display:grid;place-items:center;min-width:28px;height:28px;padding:0 7px;border-radius:9px;font:650 12.5px var(--font-mono);color:var(--surface-ink);background-color:var(--popup-glass);border:1px solid var(--glass-outline);box-shadow:inset 0 -2px 0 var(--separator),0 4px 10px -4px rgb(0 0 0 / .4),var(--glass-edge);--lens-blur:var(--popup-blur);--lens-saturate:var(--glass-sat);-webkit-backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));transition:transform var(--dur-press) var(--spring-press),color var(--dur-1) var(--ease-soft)}
.thought-row:hover .thought-key,.asking .thought-key{color:var(--accent);transform:translateY(-1px)}
.thinking-dots{display:inline-flex;gap:3px;align-items:center}
.thinking-dots b{width:4px;height:4px;border-radius:50%;background:currentColor;animation:zg-breathe 1.1s var(--ease-soft) infinite}
.thinking-dots b:nth-child(2){animation-delay:.18s}
.thinking-dots b:nth-child(3){animation-delay:.36s}
.thought-bubble .thinking-dots{color:var(--accent)}
.capture-quick-footer{display:flex;gap:8px;align-items:center;margin-top:4px;animation:zg-rise-in var(--dur-3) var(--ease-out) both;animation-delay:calc(140ms + var(--count, 4) * 55ms)}
.capture-quick-footer button{display:flex;align-items:center;gap:7px;height:34px;padding:0 14px;font:inherit;font-size:12.5px;font-weight:600;color:var(--surface-ink);border:1px solid var(--glass-outline);border-radius:var(--r-control);background-color:var(--popup-glass);background-image:var(--popup-sheen);box-shadow:0 6px 16px -8px rgb(0 0 0 / .45),var(--glass-edge);--lens-blur:var(--popup-blur);--lens-saturate:var(--glass-sat);-webkit-backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));backdrop-filter:var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));cursor:pointer;transition:background-color var(--dur-1) var(--ease-soft),transform var(--dur-press) var(--spring-press)}
.capture-quick-footer button:hover{background-color:color-mix(in srgb,var(--popup-glass) 80%,var(--accent) 8%)}
.capture-continue svg:first-child{color:var(--accent)}
.capture-quick-footer button:active{transform:scale(.96)}
.capture-quick-footer button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.capture-continue{flex:1;justify-content:flex-start}
.continue-arrow{margin-left:auto;transform:rotate(180deg)}
.capture-cancel{padding:0 10px}
.capture-cancel kbd{font:600 11px var(--font-mono);color:inherit}
.capture-quick-status{margin:2px 4px 0;padding:8px 12px;border-radius:14px;font-size:12px;line-height:1.6;color:var(--surface-ink);background:var(--popup-glass);box-shadow:var(--shadow-1);overflow-wrap:anywhere}
@media(prefers-reduced-motion:reduce){.capture-focus-veil,.capture-quick-hole,.thought-row,.thought-bubble,.thought-bubble::after,.thought-tail b,.capture-thinking,.capture-thinking svg,.capture-quick-footer,.thinking-dots b{animation:none}}
@media(prefers-reduced-transparency:reduce),(prefers-contrast:more){.capture-focus-veil{-webkit-backdrop-filter:none;backdrop-filter:none;background:rgb(10 14 22 / .62)}}
</style>
