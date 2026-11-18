<script setup lang="ts">
/* 教程里那张示意的界面：一块 1280×800 的画布，按当前主题的颜色画。它不接任何真实数据。 */
import { computed } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { MODELS, TEXT, replyLength, type Look, type Scene, type SlotId } from './lessons'

const props = defineProps<{ scene: Scene }>()
const own = (document.documentElement.dataset.style || 'glass') as Look
const look = computed(() => props.scene.look || own)
const source = computed(() => props.scene.doc === 'paper' ? TEXT.english : TEXT.sentence)
const picked = computed(() => source.value.slice(0, props.scene.selected))
const rest = computed(() => source.value.slice(props.scene.selected))
const written = computed(() => TEXT.answer.slice(0, props.scene.words))
const reply = computed(() => { let left = props.scene.answer; return TEXT.reply.map(part => { const shown = part.slice(0, Math.max(0, left)); left -= part.length; return shown }) })
const pad = (value: number) => String(Math.max(0, value)).padStart(2, '0')

/* 一支箭：杆和箭头分开画，杆可以描出来，箭头随后浮现。 */
function arrow(x1: number, y1: number, x2: number, y2: number) {
  const length = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / length, uy = (y2 - y1) / length
  const bx = x2 - ux * 7, by = y2 - uy * 7
  return { shaft: `M${x1} ${y1}L${x2.toFixed(1)} ${y2.toFixed(1)}`, head: `M${(bx - uy * 3.2).toFixed(1)} ${(by + ux * 3.2).toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}L${(bx + uy * 3.2).toFixed(1)} ${(by - ux * 3.2).toFixed(1)}`, x: x2, y: y2 }
}
const still = { v: arrow(44, 88, 100, 60), u: arrow(44, 88, 66, 22), au: arrow(44, 88, 156, 70) }
const scaled = computed(() => arrow(44, 88, 44 + 56 * props.scene.lambda, 88 - 28 * props.scene.lambda))

const INK = [
  { id: 'pen', d: 'M4 20l1-5L16 4l4 4L9 19z M14 6l4 4' },
  { id: 'highlighter', d: 'M9 14l6-9 4 3-6 9z M9 14l-2 5 5-2 M4 21h8' },
  { id: 'underline', d: 'M7 4v7a5 5 0 0 0 10 0V4 M5 20h14' },
  { id: 'eraser', d: 'M5 15l8-9 6 5-8 9H8z M9.5 10.5l6 5 M4 20h16' },
]
const SLOTS: { id: SlotId; label: string; note: string }[] = [
  { id: 'assistant', label: '阅读助手', note: '对话、框选提问、/btw' },
  { id: 'translation', label: '翻译', note: '划词翻译、翻译窗口' },
  { id: 'explain', label: '快速解释', note: '中键解释、深入 / 简化 / 举例' },
]
const SERVICES = ['OpenAI API', 'Claude', 'Kimi']
const STYLES: { id: Look; label: string }[] = [{ id: 'glass', label: '液态玻璃' }, { id: 'crystal', label: '新液态玻璃' }, { id: 'warm', label: '暖色极简' }, { id: 'sketch', label: '铅笔草稿' }]
const ARTS = ['至上主义', '风格派', '浮世绘', '包豪斯']
const OUTLINE = ['5.1 特征值与特征向量', '5.2 特征方程', '5.3 相似对角化', '5.4 实对称矩阵']
const FILES = [
  { id: 'new', title: '特征值专题讲义', meta: 'PDF · 24 页', kind: 'k1', hit: 0 },
  { id: 'algebra', title: '线性代数讲义', meta: 'PDF · 312 页', kind: 'k2', hit: 12 },
  { id: 'paper', title: 'Attention Is All You Need', meta: 'PDF · 15 页', kind: 'k3', hit: 0 },
  { id: 'prob', title: '概率论笔记', meta: 'Markdown', kind: 'k4', hit: 0 },
  { id: 'real', title: '实分析 第三章', meta: 'PDF · 48 页', kind: 'k1', hit: 0 },
  { id: 'ml', title: '机器学习导论', meta: 'PDF · 506 页', kind: 'k3', hit: 0 },
  { id: 'notes', title: '读书摘记', meta: 'Markdown', kind: 'k4', hit: 0 },
]
const files = computed(() => {
  const all = FILES.slice(props.scene.files >= 7 ? 0 : 1).map((file, slot) => ({ ...file, slot }))
  return props.scene.query ? all.filter(file => file.title.includes(props.scene.query) || file.hit) : all
})
</script>

