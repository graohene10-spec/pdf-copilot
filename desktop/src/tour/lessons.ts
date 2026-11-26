import type { Director, Point } from './director'
import { outline, type PlanScene } from './lesson-outline'
import { learn, freshLearn, type LearnScene } from './lesson-learn'

/* 示意界面的状态：脚本只改这里，画面跟着变。 */
export type Look = 'glass' | 'crystal' | 'warm' | 'sketch'
export type SlotId = 'assistant' | 'translation' | 'explain'
export type Scene = {
  /** board 是学习进度页（大纲与进度一课）。 */
  view: 'reader' | 'library' | 'board'
  /** 外观一课里临时换的风格；空着就跟随应用当前的风格。 */
  look: '' | Look
  dark: boolean
  /** 外观一课：选图片的窗口开着、底板换成了自己的图片、设置窗让开在预览新底板。 */
  picker: boolean
  picture: boolean
  preview: boolean
  chrome: boolean
  ai: boolean
  doc: 'algebra' | 'paper'
  split: boolean
  scroll: number
  zoom: number
  /** 百分比按钮按下：适应宽度。 */
  fit: boolean
  /** 目标句子已经选中了多少个字。 */
  selected: number
  card: 'none' | 'open' | 'pinned'
  /** 卡片、译文出现在书页上的位置。 */
  cardAt: Point
  running: boolean
  words: number
  drawn: boolean
  visual: boolean
  lambda: number
  settings: '' | 'ai' | 'look'
  link: boolean
  key: number
  codex: boolean
  slots: Record<SlotId, string>
  menu: '' | SlotId
  draft: string
  asked: boolean
  answer: number
  quote: boolean
  quotePop: boolean
  side: boolean
  sideAsk: string
  sideAnswer: number
  branch: boolean
  commands: boolean
  /** 上下文圆环填到几成（null 用默认）；compacting 是正在压缩。 */
  ctxFill: number | null
  compacting: boolean
  btw: boolean
  btwAnswer: number
  pop: boolean
  column: boolean
  auto: boolean
  ink: '' | 'pen' | 'highlighter' | 'underline'
  hl: number
  pen: number
  ul: number
  mark: boolean
  art: number
  markMenu: boolean
  files: number
  ghost: Point | null
  query: string
  fileMenu: boolean
  grouped: boolean
  starred: boolean
  outline: boolean
  finding: boolean
  find: string
  clock: 'idle' | 'open' | 'running' | 'ringing'
  minutes: number
  /** 固定的卡片在哪一层：跟着书页走，或停在屏幕上（hold 是切过去那一刻书页滚到了哪）。 */
  follow: 'page' | 'screen'
  hold: number
  /** 截图一课：框选工具开着、正在拖的框（画布坐标）、快捷提问气泡、右键菜单、输入框里的图。 */
  crop: boolean
  frame: { x: number; y: number; width: number; height: number } | null
  quick: boolean
  ctx: Point | null
  rightOn: boolean
  quickOff: boolean
  shots: number
  kept: number
  /** 解释卡片上的自由提问：标题变成输入框、问的那句话、回答写了多少字。 */
  asking: boolean
  cardDraft: string
  cardAsk: boolean
  cardAnswer: number
  shotSent: boolean
  shotAnswer: number
  /** 文库一课：窗口缩小、露出桌面的程度，0 到 1。 */
  desk: number
  /** 书签拖动：平的那一头在书页上的位置（没拖过是 null，贴在右边）、有没有掉头、是不是正拿在手里。 */
  ribbonAt: Point | null
  ribbonFlip: boolean
  ribbonLift: boolean
  /** 管理对话一课：管理页、悬停预览、正在拖（指针在哪）、落点红线、移过去了没有、左下角的提示、搜索框里的字。 */
  manager: boolean
  cmPeek: boolean
  cmDrag: Point | null
  cmSlot: boolean
  cmMoved: boolean
  cmFlash: '' | 'moved' | 'undone'
  cmQuery: string
  /** 记忆栏：拿着的那条挪了多少、下面那条让了多少、换过来了没有、这一下不要过渡；让助手改的那句话、在改、改完的那行字、合并了没有。 */
  memDrag: number | null
  memShift: number
  memSwap: boolean
  memStill: boolean
  memAsk: string
  memBusy: boolean
  memNote: string
  memMerged: boolean
  /** 助手栏表头的对话标题、对话记录开着、对话记录里搜索框的字。 */
  talk: string
  histOpen: boolean
  histQuery: string
  /** 新对话的记忆选哪一种。 */
  mem: 'book' | 'all' | 'off'
  /** 总结一课：停在哪一步（表、草稿）、第 5 章展开了没有、勾了几节、不遗漏开了没有、草稿写了多少字、划选了多少字、小输入框和里面的字、改好了没有、存了没有。 */
  sum: '' | 'setup' | 'draft'
  sumFold: boolean
  sumPicked: number
  sumFull: boolean
  sumWords: number
  sumSel: number
  sumAsk: boolean
  sumNote: string
  sumSent: boolean
  sumFixed: boolean
  sumSaved: boolean
  /** 书签一课最后：侧栏里拖书的顺序。拿着的那本挪了多少、另一本让了多少、换过来了没有、这一下不要过渡。 */
  markDrag: number | null
  markShift: number
  markSwap: boolean
  markStill: boolean
  /** 文库一课：右键菜单里指着哪一项。 */
  fileHover: '' | 'sum' | 'rename' | 'details' | 'reveal'
  /** 文库一课：第二张卡片的名字正在改（输入框里的字，null 是没在改）、改好的名字。 */
  renaming: string | null
  fileName: string
  /** 窗口底部的提示。 */
  toast: string
  /** 大纲与进度一课：大纲栏、学习进度页、文库书卡上的进度条；别的课里是 null。 */
  plan: PlanScene | null
  /** 学习一课：设定表、摸底和带读的对话、助手栏左边的大纲。 */
  learn: LearnScene
}

