<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

type CaptureFrame = { left: number; top: number; width: number; height: number }
const props = defineProps<{ frame: CaptureFrame; prompts: { label: string; question: string }[]; busy: boolean; status: string }>()
const emit = defineEmits<{ ask: [question: string]; continue: []; cancel: [] }>()
const panel = ref<HTMLElement>()
const overlay = ref<HTMLElement>()
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const panelSize = ref({ width: 264, height: 204 })
let observer: ResizeObserver | undefined
let previousFocus: HTMLElement | undefined

const holeStyle = computed(() => ({ left: `${props.frame.left}px`, top: `${props.frame.top}px`, width: `${props.frame.width}px`, height: `${props.frame.height}px` }))
const panelStyle = computed(() => {
  const margin = 12, gap = 10
  const width = Math.min(panelSize.value.width, viewport.value.width - margin * 2)
  const height = panelSize.value.height
  const frame = props.frame
  let left = frame.left + frame.width - width, top = frame.top + frame.height + gap
  if (top + height > viewport.value.height - margin) {
    if (frame.top - height - gap >= margin) top = frame.top - height - gap
    else if (frame.left + frame.width + gap + width <= viewport.value.width - margin) { left = frame.left + frame.width + gap; top = frame.top }
    else if (frame.left - gap - width >= margin) { left = frame.left - gap - width; top = frame.top }
    else top = frame.top + frame.height - height - gap
  }
  return {
    left: `${Math.max(margin, Math.min(viewport.value.width - width - margin, left))}px`,
    top: `${Math.max(margin, Math.min(viewport.value.height - height - margin, top))}px`,
  }
})
function resize() { viewport.value = { width: window.innerWidth, height: window.innerHeight } }
function focusable() { return [...(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])] }
function retainFocus(event: FocusEvent) {
  if (event.target instanceof Node && overlay.value && !overlay.value.contains(event.target)) focusable()[0]?.focus({ preventScroll: true })
}
watch(() => props.busy, async () => {
  await nextTick()
  if (document.activeElement instanceof HTMLButtonElement && document.activeElement.disabled) focusable()[0]?.focus({ preventScroll: true })
})
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('cancel'); return }
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
  focusable()[0]?.focus()
})
onBeforeUnmount(() => {
  observer?.disconnect(); window.removeEventListener('resize', resize); document.removeEventListener('focusin', retainFocus)
  // Do not pull focus back out of settings or the AI composer when continuing.
  if (overlay.value?.contains(document.activeElement) && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <div ref="overlay" class="capture-quick-overlay" role="dialog" aria-modal="true" aria-label="框选快捷提问" @click.self="emit('cancel')" @keydown="keydown" @wheel.prevent.stop>
    <div class="capture-quick-hole" :style="holeStyle" aria-hidden="true" />
    <section ref="panel" class="capture-quick-actions" :style="panelStyle" aria-label="对截图提问" data-glass-interactive="panel">
      <div class="capture-quick-buttons">
        <button v-for="(prompt, index) in prompts" :key="index" :title="prompt.question" :disabled="busy" data-glass-interactive @click="emit('ask', prompt.question)"><AppIcon name="sparkle" :size="14" /><span>{{ prompt.label }}</span></button>
      </div>
      <div class="capture-quick-footer">
        <button class="capture-continue" aria-label="继续到阅读助手" data-glass-interactive @click="emit('continue')">继续<AppIcon class="continue-arrow" name="arrow" :size="15" /></button>
        <button class="capture-cancel" aria-label="取消框选提问" title="取消（Esc）" data-glass-interactive @click="emit('cancel')"><AppIcon name="close" :size="16" /></button>
      </div>
      <p v-if="status" class="capture-quick-status" role="status">{{ status }}</p>
    </section>
  </div>
</template>

<style scoped>
.capture-quick-overlay{position:fixed;inset:0;z-index:70;overflow:hidden;isolation:isolate;cursor:default;touch-action:none}
.capture-quick-hole{position:absolute;box-sizing:border-box;pointer-events:none;border:1px solid #fff;outline:1px solid rgb(0 0 0 / .7);box-shadow:0 0 0 100vmax rgb(0 0 0 / .58);z-index:0}
.capture-quick-actions{--ink:var(--surface-ink);--control-ink:var(--surface-ink);--glass-label-shadow:none;position:absolute;z-index:1;box-sizing:border-box;width:264px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;padding:12px;border:1px solid var(--glass-outline);border-radius:0;background-color:var(--popup-glass);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--popup-blur)) saturate(var(--glass-sat));box-shadow:0 12px 36px rgb(0 0 0 / .28),var(--glass-edge);color:var(--control-ink)}
.capture-quick-buttons{display:grid;gap:7px}
button{display:flex;align-items:center;gap:8px;box-sizing:border-box;min-height:36px;font:inherit;font-size:13px;font-weight:550;line-height:20px;color:var(--control-ink);text-shadow:var(--glass-label-shadow);border:1px solid var(--glass-outline);border-radius:0;background-color:var(--glass-1);background-image:var(--glass-sheen);box-shadow:var(--glass-control-shadow);padding:7px 10px;cursor:pointer;transition:background-color var(--dur-1) var(--ease-soft),box-shadow var(--dur-1) var(--ease-soft)}
button:hover:not(:disabled){background-color:var(--control-hover)}
button:active:not(:disabled){box-shadow:var(--glass-pressed-shadow)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.5;cursor:default}
button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.capture-quick-footer{display:flex;gap:8px;margin-top:10px}
.capture-continue{flex:1;justify-content:space-between;background-color:var(--control-selected)}
.capture-cancel{flex:0 0 36px;justify-content:center;padding:7px}
.continue-arrow{transform:rotate(180deg)}
.capture-quick-status{margin:10px 0 0;font-size:12px;line-height:1.6;color:var(--control-ink);overflow-wrap:anywhere}
@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
