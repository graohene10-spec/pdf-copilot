<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

type Model = { id: string; name: string; efforts?: string[]; defaultEffort?: string }
const props = defineProps<{ model: string; effort: string; models: Model[]; loading?: boolean; error?: string; canRefresh?: boolean }>()
const emit = defineEmits<{ model: [id: string]; effort: [value: string]; refresh: []; more: []; close: [] }>()
const EFFORT_LABELS: Record<string, string> = { '': '默认', none: '关闭思考', minimal: '极简', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极致' }
const view = ref<'effort' | 'models'>('effort')
const card = ref<HTMLElement>()
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
          <button type="button" class="model-name" :aria-label="`模型：${current?.name || model || '默认模型'}，点击更换`" @click="view = 'models'"><span>{{ current?.name || model || '默认模型' }}</span><AppIcon name="chevron-right" :size="12" /></button>
          <strong :key="effort" class="effort-name">{{ label(effort) }}</strong>
          <button type="button" class="card-icon" data-tip="恢复默认强度" aria-label="恢复默认强度" :disabled="!effort" @click="emit('effort', '')"><AppIcon name="reset" :size="13" /></button>
        </div>
        <!-- 液态玻璃滑杆：细槽、半透明填充；拖动时滑块变成一枚透明的玻璃透镜。 -->
        <div ref="track" class="effort-track" :class="{ dragging }" role="slider" tabindex="0" aria-label="思考强度" :aria-valuemin="0" :aria-valuemax="steps.length - 1" :aria-valuenow="index" :aria-valuetext="label(effort)" :style="{ '--fill': fraction }" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @lostpointercapture="up" @keydown="key">
          <span class="effort-groove" aria-hidden="true"><span class="effort-fill" /></span>
          <span class="effort-ticks" aria-hidden="true"><b v-for="(step, i) in steps" :key="step || 'default'" :class="{ passed: i <= index }" /></span>
          <span class="effort-knob" aria-hidden="true" />
        </div>
        <p v-if="error" class="models-status" role="status">{{ error }}</p>
        <button type="button" class="card-more" @click="emit('more')">服务商、密钥与预算<AppIcon name="chevron-right" :size="11" /></button>
      </div>
      <div v-else key="models" class="card-models">
        <div class="models-head"><button type="button" class="card-icon" aria-label="返回思考强度" @click="view = 'effort'"><AppIcon name="arrow" :size="13" /></button><strong>选择模型</strong><button v-if="canRefresh" type="button" class="card-icon" :disabled="loading" data-tip="重新读取本机模型" aria-label="重新读取本机模型" @click="emit('refresh')"><AppIcon name="reset" :size="13" /></button></div>
        <div class="models-list" role="listbox" aria-label="模型">
          <button v-for="item in models" :key="item.id || 'default'" type="button" role="option" :aria-selected="item.id === model" @click="chooseModel(item.id)"><span>{{ item.name || item.id }}</span><AppIcon v-if="item.id === model" name="check" :size="13" /></button>
        </div>
        <p v-if="loading || error" class="models-status" role="status">{{ loading ? '正在读取本机模型…' : error }}</p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 模型与强度：一张更通透的液态玻璃小卡片——上面一行是模型与当前强度，下面一条细槽滑杆。
   字号、圆角、按钮与应用其他弹出层一致，不再有说明文字和渐变色块。 */
.model-card{--card-ink:var(--surface-ink);position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;box-sizing:border-box;width:236px;max-width:calc(100vw - 32px);padding:8px 10px 4px;border-radius:var(--r-lg);background-color:color-mix(in srgb,var(--popup-glass) 58%,transparent);background-image:var(--popup-sheen);-webkit-backdrop-filter:blur(var(--popup-blur)) saturate(calc(var(--glass-sat) * 1.15));backdrop-filter:blur(var(--popup-blur)) saturate(calc(var(--glass-sat) * 1.15));border:1px solid var(--glass-outline);box-shadow:0 14px 34px -14px rgb(0 0 0 / .3),var(--glass-edge);color:var(--card-ink);font-family:var(--font-ui);transform-origin:85% 100%;will-change:transform}
button{font:inherit;color:inherit;cursor:pointer}
.card-head{display:flex;align-items:center;gap:4px;min-width:0;height:28px}
.model-name{display:inline-flex;align-items:center;justify-content:flex-start;gap:2px;flex:1;min-width:0;height:26px;margin-left:-6px;padding:0 6px;border:0;border-radius:var(--r-sm);background:none;box-shadow:none;font-size:12.5px;font-weight:600;color:var(--card-ink);text-align:left}
.model-name span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.model-name svg{flex-shrink:0;opacity:.55}
.model-name:hover{background:color-mix(in srgb,var(--card-ink) 7%,transparent)}
.effort-name{flex-shrink:0;font-size:12px;font-weight:600;color:var(--surface-secondary);font-variant-numeric:tabular-nums;animation:zg-fade-in var(--dur-2) var(--ease-out) both}
.card-icon{display:grid;place-items:center;flex-shrink:0;width:24px;height:24px;padding:0;border:0;border-radius:var(--r-xs);background:none;box-shadow:none;color:var(--surface-muted)}
.card-icon:hover:not(:disabled){background:color-mix(in srgb,var(--card-ink) 8%,transparent);color:var(--card-ink)}
.card-icon:disabled{opacity:.35;cursor:default}
/* 滑杆：24px 高的操作区里一道 6px 细槽；填充是半透明墨色，不再用蓝色渐变。 */
.effort-track{--fill:0;position:relative;height:26px;margin:2px 0 4px;cursor:pointer;touch-action:none;outline:none;border-radius:var(--r-full)}
.effort-track:focus-visible{box-shadow:0 0 0 2px var(--accent-ring)}
.effort-groove{position:absolute;left:0;right:0;top:50%;height:6px;margin-top:-3px;border-radius:var(--r-full);background:color-mix(in srgb,var(--card-ink) 10%,transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / .12),0 1px 0 var(--glass-rim-soft);overflow:hidden}
.effort-fill{position:absolute;inset:0 auto 0 0;width:calc(11px + (100% - 22px) * var(--fill));border-radius:inherit;background:color-mix(in srgb,var(--card-ink) 46%,transparent);transition:width var(--dur-smooth) var(--spring-snappy)}
.effort-ticks{position:absolute;inset:0 9px;display:flex;align-items:center;justify-content:space-between;pointer-events:none}
.effort-ticks b{width:4px;height:4px;border-radius:50%;background:color-mix(in srgb,var(--card-ink) 28%,transparent)}
.effort-ticks b.passed{background:color-mix(in srgb,var(--popup-glass) 90%,transparent)}
/* 滑块：静止时是一枚带高光的白色玻璃胶囊；按住拖动时放大、变清透，像透镜一样透出下面的细槽。 */
.effort-knob{position:absolute;top:50%;left:calc((100% - 22px) * var(--fill));width:22px;height:16px;margin-top:-8px;border-radius:var(--r-full);background:linear-gradient(180deg,rgb(255 255 255 / .98),rgb(244 246 248 / .94));box-shadow:0 1px 4px rgb(0 0 0 / .22),0 0 0 .5px rgb(0 0 0 / .1),inset 0 1px 0 #fff;transition:left var(--dur-smooth) var(--spring-snappy),scale var(--dur-bounce) var(--spring-bouncy),background var(--dur-2) var(--ease-out),box-shadow var(--dur-2) var(--ease-out)}
.effort-track.dragging .effort-knob{scale:1.35 1.3;background:rgb(255 255 255 / .16);-webkit-backdrop-filter:blur(.6px) saturate(1.8) brightness(1.08);backdrop-filter:blur(.6px) saturate(1.8) brightness(1.08);box-shadow:0 4px 12px -2px rgb(0 0 0 / .28),inset 0 0 0 1px rgb(255 255 255 / .7),inset 1px 1px 0 rgb(255 255 255 / .9),inset -1px -1px 2px rgb(0 0 0 / .08)}
.card-more{display:flex;align-items:center;justify-content:center;gap:2px;width:100%;height:26px;padding:0;border:0;border-top:1px solid color-mix(in srgb,var(--card-ink) 8%,transparent);border-radius:0;background:none;box-shadow:none;font-size:11px;color:var(--surface-muted)}
.card-more:hover:not(:disabled){background:none;color:var(--card-ink)}
.models-head{display:grid;grid-template-columns:24px 1fr 24px;align-items:center;height:28px;margin-bottom:2px}
.models-head strong{font-size:12px;font-weight:600;text-align:center}
.models-list{display:grid;gap:1px;max-height:240px;padding-bottom:4px;overflow:auto;scrollbar-width:thin}
.models-list button{display:flex;align-items:center;justify-content:space-between;gap:8px;height:30px;padding:0 9px;border:0;border-radius:var(--r-sm);background:none;box-shadow:none;font-size:12px;text-align:left}
.models-list button:hover{background:color-mix(in srgb,var(--card-ink) 7%,transparent)}
.models-list button[aria-selected='true']{background:color-mix(in srgb,var(--card-ink) 11%,transparent);font-weight:600}
.models-list span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.models-status{margin:4px 2px 6px;font-size:11px;color:var(--surface-muted)}
.card-view-enter-active,.card-view-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-3) var(--spring-snappy)}
.card-view-enter-from{opacity:0;transform:translateX(8px)}
.card-view-leave-to{opacity:0;transform:translateX(-8px)}
@media(prefers-reduced-motion:reduce){.effort-fill,.effort-knob{transition:none}}
</style>
