<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'

// 输入栏下沿拉出的抽屉：上面一行是模型（可横向滑动的胶囊），下面一行是思考强度滑杆。
// 服务商、密钥与预算都在设置里，这里不再放入口。
type Model = { id: string; name: string; efforts?: string[]; defaultEffort?: string }
const props = defineProps<{ model: string; effort: string; models: Model[]; loading?: boolean; error?: string; canRefresh?: boolean }>()
const emit = defineEmits<{ model: [id: string]; effort: [value: string]; refresh: []; close: [] }>()
const EFFORT_LABELS: Record<string, string> = { '': '默认', none: '关闭思考', minimal: '极简', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极致' }
const chips = ref<HTMLElement>()
const track = ref<HTMLElement>()
const dragging = ref(false)
const current = computed(() => props.models.find(item => item.id === props.model))
const steps = computed(() => ['', ...(current.value?.efforts || ['none', 'low', 'medium', 'high', 'xhigh']).filter(Boolean)])
const index = computed(() => Math.max(0, steps.value.indexOf(props.effort)))
const fraction = computed(() => steps.value.length > 1 ? index.value / (steps.value.length - 1) : 0)
const label = (value: string) => EFFORT_LABELS[value] ?? value
function pick(clientX: number) {
  const box = track.value?.getBoundingClientRect()
  if (!box) return
  const ratio = Math.min(1, Math.max(0, (clientX - box.left - 11) / Math.max(1, box.width - 22)))
  const next = steps.value[Math.round(ratio * (steps.value.length - 1))]
  if (next !== props.effort) emit('effort', next)
}
function down(event: PointerEvent) {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  dragging.value = true
  pick(event.clientX)
}
function move(event: PointerEvent) { if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) pick(event.clientX) }
function up() { dragging.value = false }
function key(event: KeyboardEvent) {
  const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
  if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); emit('effort', steps.value[event.key === 'Home' ? 0 : steps.value.length - 1]); return }
  if (!delta) return
  event.preventDefault()
  emit('effort', steps.value[Math.min(steps.value.length - 1, Math.max(0, index.value + delta))])
}
// 模型胶囊：左右方向键在胶囊间移动，竖向滚轮横向滚动这一行。
function chipKey(event: KeyboardEvent) {
  const buttons = [...(chips.value?.querySelectorAll<HTMLButtonElement>('button') || [])]
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!delta || at < 0) return
  event.preventDefault()
  buttons[Math.min(buttons.length - 1, Math.max(0, at + delta))]?.focus()
}
function chipWheel(event: WheelEvent) {
  const strip = chips.value
  if (!strip || strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
  event.preventDefault()
  strip.scrollLeft += event.deltaY
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault(); event.stopPropagation()
  emit('close')
}
onMounted(() => chips.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }))
</script>

<template>
  <div class="model-drawer" role="group" aria-label="模型与思考强度" @keydown="escape">
    <div class="drawer-row">
      <span class="drawer-label">模型</span>
      <div ref="chips" class="model-chips" role="listbox" aria-label="模型" aria-orientation="horizontal" @keydown="chipKey" @wheel="chipWheel">
        <button v-for="item in models" :key="item.id || 'default'" type="button" role="option" :aria-selected="item.id === model" :tabindex="item.id === model ? 0 : -1" @click="emit('model', item.id)">{{ item.name || item.id }}</button>
        <span v-if="loading" class="chips-note">正在读取本机模型…</span>
      </div>
      <button v-if="canRefresh" type="button" class="drawer-icon" :disabled="loading" data-tip="重新读取本机模型" aria-label="重新读取本机模型" @click="emit('refresh')"><AppIcon name="reset" :size="13" /></button>
    </div>
    <div class="drawer-row">
      <span class="drawer-label">思考</span>
      <!-- 液态玻璃滑杆：细槽、半透明填充；拖动时滑块变成一枚透明的玻璃透镜。 -->
      <div ref="track" class="effort-track" :class="{ dragging }" role="slider" tabindex="0" aria-label="思考强度" :aria-valuemin="0" :aria-valuemax="steps.length - 1" :aria-valuenow="index" :aria-valuetext="label(effort)" :style="{ '--fill': fraction }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="up" @keydown="key">
        <span class="effort-groove" aria-hidden="true"><span class="effort-fill" /></span>
        <span class="effort-ticks" aria-hidden="true"><b v-for="(step, i) in steps" :key="step || 'default'" :class="{ passed: i <= index }" /></span>
        <span class="effort-knob" aria-hidden="true" />
      </div>
      <strong :key="effort" class="effort-name">{{ label(effort) }}</strong>
      <button type="button" class="drawer-icon" data-tip="恢复默认强度" aria-label="恢复默认强度" :disabled="!effort" @click="emit('effort', '')"><AppIcon name="reset" :size="13" /></button>
    </div>
    <p v-if="error" class="drawer-status" role="status">{{ error }}</p>
  </div>
</template>

