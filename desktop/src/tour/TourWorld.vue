<script setup lang="ts">
/* 教程里那张示意的界面：一块 1280×800 的画布，按当前主题的颜色画。它不接任何真实数据。 */
import { computed } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { BOOKMARK_ARTS } from '../library/bookmark-art'
import { MODELS, TEXT, SUM, FIND, PICTURE, SUM_NAME, sumLength, replyLength, type Look, type Scene, type SlotId } from './lessons'

const props = defineProps<{ scene: Scene }>()
const markBooks = computed(() => props.scene.markSwap ? ['paper', 'algebra'] as const : ['algebra', 'paper'] as const)
const MEMORY = [{ id: 'book', label: '本书' }, { id: 'all', label: '全局' }, { id: 'off', label: '不用' }] as const
// 总结草稿：按已经写了多少字，一块一块露出来。
const sumBlocks = computed(() => { let left = props.scene.sumWords; return SUM.blocks.map(([kind, text]) => { const part = text.slice(0, Math.max(0, left)); left -= text.length; return { kind, text: part } }).filter(block => block.text) })
const sumWriting = computed(() => props.scene.sumWords < sumLength || (props.scene.sumSent && !props.scene.sumFixed))
const own = (document.documentElement.dataset.style || 'glass') as Look
const look = computed(() => props.scene.look || own)
const source = computed(() => props.scene.doc === 'paper' ? TEXT.english : TEXT.sentence)
const picked = computed(() => source.value.slice(0, props.scene.selected))
const rest = computed(() => source.value.slice(props.scene.selected))
const written = computed(() => props.scene.cardAsk ? TEXT.cardReply.slice(0, props.scene.cardAnswer) : TEXT.answer.slice(0, props.scene.words))
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
/* 书签用应用里真的那套画：这几枚分别是至上主义、风格派、浮世绘、包豪斯、立体主义。 */
const ARTS = ['suprematism', 'destijl', 'ukiyoe', 'bauhaus', 'cubism'].map(id => BOOKMARK_ARTS.find(item => item.id === id)!)
/* 截图一课：三张截图各截了什么（输入框里的小图就是把这段字缩小了画）、快捷提问的气泡。 */
const SHOTS = ['det(A − λI) = 0', '定理 5.2　实对称矩阵的特征值都是实数', TEXT.sentence]
const QUICK = ['为什么？', '详细展开', '通俗解释', '举个例子']
const box = computed(() => { const frame = props.scene.frame; return frame ? { left: `${frame.x}px`, top: `${frame.y}px`, width: `${frame.width}px`, height: `${frame.height}px` } : {} })
/* 快捷提问时选区以外压暗：整块遮罩在选区处挖一个洞。 */
const hole = computed(() => { const frame = props.scene.frame; return frame ? { clipPath: `path(evenodd, "M0 0H1280V800H0Z M${frame.x} ${frame.y}h${frame.width}v${frame.height}h${-frame.width}Z")` } : {} })
const beside = computed(() => { const frame = props.scene.frame; return frame ? { left: `${frame.x + frame.width + 26}px`, top: `${frame.y + frame.height / 2}px` } : {} })
const away = computed(() => props.scene.scroll > 110)
/* 管理对话那一页的示意：两本书、五段对话、四条记忆。t1 可以被拖到第二本书里。记忆是 [正文, 类别]。 */
type Talk = { id: string; title: string; meta: string; items?: [string, string][] }
const CM_BOOKS: { id: string; title: string; kind: 'square' | 'round'; talks: Talk[] }[] = [
  { id: 'b0', title: '线性代数讲义', kind: 'square', talks: [
    { id: 't0', title: '特征值是什么', meta: '3 问 · 刚刚', items: [['第 5 章读到 5.2', '进度'], ['以为能对角化的矩阵都能正交对角化', '难点']] },
    { id: 't1', title: '行列式为什么能判可逆', meta: '2 问 · 1 小时前' },
    { id: 't2', title: '特征值与特征向量', meta: '4 问 · 昨天', items: [['做了习题 5.1–5.8', '进度']] },
  ] },
  { id: 'b1', title: 'Attention Is All You Need', kind: 'round', talks: [
    { id: 't3', title: '自注意力怎么算', meta: '5 问 · 2 天前', items: [['英文原文先用中文讲大意，再举例', '偏好']] },
    { id: 't4', title: '位置编码', meta: '2 问 · 3 天前' },
  ] },
]
const cmBooks = computed(() => {
  if (!props.scene.cmMoved) return CM_BOOKS
  const moved = CM_BOOKS[0]!.talks[1]!
  return [{ ...CM_BOOKS[0]!, talks: CM_BOOKS[0]!.talks.filter(talk => talk !== moved) }, { ...CM_BOOKS[1]!, talks: [CM_BOOKS[1]!.talks[0]!, moved, CM_BOOKS[1]!.talks[1]!] }]
})
/* 根到每段对话的折线：行高 40、间隔 8，和真的那页一样先平、再斜、再平。 */
const cmLinks = (count: number) => { const mid = (count * 48 - 8) / 2; return Array.from({ length: count }, (_, index) => `M0 ${mid}L14 ${mid}L32 ${index * 48 + 20}L46 ${index * 48 + 20}`) }
const ribbonStyle = computed(() => props.scene.ribbonAt ? { left: `${props.scene.ribbonAt.x}px`, top: `${props.scene.ribbonAt.y}px`, translate: props.scene.ribbonFlip ? '-100% -50%' : '0 -50%' } : undefined)
/* 记忆栏：线性代数讲义的三条可以挪、可以让助手合并；合并后两条进度并成一条。text 是记下的事，kind 是类别（偏好、背景、进度、难点、已会）。 */
type Mem = { id: string; text: string; kind: string }
const MEM: Record<string, Mem> = {
  r0: { id: 'r0', text: '第 5 章读到 5.2', kind: '进度' },
  r1: { id: 'r1', text: '以为能对角化的矩阵都能正交对角化', kind: '难点' },
  r2: { id: 'r2', text: '做了习题 5.1–5.8', kind: '进度' },
  m: { id: 'm', text: '第 5 章读到 5.2，做了习题 5.1–5.8', kind: '进度' },
}
const memRows = computed(() => props.scene.memMerged ? [MEM.m!, MEM.r1!] : props.scene.memSwap ? [MEM.r0!, MEM.r2!, MEM.r1!] : [MEM.r0!, MEM.r1!, MEM.r2!])
const memCount = computed(() => memRows.value.length + 1)
const memMove = (id: string) => id === 'r1' && props.scene.memDrag !== null ? props.scene.memDrag : id === 'r2' ? props.scene.memShift : 0
/* 外观一课里那张「自己的图片」：湖边日落，全用渐变和色块画。id 前缀让几处同时画时渐变不串。 */
const wall = (id: string) => `<defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#263468"/><stop offset=".42" stop-color="#9c5a86"/><stop offset=".7" stop-color="#ef8a5f"/><stop offset="1" stop-color="#ffd496"/></linearGradient><linearGradient id="${id}-lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2a06e"/><stop offset=".45" stop-color="#8b5a88"/><stop offset="1" stop-color="#202a58"/></linearGradient><radialGradient id="${id}-glow"><stop offset="0" stop-color="#fff3c6"/><stop offset=".3" stop-color="#ffd27f" stop-opacity=".85"/><stop offset="1" stop-color="#ffb26b" stop-opacity="0"/></radialGradient></defs>`
  + `<rect width="160" height="100" fill="url(#${id}-sky)"/><circle cx="104" cy="57" r="34" fill="url(#${id}-glow)"/><circle cx="104" cy="58" r="8" fill="#fff1c4"/>`
  + `<path d="M0 52 16 39 28 46 46 30 63 45 75 40 92 52 112 47 134 36 160 46V66H0Z" fill="#7b4c80" opacity=".8"/><path d="M0 61 15 51 29 57 42 49 60 59 81 53 101 60 121 51 141 57 160 49V66H0Z" fill="#45316a"/>`
  + `<rect y="64" width="160" height="36" fill="url(#${id}-lake)"/><path d="M90 67.5h28M94 71.5h20M97 76h14M100 81.5h8" stroke="#ffe2a6" stroke-width="1.3" stroke-linecap="round" opacity=".85"/>`
  + `<path d="M0 86C26 80 50 88 74 100H0Z" fill="#191b38"/><path d="M116 100C128 87 145 82 160 80V100Z" fill="#191b38"/><path d="M13 89 8 79h3l-4-7h3l-3-6 6 13h-3l4 7Z" fill="#191b38"/><path d="M24 91 19 81h3l-4-7h3l-3-6 6 13h-3l4 7Z" fill="#191b38"/><path d="M147 82 142 72h3l-4-7h3l-3-6 6 13h-3l4 7Z" fill="#191b38"/>`