export const freshScene = (): Scene => ({
  view: 'reader', look: '', dark: false, picker: false, picture: false, preview: false, chrome: true, ai: true, doc: 'algebra', split: false, scroll: 0, zoom: 1, fit: false, selected: 0,
  card: 'none', cardAt: { x: 0, y: 0 }, running: false, words: 0, drawn: false, visual: false, lambda: 2.5,
  settings: '', link: false, key: 0, codex: false, slots: { assistant: '未选择', translation: '未选择', explain: '未选择' }, menu: '',
  draft: '', asked: false, answer: 0, quote: false, quotePop: false, side: false, sideAsk: '', sideAnswer: 0, branch: false, commands: false, ctxFill: null, compacting: false, btw: false, btwAnswer: 0,
  pop: false, column: false, auto: false, ink: '', hl: 0, pen: 0, ul: 0, mark: false, art: 0, markMenu: false,
  files: 6, ghost: null, query: '', fileMenu: false, grouped: false, starred: false, outline: false, finding: false, find: '', clock: 'idle', minutes: 5, follow: 'page', hold: 0, desk: 0,
  crop: false, frame: null, quick: false, ctx: null, rightOn: false, quickOff: false, shots: 0, kept: 0, shotSent: false, shotAnswer: 0, asking: false, cardDraft: '', cardAsk: false, cardAnswer: 0,
  ribbonAt: null, ribbonFlip: false, ribbonLift: false, manager: false, cmPeek: false, cmDrag: null, cmSlot: false, cmMoved: false, cmFlash: '', cmQuery: '',
  memDrag: null, memShift: 0, memSwap: false, memStill: false, memAsk: '', memBusy: false, memNote: '', memMerged: false, talk: '', histOpen: false, histQuery: '',
  mem: 'book', sum: '', sumFold: false, sumPicked: 0, sumFull: false, sumWords: 0, sumSel: 0, sumAsk: false, sumNote: '', sumSent: false, sumFixed: false, sumSaved: false, fileHover: '', markDrag: null, markShift: 0, markSwap: false, markStill: false, renaming: null, fileName: '', toast: '',
  plan: null,
  learn: freshLearn(),
})

export const TEXT = {
  sentence: '若存在非零向量 v 使得 Av = λv，则称 λ 为 A 的特征值，v 为属于 λ 的特征向量。',
  answer: '大多数向量被 A 作用后会转向。特征向量是例外：它留在原来那条直线上，只被拉长或缩短 λ 倍。',
  english: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.',
  chinese: '主流的序列转换模型基于复杂的循环或卷积神经网络，其中包含一个编码器和一个解码器。',
  question: '特征值有什么用？',
  reply: ['它指出一个变换在哪些方向上只做伸缩。找到这些方向，矩阵就能', '对角化', '，高次幂和微分方程都好算得多。'],
  sideAsk: '对角化是什么意思？',
  sideReply: '换一组基，让矩阵只剩对角线上的数。',
  btwAsk: 'λ 可以是 0 吗',
  btwReply: '可以。λ = 0 表示 A 把这个方向压成了零向量，这时 A 不可逆。',
  cardAsk: 'λ 是负数会怎样？',
  cardReply: 'v 仍然留在原来那条直线上，只是被翻到反方向，长度变成 |λ| 倍。',
  shotAsk: '针对框选的内容解释「为什么」',
  shotReply: '三张图是同一条线索：定义给出 Av = λv，特征方程求出 λ，定理 5.2 保证实对称矩阵的 λ 都是实数。',
}
/* 总结一课里草稿上写的东西。 */
export const SUM = {
  title: '第5章 特征值与特征向量',
  blocks: [
    ['h2', '5.1 定义'],
    ['p', '若存在非零向量 v 使 Av = λv，λ 叫 A 的特征值，v 是属于 λ 的特征向量。'],
    ['h2', '5.2 特征方程'],
    ['p', 'λ 是特征值，当且仅当 det(A − λI) = 0。'],
  ] as ['h2' | 'p', string][],
  parts: [['5.1 定义', '87–92'], ['5.2 特征方程', '92–101'], ['5.3 对角化', '101–120']],
  say: '读了 5.1、5.2 两节，按原文的顺序写。',
  fix: '加一个例子',
  added: '例：A = diag(2, 3) 时，方程是 (2 − λ)(3 − λ) = 0，特征值是 2 和 3。',
}
/* 搜对话：字按顺序出现就算，可以不全。管理页里搜「特征向」，对话记录里搜「对角」。 */
export type Hit = { title: [string, string, string]; meta: string; snip?: [string, string, string] }
export const FIND: { manage: string; manageHits: Hit[]; opened: { title: string; ask: string; reply: string }; history: string; historyHits: Hit[] } = {
  manage: '特征向',
  // 管理页里点第二条结果打开的那段对话：命中的那一问。
  opened: { title: '特征值是什么', ask: '特征值是什么？', reply: '大多数向量被 A 作用后会转向。特征向量是例外：它留在原来那条直线上，只被拉长或缩短。这个方向就是特征向量。' },
  manageHits: [
    { title: ['特征值与', '特征向', '量'], meta: '线性代数讲义 · 4 问 · 昨天' },
    { title: ['特征值是什么', '', ''], meta: '线性代数讲义 · 3 问 · 刚刚', snip: ['…它留在原来那条直线上，只被拉长或缩短。这个方向就是', '特征向', '量。'] },
  ],
  history: '对角',
  historyHits: [
    { title: ['特征值有什么用', '', ''], meta: '线性代数讲义 · 刚刚', snip: ['…找到这些方向，矩阵就能', '对角', '化，高次幂和微分方程都好算得多。'] },
    { title: ['相似', '对角', '化的条件'], meta: '线性代数讲义 · 3 天前' },
    { title: ['PCA 为什么要算特征值', '', ''], meta: '机器学习导论 · 上周', snip: ['…协方差矩阵', '对角', '化以后，每个方向上的方差就是特征值。'] },
  ],
}
/* 外观一课里选的那张图。 */
export const PICTURE = '湖边日落.jpg'
/* 总结第一次存进文库时，助手照内容起的名字。 */
export const SUM_NAME = '线代讲义 5.1–5.2 特征值'
export const sumLength = SUM.blocks.reduce((total, block) => total + block[1].length, 0)
/* 后两个所属的服务在这一课里没有连接，菜单里是灰的。 */
export const MODELS = ['DeepSeek Flash', 'DeepSeek V4 Pro', 'GPT-5.4（未连接）', 'Opus 5.5（未连接）']
export const replyLength = TEXT.reply.join('').length

export type Caption = { text: string; keys?: string[]; mouse?: boolean | 'left' | 'right'; top?: boolean }
type Stage = Director['api']
export type Play = (stage: Stage, scene: Scene, say: (caption: Caption | string) => void) => Promise<void>
export type Lesson = { id: string; title: string; note: string; steps: number; play: Play }

const ENTRY = { x: 760, y: 790 }

/* 拖过目标句子把它选中。 */
async function select(stage: Stage, scene: Scene, zoom: number, ms = 1000) {
  const length = scene.doc === 'paper' ? TEXT.english.length : TEXT.sentence.length
  await stage.move('.tw-a', { look: zoom })
  stage.look('.tw-target', zoom)
  stage.press()
  await stage.move('.tw-b', { ms, step: k => { scene.selected = Math.round(k * length) } })
  stage.release()
}

/* 卡片、译文弹在选区末尾下面。 */
function below(stage: Stage, scene: Scene, width: number) {
  const corner = stage.locate('.tw-page', [0, 0]), tip = stage.locate('.tw-b')
  scene.cardAt = { x: Math.max(48, Math.min(tip.x - corner.x - width / 2, 552 - width)), y: tip.y - corner.y + 22 }
}

async function click(stage: Stage, target: string, at?: [number, number]) {
  await stage.move(target, { at })
  await stage.click()
}

