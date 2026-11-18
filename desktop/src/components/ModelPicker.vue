<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'

// 输入栏下沿拉出的抽屉：上面一行是模型（可横向滑动的胶囊），下面一行是思考强度滑杆。
// 服务商、密钥与预算都在设置里，这里不再放入口。
type Tier = { id: string; name?: string; description?: string }
type Model = { id: string; name: string; efforts?: string[]; defaultEffort?: string; tiers?: Tier[] }
// fast：服务商支持优先通道（Codex / OpenAI）时才传，undefined 就不显示开关。
const props = defineProps<{ model: string; effort: string; models: Model[]; loading?: boolean; error?: string; canRefresh?: boolean; fast?: boolean
  /** Codex 的速度档：当前选的档位 id（空是标准）。这个模型自己列了档位时，Fast 开关换成一排档位。 */
  tier?: string
  /** 不提供「默认」档：翻译要明确的思考强度。 */
  noDefault?: boolean }>()
const emit = defineEmits<{ model: [id: string]; effort: [value: string]; fast: [value: boolean]; tier: [id: string]; refresh: []; close: [] }>()
const EFFORT_LABELS: Record<string, string> = { '': '默认', none: '关', minimal: '极简', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极致' }
const chips = ref<HTMLElement>()
const current = computed(() => props.models.find(item => item.id === props.model))
const steps = computed(() => [...(props.noDefault ? [] : ['']), ...(current.value?.efforts || ['none', 'low', 'medium', 'high', 'xhigh']).filter(Boolean)])
const index = computed(() => Math.max(0, steps.value.indexOf(props.effort)))
const label = (value: string) => EFFORT_LABELS[value] ?? value
// 速度档：标准 + 这个模型自己有的那些（有的模型没有超快，有的一档都没有）。
const TIER_LABELS: Record<string, [string, string]> = { priority: ['快速', '约 1.5 倍速度，用量更多'], fast: ['快速', '约 1.5 倍速度，用量更多'], ultrafast: ['超快', '最快的响应，用量最多'], flex: ['省额度', '慢一些，用量更少'] }
const speeds = computed(() => {
  const tiers = current.value?.tiers || []
  return tiers.length ? [{ id: '', name: '标准', tip: '默认速度' }, ...tiers.map(item => ({ id: item.id, name: TIER_LABELS[item.id]?.[0] || item.name || item.id, tip: TIER_LABELS[item.id]?.[1] || item.description || '' }))] : []
})
const speedIndex = computed(() => { const want = props.tier || (props.fast ? 'priority' : ''); return Math.max(0, speeds.value.findIndex(item => item.id === want)) })
function speedKey(event: KeyboardEvent) {
  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!delta) return
  event.preventDefault()
  emit('tier', speeds.value[Math.min(speeds.value.length - 1, Math.max(0, speedIndex.value + delta))]!.id)
}
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
      <!-- 分段选择：每一档直接写出名字，选中的那一档下面滑过一块玻璃；档位越高，旁边的强度格亮得越多。 -->
      <div class="effort-segments" role="radiogroup" aria-label="思考强度" :style="{ '--count': steps.length, '--index': index }" @keydown="key">
        <span class="effort-thumb" aria-hidden="true" />
        <button v-for="(step, i) in steps" :key="step || 'default'" type="button" role="radio" :aria-checked="i === index" :tabindex="i === index ? 0 : -1" :class="{ on: i === index }" :data-tip="step ? undefined : '使用模型默认强度'" @click="emit('effort', step)">{{ label(step) }}</button>
      </div>
      <span class="effort-meter" aria-hidden="true" :title="label(effort)"><i v-for="bar in 4" :key="bar" :class="{ lit: index > 0 && bar <= Math.ceil(index / Math.max(1, steps.length - 1) * 4) }" /></span>
      <button v-if="fast !== undefined && !speeds.length" type="button" class="fast-toggle" :class="{ on: fast }" role="switch" :aria-checked="fast" aria-label="Fast" :data-tip="fast ? 'Fast 已开：更快，额度消耗更多' : 'Fast：更快出字，额度消耗更多'" @click="emit('fast', !fast)"><AppIcon name="bolt" :size="12" />Fast</button>
    </div>
    <div v-if="speeds.length" class="drawer-row">
      <span class="drawer-label">速度</span>
      <div class="effort-segments" role="radiogroup" aria-label="响应速度" :style="{ '--count': speeds.length, '--index': speedIndex }" @keydown="speedKey">
        <span class="effort-thumb" aria-hidden="true" />
        <button v-for="(item, i) in speeds" :key="item.id || 'standard'" type="button" role="radio" :aria-checked="i === speedIndex" :tabindex="i === speedIndex ? 0 : -1" :class="{ on: i === speedIndex }" :data-tip="item.tip || undefined" @click="emit('tier', item.id)"><AppIcon v-if="item.id" name="bolt" :size="11" class="speed-bolt" />{{ item.name }}</button>
      </div>
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
/* 思考强度：一排分段，选中的一档下面是一块随弹簧滑动的玻璃；右侧四格信号条表示当前强度。 */
.effort-segments{--count:5;--index:0;position:relative;display:grid;grid-template-columns:repeat(var(--count),1fr);flex:1;min-width:0;height:28px;padding:2px;border-radius:var(--r-sm);background:color-mix(in srgb,var(--ink) 6%,transparent);box-shadow:inset 0 1px 2px rgb(0 0 0 / .08)}
.effort-thumb{position:absolute;top:2px;bottom:2px;left:calc(2px + (100% - 4px) / var(--count) * var(--index));width:calc((100% - 4px) / var(--count));border-radius:calc(var(--r-sm) - 2px);background:var(--frost-hover);background-image:linear-gradient(180deg,rgb(255 255 255 / .55),rgb(255 255 255 / .15));box-shadow:0 1px 4px -1px rgb(0 0 0 / .22),inset 0 0 0 .5px var(--hairline),inset 0 1px 0 var(--glass-rim-soft);transition:left var(--dur-smooth) var(--spring-snappy)}
.effort-segments button{position:relative;z-index:1;min-width:0;height:100%;padding:0 2px;border:0;border-radius:calc(var(--r-sm) - 2px);background:none;box-shadow:none;font-size:11.5px;font-weight:550;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color var(--dur-1) var(--ease-soft),transform var(--dur-press) var(--spring-press)}
.effort-segments button:hover:not(.on){color:var(--ink)}
.effort-segments button:active{transform:scale(.94)}
.effort-segments button.on{color:var(--ink);font-weight:650}
.effort-segments button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--accent-ring)}
.effort-meter{display:flex;align-items:flex-end;gap:2px;flex:0 0 auto;height:14px;margin:0 4px 0 2px}
.effort-meter i{width:3px;border-radius:1px;background:color-mix(in srgb,var(--ink) 16%,transparent);transition:background var(--dur-2) var(--ease-out)}
.effort-meter i:nth-child(1){height:5px}.effort-meter i:nth-child(2){height:8px}.effort-meter i:nth-child(3){height:11px}.effort-meter i:nth-child(4){height:14px}
.effort-meter i.lit{background:var(--accent)}
.fast-toggle{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;height:26px;padding:0 8px;border:1px solid transparent;border-radius:var(--r-sm);background:none;box-shadow:none;font-size:11.5px;font-weight:600;color:var(--muted);transition:background var(--dur-1) var(--ease-soft),color var(--dur-1) var(--ease-soft)}
.speed-bolt{margin-right:3px;vertical-align:-1px;color:var(--accent)}
.fast-toggle:hover{background:var(--frost);color:var(--ink)}
.fast-toggle.on{background:color-mix(in srgb,var(--accent) 14%,transparent);border-color:color-mix(in srgb,var(--accent) 30%,transparent);color:var(--accent)}
.drawer-status{margin:0 0 2px 36px;font-size:11px;color:var(--muted)}
@media(prefers-reduced-motion:reduce){.effort-thumb,.model-chips button{transition:none}.model-chips{scroll-behavior:auto}}
</style>
