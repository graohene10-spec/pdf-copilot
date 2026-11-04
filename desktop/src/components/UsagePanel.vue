<script setup lang="ts">
// /usage：本次打开应用以来的模型用量。上面两条进度：当前对话占了多少上下文、今天用了近两周峰值的多少；
// 下面是本次会话的请求数与用时、按模型的明细，以及用量花在哪里（主对话、侧边对话、翻译……）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { ledger, summarize } from '../ai/usage'

const props = defineProps<{ contextUsed: number; contextLimit: number; model: string }>()
const emit = defineEmits<{ close: [] }>()
const now = ref(Date.now())
const card = ref<HTMLElement>()
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 30_000); card.value?.focus({ preventScroll: true }) })
onBeforeUnmount(() => clearInterval(timer))

const summary = computed(() => summarize(ledger.entries, now.value))
const contextRatio = computed(() => Math.min(1, props.contextUsed / Math.max(1, props.contextLimit)))
const todayTokens = computed(() => summary.value.today.input + summary.value.today.output)
const todayRatio = computed(() => summary.value.peak ? Math.min(1, todayTokens.value / summary.value.peak) : 0)
const tone = (ratio: number) => ratio >= .85 ? 'hot' : ratio >= .6 ? 'warm' : 'calm'
const percent = (ratio: number) => `${Math.round(ratio * 100)}%`
function count(value: number) { return value < 1000 ? String(value) : value < 1_000_000 ? `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k` : `${(value / 1_000_000).toFixed(1)}M` }
function duration(ms: number) {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return `${Math.max(0, Math.round(ms / 1000))}s`
  if (minutes < 60) return `${minutes}m ${Math.floor((ms % 60_000) / 1000)}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
const copied = ref(false)
async function copy() {
  const s = summary.value
  const lines = [
    `开智 · 用量`,
    `当前对话上下文：${count(props.contextUsed)} / ${count(props.contextLimit)} tokens（${percent(contextRatio.value)}）`,
    `今天：${count(todayTokens.value)} tokens，${s.today.requests} 次请求`,
    `本次会话：${s.requests} 次请求，输入 ${count(s.input)}，输出 ${count(s.output)}，思考 ${count(s.reasoning)}，模型用时 ${duration(s.busyMs)}，已打开 ${duration(s.activeMs)}`,
    ...s.byModel.map(model => `  ${model.model}：${model.requests} 次，输入 ${count(model.input)}，输出 ${count(model.output)}`),
    ...s.byKind.map(kind => `  ${kind.label}：${percent(kind.share)}`),
  ]
  try { await navigator.clipboard.writeText(lines.join('\n')); copied.value = true; setTimeout(() => { copied.value = false }, 1400) } catch { /* 剪贴板不可用 */ }
}
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') } }
</script>

<template>
  <div class="usage-backdrop" @pointerdown.self="emit('close')">
    <section ref="card" class="usage-card" role="dialog" aria-label="用量" tabindex="-1" @keydown="keydown">
      <header class="usage-head">
        <h3>用量</h3>
        <button type="button" class="usage-icon" :aria-label="copied ? '已复制' : '复制用量'" :data-tip="copied ? '已复制' : '复制为文字'" @click="copy"><AppIcon :name="copied ? 'check' : 'copy'" :size="15" /></button>
        <button type="button" class="usage-icon" aria-label="关闭" data-tip="关闭" data-tip-key="Esc" @click="emit('close')"><AppIcon name="close" :size="14" /></button>
      </header>

      <div class="usage-meter">
        <div class="usage-row"><span>当前对话上下文</span><span class="usage-note">{{ count(contextUsed) }} / {{ count(contextLimit) }} tokens</span><b :class="tone(contextRatio)">{{ percent(contextRatio) }}</b></div>
        <div class="usage-bar" :class="tone(contextRatio)"><i :style="{ width: percent(contextRatio) }"></i></div>
        <p v-if="contextRatio >= .6" class="usage-tip">上下文快满了：输入 <code>/compress</code> 把对话压缩成摘要。</p>
      </div>
      <div class="usage-meter">
        <div class="usage-row"><span>今天 · 所有模型</span><span class="usage-note">{{ count(todayTokens) }} tokens · 近两周单日最多的</span><b class="calm">{{ percent(todayRatio) }}</b></div>
        <div class="usage-bar daily"><i :style="{ width: percent(todayRatio) }"></i></div>
      </div>

      <h4>本次会话</h4>
      <dl class="usage-grid">
        <div><dt>请求</dt><dd>{{ summary.requests }}</dd></div>
        <div><dt>模型用时</dt><dd>{{ duration(summary.busyMs) }}</dd></div>
        <div><dt>已打开</dt><dd>{{ duration(summary.activeMs) }}</dd></div>
        <div><dt>输入</dt><dd>{{ count(summary.input) }}</dd></div>
        <div><dt>输出</dt><dd>{{ count(summary.output) }}</dd></div>
        <div><dt>思考</dt><dd>{{ count(summary.reasoning) }}</dd></div>
      </dl>
      <p v-if="summary.estimated" class="usage-tip">部分服务没有返回用量，相应的数字按字数估算。</p>

      <template v-if="summary.byModel.length">
        <div v-for="item in summary.byModel.slice(0, 3)" :key="item.provider + item.model" class="usage-breakdown">
          <div class="usage-row head"><span>明细</span><span class="usage-note">{{ item.model }}</span></div>
          <div class="usage-row"><span>输入</span><b>{{ count(item.input) }}</b></div>
          <div class="usage-row"><span>输出</span><b>{{ count(item.output) }}</b></div>
          <div class="usage-row"><span>思考</span><b>{{ count(item.reasoning) }}</b></div>
          <div class="usage-row"><span>请求</span><b>{{ item.requests }}</b></div>
        </div>
      </template>
      <p v-else class="usage-empty">这次打开应用后还没有向模型发过请求。当前模型：{{ model }}</p>

      <template v-if="summary.byKind.length">
        <h4 class="usage-muted">用在哪里（本次会话）</h4>
        <div v-for="item in summary.byKind" :key="item.kind" class="usage-kind">
          <span>{{ item.label }}</span>
          <span class="usage-mini"><i :style="{ width: percent(Math.max(item.share, .02)) }"></i></span>
          <b>{{ percent(item.share) }}</b>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.usage-backdrop{position:absolute;inset:0;z-index:40;display:flex;justify-content:center;align-items:flex-start;padding:62px 14px 14px;background:color-mix(in srgb,var(--surface) 55%,transparent);animation:usage-fade var(--dur-2) var(--ease-soft) both}
@keyframes usage-fade{from{opacity:0}}
.usage-card{width:min(100%,420px);max-height:100%;overflow:auto;padding:16px 18px 18px;border-radius:16px;background:color-mix(in srgb,var(--surface) 96%,transparent);background-image:var(--popup-sheen,none);-webkit-backdrop-filter:blur(var(--popup-blur,20px)) saturate(var(--glass-sat,1.4));backdrop-filter:blur(var(--popup-blur,20px)) saturate(var(--glass-sat,1.4));border:1px solid var(--glass-outline,var(--line-soft));box-shadow:0 22px 50px -20px rgb(0 0 0 / .4),var(--glass-edge,none);color:var(--surface-ink);font-size:13px;outline:none;animation:usage-pop var(--dur-3) var(--spring-snappy) both}
@keyframes usage-pop{from{opacity:0;translate:0 -8px;scale:.97}}
.usage-head{display:flex;align-items:center;gap:4px;margin-bottom:12px}
.usage-head h3{flex:1;margin:0;font-size:15px;font-weight:650}
.usage-icon{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:none;box-shadow:none;color:var(--surface-secondary)}
.usage-icon:hover{background:color-mix(in srgb,var(--surface-ink) 8%,transparent);color:var(--surface-ink)}
.usage-meter{margin-bottom:12px}
.usage-row{display:flex;align-items:baseline;gap:8px;padding:5px 0}
.usage-row>span:first-child{flex:none}
.usage-note{flex:1;text-align:right;color:var(--surface-muted);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.usage-row b{font-weight:600;font-variant-numeric:tabular-nums}
.usage-row b.hot{color:#b3261e}.usage-row b.warm{color:#9a6100}.usage-row b.calm{color:var(--surface-secondary)}
.usage-bar{height:8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 16%,transparent);overflow:hidden}
.usage-bar i{display:block;height:100%;border-radius:inherit;background:var(--accent);transition:width var(--dur-3) var(--spring-snappy)}
.usage-bar.warm{background:rgb(240 170 40 / .25)}.usage-bar.warm i{background:#f0a628}
.usage-bar.hot{background:rgb(214 64 64 / .2)}.usage-bar.hot i{background:#d24040}
.usage-bar.daily{background:rgb(240 170 40 / .22)}.usage-bar.daily i{background:#f0aa28}
.usage-tip{margin:6px 0 0;color:var(--surface-muted);font-size:11.5px;line-height:1.5}
.usage-tip code{padding:0 4px;border-radius:4px;background:color-mix(in srgb,var(--surface-ink) 8%,transparent)}
h4{margin:16px 0 4px;font-size:13.5px;font-weight:650}
.usage-muted{color:var(--surface-muted);font-weight:500}
.usage-grid{display:grid;grid-template-columns:repeat(3,1fr);margin:0}
.usage-grid div{display:flex;gap:6px;align-items:baseline;padding:6px 0;border-bottom:.5px solid var(--line-soft)}
.usage-grid dt{color:var(--surface-ink)}
.usage-grid dd{margin:0;color:var(--surface-muted);font-variant-numeric:tabular-nums}
.usage-breakdown{margin-top:14px}
.usage-breakdown .usage-row{border-bottom:.5px solid var(--line-soft);color:var(--surface-muted)}
.usage-breakdown .usage-row.head{color:var(--surface-ink);font-weight:600}
.usage-breakdown .usage-row b{margin-left:auto;font-weight:500}
.usage-empty{margin:14px 0 0;color:var(--surface-muted)}
.usage-kind{display:grid;grid-template-columns:1fr 120px 40px;align-items:center;gap:10px;padding:5px 0}
.usage-mini{height:6px;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,transparent);overflow:hidden}
.usage-mini i{display:block;height:100%;border-radius:inherit;background:var(--accent)}
.usage-kind b{text-align:right;font-weight:500;color:var(--surface-muted)}
@media(prefers-reduced-motion:reduce){.usage-backdrop,.usage-card{animation:none}}
</style>
