<script setup lang="ts">
/* 教程里那张示意的界面：一块 1280×800 的画布，按当前主题的颜色画。它不接任何真实数据。 */
import { computed } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { ANSWER, SENTENCE, type Scene } from './lessons'

const props = defineProps<{ scene: Scene }>()
const picked = computed(() => SENTENCE.slice(0, props.scene.selected))
const rest = computed(() => SENTENCE.slice(props.scene.selected))
const written = computed(() => ANSWER.slice(0, props.scene.words))

/* 一支箭：杆和箭头分开画，杆可以描出来，箭头随后浮现。 */
function arrow(x1: number, y1: number, x2: number, y2: number) {
  const length = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / length, uy = (y2 - y1) / length
  const bx = x2 - ux * 7, by = y2 - uy * 7
  return { shaft: `M${x1} ${y1}L${x2} ${y2}`, head: `M${(bx - uy * 3.2).toFixed(1)} ${(by + ux * 3.2).toFixed(1)}L${x2} ${y2}L${(bx + uy * 3.2).toFixed(1)} ${(by - ux * 3.2).toFixed(1)}` }
}
const origin = [44, 88] as const
const lines = {
  av: arrow(origin[0], origin[1], 184, 18), v: arrow(origin[0], origin[1], 100, 60),
  u: arrow(origin[0], origin[1], 66, 22), au: arrow(origin[0], origin[1], 156, 70),
}
const nav = [['clock', '最近阅读'], ['library', '全部文档'], ['star', '收藏'], ['visual', 'Intelligent UI']]
</script>

