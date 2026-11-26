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

const STAGE = { setup: '', probe: '摸底中', plan: '等你确认', teach: '带读中', done: '学完了' }
// 显示的次序：平时就是大纲里的次序，拖动途中先在这里换。
const order = ref<string[]>([])
watch(() => props.learning.plan?.nodes, nodes => { order.value = (nodes || []).map(node => node.id) }, { immediate: true })
const nodes = computed(() => order.value.map(id => props.learning.plan?.nodes.find(node => node.id === id)).filter(Boolean) as PlanNode[])
const status = (id: string) => props.learning.progress[id]?.passed ? 'passed' : props.learning.current === id ? 'current' : props.learning.progress[id] ? 'seen' : 'ahead'
const passed = computed(() => nodes.value.filter(node => status(node.id) === 'passed').length)

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
onBeforeUnmount(() => { menu.value = null })
</script>

<template>
  <aside class="outline" :class="[side, { adjusting, glow: adjusting || revising }]" :style="{ width: `${dragging || width}px` }" aria-label="学习大纲">
    <header>
      <h3>大纲</h3>
      <span v-if="nodes.length" class="outline-count">{{ passed }} / {{ nodes.length }}</span>
      <button v-if="nodes.length" type="button" class="text-action" :aria-pressed="adjusting" @click="emit('update:adjusting', !adjusting)">{{ adjusting ? '完成' : '调整' }}</button>
      <button type="button" class="outline-icon" :aria-label="side === 'left' ? '移到阅读区右边' : '移到屏幕左边'" :data-tip="side === 'left' ? '移到阅读区右边' : '移到屏幕左边'" @click="emit('move')"><AppIcon name="panel" :size="14" /></button>
    </header>
    <div v-if="nodes.length" class="outline-bar" role="progressbar" :aria-valuenow="passed" aria-valuemin="0" :aria-valuemax="nodes.length" aria-label="学习进度"><i :style="{ width: `${passed / nodes.length * 100}%` }" /></div>
    <p class="outline-stage">{{ revising ? '正在改大纲…' : adjusting ? '拖动换次序，右键安排' : STAGE[learning.phase] }}</p>
    <TransitionGroup v-if="nodes.length" ref="list" tag="ol" name="outline-slide" class="outline-nodes">
      <li v-for="node in nodes" :key="node.id" :class="[status(node.id), { lifted: lifted === node.id }]" @contextmenu.prevent="menu = { x: $event.clientX, y: $event.clientY, node }" @pointerdown="lift(node, $event)">
        <button v-if="adjusting" type="button" class="outline-remove" :aria-label="`删掉「${node.title}」`" @click.stop="emit('edit', { type: 'remove', id: node.id })"><i /></button>
        <button type="button" class="outline-node" :aria-current="status(node.id) === 'current' ? 'step' : undefined" @click="click(node)">
          <i aria-hidden="true" /><span v-html="renderMarkdown(node.title)" /><em v-if="node.pace">{{ node.pace === 'fast' ? '快' : '细' }}</em><small v-if="node.page">{{ node.page }}</small>
        </button>
      </li>
    </TransitionGroup>
    <p v-else class="outline-empty">摸底后出大纲</p>
    <footer v-if="nodes.length">
      <button v-if="learning.phase === 'plan' && !adjusting" type="button" class="frost-button primary outline-accept" :disabled="busy" @click="emit('accept')">就这样开始</button>
      <form @submit.prevent="ask(wish)"><input v-model="wish" type="text" maxlength="300" placeholder="想怎么改大纲" aria-label="想怎么改大纲" :disabled="busy" /><button type="submit" class="outline-icon" aria-label="发给助手" :disabled="busy || !wish.trim()"><AppIcon name="send" :size="14" /></button></form>
      <button type="button" class="text-action outline-redo" :disabled="busy" @click="ask('重新设计整份大纲')"><AppIcon name="retry" :size="12" />重新设计</button>
    </footer>
    <div class="outline-grip" role="separator" aria-orientation="vertical" aria-label="拖动调整大纲宽度" @pointerdown.prevent="grab" />
    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @close="menu = null" />
  </aside>