const PRESETS = ['晨雾', '暮光', '薄荷', '薰衣草', '石墨', '素白']
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
  <div class="tw-world" :data-look="look" :class="{ forced: scene.look, dark: scene.dark, picture: scene.picture, bare: !scene.chrome, desk: scene.desk > 0 }" aria-hidden="true">
    <div v-if="scene.desk > 0" class="tw-desk">
      <p class="tw-icon"><AppIcon name="folder" :size="30" />文档</p>
      <p class="tw-icon"><AppIcon name="image" :size="30" />截图</p>
      <p class="tw-icon tw-deskfile" :class="{ lifted: scene.ghost }"><AppIcon name="file" :size="30" />特征值专题讲义.pdf</p>
      <i class="tw-taskbar"><b></b><b></b><b></b><b></b></i>
    </div>
    <div class="tw-app" :style="scene.desk > 0 ? { transform: `translate(${-40 * scene.desk}px, ${-14 * scene.desk}px) scale(${1 - scene.desk * .27})` } : undefined">
    <Transition name="tw-wall"><svg v-if="scene.picture" class="tw-wall" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" v-html="wall('w')" /></Transition>
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
      <div class="tw-mkbooks" :class="{ still: scene.markStill }">
        <div v-for="book in markBooks" :key="book" class="tw-mkbook" :class="[`tw-mkbook-${book}`, { lifted: book === 'paper' && scene.markDrag !== null }]" :style="{ translate: `0 ${book === 'paper' ? scene.markDrag || 0 : scene.markShift}px` }">
          <template v-if="book === 'algebra'">
            <p class="tw-mkname">线性代数讲义</p>
            <p class="tw-mark"><svg class="tw-art" viewBox="0 0 96 40" preserveAspectRatio="xMaxYMid slice" v-html="ARTS[4].svg" />第 42 页</p>
            <Transition name="tw-fade"><p v-if="scene.mark" class="tw-mark tw-mark-new"><svg :key="scene.art" class="tw-art" viewBox="0 0 96 40" preserveAspectRatio="xMaxYMid slice" v-html="ARTS[scene.art].svg" />第 87 页</p></Transition>
            <p class="tw-mark"><svg class="tw-art" viewBox="0 0 96 40" preserveAspectRatio="xMaxYMid slice" v-html="ARTS[3].svg" />第 113 页</p>
          </template>
          <template v-else>
            <p class="tw-mkname">Attention Is All You Need</p>
            <p class="tw-mark"><svg class="tw-art" viewBox="0 0 96 40" preserveAspectRatio="xMaxYMid slice" v-html="ARTS[1].svg" />第 3 页</p>
          </template>
        </div>
      </div>
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
      <span class="tw-icons"><AppIcon name="search" :size="16" /><AppIcon class="tw-tr" name="translate" :size="16" /><AppIcon class="tw-aibtn" name="sparkle" :size="16" /></span>
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
          <AppIcon class="tw-ol" name="list" :size="15" /><i class="tw-sep"></i><span class="tw-percent" :class="{ fit: scene.fit }">−<b>{{ Math.round(scene.zoom * 100) }}%</b>+</span><i class="tw-sep"></i><span class="tw-cropbtn" :class="{ on: scene.crop }"><AppIcon name="crop" :size="15" /></span><AppIcon class="tw-inkbtn" name="edit" :size="15" />
        </template>
      </div>
      <Transition name="tw-slide"><div v-if="scene.outline" class="tw-outline"><h6>目录</h6><p v-for="(item, index) in OUTLINE" :key="item" :class="[`tw-ol-${index}`, { on: index === 0 }]">{{ item }}</p></div></Transition>
      <Transition name="tw-pop"><div v-if="scene.finding" class="tw-find"><AppIcon name="search" :size="14" /><span>{{ scene.find }}<i class="tw-caret"></i></span><small v-if="scene.find.length > 2">1 / 9</small></div></Transition>
      <Transition name="tw-slide"><div v-if="scene.column" class="tw-column">
        <header><b>翻译</b><span class="tw-auto" :class="{ on: scene.auto }"><i></i>自动翻译</span></header>
        <div class="tw-entry"><small>{{ TEXT.english }}</small><p>{{ TEXT.chinese }}</p></div>
        <div class="tw-entry"><small>Attention Is All You Need</small><p>注意力就是你所需要的一切</p></div>
      </div></Transition>

      <div class="tw-rail">
        <i class="tw-line" :style="{ top: '12%', background: ARTS[4].tint }"></i>
        <Transition name="tw-railmark"><i v-if="scene.mark" class="tw-line tw-rail-new" :style="{ top: '27%', background: ARTS[scene.art].tint }"></i></Transition>
        <i class="tw-line" :style="{ top: '36%', background: ARTS[3].tint }"></i>
      </div>
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

          <div class="tw-ribbons" :class="{ flip: scene.ribbonFlip, lifted: scene.ribbonLift }" :style="ribbonStyle"><Transition name="tw-ribbon"><svg v-if="scene.mark && !away" :key="scene.art" class="tw-ribbon tw-ribbon-new" viewBox="0 0 96 40" preserveAspectRatio="xMinYMid slice" v-html="ARTS[scene.art].svg" /></Transition></div>
          <Transition name="tw-pop"><div v-if="scene.markMenu" class="tw-menu tw-mark-menu"><span class="line0"><AppIcon name="image" :size="13" />用自己的图片…</span><span v-for="(art, index) in ARTS.slice(0, 4)" :key="art.id" :class="`tw-art-${index}`"><svg class="tw-art" viewBox="0 0 96 40" preserveAspectRatio="xMaxYMid slice" v-html="art.svg" />{{ art.name }}<small>{{ art.era }}</small></span></div></Transition>

          <Transition name="tw-card">
            <div v-if="scene.card !== 'none'" class="tw-card" :class="{ pinned: scene.card === 'pinned', floating: scene.follow === 'screen' }" :style="{ left: `${scene.cardAt.x}px`, top: `${scene.cardAt.y + (scene.follow === 'screen' ? scene.scroll - scene.hold : 0)}px` }">
              <div class="tw-card-head"><AppIcon class="tw-spark" name="sparkle" :size="13" /><span v-if="scene.asking" class="tw-card-ask" :class="{ empty: !scene.cardDraft }">{{ scene.cardDraft || '就这段内容提问，回车发送' }}<i class="tw-caret"></i></span><span v-else><mark>{{ TEXT.sentence.slice(0, 15) }}…</mark></span><b v-if="scene.card === 'pinned'" class="tw-follow"><AppIcon :key="scene.follow" :name="scene.follow === 'page' ? 'doc' : 'fullscreen'" :size="13" /></b><b class="tw-pin" :class="{ on: scene.card === 'pinned' }"><AppIcon name="pin" :size="13" /></b></div>
              <i class="tw-rule" :class="{ running: scene.running }"></i>
              <p v-if="scene.cardAsk" class="tw-card-q">{{ TEXT.cardAsk }}</p>
              <p class="tw-answer">{{ written }}<i v-if="scene.running && (scene.cardAsk ? scene.cardAnswer < TEXT.cardReply.length : scene.words < TEXT.answer.length)" class="tw-caret"></i></p>
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

    <Transition name="tw-fade"><section v-if="scene.sum === 'draft' && scene.view === 'reader'" class="tw-draft">
      <header :class="{ running: sumWriting }"><b>总结草稿</b><small>线性代数讲义</small><em :class="{ live: sumWriting }">{{ sumWriting ? '正在写' : `${scene.sumWords + (scene.sumFixed ? SUM.added.length : 0)} 字` }}</em><span v-if="scene.sumSaved" class="tw-draft-saved" :title="SUM_NAME">已存 · 打开</span><span class="tw-draft-save" :class="{ dim: sumWriting }">{{ scene.sumSaved ? '再存一次' : '存入文档库' }}</span></header>
      <article>
        <h1>{{ SUM.title }}</h1>
        <template v-for="(block, index) in sumBlocks" :key="index">
          <h2 v-if="block.kind === 'h2'">{{ block.text }}</h2>
          <p v-else-if="index === 3" class="target"><i class="tw-sum-a"></i><span class="tw-sum-sel">{{ block.text.slice(0, scene.sumSel) }}</span>{{ block.text.slice(scene.sumSel) }}<i class="tw-sum-b"></i><Transition name="tw-pop"><span v-if="scene.sumAsk" class="tw-draft-ask"><span :class="{ typed: scene.sumNote }">{{ scene.sumNote || '这一段怎么改？' }}<i v-if="scene.sumNote" class="tw-caret"></i></span><b class="tw-draft-send"><AppIcon name="arrow-up" :size="12" /></b></span></Transition></p>
          <p v-else>{{ block.text }}</p>
        </template>
        <p v-if="scene.sumFixed" class="tw-sum-new">{{ SUM.added }}</p>
      </article>
    </section></Transition>

    <Transition name="tw-view">
      <section v-if="scene.view === 'library'" class="tw-lib">
        <header><h2>全部文档<small>{{ files.length }}</small></h2><span class="tw-lib-search" :class="{ typed: scene.query }"><AppIcon name="search" :size="14" /><em>{{ scene.query || '搜索标题、标签或已索引内容' }}</em><i v-if="scene.query" class="tw-caret"></i></span></header>
        <TransitionGroup tag="div" class="tw-grid" name="tw-file">
          <div v-for="file in files" :key="file.id" class="tw-file" :class="`tw-file-${file.slot}`">
            <i class="tw-cover" :class="file.kind"><b></b><b></b><b></b></i>
            <p v-if="file.id === 'algebra' && scene.renaming !== null" class="tw-rename"><span :class="{ all: scene.renaming === file.title }">{{ scene.renaming }}</span><i class="tw-caret"></i></p>
            <p v-else>{{ file.id === 'algebra' && scene.fileName ? scene.fileName : file.title }}</p><small>{{ file.meta }}<template v-if="scene.query && file.hit"> · 正文 {{ file.hit }} 处</template></small>
            <AppIcon class="tw-star" :class="{ on: scene.starred && file.id === 'algebra' }" name="star" :size="14" />
            <span v-if="scene.grouped && file.id === 'algebra'" class="tw-tag">线性代数</span>
          </div>
        </TransitionGroup>
        <Transition name="tw-pop"><div v-if="scene.fileMenu" class="tw-menu tw-file-menu"><span><AppIcon name="book" :size="13" />打开</span><span><AppIcon name="star" :size="13" />收藏</span><span class="tw-fm-sum" :class="{ hot: scene.fileHover === 'sum' }"><AppIcon name="doc" :size="13" />总结…</span><span class="tw-fm-rename" :class="{ hot: scene.fileHover === 'rename' }"><AppIcon name="edit" :size="13" />重命名<small>F2</small></span><span class="tw-fm-details" :class="{ hot: scene.fileHover === 'details' }"><AppIcon name="tag" :size="13" />详情与标签…</span><span class="tw-fm-reveal" :class="{ hot: scene.fileHover === 'reveal' }"><AppIcon name="folder" :size="13" />打开所在文件夹</span><span class="tw-fm-group line"><AppIcon name="folder" :size="13" />放进「线性代数」</span><span class="line danger"><AppIcon name="trash" :size="13" />从文档库移除</span></div></Transition>
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

    <Transition name="tw-ai">
      <aside v-if="scene.ai && scene.view === 'reader'" class="tw-ai" :class="{ side: scene.side }">
        <div class="tw-main">
          <header><span class="tw-manage"><AppIcon name="threads" :size="16" /></span><span class="tw-title"><b>{{ scene.talk || '新对话' }}</b><small>{{ scene.doc === 'paper' ? 'Attention Is All You Need' : '线性代数讲义' }}</small></span><span v-if="scene.branch" class="tw-chip"><AppIcon name="branch" :size="12" />分支</span><span class="tw-hbtns"><AppIcon name="branch" :size="14" /><AppIcon name="compose" :size="14" /><AppIcon name="close" :size="13" /></span></header>
          <Transition name="tw-pop"><div v-if="scene.histOpen" class="tw-hist">
            <div class="tw-hist-top"><p><AppIcon name="compose" :size="13" />新对话</p><p><AppIcon name="list" :size="13" />管理</p></div>
            <div class="tw-hist-search" :class="{ typed: scene.histQuery }"><AppIcon name="search" :size="13" /><em>{{ scene.histQuery || '搜索对话' }}</em><i v-if="scene.histQuery" class="tw-caret"></i></div>
            <template v-if="scene.histQuery">
              <div v-for="(hit, index) in FIND.historyHits" :key="index" class="tw-hist-row tw-hist-hit" :class="[`tw-hist-hit-${index}`, { current: index === 0 }]"><strong>{{ hit.title[0] }}<mark>{{ hit.title[1] }}</mark>{{ hit.title[2] }}</strong><small>{{ hit.meta }}</small><em v-if="hit.snip">{{ hit.snip[0] }}<mark>{{ hit.snip[1] }}</mark>{{ hit.snip[2] }}</em></div>
            </template>
            <template v-else>
              <div class="tw-hist-scope"><p class="on">这份文档</p><p>全部文档</p></div>
              <div class="tw-hist-row current"><strong>{{ scene.talk || '新对话' }}</strong><small>刚刚 · 1 问</small></div>
              <div class="tw-hist-row"><strong>相似对角化的条件</strong><small>3 天前 · 2 问</small></div>
              <div class="tw-hist-row"><strong>行列式为什么能判可逆</strong><small>上周 · 2 问</small></div>
            </template>
          </div></Transition>
          <div class="tw-chat">
            <template v-if="scene.sum === 'setup'">
              <div class="tw-sum">
                <h4>总结<small>线性代数讲义</small></h4>
                <p class="tw-sum-row"><b>范围</b><em :class="{ none: !scene.sumPicked }">{{ scene.sumPicked ? `${scene.sumPicked} 节` : '不指定' }}</em></p>
                <div class="tw-sum-list">
                  <p class="tw-sum-ch"><AppIcon class="tw-sum-caret" name="arrow" :size="9" /><i></i><span>第4章 行列式</span><small>52–86</small></p>
                  <p class="tw-sum-ch"><AppIcon class="tw-sum-caret tw-sum-unfold" :class="{ on: scene.sumFold }" name="arrow" :size="9" /><i :class="{ mixed: scene.sumPicked > 0 }"></i><span>第5章 特征值</span><small>87–120</small></p>
                  <template v-if="scene.sumFold"><p v-for="(part, index) in SUM.parts" :key="part[0]" class="tw-sum-ch sub" :class="`tw-sum-part-${index}`"><i :class="{ on: index < scene.sumPicked }"></i><span>{{ part[0] }}</span><small>{{ part[1] }}</small></p></template>
                  <p class="tw-sum-ch"><AppIcon class="tw-sum-caret" name="arrow" :size="9" /><i></i><span>第6章 二次型</span><small>121–150</small></p>
                </div>
                <p class="tw-sum-row"><b>长度</b><em class="none">不指定</em></p>
                <p class="tw-sum-row"><b>写法</b><em class="none">不指定</em></p>
                <p class="tw-sum-row tw-sum-full"><b class="wide">不遗漏知识点</b><i class="tw-switch" :class="{ on: scene.sumFull }"></i></p>
                <p class="tw-sum-row"><b class="wide" :class="{ dim: scene.sumFull }">分多次写</b><i class="tw-switch" :class="{ on: scene.sumFull, dim: scene.sumFull }"></i></p>
                <span class="tw-sum-go">开始总结</span>
              </div>
            </template>
            <template v-else-if="scene.sum === 'draft'">
              <div class="tw-sumreq"><b>总结<small>线性代数讲义</small></b><p><em>范围</em>「第5章 特征值」里的 5.1、5.2</p><p><em>覆盖</em>不遗漏知识点</p></div>
              <p class="tw-say">{{ SUM.say }}</p>
              <span class="tw-draftchip"><AppIcon name="doc" :size="12" />写入草稿 · {{ scene.sumWords }} 字</span>
              <template v-if="scene.sumSent">
                <p class="tw-me">{{ SUM.fix }}</p>
                <span v-if="scene.sumFixed" class="tw-draftchip"><AppIcon name="doc" :size="12" />修改草稿 · 1 处</span>
              </template>
            </template>
            <template v-else-if="scene.asked">
              <p class="tw-me">{{ TEXT.question }}</p>
              <p class="tw-say">{{ reply[0] }}<span class="tw-q" :class="{ on: scene.quote }">{{ reply[1] }}</span>{{ reply[2] }}</p>
              <p v-if="scene.answer >= replyLength" class="tw-meta"><AppIcon name="copy" :size="13" /><AppIcon name="retry" :size="13" /><AppIcon class="tw-branch" name="branch" :size="13" /></p>
              <Transition name="tw-pop"><div v-if="scene.quotePop" class="tw-menu tw-quote"><span><AppIcon name="append" :size="13" />引用到输入框</span><span class="tw-quote-side"><AppIcon name="branch" :size="13" />在侧边对话提问</span></div></Transition>
              <Transition name="tw-fade"><p v-if="scene.branch" class="tw-note"><AppIcon name="branch" :size="12" />新分支从这条回答开始，原对话在对话记录里</p></Transition>
            </template>
            <template v-else-if="scene.shotSent">
              <div class="tw-me tw-me-shots"><span><b v-for="(text, index) in SHOTS" :key="index" class="tw-shot flat"><i>{{ text }}</i></b></span>{{ TEXT.shotAsk }}</div>
              <p class="tw-say">{{ TEXT.shotReply.slice(0, scene.shotAnswer) }}</p>
            </template>
            <div v-else class="tw-empty"><AppIcon name="sparkle" :size="22" /><span>总结这一页</span><span>这个公式怎么来的</span><p class="tw-mem"><em>记忆</em><b v-for="item in MEMORY" :key="item.id" :class="[`tw-mem-${item.id}`, { on: scene.mem === item.id }]">{{ item.label }}</b></p></div>
          </div>
          <Transition name="tw-pop"><div v-if="scene.btw" class="tw-btw"><p><b>/btw</b>{{ TEXT.btwAsk }}</p><p>{{ TEXT.btwReply.slice(0, scene.btwAnswer) }}</p></div></Transition>
          <Transition name="tw-pop"><div v-if="scene.commands" class="tw-menu tw-cmds"><span class="tw-cmd-btw"><b>/btw</b>顺便问一句</span><span><b>/compress</b>压缩对话</span><span><b>/usage</b>查看用量</span><span><b>/summary</b>总结文档</span></div></Transition>
          <TransitionGroup v-if="scene.shots" tag="div" name="tw-shot" class="tw-shots"><b v-for="index in scene.shots" :key="index" class="tw-shot" :class="[`tw-shot-${index - 1}`, { kept: index <= scene.kept }]"><i>{{ SHOTS[index - 1] }}</i></b></TransitionGroup>
          <div class="tw-ask" :class="{ typed: scene.draft }"><span>{{ scene.draft || '问问这一页' }}<i v-if="scene.draft" class="tw-caret"></i></span><svg class="tw-context" viewBox="0 0 20 20" :style="{ '--ratio': scene.asked ? .18 : .06 }"><circle cx="10" cy="10" r="7.5" /><circle cx="10" cy="10" r="7.5" pathLength="100" /></svg><b class="tw-send"><AppIcon name="arrow-up" :size="14" /></b></div>
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
      <section v-if="scene.settings" class="tw-dialog" :class="{ peek: scene.preview }">
        <h3>设置</h3>
        <nav><span :class="{ on: scene.settings === 'look' }"><AppIcon name="sun" :size="14" />外观</span><span><AppIcon name="book" :size="14" />阅读</span><span><AppIcon name="settings" :size="14" />快捷键</span><span :class="{ on: scene.settings === 'ai' }"><AppIcon name="sparkle" :size="14" />AI</span><span><AppIcon name="memory" :size="14" />记忆</span><span><AppIcon name="import" :size="14" />更新</span></nav>
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
          <!-- 底板只在两种液态玻璃下有：预设几种，下面是自己加的图片。 -->
          <template v-if="look === 'glass' || look === 'crystal'">
            <h5>底板</h5>
            <div class="tw-bgs"><p v-for="(name, index) in PRESETS" :key="name"><i :class="[`tw-bg-${index}`, { on: !scene.picture && index === 0 }]"></i>{{ name }}</p></div>
            <p class="tw-gallery-head">我的图片<small>{{ scene.picture ? 1 : 0 }} / 6</small></p>
            <div class="tw-gallery">
              <p v-if="scene.picture" class="tw-gallery-own"><svg class="on" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" v-html="wall('g')" />{{ PICTURE }}</p>
              <p class="tw-gallery-add"><i><AppIcon name="plus" :size="18" /></i>添加图片</p>
            </div>
          </template>
        </div>
      </section>
    </Transition>

    <Transition name="tw-pop"><div v-if="scene.picker" class="tw-picker">
      <header><AppIcon name="image" :size="14" />选择图片<small>图片</small></header>
      <div class="tw-picks">
        <p class="tw-pick-0"><svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" v-html="wall('p')" />{{ PICTURE }}</p>
        <p class="tw-pick-1"><i class="snow"></i>雪山.png</p>
        <p class="tw-pick-2"><i class="desk"></i>书桌.jpg</p>
      </div>
      <footer><b>打开</b><b>取消</b></footer>
    </div></Transition>
    <Transition name="tw-pop"><div v-if="scene.preview" class="tw-scene-bar"><span>新底板效果预览</span><b>不采用</b><b class="tw-scene-ok">采用</b></div></Transition>
    <Transition name="tw-fade"><div v-if="scene.quick && scene.frame" class="tw-dim" :style="hole"></div></Transition>
    <div v-if="scene.frame" class="tw-frame" :class="{ set: scene.quick }" :style="box"><i v-for="corner in 4" :key="corner"></i></div>
    <Transition name="tw-pop"><div v-if="scene.quick && scene.frame" class="tw-quick" :style="beside">
      <span class="tw-thinking"><AppIcon name="sparkle" :size="12" />想问点什么</span>
      <span v-for="(label, index) in QUICK" :key="label" class="tw-bubble" :class="`tw-bubble-${index}`" :style="{ animationDelay: `${90 + index * 55}ms` }">{{ label }}<kbd>{{ index + 1 }}</kbd></span>
      <span class="tw-quick-foot"><span class="tw-quick-own"><AppIcon name="sparkle" :size="12" />自己提问</span><kbd>Esc</kbd></span>
    </div></Transition>
    <Transition name="tw-pop"><div v-if="scene.ctx" class="tw-menu tw-ctx" :style="{ left: `${scene.ctx.x + 4}px`, top: `${scene.ctx.y + 4}px` }">
      <span><AppIcon name="split" :size="13" />并排阅读…</span><span><AppIcon name="fullscreen" :size="13" />进入全屏</span>
      <span class="tw-ctx-right line"><AppIcon name="crop" :size="13" />{{ scene.rightOn ? '关闭' : '开启' }}右键拖动截图</span><span class="tw-ctx-quick"><AppIcon name="sparkle" :size="13" />{{ scene.quickOff ? '开启' : '关闭' }}框选快捷提问</span>
      <span class="line"><AppIcon name="settings" :size="13" />设置</span>
    </div></Transition>
    </div>
    <Transition name="tw-fade"><section v-if="scene.manager" class="tw-cm">
      <div class="tw-cm-main">
        <p class="tw-cm-tools"><span><AppIcon name="arrow" :size="12" />返回</span><span :class="{ off: scene.cmFlash !== 'moved' }"><AppIcon name="reset" :size="12" />撤销<kbd>Ctrl Z</kbd></span><span class="tw-cm-find" :class="{ typed: scene.cmQuery }"><AppIcon name="search" :size="13" /><em>{{ scene.cmQuery || '搜索对话' }}</em><i v-if="scene.cmQuery" class="tw-caret"></i></span></p>
        <header class="tw-cm-hero"><h2><i></i>管理对话</h2><dl><div><dt>2</dt><dd>本书</dd></div><div><dt>5</dt><dd>段对话</dd></div><div class="red"><dt>{{ memCount }}</dt><dd>条记忆</dd></div></dl></header>
        <div v-if="scene.cmQuery" class="tw-cm-hits">
          <div v-for="(hit, index) in FIND.manageHits" :key="index" class="tw-cm-hit" :class="`tw-cm-hit-${index}`"><strong>{{ hit.title[0] }}<mark>{{ hit.title[1] }}</mark>{{ hit.title[2] }}</strong><small>{{ hit.meta }}</small><em v-if="hit.snip">{{ hit.snip[0] }}<mark>{{ hit.snip[1] }}</mark>{{ hit.snip[2] }}</em></div>
        </div>
        <template v-else>
        <div v-for="book in cmBooks" :key="book.id" class="tw-cm-book" :class="`tw-cm-${book.id}`">
          <div class="tw-cm-root"><i :class="book.kind"><AppIcon :name="book.kind === 'square' ? 'book' : 'doc'" :size="15" /></i><span><b>{{ book.title }}</b><small>{{ book.talks.length }} 段对话</small></span></div>
          <i class="tw-cm-knob"><AppIcon name="arrow" :size="9" /></i>
          <div class="tw-cm-kids">
            <svg class="tw-cm-links" :height="book.talks.length * 48 - 8" width="46"><path v-for="d in cmLinks(book.talks.length)" :key="d" :d="d" /></svg>
            <div v-for="talk in book.talks" :key="talk.id" class="tw-cm-kid">
              <div class="tw-cm-talk" :class="[`tw-cm-${talk.id}`, { has: talk.items, lifted: scene.cmDrag && talk.id === 't1', picked: (scene.cmDrag || scene.cmFlash === 'moved') && talk.id === 't1' }]"><b>{{ talk.title }}</b><small>{{ talk.meta }}</small></div>
              <template v-if="talk.items">
                <i class="tw-cm-knob has shut">{{ talk.items.length }}</i>
              </template>
              <Transition name="tw-fade"><div v-if="scene.cmPeek && talk.id === 't1'" class="tw-cm-peek"><h5>{{ talk.title }}</h5><p><i>问</i><span>行列式等于 0，为什么矩阵就不可逆？</span></p><p class="answer"><i>答</i><span>行列式是这组列向量张成的体积。体积为 0，说明它们被压进了更低的维度，信息丢了，这个变换就退不回去。</span></p></div></Transition>
            </div>
            <i v-if="scene.cmSlot && book.id === 'b1'" class="tw-cm-slot"></i>
          </div>
        </div>
        </template>
        <Transition name="tw-fade"><p v-if="scene.cmFlash" :key="scene.cmFlash" class="tw-cm-flash"><span>{{ scene.cmFlash === 'moved' ? '已把 1 段对话移到《Attention Is All You Need》' : '已撤销：把 1 段对话移到《Attention Is All You Need》' }}</span><b v-if="scene.cmFlash === 'moved'">撤销</b></p></Transition>
        <div v-if="scene.cmDrag" class="tw-cm-ghost" :style="{ left: `${scene.cmDrag.x + 12}px`, top: `${scene.cmDrag.y + 10}px` }">1 段对话</div>
      </div>
      <aside class="tw-cm-side">
        <svg class="tw-cm-art" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice"><path class="l" d="M-10 196 420 42M-10 212 420 58M-10 228 420 74" /><circle class="r" cx="262" cy="118" r="86" /><circle class="k" cx="262" cy="118" r="11" /><path class="w" d="M14 54 268 118 56 214Z" /><path class="k" d="M196 250 372 18 392 33 216 265Z" /><path class="k" d="M330 180h44v44h-44zM24 20h18v18H24zM50 20h8v8h-8z" /><circle class="w" cx="352" cy="62" r="13" /></svg>
        <header><h3>记忆</h3><b>{{ memCount }}</b><span>条</span></header>
        <div class="tw-cm-side-list">
          <p class="tw-mem-ask" :class="{ busy: scene.memBusy, typed: scene.memAsk }"><em>{{ scene.memAsk || '让助手改：比如 把循环相关的合并成一条' }}</em><i v-if="scene.memAsk && !scene.memBusy" class="tw-caret"></i><b><AppIcon :name="scene.memBusy ? 'stop' : 'arrow-up'" :size="12" /></b></p>
          <p v-if="scene.memBusy || scene.memNote" class="tw-mem-note">{{ scene.memBusy ? '助手正在看这些记忆，按你说的改…' : scene.memNote }}<b v-if="!scene.memBusy">撤销</b></p>
          <h4><span>线性代数讲义</span><small>{{ memRows.length }}</small><AppIcon name="arrow" :size="9" /></h4>
          <div class="tw-mem-rows" :class="{ still: scene.memStill }">
            <p v-for="row in memRows" :key="row.id" class="tw-mem-row" :class="[`tw-mem-${row.id}`, { lifted: row.id === 'r1' && scene.memDrag !== null, fresh: row.id === 'm' }]" :style="{ translate: `0 ${memMove(row.id)}px` }"><AppIcon class="tw-grip" name="grip" :size="12" /><span><b>{{ row.text }}</b><em>{{ row.kind }}</em></span></p>
          </div>
          <h4><span>Attention Is All You Need</span><small>1</small><AppIcon name="arrow" :size="9" /></h4>
          <p class="tw-mem-row"><AppIcon class="tw-grip" name="grip" :size="12" /><span><b>英文原文先用中文讲大意，再举例</b><em>偏好</em></span></p>
        </div>
      </aside>
    </section></Transition>
    <Transition name="tw-pop"><div v-if="scene.toast" :key="scene.toast" class="tw-toast"><span>{{ scene.toast }}</span><AppIcon name="close" :size="13" /></div></Transition>
    <div v-if="scene.ghost" class="tw-ghost" :style="{ left: `${scene.ghost.x}px`, top: `${scene.ghost.y}px` }"><AppIcon name="file" :size="14" />特征值专题讲义.pdf</div>
  </div>