<template>
  <div class="tw-world" aria-hidden="true">
    <aside class="tw-side">
      <div class="tw-search"><AppIcon name="search" :size="14" /><i></i></div>
      <p v-for="(item, index) in nav" :key="item[1]" class="tw-row" :class="{ on: index === 0 }"><AppIcon :name="item[0]" :size="15" />{{ item[1] }}</p>
      <h6>分组</h6>
      <p class="tw-row"><AppIcon name="folder" :size="15" />线性代数</p>
      <p class="tw-row"><AppIcon name="folder" :size="15" />论文</p>
      <h6>书签</h6>
      <p class="tw-mark"><i class="m1"></i>第 42 页</p>
      <p class="tw-mark"><i class="m2"></i>第 87 页</p>
      <p class="tw-mark"><i class="m3"></i>第 113 页</p>
      <p class="tw-row tw-foot"><AppIcon name="settings" :size="15" />设置</p>
    </aside>

    <header class="tw-top">
      <span class="tw-crumb">文库<AppIcon name="chevron-right" :size="12" /><b>线性代数讲义</b></span>
      <span class="tw-pages">87 / 312</span>
      <span class="tw-tools"><AppIcon name="search" :size="16" /><AppIcon name="bookmark" :size="16" /><AppIcon name="translate" :size="16" /><AppIcon name="sparkle" :size="16" /></span>
    </header>

    <main class="tw-reader">
      <article class="tw-page" :style="{ transform: `translateY(${-scene.scroll}px)` }">
        <small>第 5 章 · 特征值</small>
        <h1>5.1 特征值与特征向量</h1>
        <p>设 A 是一个 n 阶方阵。上一章我们把 A 看作一次线性变换：它把空间里的每个向量送到另一个向量，方向和长度一般都会改变。</p>
        <p><i class="tw-a"></i><span class="tw-target"><mark>{{ picked }}</mark>{{ rest }}</span><i class="tw-b"></i>换句话说，A 作用在 v 上的效果只是一次伸缩。</p>
        <p class="tw-math">det(A − λI) = 0</p>
        <p>上式称为 A 的特征方程。它是关于 λ 的 n 次多项式方程，在复数范围内恰有 n 个根（重根按重数计）。求出每个 λ 之后，再解齐次方程组 (A − λI)v = 0，就得到对应的特征向量。</p>
        <p>例 1　求矩阵 A 的特征值与特征向量。先写出特征多项式并因式分解，得到 λ₁ = 2，λ₂ = 5；再分别代回齐次方程组，各取一个基础解。</p>
        <p>属于不同特征值的特征向量线性无关。这一点在后面讨论对角化时会反复用到：若 n 阶方阵有 n 个线性无关的特征向量，它就相似于一个对角矩阵。</p>
        <p>定理 5.2　实对称矩阵的特征值都是实数，属于不同特征值的特征向量相互正交。</p>

        <Transition name="tw-card">
          <div v-if="scene.card !== 'none'" class="tw-card" :class="{ pinned: scene.card === 'pinned' }" :style="{ left: `${scene.cardAt.x}px`, top: `${scene.cardAt.y}px` }">
            <div class="tw-card-head"><AppIcon class="tw-spark" name="sparkle" :size="13" /><span><mark>{{ SENTENCE.slice(0, 15) }}…</mark></span><b class="tw-pin" :class="{ on: scene.card === 'pinned' }"><AppIcon name="pin" :size="13" /></b></div>
            <i class="tw-rule" :class="{ running: scene.running }"></i>
            <p class="tw-answer">{{ written }}<i v-if="scene.running && scene.words < ANSWER.length" class="tw-caret"></i></p>
            <svg v-if="scene.drawn" class="tw-diagram" viewBox="0 0 260 104">
              <path class="axis" d="M14 88H250M44 100V6" />
              <path class="soft" pathLength="1" :d="lines.av.shaft" style="--d: 0ms" /><path class="soft head" :d="lines.av.head" style="--d: 560ms" />
              <path class="main" pathLength="1" :d="lines.v.shaft" style="--d: 120ms" /><path class="main head" :d="lines.v.head" style="--d: 520ms" />
              <path class="other" pathLength="1" :d="lines.u.shaft" style="--d: 700ms" /><path class="other head" :d="lines.u.head" style="--d: 1040ms" />
              <path class="other" pathLength="1" :d="lines.au.shaft" style="--d: 900ms" /><path class="other head" :d="lines.au.head" style="--d: 1240ms" />
              <path class="turn" pathLength="1" d="M74 34Q112 30 134 60" style="--d: 1080ms" />
              <text class="t-main" x="104" y="74" style="--d: 520ms">v</text><text class="t-main" x="190" y="22" style="--d: 620ms">Av = λv</text>
              <text x="52" y="18" style="--d: 1040ms">u</text><text x="162" y="80" style="--d: 1240ms">Au</text>
            </svg>
            <p class="tw-actions"><AppIcon name="deeper" :size="15" /><AppIcon name="simpler" :size="15" /><AppIcon name="example" :size="15" /><AppIcon name="visual" :size="15" /></p>
          </div>
        </Transition>
      </article>
    </main>

    <aside class="tw-ai">
      <header><AppIcon name="sparkle" :size="15" /><b>阅读助手</b></header>
      <div class="tw-bubble me"><i></i><i style="width: 62%"></i></div>
      <div class="tw-bubble"><i></i><i></i><i style="width: 78%"></i><i style="width: 46%"></i></div>
      <div class="tw-ask"><span>问问这一页</span><b><AppIcon name="arrow-up" :size="14" /></b></div>
    </aside>
  </div>
</template>

<style scoped>
.tw-world{position:absolute;left:0;top:0;width:1280px;height:800px;transform-origin:0 0;overflow:hidden;background:var(--canvas);color:var(--ink);font-size:13px;line-height:1.4;user-select:none;pointer-events:none}
.tw-world p,.tw-world h1,.tw-world h6{margin:0}