<template>
  <div class="tw-world" :data-look="look" :class="{ forced: scene.look, dark: scene.dark, photo: scene.photo, bare: !scene.chrome }" aria-hidden="true">
    <aside class="tw-side">
      <div class="tw-search"><AppIcon name="search" :size="14" /><i></i></div>
      <p class="tw-row" :class="{ on: scene.view !== 'collection' }"><AppIcon name="library" :size="15" />全部文档</p>
      <p class="tw-row"><AppIcon name="clock" :size="15" />最近阅读</p>
      <p class="tw-row"><AppIcon name="star" :size="15" />收藏</p>
      <p class="tw-row tw-nav-ui" :class="{ on: scene.view === 'collection' }"><AppIcon name="visual" :size="15" />Intelligent UI</p>
      <h6>分组</h6>
      <p class="tw-row"><AppIcon name="folder" :size="15" />线性代数<b v-if="scene.grouped" class="tw-count">1</b></p>
      <p class="tw-row"><AppIcon name="folder" :size="15" />论文</p>
      <h6>书签</h6>
      <p class="tw-mark"><i class="tw-art a0"></i>第 42 页</p>
      <Transition name="tw-fade"><p v-if="scene.mark" class="tw-mark tw-mark-new"><i class="tw-art" :class="`a${scene.art}`"></i>第 87 页</p></Transition>
      <p class="tw-mark"><i class="tw-art a3"></i>第 113 页</p>
      <div class="tw-foot"><span class="tw-set"><AppIcon name="settings" :size="15" />设置</span><span class="tw-dark"><AppIcon :name="scene.dark ? 'sun' : 'moon'" :size="15" /></span></div>
    </aside>

    <header class="tw-top">
      <span class="tw-home"><AppIcon name="library" :size="15" /></span>
      <span class="tw-tab tw-t0" :class="{ on: scene.view === 'reader' && (scene.split || scene.doc === 'algebra') }"><AppIcon name="file" :size="13" />线性代数讲义</span>
      <span class="tw-tab tw-t1" :class="{ on: scene.view === 'reader' && (scene.split || scene.doc === 'paper') }"><AppIcon name="file" :size="13" />Attention Is All You Need</span>
      <span class="tw-clock" :class="scene.clock">
        <template v-if="scene.clock === 'ringing'"><AppIcon class="tw-bell" name="bell" :size="14" />到点了</template>
        <template v-else><svg v-if="scene.clock === 'running'" class="tw-ring-timer" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="6" pathLength="1" stroke-dasharray=".82 1" /></svg><AppIcon v-else name="sun" :size="14" /><small>下午</small>4:44</template>
      </span>
      <span class="tw-icons"><AppIcon class="tw-split" name="split" :size="16" /><AppIcon name="search" :size="16" /><AppIcon class="tw-tr" name="translate" :size="16" /><AppIcon name="sparkle" :size="16" /></span>
    </header>
    <Transition name="tw-pop"><div v-if="scene.clock === 'open'" class="tw-clock-panel">
      <div class="tw-wheel"><span><i>{{ pad(scene.minutes - 5) }}</i><b>{{ pad(scene.minutes) }}</b><i>{{ pad(scene.minutes + 5) }}</i></span><em>:</em><span><i>55</i><b>00</b><i>05</i></span></div>
      <p><span class="tw-start">开始</span><span>定闹钟</span></p>
    </div></Transition>

    <main v-show="scene.view === 'reader'" class="tw-reader" :class="{ wide: !scene.ai, split: scene.split, column: scene.column, hits: scene.find.length > 2 }">
      <div class="tw-bar">
        <template v-if="scene.ink">
          <span v-for="tool in INK" :key="tool.id" class="tw-tool" :class="[`tw-tool-${tool.id}`, { on: scene.ink === tool.id }]"><svg width="15" height="15" viewBox="0 0 24 24"><path :d="tool.d" /></svg></span>
          <i class="tw-sep"></i><i class="tw-dot c1"></i><i class="tw-dot c2"></i><i class="tw-dot c3"></i>
        </template>
        <template v-else>
          <AppIcon class="tw-ol" name="list" :size="15" /><i class="tw-sep"></i><span class="tw-percent">−<b>{{ Math.round(scene.zoom * 100) }}%</b>+</span><i class="tw-sep"></i><AppIcon name="crop" :size="15" /><AppIcon class="tw-inkbtn" name="edit" :size="15" />
        </template>
      </div>
      <Transition name="tw-slide"><div v-if="scene.outline" class="tw-outline"><h6>目录</h6><p v-for="(item, index) in OUTLINE" :key="item" :class="[`tw-ol-${index}`, { on: index === 0 }]">{{ item }}</p></div></Transition>
      <Transition name="tw-pop"><div v-if="scene.finding" class="tw-find"><AppIcon name="search" :size="14" /><span>{{ scene.find }}<i class="tw-caret"></i></span><small v-if="scene.find.length > 2">1 / 9</small></div></Transition>
      <Transition name="tw-slide"><div v-if="scene.column" class="tw-column">
        <header><b>翻译</b><span class="tw-auto" :class="{ on: scene.auto }"><i></i>自动翻译</span></header>
        <div class="tw-entry"><small>{{ TEXT.english }}</small><p>{{ TEXT.chinese }}</p></div>
        <div class="tw-entry"><small>Attention Is All You Need</small><p>注意力就是你所需要的一切</p></div>
      </div></Transition>

      <div class="tw-pages" :style="{ transform: `translateY(${-scene.scroll}px) scale(${scene.zoom})` }">
        <article v-if="scene.split || scene.doc === 'algebra'" class="tw-page algebra">
          <small>第 5 章 · 特征值</small>
          <h1>5.1 <em>特征值</em>与特征向量</h1>
          <p>设 A 是一个 n 阶方阵。上一章我们把 A 看作一次线性变换：它把空间里的每个向量送到另一个向量，方向和长度一般都会改变。</p>
          <p><i class="tw-a"></i><span class="tw-target"><mark>{{ scene.doc === 'algebra' ? picked : '' }}</mark>{{ scene.doc === 'algebra' ? rest : TEXT.sentence }}</span><i class="tw-b"></i>换句话说，A 作用在 v 上的效果只是一次伸缩。</p>
          <p class="tw-math"><span class="tw-ring">det(A − λI) = 0<svg viewBox="0 0 200 60" preserveAspectRatio="none"><path pathLength="1" d="M34 9C84 -3 172 1 190 25C202 49 122 58 62 54C10 50 -6 28 18 13C38 2 92 0 124 5" :style="{ strokeDashoffset: 1 - scene.pen }" /></svg></span></p>
          <p>上式称为 A 的特征方程。它是关于 λ 的 n 次多项式方程，在复数范围内恰有 n 个根（重根按重数计）。求出每个 λ 之后，再解齐次方程组 (A − λI)v = 0，就得到对应的特征向量。</p>
          <p><span class="tw-hl" :style="{ backgroundSize: `${scene.hl * 100}% 100%` }">属于不同<em>特征值</em>的特征向量线性无关。</span>这一点在后面讨论对角化时会反复用到：若 n 阶方阵有 n 个线性无关的特征向量，它就相似于一个对角矩阵。</p>
          <p><span class="tw-ul">定理 5.2　实对称矩阵的<em>特征值</em>都是实数<svg viewBox="0 0 200 8" preserveAspectRatio="none"><path pathLength="1" d="M1 5C30 2 62 7 100 4S170 6 199 3" :style="{ strokeDashoffset: 1 - scene.ul }" /></svg></span>，属于不同特征值的特征向量相互正交。</p>
          <p>例 1　求矩阵 A 的<em>特征值</em>与特征向量。先写出特征多项式并因式分解，得到 λ₁ = 2，λ₂ = 5；再分别代回齐次方程组，各取一个基础解。</p>
          <p>例 2　设 A 的<em>特征值</em>为 1、2、3，求 A² − 2A 的全部<em>特征值</em>。把 A 换成 λ 代入即可。</p>

          <div class="tw-ribbons"><i class="tw-ribbon tw-art a0"></i><Transition name="tw-ribbon"><i v-if="scene.mark" class="tw-ribbon tw-ribbon-new tw-art" :class="`a${scene.art}`"></i></Transition></div>
          <Transition name="tw-pop"><div v-if="scene.markMenu" class="tw-menu tw-mark-menu"><span v-for="(name, index) in ARTS" :key="name" :class="`tw-art-${index}`"><i class="tw-art" :class="`a${index}`"></i>{{ name }}</span><span class="line"><AppIcon name="image" :size="13" />自定义图片…</span></div></Transition>

          <Transition name="tw-card">
            <div v-if="scene.card !== 'none'" class="tw-card" :class="{ pinned: scene.card === 'pinned' }" :style="{ left: `${scene.cardAt.x}px`, top: `${scene.cardAt.y}px` }">
              <div class="tw-card-head"><AppIcon class="tw-spark" name="sparkle" :size="13" /><span><mark>{{ TEXT.sentence.slice(0, 15) }}…</mark></span><b class="tw-pin" :class="{ on: scene.card === 'pinned' }"><AppIcon name="pin" :size="13" /></b></div>
              <i class="tw-rule" :class="{ running: scene.running }"></i>
              <p class="tw-answer">{{ written }}<i v-if="scene.running && scene.words < TEXT.answer.length" class="tw-caret"></i></p>
              <svg v-if="scene.drawn" class="tw-diagram" viewBox="0 0 260 104">
                <path class="axis" d="M14 88H250M44 100V6" />
                <path class="soft" pathLength="1" :d="scaled.shaft" style="--d: 0ms" /><path class="soft head" :d="scaled.head" style="--d: 560ms" />
                <path class="main" pathLength="1" :d="still.v.shaft" style="--d: 120ms" /><path class="main head" :d="still.v.head" style="--d: 520ms" />
                <template v-if="!scene.visual">
                  <path class="other" pathLength="1" :d="still.u.shaft" style="--d: 700ms" /><path class="other head" :d="still.u.head" style="--d: 1040ms" />
                  <path class="other" pathLength="1" :d="still.au.shaft" style="--d: 900ms" /><path class="other head" :d="still.au.head" style="--d: 1240ms" />
                  <path class="turn" pathLength="1" d="M74 34Q112 30 134 60" style="--d: 1080ms" />
                  <text x="52" y="18" style="--d: 1040ms">u</text><text x="162" y="80" style="--d: 1240ms">Au</text>
                </template>
                <text class="t-main" x="104" y="74" style="--d: 520ms">v</text>
                <text class="t-main" :x="scaled.x - 12" :y="scaled.y - 4" text-anchor="end" style="--d: 620ms">Av = λv</text>
              </svg>
              <p v-if="scene.visual && scene.drawn" class="tw-sim"><span>λ</span><i class="tw-track"><i class="tw-knob" :style="{ left: `${(scene.lambda - .5) / 2.5 * 100}%` }"></i></i><b>{{ scene.lambda.toFixed(1) }}</b></p>
              <p class="tw-actions"><AppIcon name="deeper" :size="15" /><AppIcon name="simpler" :size="15" /><AppIcon name="example" :size="15" /><AppIcon name="visual" :size="15" /></p>
            </div>
          </Transition>
        </article>

        <article v-if="scene.split || scene.doc === 'paper'" class="tw-page paper">
          <small>arXiv:1706.03762</small>
          <h1>Attention Is All You Need</h1>
          <p class="tw-by">Vaswani et al. · 2017</p>
          <h2>Abstract</h2>
          <p><i class="tw-a"></i><span class="tw-target"><mark>{{ scene.doc === 'paper' ? picked : '' }}</mark>{{ scene.doc === 'paper' ? rest : TEXT.english }}</span><i class="tw-b"></i> The best performing models also connect the encoder and decoder through an attention mechanism.</p>
          <p>We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.</p>
          <h2>1 Introduction</h2>
          <p>Recurrent neural networks, long short-term memory and gated recurrent neural networks in particular, have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation.</p>
          <p>Attention mechanisms have become an integral part of compelling sequence modeling and transduction models in various tasks, allowing modeling of dependencies without regard to their distance in the input or output sequences.</p>
          <Transition name="tw-card"><div v-if="scene.pop" class="tw-trans" :style="{ left: `${scene.cardAt.x}px`, top: `${scene.cardAt.y}px` }">{{ scene.auto ? TEXT.chinese : TEXT.chinese.slice(0, scene.words) }}</div></Transition>
        </article>
      </div>
    </main>

    <Transition name="tw-view">
      <section v-if="scene.view === 'library'" class="tw-lib">
        <header><h2>全部文档<small>{{ files.length }}</small></h2><span class="tw-lib-search" :class="{ typed: scene.query }"><AppIcon name="search" :size="14" /><em>{{ scene.query || '搜索标题、标签或已索引内容' }}</em><i v-if="scene.query" class="tw-caret"></i></span></header>
        <TransitionGroup tag="div" class="tw-grid" name="tw-file">
          <div v-for="file in files" :key="file.id" class="tw-file" :class="`tw-file-${file.slot}`">
            <i class="tw-cover" :class="file.kind"><b></b><b></b><b></b></i>
            <p>{{ file.title }}</p><small>{{ file.meta }}<template v-if="scene.query && file.hit"> · 正文 {{ file.hit }} 处</template></small>
            <AppIcon class="tw-star" :class="{ on: scene.starred && file.id === 'algebra' }" name="star" :size="14" />
            <span v-if="scene.grouped && file.id === 'algebra'" class="tw-tag">线性代数</span>
          </div>
        </TransitionGroup>
        <Transition name="tw-pop"><div v-if="scene.fileMenu" class="tw-menu tw-file-menu"><span class="tw-fm-group"><AppIcon name="folder" :size="13" />放进分组：线性代数</span><span><AppIcon name="star" :size="13" />收藏</span><span class="line"><AppIcon name="trash" :size="13" />移出文库</span></div></Transition>
      </section>
      <section v-else-if="scene.view === 'collection'" class="tw-lib">
        <header><h2>Intelligent UI<small>3</small></h2></header>
        <div class="tw-grid three">
          <div class="tw-ui"><svg viewBox="0 0 260 104"><path class="axis" d="M14 88H250M44 100V6" /><path class="soft" :d="scaled.shaft" /><path class="soft" :d="scaled.head" /><path class="main" :d="still.v.shaft" /><path class="main" :d="still.v.head" /></svg><p>特征向量的方向</p><small>线性代数讲义 · 第 87 页</small></div>
          <div class="tw-ui"><svg viewBox="0 0 260 104"><path class="axis" d="M14 88H250M24 96V8" /><path class="main" d="M24 20C70 22 90 70 140 76S220 84 250 85" /><path class="other" d="M24 30C80 36 110 60 160 66S226 72 250 73" /></svg><p>损失随迭代下降</p><small>机器学习导论 · 第 131 页</small></div>
          <div class="tw-ui"><svg viewBox="0 0 260 104"><path class="axis" d="M20 22H240M20 44H240M20 66H240M20 88H240M96 10V96M168 10V96" /><path class="main" d="M34 33h44M34 55h36M34 77h48" /><path class="other" d="M110 33h40M110 55h44M110 77h30M182 33h44M182 55h30M182 77h40" /></svg><p>三种矩阵分解对比</p><small>线性代数讲义 · 第 204 页</small></div>
        </div>
      </section>
    </Transition>
    <div v-if="scene.ghost" class="tw-ghost" :style="{ left: `${scene.ghost.x}px`, top: `${scene.ghost.y}px` }"><AppIcon name="file" :size="14" />特征值专题讲义.pdf</div>

    <Transition name="tw-ai">
      <aside v-if="scene.ai && scene.view === 'reader'" class="tw-ai" :class="{ side: scene.side }">
        <div class="tw-main">
          <header><AppIcon name="sparkle" :size="15" /><b>阅读助手</b><span v-if="scene.branch" class="tw-chip"><AppIcon name="branch" :size="12" />分支</span><AppIcon class="tw-history" name="history" :size="14" /></header>
          <div class="tw-chat">
            <template v-if="scene.asked">
              <p class="tw-me">{{ TEXT.question }}</p>
              <p class="tw-say">{{ reply[0] }}<span class="tw-q" :class="{ on: scene.quote }">{{ reply[1] }}</span>{{ reply[2] }}</p>
              <p v-if="scene.answer >= replyLength" class="tw-meta"><AppIcon name="copy" :size="13" /><AppIcon name="retry" :size="13" /><AppIcon class="tw-branch" name="branch" :size="13" /></p>
              <Transition name="tw-pop"><div v-if="scene.quotePop" class="tw-menu tw-quote"><span><AppIcon name="append" :size="13" />引用到输入框</span><span class="tw-quote-side"><AppIcon name="branch" :size="13" />在侧边对话提问</span></div></Transition>
              <Transition name="tw-fade"><p v-if="scene.branch" class="tw-note"><AppIcon name="branch" :size="12" />新分支从这条回答开始，原对话在对话记录里</p></Transition>
            </template>
            <div v-else class="tw-empty"><AppIcon name="sparkle" :size="22" /><span>总结这一页</span><span>这个公式怎么来的</span></div>
          </div>
          <Transition name="tw-pop"><div v-if="scene.btw" class="tw-btw"><p><b>/btw</b>{{ TEXT.btwAsk }}</p><p>{{ TEXT.btwReply.slice(0, scene.btwAnswer) }}</p></div></Transition>
          <Transition name="tw-pop"><div v-if="scene.commands" class="tw-menu tw-cmds"><span class="tw-cmd-btw"><b>/btw</b>顺便问一句</span><span><b>/compress</b>压缩对话</span><span><b>/usage</b>查看用量</span></div></Transition>
          <div class="tw-ask" :class="{ typed: scene.draft }"><span>{{ scene.draft || '问问这一页' }}<i v-if="scene.draft" class="tw-caret"></i></span><b class="tw-send"><AppIcon name="arrow-up" :size="14" /></b></div>
        </div>
        <div v-if="scene.side" class="tw-sidechat">
          <header><span class="tw-chip"><AppIcon name="branch" :size="12" />附属对话</span></header>
          <p class="tw-quoted">{{ TEXT.reply[1] }}</p>
          <p v-if="scene.sideAsk" class="tw-me">{{ scene.sideAsk }}</p>
          <p class="tw-say">{{ TEXT.sideReply.slice(0, scene.sideAnswer) }}</p>
        </div>
      </aside>
    </Transition>

    <Transition name="tw-dialog">
      <section v-if="scene.settings" class="tw-dialog">
        <h3>设置</h3>
        <nav><span :class="{ on: scene.settings === 'look' }"><AppIcon name="sun" :size="14" />外观</span><span><AppIcon name="book" :size="14" />阅读</span><span><AppIcon name="settings" :size="14" />快捷键</span><span :class="{ on: scene.settings === 'ai' }"><AppIcon name="sparkle" :size="14" />AI</span><span><AppIcon name="import" :size="14" />更新</span></nav>
        <div v-if="scene.settings === 'ai'" class="tw-pane">
          <h5><i>1</i>连接服务</h5>
          <div class="tw-links">
            <span class="tw-link tw-link-deepseek" :class="{ on: scene.key >= 20, open: scene.link }"><i></i>DeepSeek<small>{{ scene.key >= 20 ? '已填密钥' : '未连接' }}</small></span>
            <span v-for="name in SERVICES" :key="name" class="tw-link"><i></i>{{ name }}<small>未连接</small></span>
            <span class="tw-link tw-link-codex" :class="{ on: scene.codex }"><i></i>Codex<small>{{ scene.codex ? '已登录' : '未检查' }}</small></span>
          </div>
          <div v-if="scene.link" class="tw-key"><small>API Key</small><span>{{ '•'.repeat(scene.key) }}<i v-if="scene.key < 20" class="tw-caret"></i></span></div>
          <h5><i>2</i>每个功能用哪个模型</h5>
          <div class="tw-slots">
            <div v-for="slot in SLOTS" :key="slot.id" class="tw-slot" :class="`tw-slot-${slot.id}`">
              <p><b>{{ slot.label }}</b><small>{{ slot.note }}</small></p>
              <span class="tw-select" :class="{ set: scene.slots[slot.id] !== '未选择' }">{{ scene.slots[slot.id] }}<AppIcon name="down" :size="12" /></span>
              <div v-if="scene.menu === slot.id" class="tw-menu tw-options"><span v-for="(model, index) in MODELS" :key="model" :class="[`tw-opt-${index}`, { dim: index > 1 }]">{{ model }}</span></div>
            </div>
            <div class="tw-slot"><p><b>可视化讲解</b><small>快速解释里的 Intelligent UI</small></p><span class="tw-select set">跟阅读助手一样<AppIcon name="down" :size="12" /></span></div>
          </div>
        </div>
        <div v-else class="tw-pane">
          <h5>界面风格</h5>
          <div class="tw-styles"><span v-for="item in STYLES" :key="item.id" class="tw-style" :class="[`tw-style-${item.id}`, { on: look === item.id }]"><i :class="item.id"><b></b><b></b></i>{{ item.label }}</span></div>
          <h5>底板</h5>
          <div class="tw-bgs"><i v-for="index in 5" :key="index" :class="[`tw-bg-${index - 1}`, { on: (scene.photo ? 2 : 0) === index - 1 }]"></i></div>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.tw-world{--tw-bg:var(--canvas);--tw-radius:16px;position:absolute;left:0;top:0;width:1280px;height:800px;transform-origin:0 0;overflow:hidden;background:var(--tw-bg);color:var(--ink);font-size:13px;line-height:1.4;user-select:none;pointer-events:none;transition:background .45s var(--ease-soft),color .45s var(--ease-soft)}
