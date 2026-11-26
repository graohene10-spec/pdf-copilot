import type { Point } from './director'
import type { Play } from './lessons'
import { TURNS, WISH, freshLearn, type LearnScene } from './lesson-learn'

/* 大纲与进度一课：文档库卡片上的进度条、学习进度页，接着学进到书里，再是大纲栏（右键安排、调整次序、让助手改、挪到左边）。 */
export type PlanNode = { id: string; title: string; page: number }
export type PlanScene = {
  /** 大纲在助手栏左侧（right）还是屏幕最左（left）；still 是这一下不要过渡（松手落位）。 */
  side: 'right' | 'left'
  still: boolean
  /** 节点的次序、右键安排过的快慢、删掉正在收起的、助手加的那一个出来没有。 */
  order: string[]
  pace: Record<string, 'fast' | 'slow'>
  gone: string[]
  added: boolean
  /** 节点的右键菜单开在哪、指着哪一项。 */
  menu: Point | null
  hot: '' | 'fast' | 'slow'
  /** 调整模式；拿着的节点、它挪了多少、还浮着没有；让位的节点各挪了多少。 */
  adjusting: boolean
  held: string
  drag: number
  lifted: boolean
  shift: Record<string, number>
  /** 底下输入框里的字；助手正在改。 */
  wish: string
  revising: boolean
  /** 文档库卡片上的进度条。 */
  shelf: boolean
  /** 学习进度页在场（离开后还要多留一会儿，盖住正在退场的文档库视图）、卡片的右键菜单和指着的项、正在改的名字、改好的名字。 */
  board: boolean
  cardMenu: Point | null
  cardHot: '' | 'rename'
  renaming: string | null
  name: string
}

export const NODES: PlanNode[] = [
  { id: 'a', title: '特征值的定义', page: 87 },
  { id: 'b', title: '特征方程', page: 92 },
  { id: 'c', title: '求特征向量', page: 95 },
  { id: 'd', title: '相似矩阵', page: 101 },
  { id: 'e', title: '对角化条件', page: 106 },
  { id: 'f', title: '几何意义', page: 98 },
  { id: 'g', title: '实对称矩阵', page: 114 },
  { id: 'h', title: '正交对角化', page: 118 },
]
/* 让助手改之后多出来的一节。 */
export const ADDED: PlanNode = { id: 'i', title: '习题 5.1–5.8', page: 121 }
export const PASSED = ['a', 'b']
export const CURRENT = 'c'
/* 学习进度页：按书分组，一段学习一张卡片。第一张就是这一课里的大纲，数字和它对得上。 */
export type Card = { id: string; title: string; way: string; phase: string; day: string; passed: number; total: number; now: string; go: string }
export const BOARD: { book: string; cards: Card[] }[] = [
  { book: '线性代数讲义', cards: [
    { id: 'a', title: '第5章 特征值', way: '深度理解', phase: '带读中', day: '今天', passed: 2, total: 8, now: '求特征向量', go: '接着学' },
    { id: 'b', title: '行列式', way: '复习', phase: '学完了', day: '3 天前', passed: 5, total: 5, now: '', go: '回顾' },
  ] },
  { book: 'Attention Is All You Need', cards: [
    { id: 'c', title: '自注意力', way: '速通', phase: '摸底中', day: '昨天', passed: 0, total: 0, now: '', go: '接着学' },
  ] },
]
export const RENAME = '特征值与对角化'

export const freshPlan = (): PlanScene => ({
  side: 'right', still: false, order: NODES.map(node => node.id), pace: {}, gone: [], added: false, menu: null, hot: '',
  adjusting: false, held: '', drag: 0, lifted: false, shift: {}, wish: '', revising: false,
  shelf: true, board: false, cardMenu: null, cardHot: '', renaming: null, name: '',
})

/* 助手栏里接着「学习」一课那段对话：学完了第一步，停在最后一句「答对」。 */
const learned = (): LearnScene => ({ ...freshLearn(), stage: 'teach', ticked: true, shown: TURNS.length - 2, picked: [1, 0, 1, 2], sure: [2, null, null, null], sent: [true, true, true, true], opened: true, current: 1, passed: 1 })
const REPLY = TURNS.length - 1

type Stage = Parameters<Play>[0]
async function click(stage: Stage, target: string, at?: [number, number]) {
  await stage.move(target, { at })
  await stage.click()
}

