<script setup lang="ts">
/* 学习一课的示意：助手栏里的设定表、一来一回的对话和题目，以及助手栏左边那一栏大纲。 */
import { computed } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { LEARN, QUIZZES, TURNS } from './lesson-learn'
import type { Scene } from './lessons'

const props = defineProps<{ scene: Scene; place: 'chat' | 'plan' }>()
const learn = computed(() => props.scene.learn)
const view = computed(() => learn.value.stage === 'setup' ? 'setup' : 'log')
const outlined = computed(() => learn.value.stage === 'probe' || learn.value.stage === 'plan' || learn.value.stage === 'teach')
const planned = computed(() => learn.value.stage === 'plan' || learn.value.stage === 'teach')
const STAGE: Record<string, string> = { probe: '摸底中', plan: '等你确认', teach: '带读中' }
/* 正在写的那条只露出写到的字，没写到的先占着位置：对话就不会随着换行一下一下往上跳。 */
function parts(say: string[], index: number) {
  let left = index === learn.value.shown - 1 ? learn.value.typed : Infinity
  return say.map((text, at) => { const shown = at % 2 ? (left >= text.length ? text : '') : text.slice(0, Math.max(0, left)); left -= text.length; return { text, shown, cite: at % 2 === 1 } })
}
const filled = computed(() => learn.value.picked.slice(0, 2).filter(value => value !== null).length)
const status = (index: number) => index < learn.value.passed ? 'passed' : index === learn.value.current ? 'current' : ''
// 一进来就有的几条（大纲与进度一课接着这段对话）不再一条条长出来。
const settled = props.scene.learn.shown
</script>

