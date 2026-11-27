<script setup lang="ts">
// 学习对话的大纲：可以放在阅读区右边（助手栏左侧）或屏幕最左边，宽度能拖，样子跟着主题走。
// 每个节点都能直接动手：右键给它安排（讲快、讲细、删掉）；进了调整模式像手机主屏那样，按住上下拖换次序、点角上的减号删掉。
// 更大的改动写在底下的输入框里交给助手，或者一键让它重新设计。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { LearningState, PlanNode } from '../ai/learning'
import type { PlanEdit } from '../ai/workspace'
import { renderMarkdown } from '../ai/render'
import AppIcon from './AppIcon.vue'
import ContextMenu from './ContextMenu.vue'

const props = defineProps<{ learning: LearningState; busy?: boolean; pdf?: boolean; side: 'left' | 'right'; width: number; adjusting: boolean; /** 助手正在按读者说的改大纲。 */ revising?: boolean }>()
const emit = defineEmits<{ node: [node: PlanNode]; accept: []; move: []; resize: [width: number]; 'update:adjusting': [value: boolean]; edit: [edit: PlanEdit]; ask: [how: string] }>()

// 还没有大纲的两个阶段各有一句状态；有了大纲就让大纲自己说话。
const WAITING = { probe: '摸底中', plan: '正在排大纲' } as Record<string, string>
// 显示的次序：平时就是大纲里的次序，拖动途中先在这里换。
const order = ref<string[]>([])
watch(() => props.learning.plan?.nodes, nodes => { order.value = (nodes || []).map(node => node.id) }, { immediate: true })
const nodes = computed(() => order.value.map(id => props.learning.plan?.nodes.find(node => node.id === id)).filter(Boolean) as PlanNode[])
const status = (id: string) => props.learning.progress[id]?.passed ? 'passed' : props.learning.current === id ? 'current' : props.learning.progress[id] ? 'seen' : 'ahead'
const passed = computed(() => nodes.value.filter(node => status(node.id) === 'passed').length)
const currentTitle = computed(() => nodes.value.find(node => status(node.id) === 'current')?.title || '')
defineExpose({ passed, currentTitle })

// 右键菜单：给这一个节点安排。
const menu = ref<{ x: number; y: number; node: PlanNode } | null>(null)
const menuItems = computed(() => {
  const node = menu.value?.node
  if (!node) return []
  const pace = (value?: 'fast' | 'slow') => () => emit('edit', { type: 'pace', id: node.id, pace: value })
  return [
    { label: '讲快一点', icon: 'bolt', action: pace('fast'), disabled: node.pace === 'fast' },
    { label: '讲细一点', icon: 'deeper', action: pace('slow'), disabled: node.pace === 'slow' },
    ...(node.pace ? [{ label: '恢复正常', icon: 'reset', action: pace() }] : []),
    { label: '', separator: true, action: () => {} },
    { label: '删掉', icon: 'trash', danger: true, action: () => emit('edit', { type: 'remove', id: node.id }) },
  ]
})

// 调整模式里按住拖：越过相邻节点的中线就换位置，别的节点滑开让路；松手才把新次序记下来。
const list = ref<{ $el: HTMLElement } | null>(null)
const lifted = ref('')
let moved = false
function lift(node: PlanNode, event: PointerEvent) {
  if (!props.adjusting || event.button !== 0 || (event.target as Element).closest('.outline-remove')) return
  const startY = event.clientY, from = order.value.indexOf(node.id)
  moved = false
  // 听整个窗口的移动：指针一离开这一行、这一行在列表里一换位置，挂在它自己身上的监听就收不到了。
  const move = (next: PointerEvent) => {
    if (!lifted.value && Math.abs(next.clientY - startY) < 5) return
    lifted.value = node.id; moved = true
    const rows = [...(list.value?.$el.children || [])] as HTMLElement[], at = order.value.indexOf(node.id)
    const target = rows.findIndex((row, index) => { const box = row.getBoundingClientRect(); return index !== at && next.clientY > box.top && next.clientY < box.bottom && (index < at ? next.clientY < box.top + box.height / 2 : next.clientY > box.top + box.height / 2) })
    if (target < 0) return
    const copy = [...order.value]; copy.splice(at, 1); copy.splice(target, 0, node.id); order.value = copy
  }
  const drop = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', drop); window.removeEventListener('pointercancel', drop)
    const to = order.value.indexOf(node.id)
    if (lifted.value && to !== from) emit('edit', { type: 'move', id: node.id, to })
    lifted.value = ''
  }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', drop); window.addEventListener('pointercancel', drop)
}
function click(node: PlanNode) { if (moved) { moved = false; return } if (!props.adjusting) emit('node', node) }

