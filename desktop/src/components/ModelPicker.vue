<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

type Model = { id: string; name: string; efforts?: string[]; defaultEffort?: string }
const props = defineProps<{ model: string; effort: string; models: Model[]; loading?: boolean; error?: string; canRefresh?: boolean }>()
const emit = defineEmits<{ model: [id: string]; effort: [value: string]; refresh: []; more: []; close: [] }>()
const EFFORT_LABELS: Record<string, string> = { '': '默认', none: '关闭思考', minimal: '极简', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极致' }
const EFFORT_NOTES: Record<string, string> = { '': '使用模型的默认思考强度', none: '直接回答，最快', minimal: '几乎不思考', low: '简单问题', medium: '平衡速度与深度', high: '复杂推导与长文', xhigh: '困难问题，较慢', max: '最深入，最慢', ultra: '最深入，最慢' }
const view = ref<'effort' | 'models'>('effort')
const card = ref<HTMLElement>()
const track = ref<HTMLElement>()
const current = computed(() => props.models.find(item => item.id === props.model))
const steps = computed(() => ['', ...(current.value?.efforts || ['none', 'low', 'medium', 'high', 'xhigh']).filter(Boolean)])
const index = computed(() => Math.max(0, steps.value.indexOf(props.effort)))
const fraction = computed(() => steps.value.length > 1 ? index.value / (steps.value.length - 1) : 0)
const label = (value: string) => EFFORT_LABELS[value] ?? value
// A few fixed sparkles on the filled track; deterministic so the bar does not flicker.
const sparkles = Array.from({ length: 14 }, (_, i) => ({ left: (i * 37) % 97, top: 20 + ((i * 53) % 60), size: 1.5 + (i % 3) * .6, delay: (i % 5) * .4 }))
function pick(clientX: number) {
  const box = track.value?.getBoundingClientRect()
  if (!box) return
  const ratio = Math.min(1, Math.max(0, (clientX - box.left - 20) / Math.max(1, box.width - 40)))
  const next = steps.value[Math.round(ratio * (steps.value.length - 1))]
  if (next !== props.effort) emit('effort', next)
}
function down(event: PointerEvent) {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  pick(event.clientX)
}
function move(event: PointerEvent) { if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) pick(event.clientX) }
function key(event: KeyboardEvent) {
  const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
  if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); emit('effort', steps.value[event.key === 'Home' ? 0 : steps.value.length - 1]); return }
  if (!delta) return
  event.preventDefault()
  emit('effort', steps.value[Math.min(steps.value.length - 1, Math.max(0, index.value + delta))])
}
function chooseModel(id: string) { emit('model', id); view.value = 'effort' }
// 切换视图后把焦点放进新视图，键盘和读屏用户不会丢失位置。
watch(view, value => setTimeout(() => {
  if (value === 'effort') track.value?.focus({ preventScroll: true })
  else card.value?.querySelector<HTMLElement>('.models-list [aria-selected="true"], .models-list button')?.focus({ preventScroll: true })
}, 200))
// Esc 不依赖焦点位置：先从模型列表退回，再关闭卡片。
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault(); event.stopPropagation()
  if (view.value === 'models') view.value = 'effort'; else emit('close')
}
onMounted(() => { track.value?.focus({ preventScroll: true }); window.addEventListener('keydown', escape, true) })
onBeforeUnmount(() => window.removeEventListener('keydown', escape, true))
</script>

<template>
  <div ref="card" class="model-card" role="dialog" aria-label="模型与思考强度">
    <Transition name="card-view" mode="out-in">
      <div v-if="view === 'effort'" key="effort" class="card-effort">
        <div class="card-head">
          <button type="button" class="card-icon" data-tip="最快：关闭思考" aria-label="最快：关闭思考" @click="emit('effort', steps.includes('none') ? 'none' : steps[1] || '')"><AppIcon name="bolt" :size="16" /></button>
          <div class="card-title">
            <strong :key="effort" class="effort-name">{{ label(effort) }}</strong>
            <button type="button" class="model-name" :aria-label="`模型：${current?.name || model || '默认模型'}，点击更换`" @click="view = 'models'">{{ current?.name || model || '默认模型' }}<AppIcon name="chevron-right" :size="13" /></button>
          </div>
          <button type="button" class="card-icon" data-tip="恢复默认强度" aria-label="恢复默认强度" @click="emit('effort', '')"><AppIcon name="reset" :size="16" /></button>
        </div>
        <div ref="track" class="effort-track" role="slider" tabindex="0" aria-label="思考强度" :aria-valuemin="0" :aria-valuemax="steps.length - 1" :aria-valuenow="index" :aria-valuetext="label(effort)" :style="{ '--fill': fraction }" @pointerdown="down" @pointermove="move" @keydown="key">
          <div class="effort-fill"><i v-for="(spark, i) in sparkles" :key="i" :style="{ left: `${spark.left}%`, top: `${spark.top}%`, width: `${spark.size}px`, height: `${spark.size}px`, animationDelay: `${spark.delay}s` }" /></div>
          <span class="effort-ticks" aria-hidden="true"><b v-for="(step, i) in steps" :key="step || 'default'" :class="{ passed: i <= index }" /></span>
          <span class="effort-knob" aria-hidden="true" />
        </div>
        <p class="effort-note">{{ EFFORT_NOTES[effort] || '' }}</p>
        <p v-if="error" class="models-status" role="status">{{ error }}</p>
        <button type="button" class="card-more" @click="emit('more')">服务商、密钥与预算<AppIcon name="chevron-right" :size="12" /></button>
      </div>
      <div v-else key="models" class="card-models">
        <div class="models-head"><button type="button" class="card-icon" aria-label="返回思考强度" @click="view = 'effort'"><AppIcon name="arrow" :size="15" /></button><strong>选择模型</strong><button v-if="canRefresh" type="button" class="card-icon" :disabled="loading" data-tip="重新读取本机模型" aria-label="重新读取本机模型" @click="emit('refresh')"><AppIcon name="reset" :size="15" /></button></div>
        <div class="models-list" role="listbox" aria-label="模型">
          <button v-for="item in models" :key="item.id || 'default'" type="button" role="option" :aria-selected="item.id === model" @click="chooseModel(item.id)"><span>{{ item.name || item.id }}</span><AppIcon v-if="item.id === model" name="check" :size="14" /></button>
        </div>
        <p v-if="loading || error" class="models-status" role="status">{{ loading ? '正在读取本机模型…' : error }}</p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 模型与强度：一张实底卡片，强度名在上，下面一条可拖动的渐变强度条。 */