<template>
  <div v-if="place === 'chat'" class="tl-chat">
    <Transition name="tl-swap" mode="out-in" appear>
      <section v-if="view === 'setup'" key="setup" class="tl-setup">
        <h4>学习<small>线性代数讲义</small></h4>
        <div class="tl-field">
          <p class="tl-label">范围</p>
          <div class="tl-chapters"><p v-for="(item, index) in LEARN.chapters" :key="item[0]" class="tl-ch" :class="`tl-ch-${index}`"><AppIcon class="tl-caret" name="arrow" :size="9" /><i :class="{ on: index === 1 && learn.ticked }"></i><span>{{ item[0] }}</span><small>{{ item[1] }}</small></p></div>
          <p class="tl-input">或者自己写：第 3 章、42–58 页…</p>
        </div>
        <div class="tl-field">
          <p class="tl-label">目标</p>
          <p class="tl-seg tl-goals"><span v-for="(goal, index) in LEARN.goals" :key="goal" :class="{ on: index === 2 }">{{ goal }}</span></p>
          <p class="tl-input">还有什么要求（可不填）</p>
        </div>
        <div class="tl-field row"><p class="tl-label">题型</p><p class="tl-seg"><span class="on">选择</span><span>自述</span></p></div>
        <footer><span>取消</span><b class="tl-start">开始</b></footer>
      </section>
      <div v-else key="log" class="tl-log" :style="{ translate: `0 ${learn.lift}px` }">
        <div v-for="(turn, index) in TURNS.slice(0, learn.shown)" :key="index" class="tl-turn" :class="{ old: index < settled }"><div>
          <p v-if="'me' in turn" class="tl-me">{{ turn.me }}</p>
          <p v-else-if="'say' in turn" class="tl-say"><template v-for="(part, at) in parts(turn.say, index)" :key="at"><b v-if="part.cite" class="tl-cite" :class="{ ghost: !part.shown }">{{ part.text }}</b><template v-else>{{ part.shown }}<span class="tl-ghost">{{ part.text.slice(part.shown.length) }}</span></template></template></p>
          <template v-else>
            <section v-for="id in turn.quiz" :key="id" class="tl-quiz" :class="`tl-q-${id}`">
              <div v-if="id === 3" class="tl-fold" :class="{ shut: learn.opened }"><div><span class="tl-open">做检查题</span></div></div>
              <div class="tl-fold" :class="{ shut: id === 3 && !learn.opened }"><div>
                <p class="tl-kind">{{ QUIZZES[id]!.kind }}</p>
                <p class="tl-question">{{ QUIZZES[id]!.question }}</p>
                <p v-for="(option, at) in QUIZZES[id]!.options" :key="option" class="tl-opt" :class="[`tl-opt-${at}`, { on: learn.picked[id] === at, right: learn.sent[id] && at === QUIZZES[id]!.answer, wrong: learn.sent[id] && learn.picked[id] === at && at !== QUIZZES[id]!.answer }]"><i></i>{{ option }}</p>
                <div class="tl-fold" :class="{ shut: learn.sent[id] }"><div>
                  <p class="tl-think">我的想法（可不填）</p>
                  <p class="tl-sure"><span v-for="(label, level) in LEARN.sure" :key="label" :class="[`tl-sure-${level}`, { on: learn.sure[id] === level }]">{{ label }}</span></p>
                  <p class="tl-foot"><span>不知道</span><b v-if="turn.quiz.length === 1" class="tl-submit" :class="{ ready: learn.picked[id] !== null }">提交</b></p>
                </div></div>
                <div v-if="QUIZZES[id]!.why" class="tl-fold" :class="{ shut: !learn.sent[id] }"><div><p class="tl-why">{{ QUIZZES[id]!.why }}</p></div></div>
              </div></div>
            </section>
            <div v-if="turn.quiz.length > 1" class="tl-fold" :class="{ shut: learn.sent[0] }"><div><p class="tl-all"><span>{{ filled }} / {{ turn.quiz.length }}</span><b :class="{ ready: filled === turn.quiz.length }">一起提交</b></p></div></div>
          </template>
        </div></div>
      </div>
    </Transition>
  </div>
  <div v-else-if="outlined" class="tl-plan"><div class="tl-plan-in">
    <header><h3>大纲</h3><small v-if="planned" class="tl-count">{{ learn.passed }} / {{ LEARN.nodes.length }}</small><i></i><span v-if="planned" class="tl-adjust">调整</span><span class="tl-move"><AppIcon name="panel" :size="14" /></span></header>
    <p class="tl-bar" :class="{ on: planned }"><i :style="{ width: `${learn.passed / LEARN.nodes.length * 100}%` }"></i></p>
    <Transition name="tl-swap" mode="out-in"><p :key="learn.stage" class="tl-stage">{{ STAGE[learn.stage] }}</p></Transition>
    <Transition name="tl-swap" mode="out-in">
      <ol v-if="planned" class="tl-nodes"><li v-for="(node, index) in LEARN.nodes" :key="node[0]" :class="status(index)" :style="{ animationDelay: `${index * 45}ms` }"><i></i><span>{{ node[0] }}</span><small>{{ node[1] }}</small></li></ol>
      <p v-else class="tl-none">摸底后出大纲</p>
    </Transition>
    <footer v-if="planned">
      <div class="tl-fold" :class="{ shut: learn.stage !== 'plan' }"><div><span class="tl-accept">就这样开始</span></div></div>
      <p class="tl-wish"><span>想怎么改大纲</span><b><AppIcon name="send" :size="14" /></b></p>
      <span class="tl-redo"><AppIcon name="retry" :size="12" />重新设计</span>
    </footer>
  </div></div>
</template>