.tw-world p,.tw-world h1,.tw-world h2,.tw-world h3,.tw-world h5,.tw-world h6{margin:0}
.tw-world i,.tw-world em{font-style:normal}
.tw-side,.tw-top,.tw-ai,.tw-dialog,.tw-bar,.tw-lib{transition:background-color .45s var(--ease-soft),border-color .45s var(--ease-soft),border-radius .45s var(--ease-soft),translate .5s var(--ease-out),opacity .4s var(--ease-out)}

/* ---- 外观一课：临时换一套颜色 ---- */
.tw-world.forced[data-look='glass']{--tw-bg:linear-gradient(135deg,#e9eef4,#dfe7f1 55%,#e8e3f0);--surface:rgb(255 255 255 / .76);--sidebar:rgb(255 255 255 / .7);--popup-glass:#fbfcfd;--ink:#1b1f26;--secondary:#4a5361;--muted:#6a7381;--line-soft:rgb(60 72 92 / .1);--glass-outline:rgb(28 40 48 / .13);--accent:#3b6fe0;--selection-solid:#cfe0ff;font-family:'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',system-ui,sans-serif}
.tw-world.forced[data-look='crystal']{--tw-bg:linear-gradient(135deg,#d6e6f2,#e6eef6 50%,#d9e2f3);--surface:rgb(255 255 255 / .5);--sidebar:rgb(255 255 255 / .44);--popup-glass:#f7fbfe;--ink:#17202a;--secondary:#435061;--muted:#64748a;--line-soft:rgb(60 90 120 / .12);--glass-outline:rgb(255 255 255 / .95);--accent:#1f8fd6;--selection-solid:#c8e4f8;--tw-radius:22px;font-family:'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',system-ui,sans-serif}
.tw-world.forced[data-look='warm']{--tw-bg:#f3efe6;--surface:#faf9f5;--sidebar:#f7f4ec;--popup-glass:#faf9f5;--ink:#3d2e1e;--secondary:#5e5040;--muted:#857660;--line-soft:rgb(61 46 30 / .1);--glass-outline:rgb(61 46 30 / .18);--accent:#c96442;--selection-solid:#f1d9b8;--tw-radius:8px;font-family:Georgia,'Source Han Serif SC','Songti SC',SimSun,serif}
.tw-world.forced[data-look='sketch']{--tw-bg:#efe9db;--surface:#fbf8f0;--sidebar:#fbf8f0;--popup-glass:#fbf8f0;--ink:#2e2d2a;--secondary:#4a4741;--muted:#6b675e;--line-soft:rgb(46 45 42 / .18);--glass-outline:rgb(46 45 42 / .72);--accent:#c8553d;--selection-solid:#fbe691;font-family:'Caveat','Ma Shan Zheng','Long Cang',KaiTi,STKaiti,cursive}
.tw-world.forced.dark{--tw-bg:#17181b;--surface:#26272b;--sidebar:#222327;--popup-glass:#2c2d31;--ink:#ececee;--secondary:#c5c6cb;--muted:#9a9ca3;--line-soft:rgb(255 255 255 / .09);--glass-outline:rgb(255 255 255 / .16);--selection-solid:#3a4a6b}
.tw-world.forced.photo{--tw-bg:linear-gradient(135deg,#f3cdb6,#cdb9e6 48%,#9cc3ea)}
.tw-world.forced.photo.dark{--tw-bg:linear-gradient(135deg,#4a3140,#2f3157 48%,#1e3a55)}
.tw-world[data-look='sketch'] :is(.tw-side,.tw-top,.tw-ai,.tw-card,.tw-dialog,.tw-trans,.tw-menu,.tw-bar,.tw-clock-panel){border-width:1.5px}
.tw-world[data-look='sketch'] .tw-side{border-radius:16px 22px 18px 20px / 20px 16px 22px 17px}
.tw-world[data-look='sketch'] .tw-ai{border-radius:20px 16px 22px 17px / 16px 22px 18px 20px}
.tw-world[data-look='sketch'] .tw-card{border-radius:13px 17px 14px 18px / 17px 13px 18px 14px;box-shadow:3px 4px 0 color-mix(in srgb,var(--ink) 20%,transparent)}
.tw-world[data-look='sketch'] .tw-card.pinned{box-shadow:2px 2px 0 color-mix(in srgb,var(--ink) 26%,transparent)}
.tw-world[data-look='sketch'] .tw-dialog{rotate:-.4deg;box-shadow:4px 6px 0 color-mix(in srgb,var(--ink) 16%,transparent)}

/* ---- 侧栏 ---- */
.tw-side{position:absolute;left:14px;top:14px;bottom:14px;width:196px;display:flex;flex-direction:column;gap:3px;padding:14px 12px;border:1px solid var(--glass-outline);border-radius:var(--tw-radius);background:var(--sidebar,var(--surface))}
.tw-search{display:flex;align-items:center;gap:8px;height:32px;margin-bottom:8px;padding:0 10px;border:1px solid var(--line-soft);border-radius:999px;color:var(--muted)}
.tw-search i{flex:1;height:1px;background:var(--line-soft)}
.tw-row{display:flex;align-items:center;gap:9px;height:34px;padding:0 10px;border-radius:10px;color:var(--secondary);transition:background-color .25s}
.tw-row.on{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink);font-weight:600}
.tw-count{margin-left:auto;min-width:18px;height:18px;border-radius:9px;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);font-size:11px;line-height:18px;text-align:center;animation:tw-bump .4s var(--ease-spring)}
@keyframes tw-bump{from{scale:.3;opacity:0}}
.tw-side h6{margin:14px 10px 4px;color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.08em}
.tw-mark{display:flex;align-items:center;gap:9px;height:28px;padding:0 10px;color:var(--secondary);font-size:12px}
.tw-mark .tw-art{width:24px;height:10px;clip-path:polygon(0 0,100% 0,82% 50%,100% 100%,0 100%)}
.tw-art.a0{background:linear-gradient(90deg,#e9e3d5 0 30%,#16171a 30% 52%,#e9e3d5 52% 64%,#c8372d 64% 78%,#e9e3d5 78%)}
.tw-art.a1{background:linear-gradient(90deg,#d8232a 0 28%,#111 28% 32%,#f4f1e8 32% 62%,#111 62% 66%,#1f4fa3 66% 84%,#111 84% 88%,#f2c318 88%)}
.tw-art.a2{background:linear-gradient(90deg,#1f3a5f,#3f6b8c 52%,#e8dcc0 52% 60%,#274a6e 60%)}
.tw-art.a3{background:linear-gradient(90deg,#e8b923 0 33%,#c8372d 33% 66%,#1f4fa3 66%)}
.tw-foot{display:flex;align-items:center;margin-top:auto;padding-top:10px;border-top:1px solid var(--line-soft);color:var(--secondary)}
.tw-set{display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border:1px solid var(--line-soft);border-radius:999px}
.tw-dark{display:grid;place-items:center;width:32px;height:32px;margin-left:auto;border:1px solid var(--line-soft);border-radius:50%}

/* ---- 顶栏 ---- */
.tw-top{position:absolute;left:224px;right:14px;top:14px;height:46px;display:flex;align-items:center;gap:6px;padding:0 14px 0 8px;border:1px solid var(--glass-outline);border-radius:calc(var(--tw-radius) - 2px);background:var(--surface)}
.tw-home{display:grid;place-items:center;width:32px;height:30px;color:var(--secondary)}
.tw-tab{display:flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:9px;color:var(--muted);font-size:12.5px;transition:background-color .25s,color .25s}
.tw-tab.on{background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink);font-weight:600}
.tw-clock{display:flex;align-items:center;gap:6px;height:30px;margin-left:auto;padding:0 12px;border:1px solid var(--line-soft);border-radius:999px;color:var(--ink);font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;transition:background-color .3s,color .3s,border-color .3s}
.tw-clock small{color:var(--muted);font-size:10.5px;font-weight:500}
.tw-clock.open{background:color-mix(in srgb,var(--ink) 7%,transparent)}
.tw-clock.ringing{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.tw-bell{animation:tw-ring .5s ease-in-out infinite;transform-origin:50% 10%}
@keyframes tw-ring{25%{rotate:16deg}75%{rotate:-16deg}}
.tw-ring-timer circle{fill:none;stroke:color-mix(in srgb,var(--ink) 16%,transparent);stroke-width:2}
.tw-ring-timer circle+circle{stroke:var(--accent);stroke-linecap:round;rotate:-90deg;transform-origin:50% 50%}
.tw-icons{display:flex;gap:14px;margin-left:12px;color:var(--secondary)}
.tw-clock-panel{position:absolute;right:112px;top:68px;z-index:6;width:190px;padding:14px 16px 12px;border:1px solid var(--glass-outline);border-radius:18px;background:var(--popup-glass,var(--surface));box-shadow:0 22px 50px -20px rgb(0 0 0 / .45)}
.tw-wheel{display:flex;align-items:center;justify-content:center;gap:10px;font-variant-numeric:tabular-nums}
.tw-wheel span{display:grid;justify-items:center;gap:2px}
.tw-wheel b{font:300 34px/1.1 var(--font-display,inherit);letter-spacing:.02em}
.tw-wheel i{color:var(--muted);font-size:13px;opacity:.5}
.tw-wheel em{font-size:26px;font-weight:300;color:var(--muted)}
.tw-clock-panel p{display:flex;gap:8px;margin-top:12px}
.tw-clock-panel p span{flex:1;height:30px;border:1px solid var(--line-soft);border-radius:999px;font-size:12px;font-weight:600;line-height:28px;text-align:center}
.tw-clock-panel .tw-start{border-color:transparent;background:var(--ink);color:var(--surface)}

/* ---- 阅读区 ---- */
.tw-reader{position:absolute;left:224px;right:330px;top:72px;bottom:0;overflow:hidden;transition:right .45s var(--ease-out),left .5s var(--ease-out),top .5s var(--ease-out)}
.tw-reader.wide{right:14px}
.tw-bar{position:absolute;left:50%;top:4px;z-index:4;display:flex;align-items:center;gap:12px;height:34px;padding:0 14px;border:1px solid var(--glass-outline);border-radius:999px;background:var(--surface);color:var(--secondary);translate:-50% 0;box-shadow:0 8px 22px -14px rgb(0 0 0 / .4)}
.tw-sep{width:1px;height:14px;background:var(--line-soft)}
.tw-percent{display:flex;align-items:center;gap:8px;font-size:12px;font-variant-numeric:tabular-nums}
.tw-percent b{min-width:36px;font-weight:600;text-align:center;color:var(--ink)}
.tw-tool{display:grid;place-items:center;width:28px;height:26px;border-radius:8px;transition:background-color .2s,color .2s}
.tw-tool svg{fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
.tw-tool.on{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
.tw-dot{width:12px;height:12px;border-radius:50%}
.tw-dot.c1{background:#f2c94c;box-shadow:0 0 0 2px var(--surface),0 0 0 3px #f2c94c}.tw-dot.c2{background:#e2574c}.tw-dot.c3{background:#3b6fe0}
.tw-outline{position:absolute;left:10px;top:46px;z-index:5;width:210px;padding:12px;border:1px solid var(--glass-outline);border-radius:14px;background:var(--popup-glass,var(--surface));box-shadow:0 22px 50px -22px rgb(0 0 0 / .45)}
.tw-outline h6{margin:0 8px 6px;color:var(--muted);font-size:11px;letter-spacing:.08em}
.tw-outline p{padding:6px 8px;border-radius:8px;color:var(--secondary);font-size:12.5px}
.tw-outline p.on{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink)}
.tw-find{position:absolute;right:18px;top:46px;z-index:5;display:flex;align-items:center;gap:8px;width:230px;height:36px;padding:0 12px;border:1px solid var(--glass-outline);border-radius:999px;background:var(--popup-glass,var(--surface));color:var(--muted);box-shadow:0 18px 40px -20px rgb(0 0 0 / .45)}
.tw-find span{flex:1;color:var(--ink)}
.tw-find small{font-variant-numeric:tabular-nums}
.tw-column{position:absolute;left:10px;top:46px;bottom:14px;z-index:3;width:290px;padding:14px;border:1px solid var(--glass-outline);border-radius:var(--tw-radius);background:var(--surface)}
.tw-column header{display:flex;align-items:center;margin-bottom:12px}
.tw-auto{display:flex;align-items:center;gap:7px;margin-left:auto;color:var(--muted);font-size:12px}
.tw-auto i{position:relative;width:28px;height:16px;border-radius:8px;background:color-mix(in srgb,var(--ink) 18%,transparent);transition:background-color .25s}
.tw-auto i::after{content:'';position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#fff;transition:translate .25s var(--ease-spring)}
.tw-auto.on{color:var(--ink)}.tw-auto.on i{background:var(--accent)}.tw-auto.on i::after{translate:12px 0}
.tw-entry{padding:10px 0;border-top:1px solid var(--line-soft)}
.tw-entry small{display:block;margin-bottom:6px;color:var(--muted);font-size:11.5px;line-height:1.5}
.tw-entry p{font-size:13px;line-height:1.65}
.tw-pages{display:flex;justify-content:center;align-items:flex-start;gap:22px;padding-top:52px;transform-origin:50% 0;transition:padding-left .45s var(--ease-out)}
.tw-reader.column .tw-pages{padding-left:300px}
.tw-reader.split .tw-page{zoom:.8}
.tw-page{position:relative;flex:none;width:600px;min-height:940px;padding:52px 62px 60px;border-radius:3px;background:#fffefb;color:#23252b;box-shadow:0 1px 2px rgb(0 0 0 / .08),0 14px 40px -18px rgb(0 0 0 / .28);font:15px/1.95 Georgia,'Source Han Serif SC','Noto Serif CJK SC','Songti SC',SimSun,serif;animation:tw-page .4s var(--ease-out)}
@keyframes tw-page{from{opacity:0;translate:0 10px}}
.tw-page small{color:#8a8d96;font-size:11.5px;letter-spacing:.12em}
.tw-page h1{margin:6px 0 16px;font-size:23px;font-weight:600;line-height:1.4;letter-spacing:.01em}
.tw-page h2{margin:14px 0 6px;font-size:15px;font-weight:700}
.tw-page p{margin-bottom:12px;text-align:justify}
.tw-page.paper{line-height:1.7}
.tw-page .tw-by{color:#8a8d96;font-size:13px}
.tw-page .tw-math{margin:18px 0;text-align:center;font-style:italic;font-size:16px;letter-spacing:.04em}
.tw-a,.tw-b{display:inline-block;width:0;height:1em;vertical-align:-.12em}
.tw-target mark{background:var(--selection-solid,#cfe0ff);color:inherit}
.tw-page em{border-radius:2px;transition:background-color .2s}
.tw-reader.hits .tw-page em{background:#ffe27a}
.tw-ring{position:relative;display:inline-block;padding:0 6px}
.tw-ring svg{position:absolute;inset:-9px -16px;width:calc(100% + 32px);height:calc(100% + 18px);overflow:visible}
.tw-ring path,.tw-ul path{fill:none;stroke:#e2574c;stroke-width:1.8;stroke-linecap:round;stroke-dasharray:1}
.tw-hl{background:linear-gradient(#ffe27a,#ffe27a) 0 60% / 0 100% no-repeat}
.tw-ul{position:relative;display:inline-block}
.tw-ul svg{position:absolute;left:0;bottom:1px;width:100%;height:7px;overflow:visible}
.tw-ul path{stroke:#3b6fe0}
.tw-ribbons{position:absolute;right:-30px;top:84px;display:grid;gap:8px}
.tw-ribbon{display:block;width:44px;height:17px;clip-path:polygon(0 0,100% 0,84% 50%,100% 100%,0 100%);filter:drop-shadow(0 2px 3px rgb(0 0 0 / .3))}
.tw-ribbon-new{transition:background .35s}
.tw-ribbon-enter-active{transition:translate .5s var(--ease-spring),opacity .25s}
.tw-ribbon-enter-from{translate:-40px 0;opacity:0}

/* ---- 解释卡、译文 ---- */
.tw-card,.tw-trans{position:absolute;z-index:2;width:310px;padding:11px 14px 12px;border:1px solid var(--glass-outline);border-radius:14px;background:var(--popup-glass,var(--surface));box-shadow:0 18px 44px -18px rgb(0 0 0 / .42),0 2px 6px rgb(0 0 0 / .08);color:var(--ink);font:13.5px/1.62 var(--font-ui,system-ui);text-align:left;transform-origin:40% 0;transition:box-shadow .5s var(--ease-out),translate .45s var(--ease-spring),rotate .45s var(--ease-spring)}
.tw-world.forced :is(.tw-card,.tw-trans){font-family:inherit}
.tw-trans{width:330px}
.tw-card.pinned{box-shadow:0 8px 22px -12px rgb(0 0 0 / .34),0 1px 3px rgb(0 0 0 / .1),0 0 0 1px color-mix(in srgb,var(--accent) 38%,transparent);translate:0 3px;rotate:-.5deg}
.tw-card-enter-active{transition:opacity .22s var(--ease-out),scale .42s var(--ease-spring)}
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
.tw-card .tw-answer{min-height:66px;margin:0;text-align:left}
.tw-caret{display:inline-block;width:1.5px;height:1em;margin-left:2px;vertical-align:-.14em;background:var(--accent);animation:tw-blink .9s steps(2) infinite}
@keyframes tw-blink{50%{opacity:0}}
.tw-diagram{display:block;width:100%;height:auto;margin:6px 0 2px;overflow:visible;animation:tw-unfold .4s var(--ease-out) both}
@keyframes tw-unfold{from{max-height:0;opacity:0}to{max-height:130px;opacity:1}}
.tw-diagram path,.tw-ui path{fill:none;stroke-linecap:round;stroke-linejoin:round}
:is(.tw-diagram,.tw-ui) .axis{stroke:color-mix(in srgb,var(--ink) 16%,transparent);stroke-width:1}
:is(.tw-diagram,.tw-ui) .main{stroke:var(--accent);stroke-width:2}
:is(.tw-diagram,.tw-ui) .soft{stroke:color-mix(in srgb,var(--accent) 42%,transparent);stroke-width:2}
:is(.tw-diagram,.tw-ui) .other{stroke:color-mix(in srgb,var(--ink) 46%,transparent);stroke-width:1.4}
.tw-diagram .turn{stroke:color-mix(in srgb,var(--ink) 30%,transparent);stroke-width:1}
.tw-diagram path[pathLength]{stroke-dasharray:1;stroke-dashoffset:1;animation:tw-draw .5s var(--ease-soft) calc(var(--d) * .7 + .2s) both}
.tw-diagram .head,.tw-diagram text{animation:tw-appear .26s var(--ease-out) calc(var(--d) * .7 + .2s) both}
@keyframes tw-draw{to{stroke-dashoffset:0}}
@keyframes tw-appear{from{opacity:0}}
.tw-diagram text{fill:var(--muted);font:italic 12px Georgia,serif}
.tw-diagram .t-main{fill:var(--accent)}
.tw-card .tw-sim{display:flex;align-items:center;gap:10px;margin:4px 0 2px;font:italic 13px Georgia,serif;color:var(--muted);animation:tw-appear .3s var(--ease-out) .5s both}
.tw-sim b{min-width:26px;color:var(--ink);font-style:normal;font-weight:600;font-variant-numeric:tabular-nums}
.tw-track{position:relative;flex:1;height:2px;border-radius:1px;background:color-mix(in srgb,var(--ink) 16%,transparent)}
.tw-knob{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border:1.5px solid var(--accent);border-radius:50%;background:var(--popup-glass,#fff);box-shadow:0 2px 6px rgb(0 0 0 / .2)}
.tw-card .tw-actions{display:inline-flex;gap:13px;margin:8px 0 0;padding:5px 11px;border-radius:999px;background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--muted)}

/* ---- 菜单 ---- */
.tw-menu{position:absolute;z-index:8;display:grid;gap:1px;min-width:150px;padding:5px;border:1px solid var(--glass-outline);border-radius:12px;background:var(--popup-glass,var(--surface));box-shadow:0 22px 50px -20px rgb(0 0 0 / .5),0 2px 6px rgb(0 0 0 / .08);color:var(--ink);font:12.5px/1.3 var(--font-ui,system-ui);text-align:left;white-space:nowrap}
.tw-world.forced .tw-menu{font-family:inherit}
.tw-menu span{display:flex;align-items:center;gap:8px;height:28px;padding:0 9px;border-radius:7px}
.tw-menu span.dim{color:var(--muted);opacity:.6}
.tw-menu span.line{margin-top:3px;border-top:1px solid var(--line-soft);border-radius:0 0 7px 7px;color:var(--secondary)}
.tw-menu b{color:var(--accent);font-weight:600}
.tw-menu .tw-art{width:26px;height:11px;clip-path:polygon(0 0,100% 0,82% 50%,100% 100%,0 100%)}
.tw-mark-menu{right:8px;top:118px}
.tw-file-menu{left:420px;top:178px}
.tw-options{left:14px;right:14px;top:calc(100% - 8px)}
.tw-quote{left:26px;top:150px}
.tw-cmds{left:0;right:0;bottom:52px}
.tw-cmds span{height:32px}
.tw-cmds b{min-width:74px}

/* ---- 文库、合集 ---- */
.tw-lib{position:absolute;left:224px;right:14px;top:72px;bottom:14px;padding:22px 26px;border:1px solid var(--glass-outline);border-radius:var(--tw-radius);background:var(--surface);overflow:hidden}
.tw-lib header{display:flex;align-items:center;margin-bottom:20px}
.tw-lib h2{display:flex;align-items:baseline;gap:10px;font:600 22px/1.2 var(--font-display,inherit)}
.tw-lib h2 small{color:var(--muted);font-size:13px;font-weight:500}
.tw-lib-search{display:flex;align-items:center;gap:8px;width:280px;height:36px;margin-left:auto;padding:0 14px;border:1px solid var(--line-soft);border-radius:999px;color:var(--muted);font-size:12.5px;transition:border-color .2s}
.tw-lib-search.typed{border-color:var(--accent);color:var(--ink)}
.tw-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.tw-grid.three{grid-template-columns:repeat(3,1fr)}
.tw-file{position:relative;padding:12px;border:1px solid var(--line-soft);border-radius:14px}
.tw-file p{margin-top:10px;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tw-file small{color:var(--muted);font-size:11.5px}
.tw-cover{display:grid;align-content:center;gap:9px;height:128px;padding:0 22px;border-radius:8px}
.tw-cover b{height:1px;background:rgb(255 255 255 / .7)}.tw-cover b:nth-child(2){width:70%}.tw-cover b:nth-child(3){width:44%}
.tw-cover.k1{background:linear-gradient(150deg,#3f5f8a,#274266)}.tw-cover.k2{background:linear-gradient(150deg,#8a5a44,#5e3b2c)}.tw-cover.k3{background:linear-gradient(150deg,#4f7a68,#2f5446)}.tw-cover.k4{background:linear-gradient(150deg,#77708f,#4c4763)}
.tw-star{position:absolute;right:12px;bottom:14px;color:var(--muted);opacity:.5;transition:color .2s,opacity .2s,scale .35s var(--ease-spring)}
.tw-star.on{color:#e0a100;fill:#f2c94c;opacity:1;scale:1.25}
.tw-tag{position:absolute;left:20px;top:20px;padding:2px 8px;border-radius:999px;background:rgb(255 255 255 / .9);color:#23252b;font-size:11px;font-weight:600;animation:tw-bump .4s var(--ease-spring)}
.tw-file-enter-active,.tw-file-leave-active,.tw-file-move{transition:opacity .3s var(--ease-out),scale .42s var(--ease-spring),transform .42s var(--ease-out)}
.tw-file-enter-from,.tw-file-leave-to{opacity:0;scale:.82}
.tw-file-leave-active{position:absolute;width:232px}
.tw-ghost{position:absolute;z-index:9;display:flex;align-items:center;gap:7px;height:34px;margin:10px 0 0 14px;padding:0 13px;border:1px solid var(--glass-outline);border-radius:10px;background:var(--popup-glass,var(--surface));box-shadow:0 18px 40px -16px rgb(0 0 0 / .5);font-size:12.5px;font-weight:600;rotate:-4deg}
.tw-ui{padding:16px;border:1px solid var(--line-soft);border-radius:14px;animation:tw-page .45s var(--ease-out) both}
.tw-ui:nth-child(2){animation-delay:.08s}.tw-ui:nth-child(3){animation-delay:.16s}
.tw-ui svg{display:block;width:100%;margin-bottom:10px}
.tw-ui p{font-size:13px;font-weight:600}.tw-ui small{color:var(--muted);font-size:11.5px}
.tw-view-enter-active{transition:opacity .3s var(--ease-out),translate .4s var(--ease-out)}
.tw-view-enter-from{opacity:0;translate:0 12px}

/* ---- 阅读助手 ---- */
.tw-ai{position:absolute;right:14px;top:72px;bottom:14px;z-index:3;display:flex;gap:12px;width:302px;padding:16px;border:1px solid var(--glass-outline);border-radius:var(--tw-radius);background:var(--surface);transition:width .45s var(--ease-out),background-color .45s,border-color .45s,top .5s var(--ease-out)}
.tw-ai.side{width:580px;box-shadow:-20px 0 50px -30px rgb(0 0 0 / .4)}
.tw-ai-enter-active,.tw-ai-leave-active{transition:translate .4s var(--ease-out),opacity .3s}
.tw-ai-enter-from,.tw-ai-leave-to{translate:60px 0;opacity:0}
.tw-main{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
.tw-ai header{display:flex;align-items:center;gap:8px;height:22px}
.tw-main header>svg:first-child{color:var(--accent)}
.tw-history{margin-left:auto;color:var(--muted)}
.tw-chip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 13%,transparent);color:var(--accent);font-size:11px;font-weight:600;animation:tw-bump .4s var(--ease-spring)}
.tw-chat{position:relative;flex:1;display:flex;flex-direction:column;gap:10px;min-height:0}
.tw-me{align-self:flex-end;max-width:86%;padding:8px 12px;border-radius:14px 14px 4px 14px;background:color-mix(in srgb,var(--ink) 7%,transparent);font-size:13px;animation:tw-page .3s var(--ease-out)}
.tw-say{font-size:13px;line-height:1.7;min-height:1.7em}
.tw-q{border-radius:2px;transition:background-color .15s}
.tw-q.on{background:var(--selection-solid,#cfe0ff)}
.tw-meta{display:flex;gap:12px;color:var(--muted);animation:tw-appear .3s}
.tw-note{display:flex;align-items:center;gap:6px;padding:7px 10px;border:1px dashed var(--line-soft);border-radius:10px;color:var(--muted);font-size:11.5px}
.tw-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--muted)}
.tw-empty svg{margin-bottom:8px;opacity:.5}
.tw-empty span{padding:6px 14px;border:1px solid var(--line-soft);border-radius:999px;font-size:12px}
.tw-btw{position:absolute;left:0;right:0;bottom:54px;padding:10px 12px;border:1px solid var(--glass-outline);border-radius:12px;background:var(--popup-glass,var(--surface));box-shadow:0 16px 36px -18px rgb(0 0 0 / .45);font-size:12.5px;line-height:1.6;rotate:-.6deg}
.tw-btw p:first-child{display:flex;gap:8px;margin-bottom:4px;font-weight:600}
.tw-btw b{color:var(--accent)}
.tw-ask{display:flex;align-items:center;height:44px;padding:0 7px 0 15px;border:1px solid var(--glass-outline);border-radius:999px;color:var(--muted);transition:border-color .2s}
.tw-ask.typed{border-color:color-mix(in srgb,var(--accent) 60%,transparent);color:var(--ink)}
.tw-ask span{white-space:nowrap;overflow:hidden}
.tw-send{display:grid;place-items:center;flex:none;width:30px;height:30px;margin-left:auto;border-radius:50%;background:var(--ink);color:var(--surface)}
.tw-sidechat{flex:0 0 250px;display:flex;flex-direction:column;gap:10px;padding-left:12px;border-left:1px solid var(--line-soft);animation:tw-page .4s var(--ease-out)}
.tw-quoted{align-self:flex-start;padding:3px 9px;border-left:2px solid var(--accent);color:var(--secondary);font-size:12px}

/* ---- 设置 ---- */
.tw-dialog{position:absolute;left:290px;top:150px;z-index:7;display:grid;grid-template-columns:132px 1fr;grid-template-rows:auto 1fr;width:700px;height:500px;border:1px solid var(--glass-outline);border-radius:22px;background:var(--popup-glass,var(--surface));box-shadow:0 40px 90px -30px rgb(0 0 0 / .5),0 2px 8px rgb(0 0 0 / .08)}
.tw-dialog-enter-active{transition:opacity .25s var(--ease-out),scale .45s var(--ease-spring),translate .45s var(--ease-spring)}
.tw-dialog-enter-from{opacity:0;scale:.92;translate:0 16px}
.tw-dialog h3{grid-column:1 / -1;padding:18px 24px 8px;font:700 19px/1.2 var(--font-display,inherit)}
.tw-dialog nav{display:grid;align-content:start;gap:2px;padding:6px 0 0 12px}
.tw-dialog nav span{display:flex;align-items:center;gap:9px;height:34px;padding:0 12px;border-radius:10px;color:var(--secondary);font-size:12.5px}
.tw-dialog nav span.on{background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink);font-weight:600}
.tw-pane{padding:4px 24px 20px 18px}
.tw-pane h5{display:flex;align-items:center;gap:8px;margin:8px 0 10px;font-size:13px;font-weight:650}
.tw-pane h5 i{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--ink);color:var(--surface);font-size:11px}
.tw-links{display:flex;flex-wrap:wrap;gap:8px}
.tw-link{display:flex;align-items:center;gap:7px;height:32px;padding:0 12px;border:1px solid var(--line-soft);border-radius:999px;font-size:12.5px;transition:border-color .25s,background-color .25s}
.tw-link i{width:7px;height:7px;border-radius:50%;background:color-mix(in srgb,var(--ink) 22%,transparent);transition:background-color .25s,box-shadow .25s}
.tw-link small{color:var(--muted);font-size:11px}
.tw-link.open{border-color:color-mix(in srgb,var(--ink) 40%,transparent)}
.tw-link.on{border-color:color-mix(in srgb,#2e9d62 55%,transparent);background:color-mix(in srgb,#2e9d62 8%,transparent)}
.tw-link.on i{background:#2e9d62;box-shadow:0 0 0 3px color-mix(in srgb,#2e9d62 22%,transparent)}
.tw-key{display:flex;align-items:center;gap:12px;height:36px;margin-top:10px;padding:0 14px;border:1px solid var(--line-soft);border-radius:10px;animation:tw-page .3s var(--ease-out)}
.tw-key small{color:var(--muted);font-size:11.5px}
.tw-key span{letter-spacing:.14em}
.tw-pane h5:nth-of-type(2){margin-top:18px}
.tw-slots{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tw-slot{position:relative;padding:11px 14px 12px;border:1px solid var(--line-soft);border-radius:12px}
.tw-slot p{display:grid;margin-bottom:8px}
.tw-slot b{font-size:13px}.tw-slot small{color:var(--muted);font-size:11px}
.tw-select{display:flex;align-items:center;justify-content:space-between;height:30px;padding:0 10px;border:1px solid var(--line-soft);border-radius:8px;color:var(--muted);font-size:12.5px;transition:color .2s,border-color .2s}
.tw-select.set{color:var(--ink);border-color:color-mix(in srgb,var(--ink) 26%,transparent)}
.tw-styles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.tw-style{display:grid;gap:8px;padding:8px 8px 10px;border:1px solid var(--line-soft);border-radius:12px;font-size:12px;text-align:center;transition:border-color .25s,box-shadow .25s}
.tw-style.on{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
.tw-style i{display:grid;align-content:center;gap:6px;height:66px;padding:0 14px;border-radius:8px}
.tw-style i b{height:8px;border-radius:4px}.tw-style i b+b{width:60%}
.tw-style i.glass{background:linear-gradient(135deg,#e3eaf3,#e8e3f0)}.tw-style i.glass b{background:rgb(255 255 255 / .85);box-shadow:0 1px 3px rgb(0 0 0 / .1)}
.tw-style i.crystal{background:linear-gradient(135deg,#cfe3f2,#dfe6f6)}.tw-style i.crystal b{background:rgb(255 255 255 / .55);box-shadow:inset 0 0 0 1px #fff}
.tw-style i.warm{background:#f1ece1}.tw-style i.warm b{border-radius:2px;background:#faf9f5;box-shadow:inset 0 0 0 1px rgb(61 46 30 / .2)}
.tw-style i.sketch{background:#efe9db}.tw-style i.sketch b{border-radius:5px 7px 4px 8px;background:#fbf8f0;box-shadow:inset 0 0 0 1.4px #2e2d2a}
.tw-pane h5+.tw-styles+h5{margin-top:20px}
.tw-bgs{display:flex;gap:10px}
.tw-bgs i{width:58px;height:40px;border:1px solid var(--line-soft);border-radius:9px;transition:box-shadow .25s}
.tw-bgs i.on{box-shadow:0 0 0 2px var(--popup-glass,#fff),0 0 0 4px var(--accent)}
.tw-bg-0{background:linear-gradient(135deg,#e9eef4,#e8e3f0)}.tw-bg-1{background:linear-gradient(135deg,#f6e3cf,#f0c9c9)}.tw-bg-2{background:linear-gradient(135deg,#f3cdb6,#cdb9e6 48%,#9cc3ea)}.tw-bg-3{background:linear-gradient(135deg,#cfe8dc,#b9d6e6)}.tw-bg-4{background:#3a3c42}

/* ---- 收起界面 ---- */
.tw-world.bare .tw-side{translate:-240px 0;opacity:0}
.tw-world.bare .tw-top{translate:0 -70px;opacity:0}
.tw-world.bare .tw-reader{left:14px;top:6px}
.tw-world.bare .tw-ai{top:14px}

/* ---- 通用进出 ---- */
.tw-pop-enter-active{transition:opacity .2s var(--ease-out),scale .34s var(--ease-spring)}
.tw-pop-leave-active{transition:opacity .14s}
.tw-pop-enter-from{opacity:0;scale:.9}.tw-pop-leave-to{opacity:0}
.tw-slide-enter-active,.tw-slide-leave-active{transition:opacity .25s var(--ease-out),translate .36s var(--ease-out)}
.tw-slide-enter-from,.tw-slide-leave-to{opacity:0;translate:-18px 0}
.tw-fade-enter-active{transition:opacity .3s var(--ease-out),translate .36s var(--ease-out)}
.tw-fade-enter-from{opacity:0;translate:-8px 0}
</style>