const wish = ref('')
function ask(how: string) { const text = how.trim(); if (!text || props.busy) return; emit('ask', text); wish.value = '' }

// 拖内侧那条边改宽度：拖的时候只动这张卡片，松手才告诉外面（外面要跟着挪窗口）。
const dragging = ref(0)
function grab(event: PointerEvent) {
  const start = event.clientX, from = props.width, sign = props.side === 'left' ? 1 : -1, handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const move = (next: PointerEvent) => { dragging.value = Math.min(420, Math.max(200, from + sign * (next.clientX - start))) }
  const up = () => { handle.removeEventListener('pointermove', move); if (dragging.value) emit('resize', dragging.value); dragging.value = 0 }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up, { once: true }); handle.addEventListener('pointercancel', up, { once: true })
}
// 键盘：左右方向键一次改 16px。
function nudge(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0
  if (!step) return
  event.preventDefault()
  emit('resize', Math.min(420, Math.max(200, props.width + (props.side === 'left' ? step : -step))))
}
onBeforeUnmount(() => { menu.value = null })
</script>

<template>
  <aside class="outline" :class="[side, { adjusting, glow: adjusting || revising }]" :style="{ width: `${dragging || width}px` }" aria-label="学习大纲">
    <header>
      <h3>{{ learning.options.goal || '大纲' }}</h3>
      <span v-if="nodes.length" class="outline-count" :class="{ done: passed === nodes.length }" aria-label="学习进度"><b>{{ passed }}</b><i>/</i>{{ nodes.length }}</span>
      <button v-if="nodes.length" type="button" class="outline-icon" :class="{ on: adjusting }" :aria-pressed="adjusting" :aria-label="adjusting ? '完成调整' : '调整大纲'" :data-tip="adjusting ? '完成' : '调整：拖动换次序，右键安排'" @click="emit('update:adjusting', !adjusting)"><AppIcon :name="adjusting ? 'check' : 'edit'" :size="13" /></button>
      <button type="button" class="outline-icon" :aria-label="side === 'left' ? '移到阅读区右边' : '移到屏幕左边'" :data-tip="side === 'left' ? '移到阅读区右边' : '移到屏幕左边'" @click="emit('move')"><AppIcon name="panel" :size="13" /></button>
    </header>
    <div class="outline-bar" :class="{ idle: !nodes.length }" role="progressbar" :aria-valuenow="passed" aria-valuemin="0" :aria-valuemax="nodes.length || 1" aria-label="学习进度"><i :style="{ width: nodes.length ? `${passed / nodes.length * 100}%` : '0%' }" /></div>
    <p v-if="revising" class="outline-stage live"><span>正在改大纲…</span></p>
    <TransitionGroup v-if="nodes.length" ref="list" tag="ol" name="outline-slide" class="outline-nodes">
      <li v-for="node in nodes" :key="node.id" :class="[status(node.id), { lifted: lifted === node.id }]" @contextmenu.prevent="menu = { x: $event.clientX, y: $event.clientY, node }" @pointerdown="lift(node, $event)">
        <button v-if="adjusting" type="button" class="outline-remove" :aria-label="`删掉「${node.title}」`" @click.stop="emit('edit', { type: 'remove', id: node.id })"><i /></button>
        <button type="button" class="outline-node" :aria-current="status(node.id) === 'current' ? 'step' : undefined" @click="click(node)">
          <i aria-hidden="true" /><span v-html="renderMarkdown(node.title)" /><em v-if="node.pace" :data-tip="node.pace === 'fast' ? '讲快一点' : '讲细一点'">{{ node.pace === 'fast' ? '快' : '细' }}</em><small v-if="node.page">{{ node.page }}</small>
        </button>
      </li>
    </TransitionGroup>
    <!-- 还没有大纲：一条淡淡的路线先摆在那里，一句状态带流光。 -->
    <div v-else class="outline-wait" role="status">
      <p class="outline-stage live"><span>{{ WAITING[learning.phase] || '' }}</span></p>
      <ol aria-hidden="true"><li v-for="n in 5" :key="n" :style="{ '--w': `${[62, 84, 48, 72, 56][n - 1]}%`, '--n': n }"><i /><b /></li></ol>
    </div>
    <footer v-if="nodes.length">
      <button v-if="learning.phase === 'plan' && !adjusting" type="button" class="outline-accept" :disabled="busy" @click="emit('accept')">就这样开始<AppIcon class="outline-go" name="arrow" :size="11" /></button>
      <form @submit.prevent="ask(wish)"><input v-model="wish" type="text" maxlength="300" placeholder="想怎么改" aria-label="想怎么改大纲" :disabled="busy" /><button v-if="wish.trim()" type="submit" class="outline-icon" aria-label="发给助手" :disabled="busy"><AppIcon name="send" :size="13" /></button><button v-else type="button" class="outline-icon outline-redo" aria-label="重新设计整份大纲" data-tip="重新设计整份大纲" :disabled="busy" @click="ask('重新设计整份大纲')"><AppIcon name="retry" :size="13" /></button></form>
    </footer>
    <div class="outline-grip" role="separator" tabindex="0" aria-orientation="vertical" aria-label="拖动调整大纲宽度" aria-valuemin="200" aria-valuemax="420" :aria-valuenow="dragging || width" @pointerdown.prevent="grab" @keydown="nudge" />
    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @close="menu = null" />
  </aside>