.tw-side{position:absolute;left:14px;top:14px;bottom:14px;width:196px;display:flex;flex-direction:column;gap:3px;padding:14px 12px;border:1px solid var(--glass-outline);border-radius:18px;background:var(--sidebar,var(--surface))}
.tw-search{display:flex;align-items:center;gap:8px;height:32px;margin-bottom:8px;padding:0 10px;border:1px solid var(--line-soft);border-radius:999px;color:var(--muted)}
.tw-search i{flex:1;height:1px;background:var(--line-soft)}
.tw-row{display:flex;align-items:center;gap:9px;height:34px;padding:0 10px;border-radius:10px;color:var(--secondary)}
.tw-row.on{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink);font-weight:600}
.tw-side h6{margin:14px 10px 4px;color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.08em}
.tw-mark{display:flex;align-items:center;gap:9px;height:28px;padding:0 10px;color:var(--secondary);font-size:12px}
.tw-mark i{width:22px;height:10px;clip-path:polygon(0 0,100% 0,82% 50%,100% 100%,0 100%)}
.tw-mark .m1{background:linear-gradient(90deg,#1f3a5f 55%,#d9b25f 55%)}
.tw-mark .m2{background:linear-gradient(90deg,#e8e2d4 34%,#22252b 34% 66%,#b9853a 66%)}
.tw-mark .m3{background:linear-gradient(90deg,#3f6b5c,#a8c3a0)}
.tw-side .tw-foot{margin-top:auto;border-top:1px solid var(--line-soft);border-radius:0;padding-top:8px;height:42px}

.tw-top{position:absolute;left:224px;right:14px;top:14px;height:46px;display:flex;align-items:center;gap:14px;padding:0 16px;border:1px solid var(--glass-outline);border-radius:14px;background:var(--surface)}
.tw-crumb{display:flex;align-items:center;gap:6px;color:var(--muted)}
.tw-crumb b{color:var(--ink);font-weight:600}
.tw-pages{margin-left:auto;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.tw-tools{display:flex;gap:14px;color:var(--secondary)}

.tw-reader{position:absolute;left:224px;right:330px;top:72px;bottom:0;overflow:hidden}
.tw-page{position:relative;width:600px;min-height:940px;margin:10px auto 0;padding:52px 62px 60px;border-radius:3px;background:#fffefb;color:#23252b;box-shadow:0 1px 2px rgb(0 0 0 / .08),0 14px 40px -18px rgb(0 0 0 / .28);font:15px/1.95 Georgia,'Source Han Serif SC','Noto Serif CJK SC','Songti SC',SimSun,serif}
.tw-page small{color:#8a8d96;font-size:11.5px;letter-spacing:.12em}
.tw-page h1{margin:6px 0 16px;font-size:23px;font-weight:600;line-height:1.4;letter-spacing:.01em}
.tw-page p{margin-bottom:12px;text-align:justify}
.tw-page .tw-math{margin:16px 0;text-align:center;font-style:italic;font-size:16px;letter-spacing:.04em}
.tw-a,.tw-b{display:inline-block;width:0;height:1em;vertical-align:-.12em}
.tw-target mark{background:var(--selection-solid,#cfe0ff);color:inherit}

.tw-card{position:absolute;z-index:2;width:310px;padding:11px 14px 12px;border:1px solid var(--glass-outline);border-radius:14px;background:var(--popup-glass,var(--surface));box-shadow:0 18px 44px -18px rgb(0 0 0 / .42),0 2px 6px rgb(0 0 0 / .08);color:var(--ink);font:13.5px/1.62 var(--font-ui,system-ui);transform-origin:40% 0;transition:box-shadow .5s var(--ease-out),translate .45s var(--ease-spring),rotate .45s var(--ease-spring)}
.tw-card.pinned{box-shadow:0 8px 22px -12px rgb(0 0 0 / .34),0 1px 3px rgb(0 0 0 / .1),0 0 0 1px color-mix(in srgb,var(--accent) 38%,transparent);translate:0 3px;rotate:-.5deg}
.tw-card-enter-active{transition:opacity .28s var(--ease-out),scale .5s var(--ease-spring)}
.tw-card-enter-from{opacity:0;scale:.86}
.tw-card-head{display:flex;align-items:center;gap:6px}
.tw-card-head span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;font-size:12.5px;font-weight:650}
.tw-card-head mark{background:linear-gradient(transparent 56%,color-mix(in srgb,var(--accent) 26%,transparent) 56%);color:inherit}
.tw-spark{flex:none;color:var(--accent)}
.tw-pin{display:grid;place-items:center;flex:none;width:22px;height:22px;border-radius:50%;color:var(--muted);rotate:35deg;transition:rotate .35s var(--ease-spring),color .2s,background-color .2s}
.tw-pin.on{rotate:0deg;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.tw-rule{position:relative;display:block;height:1px;margin:8px 0 9px;overflow:hidden;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 55%,transparent),color-mix(in srgb,var(--ink) 10%,transparent) 45%,transparent)}
.tw-rule.running::after{content:'';position:absolute;inset:0;width:38%;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:tw-run 1.15s cubic-bezier(.45,0,.55,1) infinite}
@keyframes tw-run{from{translate:-100% 0}to{translate:270% 0}}
.tw-answer{min-height:66px}
.tw-caret{display:inline-block;width:1.5px;height:1em;margin-left:2px;vertical-align:-.14em;background:var(--accent);animation:tw-blink .9s steps(2) infinite}
@keyframes tw-blink{50%{opacity:0}}

.tw-diagram{display:block;width:100%;height:auto;margin:6px 0 2px;overflow:visible;animation:tw-unfold .5s var(--ease-out) both}
@keyframes tw-unfold{from{max-height:0;opacity:0}to{max-height:130px;opacity:1}}
.tw-diagram path{fill:none;stroke-linecap:round;stroke-linejoin:round}
.tw-diagram .axis{stroke:color-mix(in srgb,var(--ink) 16%,transparent);stroke-width:1}
.tw-diagram .main{stroke:var(--accent);stroke-width:2}
.tw-diagram .soft{stroke:color-mix(in srgb,var(--accent) 42%,transparent);stroke-width:2}
.tw-diagram .other{stroke:color-mix(in srgb,var(--ink) 46%,transparent);stroke-width:1.4}
.tw-diagram .turn{stroke:color-mix(in srgb,var(--ink) 30%,transparent);stroke-width:1}
.tw-diagram path[pathLength]{stroke-dasharray:1;stroke-dashoffset:1;animation:tw-draw .62s var(--ease-soft) calc(var(--d) + .3s) both}
.tw-diagram .head,.tw-diagram text{animation:tw-appear .3s var(--ease-out) calc(var(--d) + .3s) both}
@keyframes tw-draw{to{stroke-dashoffset:0}}
@keyframes tw-appear{from{opacity:0}}
.tw-diagram text{fill:var(--muted);font:italic 12px Georgia,serif}
.tw-diagram .t-main{fill:var(--accent)}
.tw-actions{display:inline-flex;gap:13px;margin-top:8px!important;padding:5px 11px;border-radius:999px;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--muted)}

.tw-ai{position:absolute;right:14px;top:72px;bottom:14px;width:302px;display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--glass-outline);border-radius:18px;background:var(--surface)}
.tw-ai header{display:flex;align-items:center;gap:8px;margin-bottom:6px;color:var(--ink)}
.tw-ai header .app-icon,.tw-ai header svg{color:var(--accent)}
.tw-bubble{display:grid;gap:9px;padding:13px 14px;border-radius:14px}
.tw-bubble i{height:1px;background:color-mix(in srgb,var(--ink) 22%,transparent)}
.tw-bubble.me{align-self:flex-end;width:62%;background:color-mix(in srgb,var(--ink) 6%,transparent)}
.tw-ask{display:flex;align-items:center;margin-top:auto;height:44px;padding:0 7px 0 15px;border:1px solid var(--glass-outline);border-radius:999px;color:var(--muted)}
.tw-ask b{display:grid;place-items:center;width:30px;height:30px;margin-left:auto;border-radius:50%;background:var(--ink);color:var(--surface)}

:root[data-style='sketch'] .tw-side,:root[data-style='sketch'] .tw-top,:root[data-style='sketch'] .tw-ai,:root[data-style='sketch'] .tw-card{border-width:1.5px}
:root[data-style='sketch'] .tw-side{border-radius:16px 22px 18px 20px / 20px 16px 22px 17px}
:root[data-style='sketch'] .tw-ai{border-radius:20px 16px 22px 17px / 16px 22px 18px 20px}
:root[data-style='sketch'] .tw-card{border-radius:13px 17px 14px 18px / 17px 13px 18px 14px;box-shadow:3px 4px 0 color-mix(in srgb,var(--pencil,#2e2d2a) 20%,transparent)}
:root[data-style='sketch'] .tw-card.pinned{box-shadow:2px 2px 0 color-mix(in srgb,var(--pencil,#2e2d2a) 26%,transparent)}
</style>