const setup: Play = async (stage, scene, say) => {
  const pick = async (slot: SlotId, option: number) => {
    await click(stage, `.tw-slot-${slot} .tw-select`)
    scene.menu = slot
    await stage.wait(200)
    await click(stage, `.tw-opt-${option}`)
    scene.slots[slot] = MODELS[option]; scene.menu = ''
    await stage.wait(260)
  }
  say('在设置的 AI 页连接服务')
  stage.place({ x: 560, y: 790 })
  await click(stage, '.tw-set')
  scene.settings = 'ai'
  await stage.wait(320)
  stage.look('.tw-links', 1.6)
  await click(stage, '.tw-link-deepseek')
  scene.link = true
  await stage.wait(240)

  say('填 API Key，或者用本机 Codex 的登录')
  await click(stage, '.tw-key')
  await stage.tween(620, k => { scene.key = Math.round(k * 20) }, true)
  await stage.wait(220)
  await click(stage, '.tw-link-codex')
  scene.codex = true
  await stage.wait(520)

  say('翻译和快速解释选响应快的模型')
  stage.look('.tw-slots', 1.55)
  await stage.wait(200)
  await pick('translation', 0)
  await pick('explain', 0)
  await stage.wait(300)

  say('阅读助手选能力强的旗舰模型')
  await pick('assistant', 1)
  await stage.wait(700)
  stage.look(null, 1)
  await stage.wait(900)
}

const explain: Play = async (stage, scene, say) => {
  say('选中看不懂的句子')
  stage.place(ENTRY)
  await select(stage, scene, 1.9, 1100)
  await stage.wait(260)

  say({ text: '按鼠标中键', mouse: true })
  await stage.wait(380)
  await stage.click('middle')
  below(stage, scene, 310)
  scene.card = 'open'; scene.running = true
  await stage.wait(80)
  const card = stage.locate('.tw-card', [.5, 0])
  stage.look({ x: card.x, y: card.y + 105 }, 1.45)
  await stage.wait(300)

  say('解释显示在选区旁边')
  await stage.tween(1400, k => { scene.words = Math.round(k * TEXT.answer.length) }, true)
  scene.drawn = true
  await stage.wait(1300)
  scene.running = false

  say('底部可以深入、简化、举例')
  await stage.move('.tw-actions', { at: [.14, .5] })
  await stage.move('.tw-actions', { at: [.64, .5], ms: 620 })
  await stage.wait(260)

  say('双击卡片标题，针对这段内容提问')
  await stage.move('.tw-card-head span', { at: [.3, .5] })
  await stage.click(); await stage.click()
  scene.asking = true
  await stage.wait(200)
  await stage.type(TEXT.cardAsk, value => { scene.cardDraft = value }, 44)
  await stage.wait(240)
  scene.asking = false; scene.cardAsk = true; scene.drawn = false; scene.running = true
  await stage.tween(1000, k => { scene.cardAnswer = Math.round(k * TEXT.cardReply.length) }, true)
  scene.running = false
  await stage.wait(800)

  say('点图钉固定卡片')
  await click(stage, '.tw-pin')
  scene.card = 'pinned'
  await stage.wait(520)

  say('固定的卡片默认跟着书页走')
  stage.look('.tw-page', 1.25, [.5, .42])
  await stage.move('.tw-page', { at: [.14, .7] })
  await stage.tween(800, k => { scene.scroll = k * 150 })
  await stage.wait(150)
  await stage.tween(700, k => { scene.scroll = 150 - k * 150 })
  await stage.wait(250)

  say('点图钉旁的图标，改成停在屏幕上')
  const head = stage.locate('.tw-follow')
  stage.look({ x: head.x - 60, y: head.y + 110 }, 1.6)
  await click(stage, '.tw-follow')
  scene.hold = scene.scroll; scene.follow = 'screen'
  await stage.wait(450)
  stage.look('.tw-page', 1.25, [.5, .42])
  await stage.move('.tw-page', { at: [.14, .7] })
  await stage.tween(900, k => { scene.scroll = k * 170 })
  await stage.wait(250)
  await stage.tween(700, k => { scene.scroll = 170 - k * 170 })
  await stage.wait(500)
}

const visual: Play = async (stage, scene, say) => {
  const slide = (value: number) => {
    const track = stage.box('.tw-track')
    scene.lambda = value
    stage.place({ x: track.x + (value - .5) / 2.5 * track.width, y: track.y + track.height / 2 })
  }
  say({ text: '直接用图解释', keys: ['Shift', '中键'], mouse: true })
  stage.place(ENTRY)
  await select(stage, scene, 1.9, 850)
  await stage.wait(300)
  await stage.click('middle')
  below(stage, scene, 310)
  scene.visual = true; scene.card = 'open'; scene.running = true
  await stage.wait(80)
  const card = stage.locate('.tw-card', [.5, 0])
  stage.look({ x: card.x, y: card.y + 115 }, 1.45)
  await stage.tween(800, k => { scene.words = Math.round(k * TEXT.answer.length) }, true)
  scene.drawn = true
  await stage.wait(1200)
  scene.running = false

  say('图里的滑块可以拖动')
  await stage.move('.tw-knob')
  stage.press()
  await stage.tween(700, k => slide(2.5 - k * 1.5))
  await stage.tween(900, k => slide(1 + k * 2))
  await stage.tween(500, k => slide(3 - k * .8))
  stage.release()
  await stage.wait(1200)
}