export const outline: Play = async (stage, scene, say) => {
  // 从文档库开始，最后停在书里：循环回到开头时不用等文档库视图退场。
  scene.plan = freshPlan()
  const plan = scene.plan
  scene.view = 'library'; scene.talk = BOARD[0]!.cards[0]!.title; scene.learn = learned(); scene.zoom = .72
  stage.place({ x: 700, y: 790 })

  say('文档库的卡片上显示学习进度')
  await stage.wait(450)
  stage.look('.tw-file-0', 1.8, [.5, .85])
  await stage.move('.tw-learnbar', { at: [.3, .5], ms: 1000 })
  await stage.wait(1300)

  say('侧栏「学习进度」列出每段学习')
  stage.look(null, 1)
  // 等镜头退到侧栏露出来再点。
  await stage.wait(450)
  await click(stage, '.tw-nav-learn')
  scene.view = 'board'; plan.board = true
  await stage.wait(700)
  stage.look('.to-board', 1.3, [.4, .3])
  await stage.wait(1800)

  say({ text: '右键卡片，改名或删除', mouse: 'right' })
  await stage.move('.to-card-a', { at: [.62, .5], ms: 800 })
  await stage.wait(200)
  await stage.click('right')
  plan.cardMenu = stage.locate('.to-card-a', [.62, .5])
  await stage.wait(700)
  await stage.move('.to-cm-rename', { ms: 450 })
  plan.cardHot = 'rename'
  await stage.wait(300)
  await stage.click()
  plan.cardMenu = null; plan.cardHot = ''; plan.renaming = BOARD[0]!.cards[0]!.title
  await stage.wait(700)
  await stage.type(RENAME, value => { plan.renaming = value }, 110)
  await stage.wait(450)
  plan.name = RENAME; plan.renaming = null; scene.talk = RENAME
  await stage.wait(1100)

  // 点「接着学」回到书里：学习进度页先淡出，书和带着大纲的助手栏再进来，两边的字不叠在一起。
  await click(stage, '.to-card-a .to-go')
  plan.board = false
  stage.look(null, 1)
  await stage.wait(220)
  scene.view = 'reader'
  await stage.wait(600)

  say({ text: '右键节点，安排讲快或讲细', mouse: 'right' })
  stage.look('.to-col', 1.6, [.5, .3])
  await stage.move('.to-node-e', { at: [.42, .5], ms: 900 })
  await stage.wait(250)
  await stage.click('right')
  plan.menu = stage.locate('.to-node-e', [.42, .5])
  await stage.wait(550)
  await stage.move('.to-pace-fast', { ms: 450 })
  plan.hot = 'fast'
  await stage.wait(350)
  await stage.move('.to-pace-slow', { ms: 320 })
  plan.hot = 'slow'
  await stage.wait(300)
  await stage.click()
  plan.menu = null; plan.hot = ''; plan.pace.e = 'slow'
  await stage.wait(1300)

  // 拿起来的节点跟着鼠标走；越过谁的中线，谁就滑下去让位。松手时换好次序，位置不动。
  say({ text: '点「调整」，按住节点上下拖，换次序', mouse: 'left' })
  await click(stage, '.to-adjust')
  plan.adjusting = true
  await stage.wait(1000)
  const held = stage.locate('.to-node-f', [.45, .5]), pitch = held.y - stage.locate('.to-node-e', [.45, .5]).y
  await stage.move(held, { ms: 700 })
  stage.press()
  await stage.wait(250)
  plan.held = 'f'; plan.lifted = true
  await stage.wait(250)
  const passing = ['e', 'd', 'c']
  await stage.move({ x: held.x, y: held.y - pitch * 3 }, { ms: 1400, step: k => {
    plan.drag = -pitch * 3 * k
    passing.forEach((id, index) => { plan.shift[id] = pitch * 3 * k > pitch * (index + .5) ? pitch : 0 })
  } })
  await stage.wait(300)
  stage.release()
  plan.lifted = false
  await stage.wait(220)
  plan.still = true; plan.order = ['a', 'b', 'f', 'c', 'd', 'e', 'g', 'h']; plan.held = ''; plan.drag = 0; plan.shift = {}
  await stage.wait(80)
  plan.still = false
  await stage.wait(700)

  say('点减号删掉')
  await click(stage, '.to-node-g .to-minus')
  plan.gone = ['g']
  await stage.wait(1100)
  await click(stage, '.to-adjust')
  plan.adjusting = false
  await stage.wait(900)

  // 字幕在上面：镜头推到输入框时它挡不住。发出去以后镜头退到看得见整个助手栏、顶到画布上沿（字幕只压着大纲的表头）：右边对话里出现这句要求和回答，左边大纲多出一节。
  say({ text: '写一句话，让助手改大纲', top: true })
  stage.look('.to-foot', 1.6, [.5, -.6])
  await click(stage, '.to-wish', [.3, .5])
  await stage.type(WISH, value => { plan.wish = value }, 120)
  await stage.wait(300)
  await click(stage, '.to-send')
  plan.wish = ''; plan.revising = true; scene.learn.shown = REPLY; scene.learn.typed = 0
  stage.look({ x: 1000, y: 0 }, 1.1)
  await stage.wait(1700)
  plan.revising = false; plan.added = true; scene.learn.shown = REPLY + 1
  const reply = TURNS[REPLY]!, length = 'say' in reply ? reply.say.join('').length : 0
  await stage.tween(700, k => { scene.learn.typed = Math.round(k * length) }, true)
  await stage.wait(1300)

  say('大纲可以挪到屏幕左边')
  stage.look({ x: 600, y: 330 }, 1.2)
  await stage.wait(300)
  await click(stage, '.to-move')
  plan.side = 'left'
  await stage.wait(1600)
  await click(stage, '.to-move')
  plan.side = 'right'
  await stage.wait(1200)
}