</template>

<style scoped>
/* 一条安静的路线：细线、小点、淡字。字体和颜色用主题的；放在屏幕左边时是一座岛，放在助手栏里时只是它的一栏。 */
.outline{--rail:color-mix(in srgb,var(--ink) 16%,transparent);position:relative;display:flex;flex-direction:column;flex:none;min-height:0;padding:16px 12px 12px 18px;color:var(--ink);font-size:13.5px;box-sizing:border-box}
.outline.left{border:1px solid var(--glass-outline);border-radius:var(--r-xl);background-color:var(--glass-2);box-shadow:var(--shadow-pane),var(--glass-edge)}
.outline.right{border-right:1px solid var(--rail)}
header{display:flex;align-items:baseline;gap:2px;flex:none;min-height:28px}
h3{margin:0 auto 0 0;min-width:0;overflow:hidden;color:var(--muted);font-size:11.5px;font-weight:500;letter-spacing:.18em;text-overflow:ellipsis;white-space:nowrap}
.outline-count{flex:none;margin-right:6px;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.outline-count b{color:var(--ink);font-size:21px;font-weight:300;line-height:1}
.outline-count i{margin:0 3px;font-style:normal;opacity:.5}
.outline-count.done b{color:var(--accent)}
.outline-icon{display:grid;place-items:center;flex:none;align-self:center;width:24px;height:24px;min-width:0;padding:0;border:0;border-radius:var(--r-sm,8px);background:none;box-shadow:none;color:var(--muted);opacity:.5;transition:opacity var(--dur-1,.12s),color var(--dur-1,.12s),background-color var(--dur-1,.12s)}
.outline:hover .outline-icon,.outline-icon:focus-visible,.outline-icon.on{opacity:1}
.outline-icon:hover:not(:disabled){background:var(--frost-hover,color-mix(in srgb,var(--ink) 8%,transparent));color:var(--ink)}
.outline-icon.on{color:var(--accent)}
.outline-icon:disabled{opacity:.3}
/* 进度：一根发丝线，走过的一段换成强调色。 */
.outline-bar{position:relative;flex:none;height:1px;margin:10px 6px 0 0;background:var(--rail)}
.outline-bar i{position:absolute;left:0;top:-.5px;height:2px;border-radius:1px;background:var(--accent);transition:width var(--dur-3,.4s) var(--ease-out)}
.outline-stage{flex:none;margin:14px 0 2px;color:var(--muted);font-size:12px;letter-spacing:.04em}
.outline-stage.live span{--base:color-mix(in srgb,var(--muted) 70%,transparent);background:linear-gradient(90deg,var(--base) 0 38%,var(--ink) 47% 53%,var(--base) 62% 100%);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:outline-shimmer 2s linear infinite}
@keyframes outline-shimmer{from{background-position:100% 0}to{background-position:0 0}}
/* 路线：一条细竖线串起小点。走过的实心，正在讲的是一枚强调色细环，没到的是淡淡的空心点。 */
.outline-nodes{flex:1;min-height:0;margin:10px 0 0;padding:2px 4px 2px 0;list-style:none;overflow:auto;scrollbar-width:thin}
.outline-nodes li{position:relative}
.outline-nodes li:not(:last-child)::before{content:'';position:absolute;left:3px;top:19px;bottom:-9px;width:1px;background:var(--rail)}
.outline-nodes li.passed:not(:last-child)::before{background:color-mix(in srgb,var(--accent) 55%,transparent)}
.outline-node{position:relative;display:flex;align-items:flex-start;gap:12px;width:100%;height:auto;min-height:0;padding:6px 6px 6px 0;border:0;border-radius:var(--r-sm,8px);background:none;box-shadow:none;color:var(--muted);font:inherit;line-height:1.45;text-align:left;transition:color var(--dur-1,.12s)}
.outline-node:hover{color:var(--ink)}
.outline-node span{flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere}
.outline-node span :deep(p){margin:0}
.outline-node small{flex:none;margin-top:2px;color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums;opacity:.75}
.outline-node em{flex:none;margin-top:1px;color:var(--accent);font-size:10.5px;font-style:normal;letter-spacing:.05em}
.outline-node>i{position:relative;z-index:1;flex:none;width:7px;height:7px;margin-top:6px;border:1px solid color-mix(in srgb,var(--ink) 34%,transparent);border-radius:50%;background:var(--surface,#fff);box-sizing:border-box;transition:border-color var(--dur-2,.2s),background-color var(--dur-2,.2s),scale var(--dur-2,.2s) var(--spring-snappy,ease-out)}
li.seen .outline-node>i{border-color:var(--accent)}
li.passed .outline-node{color:var(--secondary)}
li.passed .outline-node>i{border-color:var(--accent);background:var(--accent)}
li.current .outline-node{color:var(--ink);font-weight:600}
li.current .outline-node>i{scale:1.3;border-color:var(--accent);border-width:1.5px}
li.current .outline-node>i::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:1px solid var(--accent);opacity:0;animation:outline-ping 2.2s var(--ease-out,ease-out) 3}
@keyframes outline-ping{0%{opacity:.6;scale:.5}100%{opacity:0;scale:1.25}}
/* 还没有大纲：路线先淡淡地摆着，一格一格亮过去。 */
.outline-wait{flex:1;min-height:0;overflow:hidden}
.outline-wait ol{margin:12px 0 0;padding:0;list-style:none}
.outline-wait li{position:relative;display:flex;align-items:center;gap:12px;height:34px}
.outline-wait li:not(:last-child)::before{content:'';position:absolute;left:3px;top:21px;height:26px;width:1px;background:var(--rail)}
.outline-wait li i{flex:none;width:7px;height:7px;border:1px solid color-mix(in srgb,var(--ink) 26%,transparent);border-radius:50%;box-sizing:border-box}
.outline-wait li b{width:var(--w);height:7px;border-radius:4px;background:color-mix(in srgb,var(--ink) 9%,transparent);animation:outline-breathe 2.4s ease-in-out infinite;animation-delay:calc(var(--n) * .22s)}
@keyframes outline-breathe{0%,100%{opacity:.45}50%{opacity:1}}
/* 调整模式：节点轻轻晃，角上一枚减号；按住的那一个浮起来，别的滑开让路。 */
.outline-slide-move{transition:transform var(--dur-2,.2s) var(--spring-snappy,ease-out)}
.outline.adjusting li::before{display:none}
.outline.adjusting li{cursor:grab;touch-action:none;animation:outline-wiggle .28s ease-in-out infinite alternate}
.outline.adjusting li:nth-child(even){animation-delay:-.14s;animation-direction:alternate-reverse}
.outline.adjusting .outline-node{padding-left:24px;pointer-events:none;color:var(--ink)}
.outline.adjusting .outline-node>i{display:none}
.outline.adjusting li.lifted{z-index:2;cursor:grabbing;animation:none;scale:1.03}
.outline.adjusting li.lifted .outline-node{background:var(--surface,#fff);box-shadow:var(--shadow-pane,0 6px 18px rgb(0 0 0 / .18))}
@keyframes outline-wiggle{from{rotate:-.5deg}to{rotate:.5deg}}
.outline-remove{position:absolute;left:0;top:8px;z-index:3;display:grid;place-items:center;width:16px;height:16px;min-width:0;padding:0;border:1px solid color-mix(in srgb,var(--ink) 40%,transparent);border-radius:50%;background:var(--surface,#fff);box-shadow:none}
.outline-remove i{width:7px;height:1px;background:var(--ink)}
.outline-remove:hover{border-color:var(--danger,#c0392b)}
.outline-remove:hover i{background:var(--danger,#c0392b)}
/* 底部：一行发丝线上的输入，和一颗「就这样开始」。 */
footer{display:flex;flex-direction:column;flex:none;gap:10px;margin:10px 6px 0 0}
.outline-accept{display:flex;align-items:center;justify-content:space-between;width:100%;height:34px;padding:0 12px;border:1px solid var(--ink);border-radius:var(--r-control,10px);background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;font-weight:600;letter-spacing:.06em;transition:background-color var(--dur-2,.18s),color var(--dur-2,.18s)}
.outline-accept:hover:not(:disabled){background:var(--ink);color:var(--surface,#fff)}
.outline-accept:disabled{opacity:.4}
.outline-go{rotate:180deg}
form{display:flex;align-items:center;gap:2px;border-bottom:1px solid var(--rail);transition:border-color var(--dur-2,.18s)}
form:focus-within{border-color:var(--accent)}
input{flex:1;min-width:0;height:30px;padding:0;border:0;border-radius:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:12.5px;outline:0}
input::placeholder{color:var(--muted);opacity:.8}
.outline-grip{position:absolute;top:0;bottom:0;right:0;width:7px;cursor:col-resize;touch-action:none}
.outline-grip:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
/* 在助手栏里时这条边和助手栏自己的宽度抓手（.panel-resizer，左右各伸 10px、叠在上面）重合：往里让开它，叠在它上面一层，两条都抓得到。 */
.outline.right .outline-grip{right:auto;left:10px;z-index:8;width:9px}
/* 大纲在改（读者在调，或助手在重写）：边上一圈流光。不认 @property 的内核里这个变量没有初值、只能跳变：给个 0deg 兜底，流光停住不转，而不是一闪一灭。 */
@property --outline-spin{syntax:'<angle>';inherits:false;initial-value:0deg}
.outline.glow::after{content:'';position:absolute;inset:0;z-index:4;padding:1.5px;border-radius:inherit;background:conic-gradient(from var(--outline-spin,0deg),transparent 0 55%,color-mix(in srgb,var(--accent) 45%,transparent) 72%,var(--accent) 86%,transparent 100%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);pointer-events:none;animation:outline-spin 2.6s linear infinite}
@keyframes outline-spin{to{--outline-spin:360deg}}
@media (prefers-reduced-motion:reduce){.outline.adjusting li,.outline.glow::after,.outline-wait li b,.outline-stage.live span,li.current .outline-node>i::after{animation:none}.outline-stage.live span{color:var(--muted);background:none}.outline.glow::after{background:var(--accent)}}
</style>