const assistant: Play = async (stage, scene, say) => {
  say({ text: '新对话选用哪些记忆：这本书的，或所有书的', top: true })
  stage.place({ x: 900, y: 790 })
  stage.look('.tw-mem', 1.7, [.5, .5])
  await stage.move('.tw-mem-all', { ms: 800 })
  await stage.wait(250)
  await stage.click()
  scene.mem = 'all'
  await stage.wait(900)
  await click(stage, '.tw-mem-book')
  scene.mem = 'book'
  await stage.wait(900)

  say({ text: '在右侧输入问题，提问时附带当前页', top: true })
  stage.look('.tw-ask', 1.6, [.5, -1.2])
  await click(stage, '.tw-ask')
  await stage.type(TEXT.question, value => { scene.draft = value })
  await click(stage, '.tw-send')
  scene.draft = ''; scene.asked = true
  stage.look('.tw-chat', 1.6, [.5, .18])
  await stage.tween(1200, k => { scene.answer = Math.round(k * replyLength) }, true)
  scene.talk = '特征值有什么用'
  await stage.wait(300)

  say('选中回答里的词，到附属对话里追问')
  await stage.move('.tw-q', { at: [0, .5] })
  stage.press()
  await stage.move('.tw-q', { at: [1, .5], ms: 320, step: k => { scene.quote = k > .3 } })
  stage.release()
  scene.quotePop = true
  await stage.wait(260)
  await click(stage, '.tw-quote-side')
  scene.quotePop = false; scene.side = true
  await stage.wait(120)
  stage.look('.tw-chat', 1.45, [.5, .2])
  await stage.type(TEXT.sideAsk, value => { scene.sideAsk = value }, 34)
  await stage.tween(700, k => { scene.sideAnswer = Math.round(k * TEXT.sideReply.length) }, true)
  await stage.wait(500)

  say('点分支图标，从这条回答开出分支')
  await click(stage, '.tw-branch')
  // 和真的一样：换到分支那段对话，它没有附属对话，右边那栏收起。
  scene.branch = true; scene.side = false
  await stage.wait(900)

  say({ text: '输入 / 调出指令', top: true })
  stage.look('.tw-ask', 1.6, [.3, -1.4])
  await click(stage, '.tw-ask')
  scene.draft = '/'; scene.commands = true
  await stage.wait(900)

  say({ text: '/btw 顺便问一句，不写进对话记录', top: true })
  await click(stage, '.tw-cmd-btw')
  scene.commands = false
  await stage.type(`/btw ${TEXT.btwAsk}`, value => { scene.draft = value }, 40)
  await stage.wait(200)
  scene.draft = ''; scene.btw = true
  await stage.tween(900, k => { scene.btwAnswer = Math.round(k * TEXT.btwReply.length) }, true)
  await stage.wait(1100)

  // 上下文圆环：到量自动压缩，点一下立即压缩。原来的消息都还在。
  say({ text: '点圆环压缩对话', top: true })
  scene.btw = false
  stage.look('.tw-ask', 1.7, [.7, -1.2])
  await stage.tween(1300, k => { scene.ctxFill = .18 + k * .74 }, true)
  await click(stage, '.tw-context')
  scene.compacting = true
  await stage.wait(1500)
  scene.compacting = false
  await stage.tween(500, k => { scene.ctxFill = .92 - k * .64 }, true)
  await stage.wait(900)

  // 对话记录最上面是搜索框：搜所有文档的对话，标题和内容都搜。
  // 标题在助手栏顶上，字幕放下面才不会挡住它。
  say('点标题打开对话记录，能搜所有文档的对话')
  stage.look('.tw-ai', 1.45, [.5, .3])
  await click(stage, '.tw-title')
  scene.histOpen = true
  await stage.wait(500)
  await click(stage, '.tw-hist-search')
  await stage.type(FIND.history, value => { scene.histQuery = value }, 220)
  await stage.wait(1200)
  await stage.move('.tw-hist-hit-2', { ms: 700 })
  await stage.wait(1500)
}

/* 在页面上拖出一个框；右键拖动时不用先点「框选」。关掉快捷提问后不弹气泡，图直接进输入框。 */
async function frame(stage: Stage, scene: Scene, target: string, pad: [number, number]) {
  const box = stage.box(target), from = { x: box.x - pad[0], y: box.y - pad[1] }, to = { x: box.x + box.width + pad[0], y: box.y + box.height + pad[1] }
  await stage.move(from, { ms: 700 })
  await stage.wait(220)
  stage.press()
  scene.frame = { ...from, width: 0, height: 0 }
  await stage.move(to, { ms: 900, step: k => { scene.frame = { ...from, width: (to.x - from.x) * k, height: (to.y - from.y) * k } } })
  await stage.wait(160)
  stage.release()
  scene.crop = false; scene.shots += 1; scene.quick = !scene.quickOff
  if (scene.quickOff) { await stage.wait(420); scene.frame = null }
}
/* 在文档里右键，点菜单里的一项。 */
async function menu(stage: Stage, scene: Scene, item: string) {
  await stage.move('.tw-ul', { at: [.7, 2.4], ms: 700 })
  await stage.wait(200)
  await stage.click('right')
  scene.ctx = stage.locate('.tw-ul', [.7, 2.4])
  await stage.wait(900)
  await stage.move(item, { ms: 620 })
  await stage.wait(260)
  await stage.click()
  await stage.wait(160)
  scene.ctx = null
}

const capture: Play = async (stage, scene, say) => {
  say({ text: '点「框选」，在页面上拖出一块', keys: ['Alt', 'Shift', 'S'] })
  stage.place(ENTRY)
  stage.look('.tw-bar', 1.5, [.5, 4])
  await stage.wait(500)
  await click(stage, '.tw-cropbtn')
  scene.crop = true
  await stage.wait(500)
  await frame(stage, scene, '.tw-ring', [16, 8])
  stage.look('.tw-ring', 1.5, [1.1, .5])
  await stage.wait(1500)

  say('点气泡直接提问；点「自己提问」，图进输入框')
  await stage.wait(900)
  await click(stage, '.tw-quick-own')
  scene.quick = false; scene.frame = null
  stage.look('.tw-ask', 1.6, [.5, -1.1])
  await stage.wait(1500)

  say({ text: '点一下图把它留住，不然再截一张会换掉它', mouse: 'left', top: true })
  await stage.wait(700)
  await click(stage, '.tw-shot-0')
  scene.kept = 1
  await stage.wait(1600)

  say('在文档里右键，开启「右键拖动截图」')
  stage.look({ x: 600, y: 520 }, 1.4)
  await stage.move('.tw-page', { at: [.5, .5] })
  await stage.tween(620, k => { scene.scroll = k * 120 })
  await menu(stage, scene, '.tw-ctx-right')
  scene.rightOn = true
  await stage.wait(700)

  say({ text: '之后按住右键拖动就是截图', mouse: 'right' })
  await frame(stage, scene, '.tw-ul', [10, 7])
  await stage.wait(1400)
  say({ text: '收起气泡，图留在输入框', keys: ['Esc'] })
  await stage.wait(1100)
  scene.quick = false; scene.frame = null
  stage.look({ x: 800, y: 480 }, 1.15)
  await stage.wait(1400)

  say({ text: '按住 Shift 再截，上一张自动留住', keys: ['Shift'], mouse: 'right' })
  await stage.tween(520, k => { scene.scroll = 120 - k * 120 })
  await frame(stage, scene, '.tw-target', [8, 5])
  scene.kept = 2
  await stage.wait(1700)

  say('点一个气泡，输入框里的图一起发出去')
  await stage.wait(600)
  await click(stage, '.tw-bubble-0')
  scene.quick = false; scene.frame = null; scene.shots = 0; scene.kept = 0; scene.shotSent = true
  stage.look('.tw-chat', 1.5, [.5, .2])
  await stage.tween(1300, k => { scene.shotAnswer = Math.round(k * TEXT.shotReply.length) }, true)
  await stage.wait(1600)

  say('不想要气泡：右键，关闭「框选快捷提问」')
  stage.look({ x: 600, y: 520 }, 1.4)
  await stage.tween(620, k => { scene.scroll = k * 120 })
  await menu(stage, scene, '.tw-ctx-quick')
  scene.quickOff = true
  await stage.wait(700)

  say({ text: '之后右键一拖，图直接进输入框', mouse: 'right' })
  await frame(stage, scene, '.tw-ul', [10, 7])
  stage.look({ x: 800, y: 480 }, 1.15)
  await stage.wait(900)
  stage.look('.tw-ask', 1.6, [.5, -1.1])
  await stage.wait(2000)
}