</template>

<style scoped>
.tw-world{--tw-bg:var(--canvas);--tw-radius:16px;position:absolute;left:0;top:0;width:1280px;height:800px;overflow:hidden;background:var(--tw-bg);color:var(--ink);font-size:13px;line-height:1.4;user-select:none;pointer-events:none;transition:color .45s var(--ease-soft)}
.tw-app{position:absolute;inset:0;overflow:hidden;background:var(--tw-bg);transform-origin:100% 46%;transition:background .45s var(--ease-soft)}
/* 文库一课：窗口缩小一点，露出后面的桌面。 */
.tw-world.desk .tw-app{border-radius:12px;box-shadow:0 40px 90px -30px rgb(0 0 0 / .6),0 0 0 1px rgb(255 255 255 / .22)}
.tw-desk{position:absolute;inset:0;display:grid;align-content:start;justify-items:start;gap:26px;padding:150px 0 0 70px;background:linear-gradient(160deg,#2c4a66,#56799a 46%,#c58f7c);color:#fff;font:12px/1.3 'Segoe UI','Microsoft YaHei UI',system-ui,sans-serif}
.tw-desk .tw-icon{display:grid;justify-items:center;gap:6px;width:112px;text-align:center;text-shadow:0 1px 3px rgb(0 0 0 / .5);transition:opacity .2s}
.tw-desk .tw-icon svg{filter:drop-shadow(0 2px 4px rgb(0 0 0 / .35))}
.tw-deskfile.lifted{opacity:.35}
.tw-taskbar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;gap:10px;height:38px;background:rgb(20 28 38 / .5)}
.tw-taskbar b{width:20px;height:20px;border-radius:5px;background:rgb(255 255 255 / .34)}
.tw-world p,.tw-world h1,.tw-world h2,.tw-world h3,.tw-world h5,.tw-world h6{margin:0}
.tw-world i,.tw-world em{font-style:normal}
.tw-side,.tw-top,.tw-ai,.tw-dialog,.tw-bar,.tw-lib{transition:background-color .45s var(--ease-soft),border-color .45s var(--ease-soft),border-radius .45s var(--ease-soft),translate .5s var(--ease-out),opacity .4s var(--ease-out),scale .4s var(--ease-out)}

/* ---- 外观一课：临时换一套颜色 ---- */
.tw-world.forced[data-look='glass']{--tw-bg:linear-gradient(135deg,#e9eef4,#dfe7f1 55%,#e8e3f0);--surface:rgb(255 255 255 / .76);--sidebar:rgb(255 255 255 / .7);--popup-glass:#fbfcfd;--ink:#1b1f26;--secondary:#4a5361;--muted:#6a7381;--line-soft:rgb(60 72 92 / .1);--glass-outline:rgb(28 40 48 / .13);--accent:#3b6fe0;--selection-solid:#cfe0ff;font-family:'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',system-ui,sans-serif}
.tw-world.forced[data-look='crystal']{--tw-bg:linear-gradient(135deg,#d6e6f2,#e6eef6 50%,#d9e2f3);--surface:rgb(255 255 255 / .5);--sidebar:rgb(255 255 255 / .44);--popup-glass:#f7fbfe;--ink:#17202a;--secondary:#435061;--muted:#64748a;--line-soft:rgb(60 90 120 / .12);--glass-outline:rgb(255 255 255 / .95);--accent:#1f8fd6;--selection-solid:#c8e4f8;--tw-radius:22px;font-family:'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',system-ui,sans-serif}
.tw-world.forced[data-look='warm']{--tw-bg:#f3efe6;--surface:#faf9f5;--sidebar:#f7f4ec;--popup-glass:#faf9f5;--ink:#3d2e1e;--secondary:#5e5040;--muted:#857660;--line-soft:rgb(61 46 30 / .1);--glass-outline:rgb(61 46 30 / .18);--accent:#c96442;--selection-solid:#f1d9b8;--tw-radius:8px;font-family:Georgia,'Source Han Serif SC','Songti SC',SimSun,serif}
.tw-world.forced[data-look='sketch']{--tw-bg:#efe9db;--surface:#fbf8f0;--sidebar:#fbf8f0;--popup-glass:#fbf8f0;--ink:#2e2d2a;--secondary:#4a4741;--muted:#6b675e;--line-soft:rgb(46 45 42 / .18);--glass-outline:rgb(46 45 42 / .72);--accent:#c8553d;--selection-solid:#fbe691;font-family:'Caveat','Ma Shan Zheng','Long Cang',KaiTi,STKaiti,cursive}
.tw-world.forced.dark{--tw-bg:#17181b;--surface:#26272b;--sidebar:#222327;--popup-glass:#2c2d31;--ink:#ececee;--secondary:#c5c6cb;--muted:#9a9ca3;--line-soft:rgb(255 255 255 / .09);--glass-outline:rgb(255 255 255 / .16);--selection-solid:#3a4a6b}
/* 自己的图片做底板：图铺满窗口，侧栏、顶栏、工具条、助手栏变薄，透出并模糊身后的图；书页保持实色。 */
.tw-wall{position:absolute;inset:0;width:100%;height:100%}
.tw-wall-enter-active{transition:opacity .9s var(--ease-soft)}
.tw-wall-enter-from{opacity:0}
.tw-world.forced.picture{--surface:rgb(255 255 255 / .36);--sidebar:rgb(255 255 255 / .3);--glass-outline:rgb(255 255 255 / .6);--line-soft:rgb(255 255 255 / .45);--ink:#16192a;--secondary:#2c3045;--muted:#454a60}
.tw-world.picture .tw-side,.tw-world.picture .tw-top,.tw-world.picture .tw-ai,.tw-world.picture .tw-bar{-webkit-backdrop-filter:blur(16px) saturate(1.7);backdrop-filter:blur(16px) saturate(1.7);box-shadow:inset 0 1px 0 rgb(255 255 255 / .75),inset 0 0 0 1px rgb(255 255 255 / .18),0 14px 36px -20px rgb(20 10 40 / .55)}
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
.tw-mark{display:flex;align-items:center;justify-content:flex-start;gap:9px;height:28px;padding:0 10px;color:var(--secondary);font-size:12px}
.tw-mark .tw-art{flex:none;width:30px;height:13px;clip-path:polygon(0 0,100% 0,100% 100%,0 100%,5px 50%)}
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
.tw-percent b{min-width:36px;padding:2px 4px;border-radius:6px;font-weight:600;text-align:center;color:var(--ink);transition:background-color .2s,color .2s}
.tw-percent.fit b{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
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
/* 书签：夹在页边上，跟着书页走；翻走以后滚动条旁多一道同色的刻度。 */
.tw-ribbons{position:absolute;left:calc(100% - 5px);top:76px;filter:drop-shadow(0 1px 2px rgb(0 0 0 / .42))}
.tw-ribbon{display:block;width:46px;height:19px;clip-path:polygon(0 0,100% 0,calc(100% - 7px) 50%,100% 100%,0 100%)}
.tw-ribbons.flip .tw-ribbon{scale:-1 1}
.tw-ribbons .tw-ribbon{transition:scale 0s,filter .2s}
.tw-ribbons.lifted{z-index:6;filter:drop-shadow(0 7px 9px rgb(0 0 0 / .42))}
.tw-ribbons.lifted .tw-ribbon{width:53px;height:22px}
.tw-ribbon-enter-active{transition:translate .45s var(--ease-spring),opacity .2s}
.tw-ribbon-leave-active{transition:opacity .15s}
.tw-ribbon-enter-from{translate:-30px 0;opacity:0}
.tw-ribbon-leave-to{opacity:0}
.tw-rail{position:absolute;right:6px;top:56px;bottom:20px;z-index:2;width:16px;border-right:1px solid color-mix(in srgb,var(--ink) 20%,transparent)}
.tw-line{position:absolute;right:0;width:11px;height:1.5px;border-radius:1px}
.tw-line::before{content:'';position:absolute;left:-2px;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:inherit}
.tw-railmark-enter-active{transition:translate .4s var(--ease-spring),opacity .2s}
.tw-railmark-leave-active{transition:opacity .15s,translate .2s}
.tw-railmark-enter-from,.tw-railmark-leave-to{translate:26px 0;opacity:0}

/* ---- 解释卡、译文 ---- */
.tw-card,.tw-trans{position:absolute;z-index:2;width:310px;padding:11px 14px 12px;border:1px solid var(--glass-outline);border-radius:14px;background:var(--popup-glass,var(--surface));box-shadow:0 18px 44px -18px rgb(0 0 0 / .42),0 2px 6px rgb(0 0 0 / .08);color:var(--ink);font:13.5px/1.62 var(--font-ui,system-ui);text-align:left;transform-origin:40% 0;transition:box-shadow .5s var(--ease-out),translate .45s var(--ease-spring),rotate .45s var(--ease-spring)}
.tw-world.forced :is(.tw-card,.tw-trans){font-family:inherit}
.tw-trans{width:330px}
.tw-card.pinned{box-shadow:0 8px 22px -12px rgb(0 0 0 / .34),0 1px 3px rgb(0 0 0 / .1),0 0 0 1px color-mix(in srgb,var(--accent) 38%,transparent);translate:0 3px;rotate:-.5deg}
.tw-card-enter-active{transition:opacity .22s var(--ease-out),scale .42s var(--ease-spring)}
.tw-card-enter-from{opacity:0;scale:.86}
.tw-card-head{display:flex;align-items:center;gap:6px}
.tw-card-head span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;font-size:12.5px;font-weight:650}
.tw-card-head .tw-card-ask{height:22px;padding:0 7px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:6px;font-weight:400;line-height:20px;color:var(--ink)}
.tw-card-head .tw-card-ask.empty{color:var(--muted)}
.tw-card .tw-card-q{margin:0 0 5px;padding-left:7px;border-left:2px solid color-mix(in srgb,var(--accent) 60%,transparent);color:var(--muted);font-size:12px;text-align:left}
.tw-card-head mark{background:linear-gradient(transparent 56%,color-mix(in srgb,var(--accent) 26%,transparent) 56%);color:inherit}
.tw-spark{flex:none;color:var(--accent)}
.tw-pin{display:grid;place-items:center;flex:none;width:22px;height:22px;border-radius:50%;color:var(--muted);rotate:35deg;transition:rotate .35s var(--ease-spring),color .2s,background-color .2s}
.tw-pin.on{rotate:0deg;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.tw-follow{display:grid;place-items:center;flex:none;width:22px;height:22px;border-radius:50%;color:var(--muted);animation:tw-bump .35s var(--ease-spring)}
.tw-follow svg{animation:tw-bump .3s var(--ease-spring)}
.tw-card.floating{rotate:0deg;translate:0 0;box-shadow:0 26px 60px -20px rgb(0 0 0 / .5),0 2px 8px rgb(0 0 0 / .12),0 0 0 1px color-mix(in srgb,var(--accent) 38%,transparent)}
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
.tw-menu .tw-art{flex:none;width:36px;height:15px;border-radius:2px;box-shadow:0 0 0 1px rgb(0 0 0 / .18)}
.tw-menu small{margin-left:auto;padding-left:14px;color:var(--muted);font-size:11px}
.tw-menu span.line0{margin-bottom:3px;border-bottom:1px solid var(--line-soft);border-radius:7px 7px 0 0;color:var(--secondary)}
.tw-mark-menu{right:-64px;top:96px}
/* 管理对话那一页：构成主义的红、黑、纸色，直角和斜线。 */
.tw-cm{--cm-red:#d23f2a;--cm-line:color-mix(in srgb,var(--ink) 58%,transparent);position:absolute;inset:0;z-index:14;display:grid;grid-template-columns:minmax(0,1fr) 330px;background:var(--canvas);color:var(--ink);text-align:left}
.tw-world[data-look='sketch'] .tw-cm{--cm-red:var(--red-pencil,#c0392b)}
.tw-cm-main{position:relative;padding:62px 0 0 64px;min-width:0}
.tw-cm-tools{position:absolute;left:18px;top:14px;display:flex;gap:7px}
.tw-cm-tools span{display:inline-flex;align-items:center;gap:5px;height:27px;padding:0 10px 0 8px;border:1.5px solid var(--ink);font-size:11.5px;font-weight:600}
.tw-cm-tools span.off{opacity:.3}
.tw-cm-tools kbd{margin-left:2px;font:inherit;font-size:10px;font-weight:400;opacity:.6}
.tw-cm-hero{display:flex;align-items:flex-end;gap:34px;width:max-content;margin-bottom:34px;padding-bottom:13px;border-bottom:4px solid var(--ink)}
.tw-cm-hero h2{display:flex;align-items:center;gap:12px;font-size:28px;font-weight:800;letter-spacing:.1em;line-height:1}
.tw-cm-hero h2 i{width:22px;height:25px;background:var(--cm-red);clip-path:polygon(0 0,100% 50%,0 100%)}
.tw-cm-hero dl{display:flex;gap:22px;margin:0}
.tw-cm-hero dl div{display:flex;align-items:baseline;gap:5px}
.tw-cm-hero dt{font-size:20px;font-weight:800;line-height:1}
.tw-cm-hero dd{margin:0;color:var(--muted);font-size:10.5px;letter-spacing:.14em}
.tw-cm-hero .red dt{color:var(--cm-red)}
.tw-cm-book{display:flex;align-items:center;margin-bottom:30px}
.tw-cm-root{display:flex;align-items:center;gap:11px;flex:none;width:212px}
.tw-cm-root>i{display:grid;place-items:center;flex:none;width:34px;height:34px;background:var(--ink);color:var(--canvas)}
.tw-cm-root>i.round{border-radius:50%;background:var(--cm-red);color:#fff}
.tw-cm-root span{display:grid;gap:3px;min-width:0}
.tw-cm-root b{font-size:13px;font-weight:700;line-height:1.25}
.tw-cm-root small{color:var(--muted);font-size:10.5px}
.tw-cm-knob{display:grid;place-items:center;flex:none;width:18px;height:18px;margin-left:7px;border:1.5px solid var(--ink);background:var(--canvas);font-size:10px;font-weight:700;line-height:1}
.tw-cm-knob.has{border-color:var(--cm-red);color:var(--cm-red)}
.tw-cm-knob.has.shut{background:var(--cm-red);color:#fff}
.tw-cm-kids{position:relative;display:flex;flex-direction:column;gap:8px;margin-left:46px}
.tw-cm-links{position:absolute;left:-46px;top:0;overflow:visible}
.tw-cm-links path{fill:none;stroke:var(--cm-line);stroke-width:1.3}
.tw-cm-kid{position:relative;display:flex;align-items:center;height:40px}
.tw-cm-talk{display:flex;align-items:center;gap:8px;flex:none;width:270px;height:36px;padding:0 11px;border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-left:5px solid var(--ink);background:var(--surface);font-size:12px;transition:opacity .15s,border-color .15s,background-color .15s,box-shadow .15s}
.tw-cm-talk.has{border-left-color:var(--cm-red)}
.tw-cm-talk b{flex:1;min-width:0;overflow:hidden;font-weight:400;white-space:nowrap;text-overflow:ellipsis}
.tw-cm-talk small{flex:none;color:var(--muted);font-size:10px}
.tw-cm-talk.picked{border-color:var(--cm-red);background:color-mix(in srgb,var(--cm-red) 10%,var(--surface));box-shadow:4px 4px 0 color-mix(in srgb,var(--cm-red) 30%,transparent)}
.tw-cm-talk.lifted{opacity:.35}
.tw-cm-side-list b{font-weight:600}
.tw-cm-side-list em{margin-left:8px;color:var(--muted);font-size:10.5px}
.tw-cm-slot{position:absolute;left:0;top:42.5px;z-index:2;width:270px;height:3px;background:var(--cm-red)}
.tw-cm-slot::before{content:'';position:absolute;left:-8px;top:-2.5px;width:8px;height:8px;background:var(--cm-red)}
.tw-cm-peek{position:absolute;left:292px;top:-4px;z-index:5;width:300px;padding:12px 14px 13px;border:1.5px solid var(--ink);background:var(--surface);box-shadow:6px 6px 0 color-mix(in srgb,var(--ink) 18%,transparent)}
.tw-cm-peek h5{margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid var(--cm-line);font-size:11.5px;font-weight:700}
.tw-cm-peek p{display:flex;align-items:flex-start;gap:9px;font-size:11.5px;line-height:1.6}
.tw-cm-peek p+p{margin-top:7px}
.tw-cm-peek i{display:grid;place-items:center;flex:none;width:17px;height:17px;margin-top:1px;background:var(--ink);color:var(--canvas);font-size:10px;font-weight:700}
.tw-cm-peek .answer i{background:var(--cm-red);color:#fff}
.tw-cm-peek .answer span{color:var(--secondary)}
.tw-cm-flash{position:absolute;left:20px;bottom:14px;display:flex;align-items:center;font-size:10.5px}
.tw-cm-flash{gap:12px;height:32px;padding:0 6px 0 12px;border-left:6px solid var(--cm-red);background:var(--ink);color:var(--canvas);font-size:11.5px}
.tw-cm-flash b{display:grid;place-items:center;height:23px;padding:0 9px;background:var(--cm-red);color:#fff;font-weight:700}
.tw-cm-flash:not(:has(b)){padding-right:12px}
.tw-cm-ghost{position:absolute;z-index:9;padding:3px 9px;background:var(--cm-red);color:#fff;font-size:10.5px;font-weight:600;white-space:nowrap}
.tw-cm-side{display:flex;flex-direction:column;border-left:4px solid var(--ink);background:color-mix(in srgb,var(--surface) 55%,var(--canvas))}
.tw-cm-art{display:block;width:100%;height:200px;border-bottom:4px solid var(--ink);background:var(--canvas)}
.tw-cm-art .l{fill:none;stroke:var(--ink);stroke-width:1.2}
.tw-cm-art .r{fill:none;stroke:var(--ink);stroke-width:3}
.tw-cm-art .k{fill:var(--ink)}
.tw-cm-art .w{fill:var(--cm-red)}
.tw-cm-side header{display:flex;align-items:baseline;gap:7px;padding:16px 20px 8px}
.tw-cm-side h3{margin-right:auto;font-size:19px;font-weight:800;letter-spacing:.12em}
.tw-cm-side header b{color:var(--cm-red);font-size:22px;font-weight:800;line-height:1}
.tw-cm-side header span{color:var(--muted);font-size:10.5px}
.tw-cm-side-list{padding:0 20px}
.tw-cm-side-list h4{display:flex;align-items:center;gap:8px;margin:14px 0 5px;font-size:11px;font-weight:700}
.tw-cm-side-list h4::before{content:'';width:14px;height:4px;background:var(--ink)}
.tw-cm-side-list h4 span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tw-cm-side-list h4 small{color:var(--muted);font-size:10.5px;font-weight:400}
.tw-cm-side-list h4 svg{color:var(--muted);rotate:-90deg}
/* 记忆栏的一条：拿起来时放大一点、带硬投影，别的条目跟着让位。 */
.tw-mem-rows{display:flex;flex-direction:column}
.tw-mem-row{position:relative;display:flex;align-items:center;height:28px;padding-left:4px;background:transparent;font-size:11.5px;transition:translate .32s var(--ease-spring),scale .2s,box-shadow .2s,background-color .2s}
.tw-mem-rows.still .tw-mem-row{transition:none}
.tw-mem-row.lifted{z-index:2;scale:1.04;background:var(--surface);box-shadow:5px 5px 0 color-mix(in srgb,var(--ink) 18%,transparent),0 0 0 1.5px var(--ink);transition:scale .2s,box-shadow .2s,background-color .2s}
.tw-mem-row.fresh{animation:tw-sum-new 2.2s ease-out both}
.tw-grip{flex:none;margin-right:4px;color:var(--muted);opacity:0;transition:opacity .2s}
.tw-mem-row.lifted .tw-grip{opacity:1}
.tw-mem-row span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tw-cm-side-list .tw-mem-ask{position:relative;clip-path:inset(-4px 0 -3px 0);display:flex;align-items:center;gap:4px;height:32px;margin:2px 0 10px;border-bottom:1.5px solid var(--ink);font-size:11.5px}
.tw-mem-ask em{flex:1;min-width:0;overflow:hidden;white-space:nowrap;color:var(--muted)}
.tw-mem-ask.typed em{flex:none;color:var(--ink)}
.tw-mem-ask b{display:grid;place-items:center;flex:none;width:22px;height:22px;margin-left:auto;color:var(--ink)}
.tw-mem-ask.busy::after{content:'';position:absolute;left:0;bottom:-1.5px;width:36%;height:1.5px;background:linear-gradient(90deg,transparent,var(--cm-red),transparent);animation:tw-mem-run 1.15s cubic-bezier(.45,0,.55,1) infinite}
@keyframes tw-mem-run{from{translate:-100% 0}to{translate:280% 0}}
.tw-cm-side-list .tw-mem-note{display:block;height:auto;margin:-4px 0 10px;padding:0;color:var(--secondary);font-size:11px;line-height:1.5;animation:tw-appear .25s}
.tw-mem-note b{margin-left:10px;color:var(--cm-red);font-weight:700;text-decoration:underline;text-underline-offset:3px}
/* 管理页的搜索框和结果：一列卡片，命中的字是红的。 */
.tw-cm-tools .tw-cm-find{width:210px;margin-left:8px;padding:0 9px;font-weight:400;transition:width .2s var(--ease-out),box-shadow .15s}
.tw-cm-find em{flex:1;color:var(--muted)}
.tw-cm-tools .tw-cm-find.typed{width:290px;box-shadow:4px 4px 0 color-mix(in srgb,var(--cm-red) 30%,transparent)}
.tw-cm-find.typed em{flex:none;color:var(--ink)}
.tw-cm-hits{display:flex;flex-direction:column;gap:6px;max-width:640px;animation:tw-page .3s var(--ease-out)}
.tw-cm-hit{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:4px 16px;padding:11px 12px 11px 14px;border-left:4px solid var(--ink);border-bottom:1px solid var(--cm-line);background:var(--surface)}
.tw-cm-hit strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13.5px;font-weight:650}
.tw-cm-hit small{color:var(--muted);font-size:11px;white-space:nowrap}
.tw-cm-hit em{grid-column:1 / -1;color:var(--secondary);font-size:12.5px;line-height:1.6}
.tw-cm-hit mark{padding:0;background:none;color:var(--cm-red);font-weight:700}
.tw-file-menu{left:420px;top:178px}
.tw-menu span.danger{color:#d0453a}
.tw-file .tw-rename{display:flex;align-items:center;height:22px;margin-top:8px;padding:0 6px;border:1px solid var(--accent);border-radius:6px;background:var(--surface);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
.tw-rename span{overflow:hidden;white-space:nowrap}
.tw-rename span.all{background:var(--selection-solid,#cfe0ff)}
/* 窗口底部的提示：一条圆角的胶囊，右边一颗叉。 */
.tw-toast{position:absolute;left:50%;bottom:92px;z-index:20;display:flex;align-items:center;gap:14px;height:36px;padding:0 12px 0 18px;border:1px solid var(--glass-outline);border-radius:999px;background:var(--popup-glass,var(--surface));box-shadow:0 18px 40px -16px rgb(0 0 0 / .45);color:var(--ink);font:500 12.5px/1 var(--font-ui,system-ui);white-space:nowrap;translate:-50% 0}
.tw-world.forced .tw-toast{font-family:inherit}
.tw-toast svg{color:var(--muted)}
.tw-menu span.hot{background:color-mix(in srgb,var(--ink) 9%,transparent);color:var(--ink)}
/* 总结：助手栏里的表、发出去的表、盖在书页上的草稿。 */
.tw-sum{display:flex;flex-direction:column;padding:12px 13px 12px;border:1px solid var(--glass-outline);border-radius:12px;background:var(--surface);font-size:12.5px;animation:tw-page .3s var(--ease-out)}
.tw-sum h4{display:flex;align-items:baseline;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--line-soft);font-size:14px;font-weight:650}
.tw-sum h4 small,.tw-sumreq small{color:var(--muted);font-size:11.5px;font-weight:400}
.tw-sum-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:31px;border-bottom:1px solid var(--line-soft)}
.tw-sum-row b{font-weight:550}
.tw-sum-row b.dim{opacity:.55}
.tw-sum-row em{color:var(--secondary);font-style:normal}
.tw-sum-row em.none{color:var(--muted)}
.tw-sum-list{display:grid;gap:1px;margin:2px 0 8px;padding:4px;border:1px solid var(--line-soft);border-radius:8px}
.tw-sum-ch{display:flex;align-items:center;gap:7px;height:25px;font-size:12px}
.tw-sum-ch.sub{padding-left:30px;color:var(--secondary);animation:tw-page .25s var(--ease-out)}
.tw-sum-ch span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tw-sum-ch small{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.tw-sum-ch i{position:relative;flex:none;width:12px;height:12px;border:1.5px solid color-mix(in srgb,var(--ink) 42%,transparent);border-radius:3px;transition:background-color .2s,border-color .2s}
.tw-sum-ch i.on{border-color:var(--accent);background:var(--accent)}
.tw-sum-ch i.on::after{content:'';position:absolute;left:3px;top:.5px;width:3px;height:6px;border:solid #fff;border-width:0 1.6px 1.6px 0;rotate:45deg}
.tw-sum-ch i.mixed{border-color:var(--accent)}
.tw-sum-ch i.mixed::after{content:'';position:absolute;left:2px;right:2px;top:calc(50% - 1px);height:2px;border-radius:1px;background:var(--accent)}
.tw-sum-caret{flex:none;width:14px;color:var(--muted);rotate:180deg;transition:rotate .25s var(--ease-spring)}
.tw-sum-caret.on{rotate:-90deg}
.tw-switch{position:relative;flex:none;width:30px;height:18px;border-radius:999px;background:color-mix(in srgb,var(--ink) 20%,transparent);transition:background-color .25s}
.tw-switch::after{content:'';position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / .25);transition:translate .3s var(--ease-spring)}
.tw-switch.on{background:var(--accent)}
.tw-switch.on::after{translate:12px 0}
.tw-switch.dim{opacity:.55}
.tw-sum-go{align-self:flex-end;display:grid;place-items:center;height:30px;margin-top:11px;padding:0 16px;border-radius:9px;background:var(--accent);color:#fff;font-size:12.5px;font-weight:600}
.tw-sumreq{align-self:flex-end;display:grid;gap:4px;width:92%;padding:10px 12px;border:1px solid var(--line-soft);border-radius:11px;font-size:12px;animation:tw-page .3s var(--ease-out)}
.tw-sumreq b{display:flex;align-items:baseline;gap:8px;padding-bottom:6px;border-bottom:1px solid var(--line-soft);font-size:13px}
.tw-sumreq p{display:flex;gap:10px}
.tw-sumreq em{flex:none;color:var(--muted);font-style:normal}
.tw-draftchip{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);border-radius:8px;background:color-mix(in srgb,var(--accent) 9%,transparent);font-size:12px;font-variant-numeric:tabular-nums;animation:tw-page .3s var(--ease-out)}
.tw-draftchip svg{color:var(--accent)}
.tw-draft{position:absolute;left:224px;right:330px;top:72px;bottom:14px;z-index:4;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--glass-outline);border-radius:var(--tw-radius);background:var(--surface);box-shadow:0 18px 44px -24px rgb(0 0 0 / .3)}
.tw-draft header{position:relative;display:flex;align-items:center;gap:10px;flex:none;height:46px;padding:0 12px 0 20px;border-bottom:1px solid var(--line-soft);font-size:12.5px}
.tw-draft header b{font-size:14px;font-weight:650}
.tw-draft header small{flex:1;color:var(--muted)}
.tw-draft header em{color:var(--muted);font-style:normal;font-variant-numeric:tabular-nums}
.tw-draft header em.live{color:var(--accent)}
.tw-draft header.running::after{content:'';position:absolute;left:0;bottom:-1px;width:38%;height:2px;border-radius:1px;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:tw-run 1.15s cubic-bezier(.45,0,.55,1) infinite}
.tw-draft-saved{color:var(--secondary);text-decoration:underline;text-underline-offset:3px;animation:tw-bump .4s var(--ease-spring)}
.tw-draft-save{display:grid;place-items:center;height:30px;padding:0 14px;border-radius:9px;background:var(--accent);color:#fff;font-weight:600;transition:opacity .3s}
.tw-draft-save.dim{opacity:.4}
.tw-draft article{flex:1;padding:30px 44px;font-size:14px;line-height:1.8}
.tw-draft h1{margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--line-soft);font-size:22px;font-weight:650;line-height:1.35}
.tw-draft h2{margin:16px 0 6px;font-size:15.5px;font-weight:650}
.tw-draft p{position:relative}
.tw-sum-sel{border-radius:2px;background:color-mix(in srgb,var(--accent) 26%,transparent)}
.tw-sum-a,.tw-sum-b{display:inline-block;width:0;height:1em;vertical-align:-.15em}
.tw-sum-new{margin-top:8px;border-radius:4px;animation:tw-sum-new 2.2s ease-out both}
@keyframes tw-sum-new{from{background:color-mix(in srgb,var(--accent) 22%,transparent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 22%,transparent)}to{background:transparent;box-shadow:0 0 0 6px transparent}}
.tw-draft-ask{position:absolute;left:150px;top:calc(100% + 8px);z-index:2;display:flex;align-items:center;gap:8px;width:250px;height:38px;padding:0 5px 0 13px;border:1px solid color-mix(in srgb,var(--ink) 22%,transparent);border-radius:11px;background:var(--surface);box-shadow:0 12px 30px -12px rgb(0 0 0 / .4);color:var(--muted);font-size:12.5px;line-height:1}
.tw-draft-ask>span{flex:1;white-space:nowrap;overflow:hidden}
.tw-draft-ask>span.typed{color:var(--ink)}
.tw-draft-send{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff}
/* 侧栏的书签按书分开；拿起一本时它浮起来，另一本让位。 */
.tw-mkbooks{display:flex;flex-direction:column}
.tw-mkbook{position:relative;border-radius:8px;transition:translate .34s var(--ease-spring),box-shadow .2s,background-color .2s}
.tw-mkbook.lifted{z-index:2;background:var(--surface);box-shadow:0 10px 24px -10px rgb(0 0 0 / .45);transition:box-shadow .2s,background-color .2s}
.tw-mkbooks.still .tw-mkbook{transition:none}
.tw-mkname{margin:5px 10px 1px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--secondary);font-size:11.5px;font-weight:600}
/* 新对话的记忆：三个词，选中的下面一道线。 */
.tw-mem{display:flex;align-items:center;gap:14px;margin-top:14px;font-size:11.5px;letter-spacing:.08em}
.tw-mem em{font-style:normal;opacity:.7}
.tw-mem b{position:relative;padding:3px 1px;font-weight:400;transition:color .2s}
.tw-mem b::after{content:'';position:absolute;left:1px;right:1px;bottom:0;height:1.5px;border-radius:1px;background:var(--accent);scale:0 1;transition:scale .3s var(--ease-spring)}
.tw-mem b.on{color:var(--ink)}
.tw-mem b.on::after{scale:1 1}
.tw-world[data-look='sketch'] :is(.tw-sum,.tw-sumreq,.tw-draft,.tw-draft-ask){border-width:1.5px}
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
.tw-ghost{position:absolute;z-index:19;display:flex;align-items:center;gap:7px;height:34px;margin:10px 0 0 14px;padding:0 13px;border:1px solid var(--glass-outline);border-radius:10px;background:var(--popup-glass,var(--surface));box-shadow:0 18px 40px -16px rgb(0 0 0 / .5);font-size:12.5px;font-weight:600;rotate:-4deg}
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
.tw-manage{display:grid;place-items:center;flex:none;width:26px;height:26px;margin-left:-4px;border-radius:8px;color:var(--secondary)}
.tw-title{display:flex;align-items:baseline;gap:6px;flex:1;min-width:0;overflow:hidden;white-space:nowrap}
.tw-title b{overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:650}
.tw-title small{overflow:hidden;text-overflow:ellipsis;color:var(--muted);font-size:11px}
.tw-hbtns{display:flex;align-items:center;gap:11px;flex:none;color:var(--muted)}
/* 对话记录：表头标题下弹出；最上面一行新对话、管理，下面是搜索框。 */
.tw-hist{position:absolute;left:-4px;right:-4px;top:30px;z-index:8;display:flex;flex-direction:column;padding:6px;border:1px solid var(--glass-outline);border-radius:12px;background:linear-gradient(var(--popup-glass,var(--surface)),var(--popup-glass,var(--surface))),var(--popup-glass,var(--surface));-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px);box-shadow:0 22px 50px -20px rgb(0 0 0 / .5),0 2px 6px rgb(0 0 0 / .08);font-size:12.5px}
.tw-hist-top{display:flex;gap:4px}
.tw-hist-top p{display:flex;align-items:center;gap:6px;height:28px;padding:0 9px;border-radius:7px;font-weight:600}
.tw-hist-top p+p{color:var(--secondary);font-weight:500}
.tw-hist-search{display:flex;align-items:center;gap:7px;height:30px;margin-top:4px;padding:0 10px;border-bottom:1px solid var(--line-soft);color:var(--muted)}
.tw-hist-search em{overflow:hidden;white-space:nowrap}
.tw-hist-search.typed{border-bottom-color:var(--ink);color:var(--ink)}
.tw-hist-scope{display:flex;gap:4px;margin:6px 0 2px}
.tw-hist-scope p{flex:1;height:24px;border-radius:6px;color:var(--muted);font-size:11.5px;line-height:24px;text-align:center}
.tw-hist-scope p.on{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink);font-weight:600}
.tw-hist-row{display:grid;gap:1px;padding:6px 9px;border-radius:8px}
.tw-hist-search+.tw-hist-row{margin-top:6px}
.tw-hist-row.current{background:color-mix(in srgb,var(--ink) 6%,transparent)}
.tw-hist-row strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.tw-hist-row small{color:var(--muted);font-size:11px}
.tw-hist-row em{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin-top:2px;color:var(--secondary);font-size:11.5px;line-height:1.5}
.tw-hist-row mark{padding:0;background:none;color:var(--accent);font-weight:700}
.tw-hist-hit{animation:tw-page .25s var(--ease-out) both}
.tw-hist-hit-1{animation-delay:.05s}.tw-hist-hit-2{animation-delay:.1s}
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
/* 输入框旁的小圆环：离自动压缩还有多远。 */
.tw-context{--ratio:0;flex:none;width:18px;height:18px;margin-left:auto;rotate:-90deg}
.tw-context circle{fill:none;stroke:color-mix(in srgb,var(--ink) 14%,transparent);stroke-width:2.6}
.tw-context circle+circle{stroke:var(--secondary);stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:calc(100 - var(--ratio) * 100)}
.tw-send{display:grid;place-items:center;flex:none;width:30px;height:30px;margin-left:6px;border-radius:50%;background:var(--ink);color:var(--surface)}
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
.tw-bgs,.tw-gallery{display:flex;gap:12px}
.tw-bgs p,.tw-gallery p{display:grid;justify-items:center;gap:5px;width:66px;color:var(--secondary);font-size:11px;white-space:nowrap}
.tw-bgs i,.tw-gallery svg,.tw-gallery i{display:block;width:66px;height:44px;border:1px solid var(--line-soft);border-radius:9px;transition:box-shadow .25s}
.tw-bgs i.on,.tw-gallery svg.on{box-shadow:0 0 0 2px var(--popup-glass,#fff),0 0 0 4px var(--accent)}
.tw-bg-0{background:linear-gradient(135deg,#e9eef4,#e8e3f0)}.tw-bg-1{background:linear-gradient(135deg,#f6e3cf,#f0c9c9)}.tw-bg-2{background:linear-gradient(135deg,#cfe8dc,#b9d6e6)}.tw-bg-3{background:linear-gradient(135deg,#e3dcf3,#cdb9e6)}.tw-bg-4{background:#3a3c42}.tw-bg-5{background:#f7f6f2}
.tw-pane .tw-gallery-head{display:flex;align-items:baseline;gap:8px;margin:16px 0 8px;color:var(--secondary);font-size:12px;font-weight:600}
.tw-gallery-head small{color:var(--muted);font-weight:400}
.tw-gallery svg{overflow:hidden}
.tw-gallery-own{animation:tw-bump .45s var(--ease-spring)}
.tw-gallery i{display:grid;place-items:center;border-style:dashed;color:var(--muted)}
/* 选图片的窗口：示意系统的打开文件框。 */
.tw-picker{position:absolute;left:520px;top:300px;z-index:9;width:340px;padding:12px 14px;border:1px solid var(--glass-outline);border-radius:12px;background:var(--popup-glass,var(--surface));box-shadow:0 30px 70px -24px rgb(0 0 0 / .55);font:12px/1.3 var(--font-ui,system-ui)}
.tw-world.forced .tw-picker{font-family:inherit}
.tw-picker header{display:flex;align-items:center;gap:7px;margin-bottom:10px;font-weight:600}
.tw-picker header small{margin-left:auto;color:var(--muted);font-weight:400}
.tw-picks{display:flex;gap:12px}
.tw-picks p{display:grid;justify-items:center;gap:6px;flex:1;padding:6px;border-radius:8px;color:var(--secondary);font-size:11px;white-space:nowrap}
.tw-picks svg,.tw-picks i{display:block;width:92px;height:62px;border-radius:5px;box-shadow:0 0 0 1px rgb(0 0 0 / .12)}
.tw-picks .tw-pick-0{background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--ink)}
.tw-picks i.snow{background:linear-gradient(170deg,#c9dcef 0 38%,transparent 38%),linear-gradient(140deg,transparent 46%,#f4f7fb 46% 60%,#7f93ad 60%),linear-gradient(#9fb6cf,#5c7088)}
.tw-picks i.desk{background:radial-gradient(circle at 70% 30%,#f6e4bf 0 12%,transparent 13%),linear-gradient(#cdb08c 0 62%,#8a6748 62%)}
.tw-picker footer{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.tw-picker footer b{display:grid;place-items:center;height:26px;padding:0 14px;border:1px solid var(--line-soft);border-radius:6px;font-weight:500}
.tw-picker footer b:first-child{border-color:transparent;background:var(--accent);color:#fff}
/* 新底板预览：设置窗让开，底部一条「不采用 / 采用」。 */
.tw-dialog.peek{opacity:0;scale:.97}
.tw-scene-bar{position:absolute;left:50%;bottom:96px;z-index:12;display:flex;align-items:center;gap:10px;height:42px;padding:0 6px 0 18px;border:1px solid rgb(255 255 255 / .65);border-radius:999px;background:rgb(255 255 255 / .5);-webkit-backdrop-filter:blur(16px) saturate(1.6);backdrop-filter:blur(16px) saturate(1.6);box-shadow:inset 0 1px 0 rgb(255 255 255 / .8),0 18px 40px -16px rgb(20 10 40 / .55);color:var(--ink);font-size:12.5px;font-weight:600;white-space:nowrap;translate:-50% 0}
.tw-scene-bar span{margin-right:6px}
.tw-scene-bar b{display:grid;place-items:center;height:30px;padding:0 16px;border-radius:999px;background:rgb(255 255 255 / .55);font-weight:500}
.tw-scene-bar b.tw-scene-ok{background:var(--accent);color:#fff;font-weight:600}

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
/* 截图一课：拖出来的框、快捷提问的气泡、输入框里的小图。 */
.tw-cropbtn{display:grid;place-items:center;width:28px;height:26px;margin:0 -6px;border-radius:8px;transition:background-color .2s,color .2s}
.tw-cropbtn.on{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
.tw-frame{position:absolute;z-index:9;box-sizing:border-box;border:1.5px dashed var(--accent);border-radius:4px;background:color-mix(in srgb,var(--accent) 9%,transparent);transition:box-shadow .35s var(--ease-out),border-radius .3s,background-color .3s}
.tw-frame.set{border:1.5px solid rgb(255 255 255 / .92);border-radius:7px;background:none;box-shadow:0 0 0 1px rgb(0 0 0 / .22),0 0 24px 2px color-mix(in srgb,var(--accent) 45%,transparent)}
.tw-dim{position:absolute;inset:0;z-index:9;background:rgb(12 16 26 / .3)}
.tw-frame i{position:absolute;width:10px;height:10px;border:2.5px solid #fff;opacity:0;transition:opacity .3s}
.tw-frame.set i{opacity:1}
.tw-frame i:nth-child(1){left:-4px;top:-4px;border-right:0;border-bottom:0;border-top-left-radius:6px}
.tw-frame i:nth-child(2){right:-4px;top:-4px;border-left:0;border-bottom:0;border-top-right-radius:6px}
.tw-frame i:nth-child(3){right:-4px;bottom:-4px;border-left:0;border-top:0;border-bottom-right-radius:6px}
.tw-frame i:nth-child(4){left:-4px;bottom:-4px;border-right:0;border-top:0;border-bottom-left-radius:6px}
.tw-quick{position:absolute;z-index:10;display:flex;flex-direction:column;align-items:flex-start;gap:7px;translate:0 -50%;font:12.5px/1.3 var(--font-ui,system-ui);white-space:nowrap}
.tw-quick>span,.tw-quick-own{display:flex;align-items:center;gap:7px;border:1px solid var(--glass-outline);border-radius:999px;background:var(--popup-glass,var(--surface));color:var(--ink);box-shadow:0 10px 24px -14px rgb(0 0 0 / .55)}
.tw-quick .tw-thinking{height:24px;padding:0 10px 0 8px;font-size:11px;font-weight:600;letter-spacing:.3px}
.tw-thinking svg,.tw-quick-own svg{color:var(--accent)}
.tw-quick .tw-bubble{height:32px;padding:0 8px 0 14px;animation:tw-bubble .42s var(--ease-spring) both}
@keyframes tw-bubble{from{opacity:0;translate:-18px 0;scale:.6}}
.tw-quick kbd{display:grid;place-items:center;min-width:18px;height:18px;padding:0 4px;border-radius:5px;background:color-mix(in srgb,var(--ink) 9%,transparent);color:var(--muted);font:600 10px/1 var(--font-ui,system-ui)}
.tw-quick .tw-quick-foot{gap:8px;margin-top:3px;border:0;background:none;box-shadow:none}
.tw-quick-own{height:28px;padding:0 12px 0 10px;font-size:12px}
.tw-quick-foot>kbd{height:22px;padding:0 7px;background:var(--popup-glass,var(--surface));box-shadow:0 0 0 1px var(--glass-outline)}
.tw-ctx{z-index:11;min-width:190px}
.tw-shots{--tw-red:#e5484d;display:flex;gap:12px;padding:4px 6px 0}
.tw-world[data-look='warm'] .tw-shots{--tw-red:var(--accent)}
.tw-world[data-look='sketch'] .tw-shots{--tw-red:var(--red-pencil,#c0392b)}
.tw-shot{flex:none;width:58px;height:40px;border-radius:5px;background:#fffefb;color:#23252b;overflow:hidden;outline:1.5px dashed var(--accent);outline-offset:2px;box-shadow:0 4px 12px -6px rgb(0 0 0 / .4);font-weight:400;transition:outline-color .2s}
.tw-shot i{display:block;padding:6px 6px 0;font:italic 6.5px/1.55 Georgia,'Source Han Serif SC','Noto Serif CJK SC',SimSun,serif}
.tw-shot.kept{outline:2px solid var(--tw-red);box-shadow:0 0 0 5px color-mix(in srgb,var(--tw-red) 14%,transparent);animation:tw-kept .42s var(--ease-spring)}
@keyframes tw-kept{0%{scale:1}35%{scale:.88}70%{scale:1.08}100%{scale:1}}
.tw-shot-enter-active{transition:opacity .25s,scale .36s var(--ease-spring)}
.tw-shot-enter-from{opacity:0;scale:.6}
.tw-shot.flat{width:44px;height:30px;outline:0;box-shadow:0 0 0 1px rgb(0 0 0 / .12)}
.tw-me-shots{display:grid;gap:7px;justify-items:end}
.tw-me-shots>span{display:flex;gap:6px}
</style>