<style scoped>
/* 抽屉在输入栏玻璃之内，用输入栏自己的墨色；两行之间只有很轻的分隔。 */
.model-drawer{display:grid;gap:4px;padding:8px 2px 2px;border-top:1px solid var(--hairline);color:var(--ink);font-family:var(--font-ui)}
button{font:inherit;color:inherit;cursor:pointer}
.drawer-row{display:flex;align-items:center;gap:8px;min-width:0;height:32px}
.drawer-label{flex:0 0 auto;width:28px;font-size:11.5px;font-weight:600;color:var(--muted)}
.model-chips{display:flex;align-items:center;gap:4px;flex:1;min-width:0;height:32px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;scroll-behavior:smooth;-webkit-mask:linear-gradient(90deg,transparent,#000 10px,#000 calc(100% - 14px),transparent);mask:linear-gradient(90deg,transparent,#000 10px,#000 calc(100% - 14px),transparent);padding:0 10px 0 6px}
.model-chips::-webkit-scrollbar{display:none}
.model-chips button{flex:0 0 auto;height:26px;padding:0 11px;border:1px solid transparent;border-radius:var(--r-sm);background:none;box-shadow:none;font-size:12px;font-weight:550;color:var(--secondary);white-space:nowrap;transition:background var(--dur-1) var(--ease-soft),color var(--dur-1) var(--ease-soft),transform var(--dur-press) var(--spring-press)}
.model-chips button:hover{background:var(--frost);color:var(--ink)}
.model-chips button:active{transform:scale(.96)}
.model-chips button[aria-selected='true']{background:var(--frost-hover);border-color:var(--hairline);color:var(--ink);font-weight:650;box-shadow:inset 0 1px 0 var(--glass-rim-soft),0 2px 6px -3px rgb(0 0 0 / .3)}
.chips-note{flex:0 0 auto;font-size:11px;color:var(--muted)}
.drawer-icon{display:grid;place-items:center;flex-shrink:0;width:26px;height:26px;padding:0;border:0;border-radius:var(--r-xs);background:none;box-shadow:none;color:var(--muted)}
.drawer-icon:hover:not(:disabled){background:var(--frost);color:var(--ink)}
.drawer-icon:disabled{opacity:.35;cursor:default}
.effort-name{flex:0 0 auto;min-width:42px;font-size:12px;font-weight:600;color:var(--secondary);text-align:right;font-variant-numeric:tabular-nums;animation:zg-fade-in var(--dur-2) var(--ease-out) both}
/* 滑杆：26px 高的操作区里一道 6px 细槽；填充是半透明墨色。 */
.effort-track{--fill:0;position:relative;flex:1;min-width:80px;height:26px;margin-left:6px;cursor:pointer;touch-action:none;outline:none;border-radius:var(--r-full)}
.effort-track:focus-visible{box-shadow:0 0 0 2px var(--accent-ring)}
.effort-groove{position:absolute;left:0;right:0;top:50%;height:6px;margin-top:-3px;border-radius:var(--r-full);background:color-mix(in srgb,var(--ink) 10%,transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / .12),0 1px 0 var(--glass-rim-soft);overflow:hidden}
.effort-fill{position:absolute;inset:0 auto 0 0;width:calc(11px + (100% - 22px) * var(--fill));border-radius:inherit;background:color-mix(in srgb,var(--ink) 46%,transparent);transition:width var(--dur-smooth) var(--spring-snappy)}
.effort-ticks{position:absolute;inset:0 9px;display:flex;align-items:center;justify-content:space-between;pointer-events:none}
.effort-ticks b{width:4px;height:4px;border-radius:50%;background:color-mix(in srgb,var(--ink) 28%,transparent)}
.effort-ticks b.passed{background:color-mix(in srgb,var(--glass-light, #fff) 90%,transparent)}
/* 滑块：静止时是一枚带高光的白色玻璃胶囊；按住拖动时放大、变清透，像透镜一样透出下面的细槽。 */
.effort-knob{position:absolute;top:50%;left:calc((100% - 22px) * var(--fill));width:22px;height:16px;margin-top:-8px;border-radius:var(--r-full);background:linear-gradient(180deg,rgb(255 255 255 / .98),rgb(244 246 248 / .94));box-shadow:0 1px 4px rgb(0 0 0 / .22),0 0 0 .5px rgb(0 0 0 / .1),inset 0 1px 0 #fff;transition:left var(--dur-smooth) var(--spring-snappy),scale var(--dur-bounce) var(--spring-bouncy),background var(--dur-2) var(--ease-out),box-shadow var(--dur-2) var(--ease-out)}
.effort-track.dragging .effort-knob{scale:1.35 1.3;background:rgb(255 255 255 / .16);-webkit-backdrop-filter:blur(.6px) saturate(1.8) brightness(1.08);backdrop-filter:blur(.6px) saturate(1.8) brightness(1.08);box-shadow:0 4px 12px -2px rgb(0 0 0 / .28),inset 0 0 0 1px rgb(255 255 255 / .7),inset 1px 1px 0 rgb(255 255 255 / .9),inset -1px -1px 2px rgb(0 0 0 / .08)}
.drawer-status{margin:0 0 2px 36px;font-size:11px;color:var(--muted)}
@media(prefers-reduced-motion:reduce){.effort-fill,.effort-knob,.model-chips button{transition:none}.model-chips{scroll-behavior:auto}}
</style>