const translate: Play = async (stage, scene, say) => {
  scene.doc = 'paper'; scene.ai = false
  say({ text: '翻译选中的文字', keys: ['Ctrl', 'T'] })
  stage.place(ENTRY)
  await select(stage, scene, 1.75, 1000)
  await stage.wait(320)
  below(stage, scene, 330)
  scene.pop = true
  await stage.tween(800, k => { scene.words = Math.round(k * TEXT.chinese.length) }, true)
  await stage.wait(900)

  say('顶栏的翻译图标打开翻译栏')
  stage.look(null, 1)
  // 等镜头退到顶栏露出来再点。
  await stage.wait(300)
  await click(stage, '.tw-tr')
  scene.pop = false; scene.selected = 0; scene.column = true
  await stage.wait(1000)

  // 开关在翻译栏最底下，字幕放上面才不会盖住它。
  say({ text: '打开「划词翻译」，选中就出译文', top: true })
  await click(stage, '.tw-auto')
  scene.auto = true
  await stage.wait(200)
  await select(stage, scene, 1.6, 800)
  below(stage, scene, 330)
  scene.pop = true
  await stage.wait(1300)
}

const ink: Play = async (stage, scene, say) => {
  say({ text: '用快捷键拿起荧光笔', keys: ['Alt', '2'] })
  stage.place(ENTRY)
  stage.look('.tw-bar', 1.5)
  await stage.move('.tw-page', { at: [.3, .2] })
  await stage.wait(500)
  scene.ink = 'highlighter'
  await stage.wait(700)
  await stage.move('.tw-hl', { at: [0, .55], look: 1.8 })
  stage.look('.tw-hl', 1.8)
  stage.press()
  await stage.move('.tw-hl', { at: [1, .55], ms: 700, step: k => { scene.hl = k } })
  stage.release()
  await stage.wait(300)

  say({ text: '换成笔，写字、画圈', keys: ['Alt', '1'] })
  scene.ink = 'pen'
  const ring = stage.box('.tw-ring'), around = (k: number) => {
    const angle = -Math.PI * .75 + k * Math.PI * 2.08
    return { x: ring.x + ring.width / 2 + Math.cos(angle) * (ring.width / 2 + 12), y: ring.y + ring.height / 2 + Math.sin(angle) * (ring.height / 2 + 6) }
  }
  stage.look('.tw-ring', 1.8)
  await stage.move(around(0))
  stage.press()
  await stage.tween(850, k => { scene.pen = k; stage.place(around(k)) })
  stage.release()
  await stage.wait(300)

  say({ text: '换成划线，画一条手写横线', keys: ['Alt', '3'] })
  scene.ink = 'underline'
  await stage.move('.tw-ul', { at: [0, 1], look: 1.8 })
  stage.look('.tw-ul', 1.8)
  stage.press()
  await stage.move('.tw-ul', { at: [1, 1], ms: 650, step: k => { scene.ul = k } })
  stage.release()
  await stage.wait(400)

  say({ text: '退出标记', keys: ['Esc'] })
  stage.look('.tw-bar', 1.3, [.5, 4])
  await stage.wait(500)
  scene.ink = ''
  await stage.wait(1000)
}

const bookmark: Play = async (stage, scene, say) => {
  say({ text: '在当前位置加书签，夹在页边上', keys: ['Alt', 'B'] })
  stage.place(ENTRY)
  stage.look('.tw-ribbons', 1.7, [.5, 3])
  await stage.move('.tw-page', { at: [.7, .2] })
  await stage.wait(350)
  scene.mark = true
  await stage.wait(900)

  say('右键书签换图案，也可以换成自己的图片')
  await stage.move('.tw-ribbon-new')
  await stage.click('right')
  scene.markMenu = true
  await stage.wait(320)
  await click(stage, '.tw-art-2')
  scene.art = 2; scene.markMenu = false
  await stage.wait(800)

  say('滚动条旁有一道同色刻度，标出书签的位置')
  stage.look('.tw-rail', 1.35, [-2.6, .4])
  await stage.move('.tw-page', { at: [.5, .5] })
  await stage.tween(900, k => { scene.scroll = k * 260 })
  await stage.wait(900)

  say({ text: '在书签之间跳转', keys: ['Ctrl', '↑', '↓'] })
  await stage.wait(450)
  await stage.tween(600, k => { scene.scroll = 260 - k * 260 })
  await stage.wait(900)

  say('全部书签列在侧栏，点一下跳过去')
  stage.look(null, 1)
  await stage.tween(500, k => { scene.scroll = k * 260 })
  await click(stage, '.tw-mark-new')
  await stage.tween(560, k => { scene.scroll = 260 - k * 260 })
  await stage.wait(900)

  // 挪书签：位置按书页自己的坐标记（平的那一头在哪、中线多高）。
  say({ text: '按住书签上下拖，挪到新的位置', mouse: 'left' })
  stage.look('.tw-page', 1.25, [.62, .3])
  await stage.wait(500)
  const page = stage.box('.tw-page'), tab = stage.box('.tw-ribbon-new')
  const edge = page.width - 5, high = tab.y + tab.height / 2 - page.y
  const grab = { x: tab.x + 12, y: tab.y + tab.height / 2 }
  const carry = async (to: Point, ms: number, flip?: (x: number) => boolean) => {
    const from = { ...scene.ribbonAt! }
    await stage.move({ x: grab.x + to.x - edge, y: page.y + to.y }, { ms, step: k => {
      const x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k
      // 靠近左边就吸上去并掉头；离开以后保持掉头。
      const snapped = flip?.(x) ?? false
      if (flip) scene.ribbonFlip = scene.ribbonFlip || snapped
      scene.ribbonAt = { x: snapped ? 5 : x, y }
    } })
  }
  scene.ribbonAt = { x: edge, y: high }
  await stage.move(grab, { ms: 700 })
  stage.press()
  await stage.wait(420)
  scene.ribbonLift = true
  await stage.wait(250)
  await carry({ x: edge, y: high + 170 }, 1000)
  stage.release(); scene.ribbonLift = false
  await stage.wait(1100)

  say('拖到页面左边，书签贴到左边并掉头')
  stage.look('.tw-page', 1.25, [.4, .4])
  stage.press()
  await stage.wait(420)
  scene.ribbonLift = true
  await carry({ x: 5, y: high + 120 }, 1500, x => x < 46)
  stage.release(); scene.ribbonLift = false
  await stage.wait(1300)

  say('两边都不靠，就停在松手的地方')
  stage.press()
  await stage.wait(420)
  scene.ribbonLift = true
  await carry({ x: page.width * .46, y: high + 40 }, 1100)
  stage.release(); scene.ribbonLift = false
  await stage.wait(1500)

  // 侧栏里书签按书分开放：按住书名拖，别的书让开，松手就换了顺序。
  say({ text: '侧栏里按住书名拖动，调整书的顺序', mouse: 'left' })
  stage.look('.tw-mkbooks', 1.6, [.5, .5])
  await stage.move('.tw-mkbook-paper .tw-mkname', { at: [.4, .5], ms: 900 })
  await stage.wait(300)
  stage.press()
  await stage.wait(380)
  const held = stage.locate('.tw-mkbook-paper .tw-mkname', [.4, .5])
  const rise = stage.locate('.tw-mkbook-algebra', [0, 0]).y - stage.locate('.tw-mkbook-paper', [0, 0]).y
  const room = stage.locate('.tw-mkbook-paper', [0, 1]).y - stage.locate('.tw-mkbook-paper', [0, 0]).y
  scene.markDrag = 0
  await stage.move({ x: held.x, y: held.y + rise }, { ms: 1200, step: k => { scene.markDrag = rise * k; scene.markShift = k > .5 ? room : 0 } })
  await stage.wait(450)
  stage.release()
  scene.markStill = true; scene.markSwap = true; scene.markDrag = null; scene.markShift = 0
  await stage.wait(80)
  scene.markStill = false
  await stage.wait(1500)
}

