import type { Director, Point } from './director'

/* 示意界面的状态：脚本只改这里，画面跟着变。 */
export type Look = 'glass' | 'crystal' | 'warm' | 'sketch'
export type SlotId = 'assistant' | 'translation' | 'explain'
export type Scene = {
  view: 'reader' | 'library' | 'collection'
  /** 外观一课里临时换的风格；空着就跟随应用当前的风格。 */
  look: '' | Look
  dark: boolean
  photo: boolean
  chrome: boolean
  ai: boolean
  doc: 'algebra' | 'paper'
  split: boolean
  scroll: number
  zoom: number
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
}

export const freshScene = (): Scene => ({
  view: 'reader', look: '', dark: false, photo: false, chrome: true, ai: true, doc: 'algebra', split: false, scroll: 0, zoom: 1, selected: 0,
  card: 'none', cardAt: { x: 0, y: 0 }, running: false, words: 0, drawn: false, visual: false, lambda: 2.5,
  settings: '', link: false, key: 0, codex: false, slots: { assistant: '未选择', translation: '未选择', explain: '未选择' }, menu: '',
  draft: '', asked: false, answer: 0, quote: false, quotePop: false, side: false, sideAsk: '', sideAnswer: 0, branch: false, commands: false, btw: false, btwAnswer: 0,
  pop: false, column: false, auto: false, ink: '', hl: 0, pen: 0, ul: 0, mark: false, art: 0, markMenu: false,
  files: 6, ghost: null, query: '', fileMenu: false, grouped: false, starred: false, outline: false, finding: false, find: '', clock: 'idle', minutes: 5, follow: 'page', hold: 0, desk: 0,
  crop: false, frame: null, quick: false, ctx: null, rightOn: false, shots: 0, kept: 0, shotSent: false, shotAnswer: 0, asking: false, cardDraft: '', cardAsk: false, cardAnswer: 0,
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
/* 后两个所属的服务在这一课里没有连接，菜单里是灰的。 */
export const MODELS = ['DeepSeek Flash', 'DeepSeek V4 Pro', 'GPT-5.4（未连接）', 'Claude Opus 5.5（未连接）']
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

  say('双击标题，就这段内容自己问一句')
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
  await stage.wait(300)

  say('固定后收进侧栏的 Intelligent UI')
  await click(stage, '.tw-pin')
  scene.card = 'pinned'
  await stage.wait(300)
  stage.look(null, 1)
  await click(stage, '.tw-nav-ui')
  scene.view = 'collection'
  await stage.wait(1500)
}

const assistant: Play = async (stage, scene, say) => {
  say({ text: '在右侧输入问题，提问时附带当前页', top: true })
  stage.place({ x: 900, y: 790 })
  stage.look('.tw-ask', 1.6, [.5, -1.2])
  await click(stage, '.tw-ask')
  await stage.type(TEXT.question, value => { scene.draft = value })
  await click(stage, '.tw-send')
  scene.draft = ''; scene.asked = true
  stage.look('.tw-chat', 1.6, [.5, .18])
  await stage.tween(1200, k => { scene.answer = Math.round(k * replyLength) }, true)
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

  say('从任意一条回答开出分支')
  await click(stage, '.tw-branch')
  scene.branch = true
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
}

/* 在页面上拖出一个框；右键拖动时不用先点「框选」。 */
async function frame(stage: Stage, scene: Scene, target: string, pad: [number, number]) {
  const box = stage.box(target), from = { x: box.x - pad[0], y: box.y - pad[1] }, to = { x: box.x + box.width + pad[0], y: box.y + box.height + pad[1] }
  await stage.move(from)
  stage.press()
  scene.frame = { ...from, width: 0, height: 0 }
  await stage.move(to, { ms: 560, step: k => { scene.frame = { ...from, width: (to.x - from.x) * k, height: (to.y - from.y) * k } } })
  stage.release()
  scene.crop = false; scene.shots += 1; scene.quick = true
}

const capture: Play = async (stage, scene, say) => {
  say({ text: '点「框选」，在页面上拖出一块', keys: ['Alt', 'Shift', 'S'] })
  stage.place(ENTRY)
  stage.look('.tw-bar', 1.5, [.5, 4])
  await click(stage, '.tw-cropbtn')
  scene.crop = true
  await stage.wait(260)
  await frame(stage, scene, '.tw-ring', [16, 8])
  stage.look('.tw-ring', 1.5, [1.1, .5])
  await stage.wait(800)

  say('点气泡直接提问；点「自己提问」，图进输入框')
  await click(stage, '.tw-quick-own')
  scene.quick = false; scene.frame = null
  stage.look('.tw-ask', 1.6, [.5, -1.1])
  await stage.wait(700)

  say({ text: '再截一张会换掉这张；左键点一下固定住它', mouse: 'left', top: true })
  await click(stage, '.tw-shot-0')
  scene.kept = 1
  await stage.wait(900)

  say('第二种截法：在文档里右键，开启「右键拖动截图」')
  stage.look({ x: 600, y: 520 }, 1.4)
  await stage.move('.tw-page', { at: [.5, .5] })
  await stage.tween(520, k => { scene.scroll = k * 120 })
  await stage.move('.tw-ul', { at: [.7, 2.4] })
  await stage.click('right')
  scene.ctx = stage.locate('.tw-ul', [.7, 2.4])
  await stage.wait(360)
  await click(stage, '.tw-ctx-right')
  scene.ctx = null; scene.rightOn = true
  await stage.wait(300)

  say({ text: '之后按住右键拖动就是截图', mouse: 'right' })
  await frame(stage, scene, '.tw-ul', [10, 7])
  await stage.wait(650)
  say({ text: '收起气泡，图留在输入框', keys: ['Esc'] })
  await stage.wait(700)
  scene.quick = false; scene.frame = null
  stage.look({ x: 800, y: 480 }, 1.15)
  await stage.wait(800)

  say({ text: '按住再截，上一张自动固定', keys: ['Shift'], mouse: 'right' })
  await stage.tween(420, k => { scene.scroll = 120 - k * 120 })
  await frame(stage, scene, '.tw-target', [8, 5])
  scene.kept = 2
  await stage.wait(1000)

  say('点一个气泡，输入框里的图一起发出去')
  await click(stage, '.tw-bubble-0')
  scene.quick = false; scene.frame = null; scene.shots = 0; scene.kept = 0; scene.shotSent = true
  stage.look('.tw-chat', 1.5, [.5, .2])
  await stage.tween(1100, k => { scene.shotAnswer = Math.round(k * TEXT.shotReply.length) }, true)
  await stage.wait(1100)
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
  await click(stage, '.tw-tr')
  scene.pop = false; scene.selected = 0; scene.column = true
  await stage.wait(1000)

  say('打开自动翻译，选中就出译文')
  await click(stage, '.tw-auto')
  scene.auto = true
  await stage.wait(200)
  await select(stage, scene, 1.6, 800)
  below(stage, scene, 330)
  scene.pop = true
  await stage.wait(1300)
}

const ink: Play = async (stage, scene, say) => {
  say({ text: '直接拿起荧光笔，不用先点标记按钮', keys: ['Alt', '2'] })
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

  say('右键换画风，也可以用自己的图片')
  await click(stage, '.tw-ribbon-new')
  scene.markMenu = true
  await stage.wait(320)
  await click(stage, '.tw-art-2')
  scene.art = 2; scene.markMenu = false
  await stage.wait(800)

  say('滚动条旁同时有一道同色的刻度，翻走了靠它找回来')
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
  stage.look({ x: 700, y: 330 }, 1.2)
  await stage.wait(500)

  say({ text: '搜索标题和正文', keys: ['Ctrl', 'K'] })
  await click(stage, '.tw-lib-search')
  await stage.type('特征', value => { scene.query = value }, 160)
  await stage.wait(1000)
  scene.query = ''
  await stage.wait(300)

  say('右键文档，放进分组或收藏')
  stage.look('.tw-file-1', 1.7, [.7, .6])
  await click(stage, '.tw-file-1', [.6, .4])
  scene.fileMenu = true
  await stage.wait(260)
  await click(stage, '.tw-fm-group')
  scene.grouped = true; scene.fileMenu = false
  await stage.wait(350)
  await click(stage, '.tw-file-1 .tw-star')
  scene.starred = true
  await stage.wait(700)
  stage.look(null, 1)
  await stage.wait(700)
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

  say({ text: '并排阅读两份文档', keys: ['Ctrl', '\\'] })
  stage.look(null, 1)
  await click(stage, '.tw-split')
  scene.ai = false; scene.split = true
  await stage.wait(700)
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

  say({ text: '缩放页面，触控板可以两指捏合', keys: ['Ctrl', '滚轮'] })
  stage.look(null, 1)
  await stage.move('.tw-page', { at: [.5, .4] })
  await stage.tween(600, k => { scene.zoom = 1 + k * .28 })
  await stage.tween(700, k => { scene.zoom = 1.28 - k * .4 })
  await stage.tween(500, k => { scene.zoom = .88 + k * .12 })

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
    await stage.wait(520)
  }

  say('深色和浅色随时切换')
  await click(stage, '.tw-dark')
  scene.dark = true
  await stage.wait(900)
  await stage.click()
  scene.dark = false
  await stage.wait(400)

  say('底板可以换预设，或用自己的图片')
  await click(stage, '.tw-bg-2')
  scene.photo = true
  await stage.wait(1400)
}