</template>

<style scoped>
/* 字体、颜色、圆角都用主题的：放在屏幕左边时是一座和左栏、助手栏一样的岛；放在助手栏里时只是它的一栏，不再套一层底。 */
.outline{position:relative;display:flex;flex-direction:column;flex:none;min-height:0;padding:14px 10px 12px 14px;color:var(--ink);font-size:13.5px;box-sizing:border-box}
.outline.left{border:1px solid var(--glass-outline);border-radius:var(--r-xl);background-color:var(--glass-2);box-shadow:var(--shadow-pane),var(--glass-edge)}
.outline.right{border-right:1px solid var(--separator);border-radius:var(--r-lg)}
header{display:flex;align-items:center;gap:8px;flex:none;padding-right:4px}
h3{margin:0 auto 0 0;font-size:15px}
h3:has(+.outline-count){margin-right:0}
.outline-count{margin-right:auto;color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
.outline-icon{display:grid;place-items:center;flex:none;width:26px;height:26px;padding:0;border:0;border-radius:var(--r-sm,8px);background:none;box-shadow:none;color:var(--muted)}
.outline-icon:hover:not(:disabled){background:var(--frost-hover,color-mix(in srgb,var(--ink) 8%,transparent));color:var(--ink)}
.outline-icon:disabled{opacity:.4}
.outline-bar{flex:none;height:4px;margin:12px 4px 0 0;border-radius:2px;background:var(--fill-2,color-mix(in srgb,var(--ink) 10%,transparent));overflow:hidden}
.outline-bar i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,var(--accent-muted,var(--accent)),var(--accent));transition:width var(--dur-3,.3s) var(--ease-out)}
.outline-stage{flex:none;margin:8px 0 6px;color:var(--muted);font-size:12px}
.outline-empty{margin:4px 0 0;color:var(--muted);font-size:12.5px}
/* 时间线：一条细竖线串起每个节点的小圆点。 */
.outline-nodes{flex:1;min-height:0;margin:0;padding:2px 4px 2px 0;list-style:none;overflow:auto}
.outline-nodes li{position:relative}
.outline-nodes li:not(:last-child)::before{content:'';position:absolute;left:12.5px;top:24px;bottom:-8px;width:1px;background:var(--separator)}
.outline-nodes li.passed:not(:last-child)::before{background:color-mix(in srgb,var(--accent) 60%,transparent)}
.outline-node{position:relative;display:flex;align-items:flex-start;gap:10px;width:100%;height:auto;padding:7px 8px 7px 7px;border:0;border-radius:var(--r-sm,9px);background:none;box-shadow:none;color:var(--secondary);font:inherit;line-height:1.45;text-align:left}
.outline-node:hover{background:var(--frost-hover,color-mix(in srgb,var(--ink) 6%,transparent))}
.outline-node span{flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere}
.outline-node span :deep(p){margin:0}
.outline-node small{flex:none;margin-top:1px;color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums}
.outline-node em{flex:none;padding:0 5px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:5px;color:var(--accent);font-size:11px;font-style:normal;line-height:1.5}
.outline-node>i{position:relative;z-index:1;flex:none;width:11px;height:11px;margin-top:4px;border:1.5px solid color-mix(in srgb,var(--ink) 34%,transparent);border-radius:50%;background:var(--surface,#fff);box-sizing:border-box}
li.seen .outline-node>i{border-color:var(--accent)}
li.passed .outline-node{color:var(--ink)}
li.passed .outline-node>i{border-color:var(--accent);background:var(--accent)}
li.current .outline-node{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--ink);font-weight:650}
li.current .outline-node>i{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 24%,transparent)}
/* 调整模式：节点轻轻晃，角上一枚减号；按住的那一个浮起来，别的滑开让路。 */
.outline-slide-move{transition:transform var(--dur-2,.2s) var(--spring-snappy,ease-out)}
.outline.adjusting li::before{display:none}
.outline.adjusting li{cursor:grab;touch-action:none;animation:outline-wiggle .28s ease-in-out infinite alternate}
.outline.adjusting li:nth-child(even){animation-delay:-.14s;animation-direction:alternate-reverse}
.outline.adjusting .outline-node{padding-left:22px;pointer-events:none}
.outline.adjusting li.lifted{z-index:2;cursor:grabbing;animation:none;scale:1.03}
.outline.adjusting li.lifted .outline-node{background:var(--surface,#fff);box-shadow:var(--shadow-pane,0 6px 18px rgb(0 0 0 / .18))}
@keyframes outline-wiggle{from{rotate:-.5deg}to{rotate:.5deg}}
.outline-remove{position:absolute;left:0;top:7px;z-index:3;display:grid;place-items:center;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:color-mix(in srgb,var(--ink) 58%,transparent);box-shadow:none}
.outline-remove i{width:8px;height:1.5px;border-radius:1px;background:var(--surface,#fff)}
.outline-remove:hover{background:var(--danger,#c0392b)}
.frost-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--hairline);border-radius:var(--r-control);background:var(--frost);box-shadow:inset 0 1px 0 var(--glass-rim-soft);font-size:12px;font-weight:600;color:var(--ink)}
.frost-button:hover:not(:disabled){background:var(--frost-hover)}
.frost-button.primary{background:color-mix(in srgb,var(--accent) 82%,transparent);border-color:transparent;color:var(--accent-on,#fff)}
.frost-button.primary:hover:not(:disabled){background:var(--accent)}
.frost-button.danger{border-color:transparent;background:var(--danger,#c0392b);color:#fff}
.frost-button:disabled{opacity:.45}
.text-action{height:26px;padding:0 9px;border:0;border-radius:var(--r-control);background:none;box-shadow:none;color:var(--accent);font-size:12px;font-weight:600}
.text-action:hover:not(:disabled){background-color:color-mix(in srgb,var(--accent) 10%,transparent)}
.text-action:disabled{opacity:.45}
footer{display:flex;flex-direction:column;flex:none;gap:8px;margin:10px 4px 0 0;padding-top:10px;border-top:1px solid var(--separator)}
.outline-accept{width:100%}
form{display:flex;align-items:center;gap:4px;padding:0 4px 0 10px;border:1px solid var(--separator);border-radius:var(--r-sm,9px)}
form:focus-within{border-color:var(--accent)}
input{flex:1;min-width:0;height:30px;padding:0;border:0;background:none;box-shadow:none;color:var(--ink);font:inherit;font-size:13px;outline:0}
input::placeholder{color:var(--muted)}
.outline-redo{display:inline-flex;align-items:center;align-self:flex-start;gap:5px}
.outline-grip{position:absolute;top:0;bottom:0;right:0;width:7px;cursor:col-resize;touch-action:none}
.outline.right .outline-grip{right:auto;left:0}
/* 大纲在改（读者在调，或助手在重写）：边上一圈流光。不认 @property 的内核里这个变量没有初值、只能跳变：给个 0deg 兜底，流光停住不转，而不是一闪一灭。 */
@property --outline-spin{syntax:'<angle>';inherits:false;initial-value:0deg}
.outline.glow::after{content:'';position:absolute;inset:0;z-index:4;padding:1.5px;border-radius:inherit;background:conic-gradient(from var(--outline-spin,0deg),transparent 0 55%,color-mix(in srgb,var(--accent) 45%,transparent) 72%,var(--accent) 86%,transparent 100%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);pointer-events:none;animation:outline-spin 2.6s linear infinite}
@keyframes outline-spin{to{--outline-spin:360deg}}
@media (prefers-reduced-motion:reduce){.outline.adjusting li,.outline.glow::after{animation:none}.outline.glow::after{background:var(--accent)}}
</style>