/* 管理对话：从助手栏表头的按钮进去；树、悬停预览、拖动移动、撤销、记忆栏、搜索。 */
const manage: Play = async (stage, scene, say) => {
  say('点助手栏标题左边的按钮，打开对话管理')
  stage.place(ENTRY)
  stage.look('.tw-manage', 1.6, [3, 3])
  await stage.move('.tw-manage', { ms: 900 })
  await stage.wait(300)
  await stage.click()
  scene.manager = true
  stage.look(null, 1)
  await stage.wait(1400)

  say('鼠标停在一段对话上，显示最后一轮问答')
  stage.look('.tw-cm-t1', 1.12, [.75, .9])
  await stage.move('.tw-cm-t1', { at: [.3, .5], ms: 800 })
  await stage.wait(450)
  scene.cmPeek = true
  await stage.wait(2200)

  say({ text: '把对话拖到另一本书，红线是落点', mouse: 'left' })
  scene.cmPeek = false
  stage.look('.tw-cm-b1', 1.2, [.5, -.2])
  await stage.wait(400)
  stage.press()
  const from = stage.locate('.tw-cm-t1', [.3, .5]), to = stage.locate('.tw-cm-t4', [.3, -.05])
  await stage.move(to, { ms: 1300, step: k => { scene.cmDrag = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }; scene.cmSlot = k > .72 } })
  await stage.wait(500)
  stage.release()
  scene.cmDrag = null; scene.cmSlot = false; scene.cmMoved = true; scene.cmFlash = 'moved'
  await stage.wait(1500)

  say({ text: '每一步都能撤销', keys: ['Ctrl', 'Z'] })
  await stage.wait(800)
  scene.cmMoved = false; scene.cmFlash = 'undone'
  await stage.wait(1500)

  // 记忆栏：按住一条，它浮起来跟着走，下面那条让开；松手落进新位置。
  say({ text: '右栏是自动记下的记忆，按住一条拖动换位置', mouse: 'left' })
  scene.cmFlash = ''
  stage.look('.tw-cm-side', 1.5, [.5, .55])
  await stage.wait(300)
  const held = stage.locate('.tw-mem-r1', [.4, .5])
  const room = stage.locate('.tw-mem-r2', [0, 0]).y - stage.locate('.tw-mem-r1', [0, 0]).y
  await stage.move(held, { ms: 800 })
  stage.press()
  await stage.wait(380)
  scene.memDrag = 0
  await stage.move({ x: held.x, y: held.y + room }, { ms: 1000, step: k => { scene.memDrag = room * k; scene.memShift = k > .5 ? -room : 0 } })
  await stage.wait(350)
  stage.release()
  scene.memStill = true; scene.memSwap = true; scene.memDrag = null; scene.memShift = 0
  await stage.wait(80)
  scene.memStill = false
  await stage.wait(900)

  say('写一句要求，让助手改记忆；改完可以撤销')
  await click(stage, '.tw-mem-ask')
  await stage.type('把两条进度合并成一条', value => { scene.memAsk = value }, 70)
  await stage.wait(250)
  await click(stage, '.tw-mem-ask b')
  scene.memBusy = true
  await stage.wait(1700)
  scene.memBusy = false; scene.memAsk = ''; scene.memMerged = true; scene.memNote = '已改写 1 条，删除 1 条'
  await stage.wait(2000)

  // 搜索框在左上角，Ctrl + F 直接到那里。打字后树换成一列结果。
  say({ text: '搜索对话，标题和内容都搜', keys: ['Ctrl', 'F'] })
  scene.memNote = ''
  stage.look('.tw-cm-main', 1.25, [.35, .3])
  await stage.move('.tw-cm-find', { ms: 800 })
  await stage.click()
  await stage.type(FIND.manage, value => { scene.cmQuery = value }, 260)
  await stage.wait(1600)

  say({ text: '点一条结果，打开那段对话', mouse: 'left' })
  await stage.move('.tw-cm-hit-1', { at: [.3, .3], ms: 700 })
  await stage.wait(400)
  await stage.click()
  scene.manager = false; scene.cmQuery = ''; scene.talk = FIND.opened.title
  stage.look('.tw-ai', 1.3, [.5, .3])
  await stage.wait(2000)
}

