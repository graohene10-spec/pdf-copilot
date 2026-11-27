<script setup lang="ts">
/* 大纲与进度一课的示意：大纲栏、节点和卡片的右键菜单、学习进度页，以及助手栏标题栏里的小进度。只按状态画，不接真实数据。 */
import { computed, getCurrentInstance, onMounted, shallowRef, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import type { Scene } from './lessons'
import { ADDED, BOARD, CURRENT, NODES, PASSED, type PlanScene } from './lesson-outline'

const props = defineProps<{ plan: PlanScene; view: Scene['view'] }>()
const BY_ID = Object.fromEntries([...NODES, ADDED].map(node => [node.id, node]))
const WAY = BOARD[0]!.cards[0]!.way
const nodes = computed(() => [...props.plan.order, ...(props.plan.added ? [ADDED.id] : [])].map(id => BY_ID[id]!))
const live = computed(() => nodes.value.filter(node => !props.plan.gone.includes(node.id)))
const total = computed(() => live.value.length)
const status = (id: string) => PASSED.includes(id) ? 'passed' : id === CURRENT ? 'current' : ''
const offset = (id: string) => props.plan.held === id ? props.plan.drag : props.plan.shift[id] || 0
// 晃动的节拍跟着节点走、不跟位置：换了次序也不会顿一下。
const beat = (id: string) => NODES.findIndex(node => node.id === id) % 2 === 1 ? '-.28s' : '0s'
// 助手栏标题栏里的小进度：画进那张示意界面的标题栏（排在分支和新对话两颗图标之间），跟着大纲的次序和进度走。
const marks = computed(() => live.value.map(node => status(node.id) || 'ahead'))
const self = getCurrentInstance()
const hbtns = shallowRef<Element | null>(null)
function find() {
  const world = (self?.vnode.el as Node | null)?.parentElement
  const found = world?.querySelector(':scope > .tw-ai .tw-main > header .tw-hbtns') ?? null
  if (found !== hbtns.value && (found || !hbtns.value?.isConnected)) hbtns.value = found
}
onMounted(find)
watch(() => props.view, find, { flush: 'post' })
</script>

<template>
  <Teleport v-if="hbtns" :to="hbtns"><span class="to-meter"><span class="to-ticks"><i v-for="(mark, at) in marks" :key="at" :class="mark"></i></span><small>{{ PASSED.length }}/{{ total }}</small></span></Teleport>
  <Transition name="to-col">
    <aside v-if="view === 'reader'" class="to-plan to-col" :class="[plan.side, { still: plan.still, adjusting: plan.adjusting, glow: plan.adjusting || plan.revising }]">
      <header><h3>{{ WAY }}</h3><span class="to-count"><b>{{ PASSED.length }}</b><i>/</i>{{ total }}</span><span class="to-adjust to-icon" :class="{ on: plan.adjusting }"><AppIcon :name="plan.adjusting ? 'check' : 'edit'" :size="13" /></span><span class="to-move to-icon"><AppIcon name="panel" :size="13" /></span></header>
      <p class="to-bar"><i :style="{ width: `${PASSED.length / total * 100}%` }"></i></p>
      <div class="to-fold" :class="{ shut: !plan.revising }"><div><p class="to-stage"><span>正在改大纲…</span></p></div></div>
      <ol class="to-nodes" :class="{ still: plan.still }">
        <li v-for="node in nodes" :key="node.id" :class="[`to-node-${node.id}`, status(node.id), { held: plan.held === node.id, gone: plan.gone.includes(node.id), fresh: node === ADDED }]" :style="{ translate: `0 ${offset(node.id)}px`, animationDelay: beat(node.id) }">
          <b class="to-minus"><i></i></b>
          <span class="to-node" :class="{ lifted: plan.held === node.id && plan.lifted }"><i></i><span>{{ node.title }}</span><em v-if="plan.pace[node.id]">{{ plan.pace[node.id] === 'fast' ? '快' : '细' }}</em><small>{{ node.page }}</small></span>
        </li>
      </ol>
      <footer class="to-foot">
        <p class="to-wish" :class="{ typed: plan.wish, dim: plan.revising }"><span>{{ plan.wish || '想怎么改' }}<i v-if="plan.wish" class="to-caret"></i></span><b class="to-send to-icon"><AppIcon :name="plan.wish ? 'send' : 'retry'" :size="13" /></b></p>
      </footer>
    </aside>
  </Transition>
  <Transition name="to-pop"><div v-if="plan.menu" class="to-menu" :style="{ left: `${plan.menu.x + 4}px`, top: `${plan.menu.y + 4}px` }">
    <span class="to-pace-fast" :class="{ hot: plan.hot === 'fast' }"><AppIcon name="bolt" :size="13" />讲快一点</span><span class="to-pace-slow" :class="{ hot: plan.hot === 'slow' }"><AppIcon name="deeper" :size="13" />讲细一点</span><span class="line danger"><AppIcon name="trash" :size="13" />删掉</span>
  </div></Transition>

  <Transition name="to-view"><section v-if="plan.board && view === 'board'" class="to-board">
    <header><h2>学习进度<small>3</small></h2><span class="to-search"><AppIcon name="search" :size="14" />搜索标题、标签或打开过的正文</span></header>
    <div v-for="book in BOARD" :key="book.book" class="to-book">
      <h3><AppIcon name="book" :size="15" /><span>{{ book.book }}</span><small>{{ book.cards.length }}</small></h3>
      <div class="to-cards">
        <article v-for="card in book.cards" :key="card.id" class="to-card" :class="[`to-card-${card.id}`, { done: card.total && card.passed === card.total }]">
          <p v-if="card.id === 'a' && plan.renaming !== null" class="to-rename"><span :class="{ all: plan.renaming === card.title }">{{ plan.renaming }}</span><i class="to-caret"></i></p>
          <h4 v-else>{{ card.id === 'a' && plan.name ? plan.name : card.title }}</h4>
          <p class="to-meta"><span class="to-way">{{ card.way }}</span><span>{{ card.phase }}</span><span>{{ card.day }}</span></p>
          <p class="to-steps" :class="{ none: !card.total }"><i v-for="step in card.total || 1" :key="step" :class="{ on: step <= card.passed }"></i></p>
          <p class="to-now"><b>{{ card.total ? `${card.passed} / ${card.total}` : '—' }}</b><span v-if="card.now">{{ card.now }}</span></p>
          <footer><span class="to-go">{{ card.go }}</span></footer>
        </article>
      </div>
    </div>
  </section></Transition>
  <Transition name="to-pop"><div v-if="plan.cardMenu" class="to-menu" :style="{ left: `${plan.cardMenu.x + 4}px`, top: `${plan.cardMenu.y + 4}px` }">
    <span><AppIcon name="play" :size="13" />接着学</span><span class="to-cm-rename" :class="{ hot: plan.cardHot === 'rename' }"><AppIcon name="edit" :size="13" />改名</span><span class="line danger"><AppIcon name="trash" :size="13" />删除</span>
  </div></Transition>
</template>

<style scoped>
/* 大纲栏：一条安静的路线（细线、小点、淡字），样子照着真的大纲栏。在助手栏里是它左边的一栏，只有右侧一条细分隔线；挪到屏幕最左就是一座和侧栏一样的岛。两处之间平移过去。 */
.to-col{--to-wobble:0deg;--to-rail:color-mix(in srgb,var(--ink) 16%,transparent);position:absolute;left:729px;top:73px;bottom:15px;z-index:5;display:flex;flex-direction:column;width:236px;padding:16px 12px 12px 18px;border:1px solid transparent;border-right-color:var(--to-rail);border-radius:calc(var(--tw-radius) - 1px) 0 0 calc(var(--tw-radius) - 1px);color:var(--ink);font-size:13.5px;text-align:left;transition:left .55s var(--ease-soft),top .55s var(--ease-soft),bottom .55s var(--ease-soft),padding-left .55s var(--ease-soft),border-color .2s .4s,border-radius .2s .4s,background-color .2s .4s,--to-wobble .3s var(--ease-soft)}
/* 飞过书页时得是一块实底：去左边时底色立刻出来，回到助手栏落定了才褪掉。 */
.to-col.left{left:224px;top:72px;bottom:14px;border-color:var(--glass-outline);border-radius:var(--tw-radius);background-color:var(--surface);transition:left .55s var(--ease-soft),top .55s var(--ease-soft),bottom .55s var(--ease-soft),padding-left .55s var(--ease-soft),border-color .15s,border-radius .15s,background-color .15s,--to-wobble .3s var(--ease-soft)}
.to-col.still{transition:none}
.tw-world[data-look='sketch'] .to-col.left{border-width:1.5px;border-radius:18px 14px 20px 16px / 14px 20px 16px 18px}
/* 铅笔草稿里排在助手栏最左时，和真的一样整栏从红色页边线右边开始（33px），标题再让开回形针（19px），节点文字和标题左缘对齐。 */
.tw-world[data-look='sketch'] .to-col:not(.left){padding-left:33px}
.tw-world[data-look='sketch'] .to-col:not(.left)>header{padding-left:19px}
/* 进出都和助手栏一起：从右边滑进来、退到右边。 */
.to-col-enter-active,.to-col-leave-active{transition:translate .4s var(--ease-out),opacity .3s}
.to-col-enter-from,.to-col-leave-to{translate:60px 0;opacity:0}
/* 表头：左边学法名，右边大号细体的进度数字，再是两颗淡色小图标（调整、换位置）。 */
.to-col header{display:flex;align-items:baseline;gap:2px;flex:none;min-height:28px;transition:padding-left .55s var(--ease-soft)}
/* 一枚看不见的大号数字撑住基线（真的大纲在没有进度数字时也靠它），标题停在同一高度。 */
.to-col header::before{content:'\200b';width:0;margin-right:-2px;overflow:hidden;font-size:21px;font-weight:300;line-height:1}
.to-col.still header{transition:none}
.to-col h3{margin:0 auto 0 0;min-width:0;overflow:hidden;color:var(--muted);font-size:11.5px;font-weight:500;letter-spacing:.18em;text-overflow:ellipsis;white-space:nowrap}
.to-count{flex:none;margin-right:6px;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.to-count b{color:var(--ink);font-size:21px;font-weight:300;line-height:1}
.to-count i{margin:0 3px;font-style:normal;opacity:.5}
.to-icon{display:grid;place-items:center;flex:none;align-self:center;width:24px;height:24px;border-radius:8px;color:var(--muted);opacity:.55;transition:opacity .2s,color .2s}
.to-icon.on{color:var(--accent);opacity:1}
/* 进度：一根发丝线，走过的一段是 2px 的强调色。 */
.to-bar{position:relative;flex:none;height:1px;margin:10px 6px 0 0;background:var(--to-rail)}
.to-bar i{position:absolute;left:0;top:-.5px;height:2px;border-radius:1px;background:var(--accent);transition:width .4s var(--ease-out)}
/* 助手在改大纲时才有的一句，带流光；收起、展开时高度跟着走，下面的节点不跳。 */
.to-fold{display:grid;grid-template-rows:1fr;flex:none;transition:grid-template-rows .32s var(--ease-out),opacity .26s var(--ease-soft)}
.to-fold.shut{grid-template-rows:0fr;opacity:0}
.to-fold>div{min-height:0;overflow:hidden}
.to-stage{margin:14px 0 2px;color:var(--muted);font-size:12px;letter-spacing:.04em}
.to-stage span{--base:color-mix(in srgb,var(--muted) 70%,transparent);background:linear-gradient(90deg,var(--base) 0 38%,var(--ink) 47% 53%,var(--base) 62% 100%);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:to-shimmer 2s linear infinite}
@keyframes to-shimmer{from{background-position:100% 0}to{background-position:0 0}}
/* 路线：一条细竖线串起 7px 的小点。走过的实心，正在讲的是一枚强调色细环，没到的是淡淡的空心点；调整时竖线收起。 */
.to-nodes{flex:1;min-height:0;margin:10px 0 0;padding:2px 4px 2px 0;list-style:none}
.to-nodes li{position:relative;height:calc(12px + 1lh);line-height:1.45;transition:translate .28s var(--ease-spring),height .3s var(--ease-out),opacity .22s}
/* 竖线从这一颗点的下沿接到下一颗点的上沿：和真的一样，点的中心在 6px 内边距 + 半个行高处。 */
.to-nodes li:not(:last-child)::before{content:'';position:absolute;left:3px;top:calc(6px + .5lh + 3.5px);bottom:calc(-2.5px - .5lh);width:1px;background:var(--to-rail);transition:opacity .25s}
.to-nodes li.passed:not(:last-child)::before{background:color-mix(in srgb,var(--accent) 55%,transparent)}
.to-col.adjusting li::before{opacity:0}
.to-nodes li.held{z-index:2;transition:height .3s var(--ease-out),opacity .22s}
.to-nodes.still li{transition:none}
.to-nodes li.gone{height:0;opacity:0;overflow:hidden}
.to-nodes li.fresh{animation:to-grow .45s var(--ease-out) both}
@keyframes to-grow{from{height:0;opacity:0}}
.to-node{position:relative;display:flex;align-items:flex-start;gap:12px;padding:6px 6px 6px 0;line-height:1.45;border-radius:8px;color:var(--muted);transition:padding-left .25s var(--ease-out),color .2s,background-color .2s,box-shadow .2s,scale .2s}
.to-node>i{position:relative;z-index:1;flex:none;width:7px;height:7px;border:1px solid color-mix(in srgb,var(--ink) 34%,transparent);border-radius:50%;background:var(--surface);box-sizing:border-box;margin-top:calc(.5lh - 3.5px);transition:border-color .2s,background-color .2s,opacity .2s,width .25s var(--ease-out),margin .25s var(--ease-out),scale .25s var(--ease-spring)}
.to-node span{flex:1;align-self:baseline;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.to-node em{flex:none;align-self:baseline;color:var(--accent);font-size:10.5px;font-style:normal;letter-spacing:.05em;animation:to-bump .4s var(--ease-spring)}
@keyframes to-bump{from{scale:.3;opacity:0}}
.to-node small{flex:none;align-self:baseline;color:var(--muted);font-size:11px;font-weight:400;font-variant-numeric:tabular-nums;opacity:.75}
li.passed .to-node{color:var(--secondary)}
li.passed .to-node>i{border-color:var(--accent);background:var(--accent)}
li.current .to-node{color:var(--ink);font-weight:600}
li.current .to-node>i{scale:1.3;border-color:var(--accent);border-width:1.5px}
li.current .to-node>i::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:1px solid var(--accent);opacity:0;animation:to-ping 2.2s var(--ease-out) 3}
@keyframes to-ping{0%{opacity:.6;scale:.5}100%{opacity:0;scale:1.25}}
li.fresh .to-node{animation:to-flash 2.4s ease-out both}
@keyframes to-flash{from{color:var(--accent)}}
/* 调整模式：节点像手机主屏那样轻轻晃，小点收起，左边一枚细边减号；拿起的那个浮起来跟着鼠标走。晃动一直在转，幅度从 0 渐变到 .5deg：进出调整时不会一下歪过去、一下弹回来。 */
.to-col.adjusting{--to-wobble:.5deg}
.to-nodes li{animation:to-wiggle .28s ease-in-out infinite alternate}
.to-nodes li.held{animation:none}
@keyframes to-wiggle{from{rotate:calc(var(--to-wobble) * -1)}to{rotate:var(--to-wobble)}}
.to-col.adjusting .to-node{padding-left:24px;color:var(--ink)}
.to-col.adjusting .to-node>i{width:0;margin-right:-12px;border-width:0;opacity:0}
.to-node.lifted{background:var(--popup-glass,var(--surface));box-shadow:0 10px 24px -10px rgb(0 0 0 / .45),0 0 0 1px var(--line-soft);scale:1.03}
.to-minus{position:absolute;left:0;top:calc(6px + .5lh - 8px);z-index:3;display:grid;place-items:center;width:16px;height:16px;border:1px solid color-mix(in srgb,var(--ink) 40%,transparent);border-radius:50%;background:var(--surface);box-sizing:border-box;opacity:0;scale:.4;transition:opacity .2s,scale .3s var(--ease-spring)}
.to-minus i{width:7px;height:1px;background:var(--ink)}
.to-col.adjusting .to-minus{opacity:1;scale:1}
/* 底部：一行只有底边发丝线的输入；右端平时是「重新设计」，写了字换成发送。 */
.to-foot{display:flex;flex-direction:column;flex:none;gap:10px;margin:10px 6px 0 0}
.to-wish{display:flex;align-items:center;gap:2px;height:30px;margin:0;border-bottom:1px solid var(--to-rail);color:var(--muted);font-size:12.5px;transition:border-color .2s,opacity .25s}
.to-wish.typed{border-color:var(--accent);color:var(--ink)}
.to-wish>span{flex:1;min-width:0;overflow:hidden;white-space:nowrap}
.to-wish.typed .to-send{opacity:1}
.to-col .dim{opacity:.45}
.to-caret{display:inline-block;width:1.5px;height:1em;margin-left:2px;vertical-align:-.14em;background:var(--accent);animation:to-blink .9s steps(2) infinite}
@keyframes to-blink{50%{opacity:0}}
/* 大纲在改（读者在调，或助手在重写）：边上一圈流光转着；停下时原地淡出，不跳回起点。渐变只留三个色标：看上去一样，第一次亮起时的卡顿少一半。 */
.to-col::after{content:'';position:absolute;inset:-1px;z-index:4;padding:1.5px;border-radius:inherit;background:conic-gradient(from var(--to-spin,0deg),transparent 0 55%,var(--accent) 86%,transparent 100%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);opacity:0;pointer-events:none;transition:opacity .4s var(--ease-soft);animation:to-spin 2.6s linear infinite paused}
.to-col.glow::after{opacity:1;animation-play-state:running}
@keyframes to-spin{to{--to-spin:360deg}}
/* 助手栏标题栏里的小进度：几根细刻度，走过的强调色，当前那根高一些、是墨色，后面跟着数字。 */
.to-meter{display:flex;align-items:center;gap:7px;flex:none;order:1;color:var(--muted)}
.to-ticks{display:flex;align-items:center;gap:2.5px;height:12px}
.to-ticks i{width:1.5px;height:7px;border-radius:1px;background:color-mix(in srgb,var(--ink) 24%,transparent);transition:height .25s var(--ease-spring),background-color .25s}
.to-ticks i.passed{background:var(--accent)}
.to-ticks i.current{height:12px;background:var(--ink)}
.to-meter small{font-size:11px;font-variant-numeric:tabular-nums;letter-spacing:.02em}

/* ---- 菜单 ---- */
.to-menu{position:absolute;z-index:8;display:grid;gap:1px;min-width:150px;padding:5px;border:1px solid var(--glass-outline);border-radius:12px;background:var(--popup-glass,var(--surface));box-shadow:0 22px 50px -20px rgb(0 0 0 / .5),0 2px 6px rgb(0 0 0 / .08);color:var(--ink);font:12.5px/1.3 var(--font-ui,system-ui);text-align:left;white-space:nowrap}
.tw-world.forced .to-menu{font-family:inherit}
.tw-world[data-look='sketch'] .to-menu{border-width:1.5px}
.to-menu span{display:flex;align-items:center;gap:8px;height:28px;padding:0 9px;border-radius:7px;transition:background-color .15s}
.to-menu span.hot{background:color-mix(in srgb,var(--ink) 9%,transparent)}
.to-menu span.line{margin-top:3px;border-top:1px solid var(--line-soft);border-radius:0 0 7px 7px}
.to-menu .danger{color:#d0453a}

/* ---- 学习进度页 ---- */
.to-board{position:absolute;left:224px;right:14px;top:72px;bottom:14px;padding:22px 26px;overflow:hidden;border:1px solid var(--glass-outline);border-radius:var(--tw-radius);background:var(--surface);color:var(--ink);text-align:left}
.to-view-enter-active{transition:opacity .3s var(--ease-out),translate .4s var(--ease-out)}
.to-view-enter-from{opacity:0;translate:0 12px}
.to-view-leave-active{transition:opacity .2s var(--ease-soft)}
.to-view-leave-to{opacity:0}
.to-board>header{display:flex;align-items:center;margin-bottom:20px}
.to-board h2{display:flex;align-items:baseline;gap:10px;margin:0;font:600 22px/1.2 var(--font-display,inherit)}
.to-board h2 small{color:var(--muted);font-size:13px;font-weight:500}
.to-search{display:flex;align-items:center;gap:8px;width:280px;height:36px;margin-left:auto;padding:0 14px;border:1px solid var(--line-soft);border-radius:999px;color:var(--muted);font-size:12.5px}
.to-book+.to-book{margin-top:24px}
.to-book h3{display:flex;align-items:center;gap:8px;margin:0 0 12px;color:var(--secondary);font-size:13.5px;font-weight:650}
.to-book h3 small{color:var(--muted);font-size:12px;font-weight:400}
.to-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.to-card{display:flex;flex-direction:column;gap:10px;min-width:0;padding:16px 16px 14px;border:1px solid var(--line-soft);border-radius:14px}
.to-card h4{margin:0;overflow:hidden;font-size:15px;font-weight:650;line-height:22px;white-space:nowrap;text-overflow:ellipsis}
.to-rename{display:flex;align-items:center;height:22px;margin:0;padding:0 6px;border:1px solid var(--accent);border-radius:6px;background:var(--surface);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent);font-size:15px}
.to-rename span{overflow:hidden;white-space:nowrap}
.to-rename span.all{background:var(--selection-solid,#cfe0ff)}
.to-meta{display:flex;align-items:center;gap:8px;margin:0;color:var(--muted);font-size:12px}
.to-way{padding:1px 7px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:6px;color:var(--accent)}
.to-steps{display:flex;gap:3px;margin:4px 0 0}
.to-steps i{flex:1;height:6px;border-radius:3px;background:color-mix(in srgb,var(--ink) 10%,transparent)}
.to-steps i.on{background:var(--accent)}
.to-steps.none i{opacity:.5}
.to-now{display:flex;align-items:baseline;gap:8px;min-width:0;margin:0;color:var(--secondary);font-size:13px}
.to-now b{flex:none;color:var(--ink);font-size:14px;font-variant-numeric:tabular-nums}
.to-now span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.to-card.done .to-now b{color:var(--accent)}
.to-card footer{display:flex;justify-content:flex-end;margin-top:auto;padding-top:4px}
.to-go{display:grid;place-items:center;height:30px;padding:0 12px;border-radius:9px;background:var(--accent);color:#fff;font-size:12px;font-weight:600}

.to-pop-enter-active{transition:opacity .2s var(--ease-out),scale .34s var(--ease-spring)}
.to-pop-leave-active{transition:opacity .14s}
.to-pop-enter-from{opacity:0;scale:.9}.to-pop-leave-to{opacity:0}
@media (prefers-reduced-motion:reduce){.to-nodes li,.to-col::after,.to-stage span,li.current .to-node>i::after{animation:none}.to-col::after{background:var(--accent)}.to-stage span{color:var(--muted);background:none}}
</style>

<style>
/* 流光转的角度、晃动的幅度要能过渡，得登记成带类型的属性。助手栏、阅读区给大纲让位置由 TourWorld 按场景状态排。 */
@property --to-spin{syntax:'<angle>';inherits:false;initial-value:0deg}
@property --to-wobble{syntax:'<angle>';inherits:true;initial-value:0deg}
/* 标题栏里画进去的小进度排在分支图标后面、新对话图标前面（真的标题栏也是这个次序）。 */
.tw-hbtns>svg+svg{order:2}
</style>