.model-card{position:absolute;right:0;bottom:calc(100% + 10px);z-index:20;width:308px;max-width:calc(100vw - 32px);padding:14px;border-radius:22px;background:var(--surface);border:1px solid var(--line);box-shadow:0 18px 50px -14px rgb(0 0 0 / .35),0 2px 8px rgb(0 0 0 / .06);color:var(--surface-ink);transform-origin:85% 100%;will-change:transform}
button{font:inherit;color:inherit;cursor:pointer}
.card-head{display:grid;grid-template-columns:34px 1fr 34px;align-items:center;gap:6px}
.card-icon{display:grid;place-items:center;width:34px;height:34px;padding:0;border:0;border-radius:50%;background:none;box-shadow:none;color:var(--surface-muted)}
.card-icon:hover:not(:disabled){background:var(--fill-3);color:var(--surface-ink)}
.card-title{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0}
.effort-name{font-family:var(--font-display);font-size:19px;font-weight:700;letter-spacing:.2px;background:linear-gradient(100deg,var(--accent),var(--brand-b));-webkit-background-clip:text;background-clip:text;color:transparent;animation:zg-rise-in var(--dur-3) var(--ease-out) both}
.model-name{display:inline-flex;align-items:center;gap:2px;max-width:100%;height:auto;padding:1px 6px;border:0;border-radius:6px;background:none;box-shadow:none;font-size:12.5px;font-weight:500;color:var(--surface-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.model-name:hover{background:var(--fill-3);color:var(--surface-ink)}
/* 强度条：已选部分是带星点的渐变，旋钮是一颗白色圆。 */
.effort-track{--fill:0;position:relative;height:42px;margin-top:14px;border-radius:999px;background:var(--fill-3);cursor:pointer;touch-action:none;outline:none}
.effort-track:focus-visible{box-shadow:0 0 0 3px var(--accent-ring)}
.effort-fill{position:absolute;inset:0 auto 0 0;width:calc(42px + (100% - 42px) * var(--fill));border-radius:999px;overflow:hidden;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 85%,#1b2a6b),color-mix(in srgb,var(--brand-b) 90%,#fff 0%));transition:width var(--dur-smooth) var(--spring-snappy)}
.effort-fill i{position:absolute;border-radius:50%;background:#fff;opacity:.75;animation:spark 2.4s ease-in-out infinite}
@keyframes spark{0%,100%{opacity:.25}50%{opacity:.95}}
.effort-ticks{position:absolute;inset:0 21px;display:flex;align-items:center;justify-content:space-between;pointer-events:none}
.effort-ticks b{width:4px;height:4px;border-radius:50%;background:color-mix(in srgb,var(--surface-ink) 25%,transparent)}
.effort-ticks b.passed{background:rgb(255 255 255 / .55)}
.effort-knob{position:absolute;top:4px;left:calc(4px + (100% - 42px) * var(--fill));width:34px;height:34px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgb(0 0 0 / .22),0 0 0 .5px rgb(0 0 0 / .08);transition:left var(--dur-smooth) var(--spring-snappy)}
.effort-track:active .effort-knob{scale:1.06}
.effort-note{margin:9px 2px 2px;font-size:11.5px;color:var(--surface-muted);text-align:center}
.card-more{display:flex;align-items:center;justify-content:center;gap:3px;width:100%;height:32px;margin-top:8px;padding:0;border:0;border-top:1px solid var(--line-soft);border-radius:0;background:none;box-shadow:none;font-size:11.5px;color:var(--surface-muted)}
.card-more:hover:not(:disabled){background:none;color:var(--surface-ink)}
.models-head{display:grid;grid-template-columns:34px 1fr 34px;align-items:center;margin-bottom:6px}
.models-head strong{font-size:13px;text-align:center}
.models-list{display:grid;gap:2px;max-height:260px;overflow:auto;scrollbar-width:thin}
.models-list button{display:flex;align-items:center;justify-content:space-between;gap:8px;height:36px;padding:0 12px;border:0;border-radius:11px;background:none;box-shadow:none;font-size:12.5px;text-align:left}
.models-list button:hover{background:var(--fill-3)}
.models-list button[aria-selected='true']{background:var(--fill-2);font-weight:600}
.models-list span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.models-status{margin:8px 4px 0;font-size:11.5px;color:var(--surface-muted)}
.card-view-enter-active,.card-view-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-3) var(--spring-snappy)}
.card-view-enter-from{opacity:0;transform:translateX(10px)}
.card-view-leave-to{opacity:0;transform:translateX(-10px)}
@media(prefers-reduced-motion:reduce){.effort-fill,.effort-knob{transition:none}.effort-fill i{animation:none}}
</style>