const library: Play = async (stage, scene, say) => {
  scene.view = 'library'
  say('从桌面把 PDF 或 Markdown 拖进窗口')
  await stage.tween(650, k => { scene.desk = k })
  stage.place({ x: 250, y: 560 })
  await stage.move('.tw-deskfile', { at: [.5, .3] })
  await stage.wait(200)
  stage.press()
  const from = stage.locate('.tw-deskfile', [.5, .3]), to = stage.locate('.tw-file-0', [.5, .4])
  scene.ghost = from
  await stage.move(to, { ms: 1000, step: k => { scene.ghost = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k } } })
  stage.release()
  scene.ghost = null; scene.files = 7
  await stage.wait(350)
  await stage.tween(600, k => { scene.desk = 1 - k })
  stage.look({ x: 760, y: 330 }, 1.2)
  await stage.wait(500)

  say({ text: '搜索标题和正文', keys: ['Ctrl', 'K'] })
  await click(stage, '.tw-lib-search')
  await stage.type('特征', value => { scene.query = value }, 160)
  await stage.wait(1000)
  scene.query = ''
  await stage.wait(300)

  // 镜头偏下一些：菜单靠下的「放进」一项不落到字幕底下。
  say('右键文档，放进分组或收藏')
  stage.look('.tw-file-1', 1.7, [.7, .85])
  await stage.move('.tw-file-1', { at: [.6, .4] })
  await stage.click('right')
  scene.fileMenu = true
  await stage.wait(260)
  await click(stage, '.tw-fm-group')
  scene.grouped = true; scene.fileMenu = false
  await stage.wait(350)
  await click(stage, '.tw-file-1 .tw-star')
  scene.starred = true
  await stage.wait(700)

  say({ text: '右键菜单里还有：总结、详情与标签、打开所在文件夹', mouse: 'right' })
  await stage.move('.tw-file-1', { at: [.6, .4], ms: 500 })
  await stage.click('right')
  scene.fileMenu = true
  await stage.wait(500)
  for (const item of ['sum', 'details', 'reveal'] as const) {
    await stage.move(`.tw-fm-${item}`, { ms: 420 })
    scene.fileHover = item
    await stage.wait(650)
  }

  // 重命名：名字变成输入框，回车生效；磁盘上的文件一起改名。
  say({ text: '重命名，磁盘上的文件跟着改名', keys: ['F2'] })
  await stage.move('.tw-fm-rename', { ms: 500 })
  scene.fileHover = 'rename'
  await stage.wait(400)
  await stage.click()
  scene.fileHover = ''; scene.fileMenu = false; scene.renaming = '线性代数讲义'
  stage.look('.tw-file-1', 1.7, [.5, .8])
  await stage.wait(700)
  await stage.type('线性代数讲义 第二版', value => { scene.renaming = value }, 90)
  await stage.wait(400)
  scene.fileName = scene.renaming!; scene.renaming = null; scene.toast = '已改名　Ctrl + Z 撤销'
  await stage.wait(1500)

  say({ text: '改名、移除文档、删分组，都能撤销', keys: ['Ctrl', 'Z'] })
  stage.look({ x: 700, y: 520 }, 1.2)
  await stage.wait(900)
  scene.fileName = ''; scene.toast = '已撤销：已改名'
  await stage.wait(1800)
  scene.toast = ''
  stage.look(null, 1)
  await stage.wait(500)
}

/* 总结：从文库右键进去；表里勾章节、开「不遗漏知识点」；草稿边写边看，划选一段让助手改，最后存进文库。 */
const summary: Play = async (stage, scene, say) => {
  scene.view = 'library'; scene.ai = false
  say({ text: '右键文档，选「总结…」；在阅读助手里输入 /summary 也一样', mouse: 'right' })
  stage.place({ x: 700, y: 620 })
  // 等文库画出来再量卡片，不然镜头对准的是鼠标那一点，卡片被切掉一半。
  await stage.wait(0)
  stage.look('.tw-file-1', 1.5, [.7, .7])
  await stage.move('.tw-file-1', { at: [.6, .4], ms: 800 })
  await stage.wait(200)
  await stage.click('right')
  scene.fileMenu = true
  await stage.wait(700)
  await stage.move('.tw-fm-sum', { ms: 500 })
  scene.fileHover = 'sum'
  await stage.wait(300)
  await stage.click()
  scene.fileMenu = false; scene.fileHover = ''; scene.view = 'reader'; scene.ai = true; scene.sum = 'setup'
  stage.look(null, 1)
  await stage.wait(1000)

  say('点小箭头展开一章，可以只勾其中几节')
  stage.look('.tw-sum-list', 1.55, [.5, .6])
  await click(stage, '.tw-sum-unfold')
  scene.sumFold = true
  await stage.wait(500)
  await click(stage, '.tw-sum-part-0 i')
  scene.sumPicked = 1
  await stage.wait(350)
  await click(stage, '.tw-sum-part-1 i')
  scene.sumPicked = 2
  await stage.wait(1300)

  say('要一条不落，打开「不遗漏知识点」')
  stage.look('.tw-sum-full', 1.55, [.5, .2])
  await stage.wait(350)
  await click(stage, '.tw-sum-full .tw-switch')
  scene.sumFull = true
  await stage.wait(1500)

  say('点「开始总结」，草稿边写边出现')
  await click(stage, '.tw-sum-go')
  scene.sum = 'draft'
  stage.look(null, 1)
  await stage.wait(600)
  stage.look('.tw-draft', 1.22, [.5, .2])
  await stage.tween(2800, k => { scene.sumWords = Math.round(k * sumLength) }, true)
  await stage.wait(800)

  say({ text: '在草稿上划选一段，直接写怎么改；助手只改这一处', mouse: 'left' })
  await stage.move('.tw-sum-a', { ms: 700 })
  stage.press()
  await stage.move('.tw-sum-b', { ms: 900, step: k => { scene.sumSel = Math.round(k * SUM.blocks[3]![1].length) } })
  stage.release()
  scene.sumAsk = true
  await stage.wait(450)
  await stage.type(SUM.fix, value => { scene.sumNote = value }, 130)
  await stage.wait(250)
  await click(stage, '.tw-draft-send')
  scene.sumAsk = false; scene.sumSel = 0; scene.sumNote = ''; scene.sumSent = true
  await stage.wait(1000)
  scene.sumFixed = true
  await stage.wait(1700)

  say('点「存入文档库」，存成 Markdown')
  await click(stage, '.tw-draft-save')
  scene.sumSaved = true; scene.toast = `已存为「${SUM_NAME}.md」，在原文档的文件夹里。`
  stage.look(null, 1)
  await stage.wait(2400)
}

const tabs: Play = async (stage, scene, say) => {
  say('打开的文档排在顶栏标签里')
  stage.place(ENTRY)
  stage.look('.tw-t1', 1.4)
  await click(stage, '.tw-t1')
  scene.doc = 'paper'
  await stage.wait(700)
  await click(stage, '.tw-t0')
  scene.doc = 'algebra'
  await stage.wait(500)

  // 顶栏上已经没有并排按钮：入口是标签的右键菜单和快捷键。
  say({ text: '右键标签，或按快捷键：并排阅读两份文档', keys: ['Ctrl', '\\'] })
  stage.look(null, 1)
  await stage.move('.tw-t1', { at: [.5, .5] })
  await stage.wait(900)
  scene.ai = false; scene.split = true
  await stage.tween(450, k => { scene.zoom = 1 - k * .2 })
  await stage.wait(250)
  await stage.move('.tw-page.paper', { at: [.5, .4] })
  await stage.wait(1000)
}