export const LESSONS: Lesson[] = [
  { id: 'setup', title: '接入 AI', note: '连接服务，给每个功能选模型', steps: 4, play: setup },
  { id: 'explain', title: '快速解释', note: '选中文字后按中键', steps: 8, play: explain },
  { id: 'visual', title: '用图解释', note: '图解、可拖的图、合集', steps: 3, play: visual },
  { id: 'assistant', title: '阅读助手', note: '提问、附属对话、分支、指令', steps: 5, play: assistant },
  { id: 'capture', title: '截图提问', note: '框选、右键拖动、固定多张', steps: 7, play: capture },
  { id: 'translate', title: '翻译', note: '划词翻译与翻译栏', steps: 3, play: translate },
  { id: 'ink', title: '标记', note: 'Alt + 1 / 2 / 3 直接拿起工具', steps: 4, play: ink },
  { id: 'bookmark', title: '书签', note: '夹在页边，Ctrl + ↑ ↓ 跳转', steps: 5, play: bookmark },
  { id: 'library', title: '文库', note: '导入、搜索、分组、收藏', steps: 3, play: library },
  { id: 'tabs', title: '多文档', note: '标签页与并排阅读', steps: 2, play: tabs },
  { id: 'view', title: '阅读视图', note: '目录、搜索、缩放、收起界面', steps: 4, play: view },
  { id: 'focus', title: '计时', note: '倒计时与提醒', steps: 3, play: focus },
  { id: 'look', title: '外观', note: '四种风格、深浅色、底板', steps: 3, play: look },
]

/* 看过哪些、还要不要自动弹出，记在本机。 */
const KEY = 'tour.v1'
export type TourMemory = { done: string[]; hidden: boolean }
export function loadTour(): TourMemory {
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}'); return { done: Array.isArray(saved.done) ? saved.done.filter((id: unknown) => typeof id === 'string') : [], hidden: saved.hidden === true } } catch { return { done: [], hidden: false } }
}
export function saveTour(memory: TourMemory) { try { localStorage.setItem(KEY, JSON.stringify(memory)) } catch { /* 存不下就算了 */ } }