<style scoped>
p,h3,h4,ol{margin:0}
i{font-style:normal}
/* 对话从顶上排；排满以后贴着底，新的一条从下面把旧的推上去。 */
.tl-chat{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
.tl-swap-enter-active{transition:opacity .28s var(--ease-out),translate .32s var(--ease-out)}
.tl-swap-leave-active{transition:opacity .14s var(--ease-soft)}
.tl-swap-enter-from{opacity:0;translate:0 8px}
.tl-swap-leave-to{opacity:0}

/* 设定表：和总结的那张表同一种版式。 */
.tl-setup{margin-bottom:auto;display:flex;flex-direction:column;gap:12px;padding:13px 13px 12px;border:1px solid var(--glass-outline);border-radius:12px;background:var(--surface);font-size:12.5px}
.tl-setup h4{display:flex;align-items:baseline;gap:8px;font-size:14px;font-weight:650}
.tl-setup h4 small{color:var(--muted);font-size:11.5px;font-weight:400}
.tl-field{display:flex;flex-direction:column;gap:6px}
.tl-field.row{flex-direction:row;align-items:center;justify-content:space-between}
.tl-label{color:var(--secondary);font-size:12px}
.tl-chapters{display:grid;gap:1px;padding:4px;border:1px solid var(--line-soft);border-radius:8px}
.tl-ch{display:flex;align-items:center;gap:7px;height:25px;font-size:12px}
.tl-ch span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tl-ch small{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.tl-caret{flex:none;width:14px;color:var(--muted);rotate:180deg}
.tl-ch i{position:relative;flex:none;width:12px;height:12px;border:1.5px solid color-mix(in srgb,var(--ink) 42%,transparent);border-radius:3px;transition:background-color .2s,border-color .2s}
.tl-ch i.on{border-color:var(--accent);background:var(--accent)}
.tl-ch i.on::after{content:'';position:absolute;left:3px;top:.5px;width:3px;height:6px;border:solid #fff;border-width:0 1.6px 1.6px 0;rotate:45deg}
.tl-input{height:28px;padding:0 9px;overflow:hidden;border:1px solid var(--line-soft);border-radius:7px;color:var(--muted);font-size:11.5px;line-height:26px;white-space:nowrap}
.tl-seg{display:flex;padding:2px;border-radius:8px;background:color-mix(in srgb,var(--ink) 8%,transparent)}
.tl-seg span{display:grid;place-items:center;height:24px;padding:0 12px;border-radius:6px;color:var(--secondary);font-size:12px;white-space:nowrap}
.tl-goals span{flex:1;padding:0 4px}
.tl-seg span.on{background:var(--surface);box-shadow:0 1px 3px rgb(0 0 0 / .18);color:var(--ink);font-weight:600}
.tl-setup footer{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:12px}
.tl-start{display:grid;place-items:center;height:28px;padding:0 18px;border-radius:8px;background:var(--accent);color:#fff;font-size:12.5px;font-weight:600}
.tw-world[data-look='sketch'] .tl-setup{border-width:1.5px}

/* 对话：每一条都从零高度长出来，前面的跟着平滑地让位。 */
.tl-log{flex:none;margin-bottom:auto;display:flex;flex-direction:column}
.tl-turn{display:grid;grid-template-rows:1fr;animation:tl-grow .42s var(--ease-out) both}
.tl-turn>div{display:flex;flex-direction:column;min-height:0;overflow:hidden}
/* 和上一条的间距写在里面、跟着收起：写成内边距的话新的一条一出现就先占 10px，整段对话跳一下。 */
.tl-turn>div>:first-child{margin-top:10px}
.tl-turn:first-child>div>:first-child{margin-top:0}
@keyframes tl-grow{from{grid-template-rows:0fr;opacity:0}}
.tl-turn.old{animation:none}
.tl-me{align-self:flex-end;max-width:86%;padding:8px 12px;border-radius:14px 14px 4px 14px;background:color-mix(in srgb,var(--ink) 7%,transparent);font-size:13px;white-space:pre-line}
.tl-say{font-size:13px;line-height:1.7}
.tl-ghost,.tl-cite.ghost{visibility:hidden}
.tl-cite{display:inline-flex;align-items:center;height:19px;margin:0 2px;padding:0 6px;border:1px solid var(--line-soft);border-radius:5px;background:color-mix(in srgb,var(--ink) 4%,transparent);color:var(--secondary);font-size:10.5px;font-weight:600;line-height:1;vertical-align:1px}
/* 收起、展开：高度跟着走，不让下面的东西跳。 */
.tl-fold{display:grid;grid-template-rows:1fr;transition:grid-template-rows .36s var(--ease-out),opacity .26s var(--ease-soft)}
.tl-fold.shut{grid-template-rows:0fr;opacity:0}
.tl-fold>div{min-height:0;overflow:hidden}

/* 题目：和真的卡片一样用正文字体、实心底，不跟着主题换手写体。 */
.tl-quiz{padding:11px 12px 12px;border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-radius:11px;background:var(--surface);font-family:var(--font-formal,system-ui);font-size:12.5px;line-height:1.5;letter-spacing:0}
.tl-quiz+.tl-quiz{margin-top:10px}
.tl-kind{color:var(--secondary);font-size:11px;font-weight:600;letter-spacing:.04em}
.tl-question{margin:4px 0 2px;font-size:13px;font-weight:650}
.tl-opt{display:flex;align-items:flex-start;gap:8px;margin-top:5px;padding:5px 9px;border:1.5px solid color-mix(in srgb,var(--ink) 26%,transparent);border-radius:8px;transition:border-color .2s,background-color .2s}
.tl-opt i{flex:none;width:12px;height:12px;margin-top:3px;border:1.5px solid color-mix(in srgb,var(--ink) 55%,transparent);border-radius:50%;transition:background-color .2s,border-color .2s,box-shadow .2s}
.tl-opt.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface))}
.tl-opt.on i{border-color:var(--accent);background:var(--accent);box-shadow:inset 0 0 0 2px var(--surface)}
.tl-opt.right{border-color:#2e9d5c;background:color-mix(in srgb,#2e9d5c 14%,var(--surface))}
.tl-opt.wrong{border-color:#c9503c;background:color-mix(in srgb,#c9503c 13%,var(--surface))}
.tl-think{height:26px;margin-top:8px;padding:0 9px;border:1px solid color-mix(in srgb,var(--ink) 26%,transparent);border-radius:7px;color:var(--secondary);font-size:11.5px;line-height:24px}
.tl-sure{display:flex;gap:4px;margin-top:6px}
.tl-sure span{height:22px;padding:0 7px;border:1px solid color-mix(in srgb,var(--ink) 26%,transparent);border-radius:6px;color:var(--secondary);font-size:11px;line-height:20px;white-space:nowrap;transition:border-color .2s,background-color .2s,color .2s}
.tl-sure span.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface));color:var(--ink);font-weight:600}
.tl-foot{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:6px;color:var(--secondary);font-size:12px}
.tl-foot>span{line-height:24px}
.tl-submit,.tl-all b{height:24px;padding:0 14px;border-radius:7px;background:var(--accent);color:#fff;font-size:12px;font-weight:600;line-height:24px;opacity:.45;transition:opacity .2s}
:is(.tl-submit,.tl-all b).ready{opacity:1}
.tl-why{margin-top:7px;font-size:12.5px}
.tl-all{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding-top:8px;font-family:var(--font-formal,system-ui)}
.tl-all span{color:var(--secondary);font-size:12px;font-variant-numeric:tabular-nums}
.tl-open{display:inline-block;height:26px;padding:0 11px;border:1px solid color-mix(in srgb,var(--ink) 30%,transparent);border-radius:7px;line-height:24px}

/* 大纲：助手栏左边的一栏，位置和尺寸跟「大纲与进度」一课一样，两课接得上。展开时宽度和助手栏同步长出来。 */
.tl-plan{position:absolute;left:0;top:0;bottom:0;width:236px;overflow:hidden;animation:tl-open .45s var(--ease-out) both}
@keyframes tl-open{from{width:0;opacity:0}}
.tl-plan-in{display:flex;flex-direction:column;width:236px;height:100%;padding:14px 10px 12px 14px;border-right:1px solid var(--line-soft);color:var(--ink)}
.tl-plan header{display:flex;align-items:center;gap:8px;flex:none;padding-right:4px}
.tl-plan h3{font-size:15px;font-weight:650}
.tl-plan header>i{flex:1}
.tl-count{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums;animation:tl-in .3s var(--ease-out) both}
.tl-adjust{height:26px;padding:0 9px;color:var(--accent);font-size:12px;font-weight:600;line-height:26px;animation:tl-in .3s var(--ease-out) both}
@keyframes tl-in{from{opacity:0}}
.tl-move{display:grid;place-items:center;flex:none;width:26px;height:26px;color:var(--muted)}
.tl-bar{flex:none;height:4px;margin:12px 4px 0 0;overflow:hidden;border-radius:2px;background:color-mix(in srgb,var(--ink) 10%,transparent);opacity:0;transition:opacity .3s}
.tl-bar.on{opacity:1}
.tl-bar i{display:block;height:100%;border-radius:2px;background:var(--accent);transition:width .5s var(--ease-out)}
.tl-stage{flex:none;margin:8px 0 6px;color:var(--muted);font-size:12px}
.tl-none{flex:1;color:var(--muted);font-size:12.5px}
.tl-nodes{flex:1;min-height:0;padding:2px 4px 2px 0;list-style:none}
.tl-nodes li{position:relative;display:flex;align-items:center;gap:10px;height:32px;padding:0 8px 0 7px;border-radius:9px;color:var(--secondary);font-size:13px;animation:tl-node .35s var(--ease-out) both;transition:background-color .3s,color .3s}
@keyframes tl-node{from{opacity:0;translate:0 6px}}
.tl-nodes li:not(:last-child)::before{content:'';position:absolute;left:12.5px;top:22px;bottom:-10px;width:1px;background:var(--line-soft);transition:background-color .3s}
.tl-nodes li>i{position:relative;z-index:1;flex:none;width:11px;height:11px;border:1.5px solid color-mix(in srgb,var(--ink) 34%,transparent);border-radius:50%;background:var(--surface);transition:background-color .3s,border-color .3s,box-shadow .3s}
.tl-nodes span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tl-nodes small{flex:none;color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums}
.tl-nodes li.current{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--ink);font-weight:650}
.tl-nodes li.current>i{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 24%,transparent)}
.tl-nodes li.passed{color:var(--ink)}
.tl-nodes li.passed>i{border-color:var(--accent);background:var(--accent)}
.tl-nodes li.passed:not(:last-child)::before{background:color-mix(in srgb,var(--accent) 60%,transparent)}
.tl-plan footer{display:flex;flex-direction:column;flex:none;margin:10px 4px 0 0;padding-top:10px;border-top:1px solid var(--line-soft);animation:tl-in .3s var(--ease-out) both}
.tl-plan footer .tl-fold>div{display:flex;flex-direction:column;padding-bottom:8px}
.tl-accept{display:grid;place-items:center;height:30px;border-radius:9px;background:color-mix(in srgb,var(--accent) 82%,transparent);color:#fff;font-size:12px;font-weight:600}
.tl-wish{display:flex;align-items:center;gap:4px;height:32px;padding:0 3px 0 10px;border:1px solid var(--line-soft);border-radius:9px;color:var(--muted);font-size:12.5px}
.tl-wish span{flex:1;min-width:0;overflow:hidden;white-space:nowrap}
.tl-wish b{display:grid;place-items:center;flex:none;width:26px;height:26px;color:var(--muted)}
.tl-redo{display:inline-flex;align-items:center;align-self:flex-start;gap:5px;height:26px;margin-top:8px;padding:0 9px;color:var(--accent);font-size:12px;font-weight:600}
</style>