const view: Play = async (stage, scene, say) => {
  say('目录按钮列出章节')
  stage.place(ENTRY)
  stage.look('.tw-bar', 1.4)
  await click(stage, '.tw-ol')
  scene.outline = true
  await stage.wait(260)
  await click(stage, '.tw-ol-2')
  await stage.tween(600, k => { scene.scroll = k * 210 })
  scene.outline = false
  await stage.wait(300)

  say({ text: '在文档内搜索', keys: ['Ctrl', 'F'] })
  scene.finding = true
  await stage.wait(200)
  await stage.type('特征值', value => { scene.find = value }, 150)
  await stage.wait(900)
  scene.finding = false; scene.find = ''

  say({ text: '缩放页面；点百分比回到适应宽度', keys: ['Ctrl', '滚轮'] })
  stage.look(null, 1)
  await stage.move('.tw-page', { at: [.5, .4] })
  await stage.tween(600, k => { scene.zoom = 1 + k * .28 })
  await stage.tween(700, k => { scene.zoom = 1.28 - k * .4 })
  stage.look('.tw-bar', 1.5, [.5, 3])
  await click(stage, '.tw-percent b')
  scene.fit = true
  await stage.tween(500, k => { scene.zoom = .88 + k * .26 })
  await stage.wait(600)

  // 侧边面板把阅读区挤窄时，页面自动缩小；面板关掉，回到原来的比例。
  say('侧边面板打开时页面自动缩小，关掉后复原')
  stage.look(null, 1)
  await click(stage, '.tw-tr')
  scene.column = true
  await stage.tween(450, k => { scene.zoom = 1.14 - k * .44 })
  await stage.wait(1300)
  await click(stage, '.tw-tr')
  scene.column = false
  await stage.tween(450, k => { scene.zoom = .7 + k * .44 })
  await stage.wait(900)

  say({ text: '收起顶栏和侧栏', keys: ['Ctrl', 'Shift', 'H'] })
  await stage.wait(300)
  scene.chrome = false
  await stage.wait(1300)
  scene.chrome = true
  await stage.wait(700)
}

const focus: Play = async (stage, scene, say) => {
  say('点顶栏的时间打开计时')
  stage.place(ENTRY)
  stage.look('.tw-clock', 1.7, [.3, 2.4])
  await click(stage, '.tw-clock')
  scene.clock = 'open'
  await stage.wait(500)

  say('拨到想要的时长，开始倒计时')
  await stage.move('.tw-wheel', { at: [.3, .7] })
  stage.press()
  await stage.move('.tw-wheel', { at: [.3, .2], ms: 800, step: k => { scene.minutes = 5 + Math.round(k * 4) * 5 } })
  stage.release()
  await click(stage, '.tw-start')
  scene.clock = 'running'
  await stage.wait(1200)

  say('到点后响铃提醒')
  scene.clock = 'ringing'
  await stage.wait(1500)
}

const look: Play = async (stage, scene, say) => {
  say('设置的外观页有四种界面风格')
  stage.place({ x: 560, y: 790 })
  await click(stage, '.tw-set')
  scene.settings = 'look'
  await stage.wait(300)
  for (const style of ['crystal', 'warm', 'sketch', 'glass'] as Look[]) {
    await click(stage, `.tw-style-${style}`)
    scene.look = style
    await stage.wait(480)
  }

  // 设置窗是模态的，点不到侧栏：先关掉它，切完再打开。
  say('深色和浅色随时切换')
  await click(stage, '.tw-dialog-close')
  scene.settings = ''
  await stage.wait(350)
  await click(stage, '.tw-dark')
  scene.dark = true
  await stage.wait(800)
  await stage.click()
  scene.dark = false
  await stage.wait(400)
  await click(stage, '.tw-set')
  scene.settings = 'look'
  await stage.wait(450)

  // 只有两种液态玻璃有底板：预设几种，也可以加自己的图片。
  say('液态玻璃可以拿自己的图片做底板')
  stage.look('.tw-gallery', 1.5, [.4, .2])
  await click(stage, '.tw-gallery-add')
  scene.picker = true
  await stage.wait(600)
  stage.look('.tw-picker', 1.4)
  await stage.move('.tw-pick-0', { ms: 700 })
  await stage.wait(500)
  await stage.click()
  scene.picker = false; scene.picture = true; scene.preview = true
  stage.look(null, 1)
  await stage.wait(900)

  // 设置窗让开：整个窗口换成这张图，侧栏、顶栏、助手栏的玻璃透出它。
  say('整个窗口换上这张图')
  await stage.wait(900)
  stage.look('.tw-side', 1.7, [.6, .4])
  await stage.move('.tw-side', { at: [.7, .55], ms: 1000 })
  await stage.wait(1300)
  stage.look('.tw-ai', 1.6, [.4, .4])
  await stage.move('.tw-ai', { at: [.35, .6], ms: 1200 })
  await stage.wait(1300)
  stage.look(null, 1)
  await stage.wait(1000)

  // 预览条在窗口底部，字幕放上面才不会盖住「采用」。
  say({ text: '点「采用」；图片留在「我的图片」里', top: true })
  await click(stage, '.tw-scene-ok')
  scene.preview = false
  await stage.wait(500)
  stage.look('.tw-gallery', 1.5, [.4, .4])
  await stage.wait(2200)
}

export const LESSONS: Lesson[] = [
  { id: 'setup', title: '接入 AI', note: '连接服务，给每个功能选模型', steps: 4, play: setup },
  { id: 'explain', title: '快速解释', note: '选中文字后按中键', steps: 8, play: explain },
  { id: 'visual', title: '用图解释', note: '图解、可拖的图', steps: 2, play: visual },
  { id: 'assistant', title: '阅读助手', note: '记忆、提问、附属对话、分支、指令、压缩、搜对话', steps: 8, play: assistant },
  { id: 'summary', title: '总结', note: '勾章节、边写边改、存进文档库', steps: 6, play: summary },
  { id: 'learn', title: '学习', note: '摸底、出大纲、一步步带读', steps: 8, play: learn },
  { id: 'outline', title: '大纲与进度', note: '右键安排、调整次序、让助手改、学习进度', steps: 8, play: outline },
  { id: 'capture', title: '截图提问', note: '框选、右键拖动、留住多张', steps: 10, play: capture },
  { id: 'manage', title: '管理对话', note: '移动、撤销、改记忆、搜索对话', steps: 8, play: manage },
  { id: 'translate', title: '翻译', note: '划词翻译与翻译栏', steps: 3, play: translate },
  { id: 'ink', title: '标记', note: 'Alt + 1 / 2 / 3 直接拿起工具', steps: 4, play: ink },
  { id: 'bookmark', title: '书签', note: '夹在页边，可以拖，Ctrl + ↑ ↓ 跳转，书能排顺序', steps: 9, play: bookmark },
  { id: 'library', title: '文档库', note: '导入、搜索、分组、收藏、重命名、撤销', steps: 6, play: library },
  { id: 'tabs', title: '多文档', note: '标签页与并排阅读', steps: 2, play: tabs },
  { id: 'view', title: '阅读视图', note: '目录、搜索、缩放、收起界面', steps: 5, play: view },
  { id: 'focus', title: '计时', note: '倒计时与提醒', steps: 3, play: focus },
  { id: 'look', title: '外观', note: '四种风格、深浅色，自己的图片做底板', steps: 5, play: look },
]

/* 看过哪些、还要不要自动弹出，记在本机。 */
const KEY = 'tour.v1'
export type TourMemory = { done: string[]; hidden: boolean }
export function loadTour(): TourMemory {
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}'); return { done: Array.isArray(saved.done) ? saved.done.filter((id: unknown) => typeof id === 'string') : [], hidden: saved.hidden === true } } catch { return { done: [], hidden: false } }
}
export function saveTour(memory: TourMemory) { try { localStorage.setItem(KEY, JSON.stringify(memory)) } catch { /* 存不下就算了 */ } }
