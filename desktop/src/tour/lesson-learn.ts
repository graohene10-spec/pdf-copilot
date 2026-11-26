import type { Director } from './director'
import type { Play, Scene } from './lessons'

type Stage = Director['api']

/** 学习一课：走到哪一步、第 5 章勾上没有、对话里出现了几条、最后一条回答写出几个字、四道题各选了哪项和几分把握、交了没有、检查题点开没有、大纲上正在学和学过几个、对话往回翻了多少。 */
export type LearnScene = {
  stage: '' | 'setup' | 'probe' | 'plan' | 'teach'
  ticked: boolean
  shown: number
  typed: number
  picked: (number | null)[]
  sure: (number | null)[]
  sent: boolean[]
  opened: boolean
  current: number
  passed: number
  lift: number
}
export const freshLearn = (): LearnScene => ({ stage: '', ticked: false, shown: 0, typed: 0, picked: [null, null, null, null], sure: [null, null, null, null], sent: [false, false, false, false], opened: false, current: -1, passed: 0, lift: 0 })

/* 设定表、大纲上的字。章节和页码跟总结一课的那张表一致；大纲和「大纲与进度」一课是同一份，那一课接着这里往下学。 */
export const LEARN = {
  chapters: [['第4章 行列式', '52–86'], ['第5章 特征值', '87–120'], ['第6章 二次型', '121–150']],
  goals: ['速通', '复习', '深度理解'],
  sure: ['蒙的', '不太确定', '比较确定', '确定'],
  nodes: [['特征值的定义', 87], ['特征方程', 92], ['求特征向量', 95], ['相似矩阵', 101], ['对角化条件', 106], ['几何意义', 98], ['实对称矩阵', 114], ['正交对角化', 118]] as [string, number][],
}
/* 两道摸底、一道先猜、一道检查。answer 是对的那项；why 答完才显示。 */
export type LearnQuiz = { kind: string; question: string; options: string[]; answer: number; why?: string }
export const QUIZZES: LearnQuiz[] = [
  { kind: '摸底 1', question: '矩阵乘一个向量，一般改变它的什么？', options: ['只改变长度', '方向和长度', '都不变'], answer: 1 },
  { kind: '摸底 2', question: '行列式为 0 的方阵一定怎样？', options: ['不可逆', '元素全是 0', '是单位矩阵'], answer: 0 },
  { kind: '先猜', question: '横向拉长 2 倍、纵向拉长 3 倍，哪些向量不转向？', options: ['所有向量', '横轴、纵轴上的', '一个也没有'], answer: 1, why: '横轴、纵轴上的向量只被拉长。' },
  { kind: '检查', question: '特征向量被矩阵作用以后会怎样？', options: ['转到和它垂直的方向', '长度一定不变', '留在原来那条直线上'], answer: 2, why: '它只被伸缩，不离开原来那条直线。' },
]
/* 「大纲与进度」一课接着这段对话：在大纲底下写的那句要求。 */
export const WISH = '最后加一节习题'
/* 对话里一条条出现的东西：我发的、助手写的（单数位是原文出处）、题目。最后一问一答是「大纲与进度」一课里让助手改大纲。 */
export type Turn = { me: string } | { say: string[] } | { quiz: number[] }
export const TURNS: Turn[] = [
  { me: '学习《线性代数讲义》\n- 范围：「第5章 特征值」\n- 目标：深度理解\n- 题型：选择' },
  { say: ['先看两个点。'] },
  { quiz: [0, 1] },
  { me: '答了 2 题' },
  { say: ['两题都对。从「特征值的定义」讲起，一共 8 步。'] },
  { me: '就按这条路线开始。' },
  { say: ['先猜一下。'] },
  { quiz: [2] },
  { me: '答对' },
  { say: ['对。横轴、纵轴上的向量只被拉长，不转向', '第 87 页', '。这种只被伸缩的方向叫特征向量，倍数叫特征值。'] },
  { quiz: [3] },
  { me: '答对' },
  { me: `调整大纲：${WISH}` },
  { say: ['在最后加了一节「习题 5.1–5.8」。'] },
]
const spoken = (turn: number) => { const item = TURNS[turn]!; return 'say' in item ? item.say.join('').length : 0 }

async function click(stage: Stage, target: string, at?: [number, number]) {
  await stage.move(target, { at })
  await stage.click()
}
/* 新的一条出现，再让助手把这条一个字一个字写出来。 */
async function write(stage: Stage, scene: Scene, turn: number, ms: number) {
  scene.learn.shown = turn + 1; scene.learn.typed = 0
  await stage.tween(ms, k => { scene.learn.typed = Math.round(k * spoken(turn)) }, true)
}
/* 对话往回翻，让这张卡片的顶露出来；不给卡片就翻回最底下。 */
async function peek(stage: Stage, scene: Scene, target: string | null, ms: number) {
  const from = scene.learn.lift
  let to = 0
  if (target) { const view = stage.box('.tl-chat'), box = stage.box(target); to = Math.max(from, from + view.y - box.y + 6) }
  await stage.tween(ms, k => { scene.learn.lift = from + (to - from) * k })
}

/* 学习：欢迎页进去，设定表 → 两道摸底一起交 → 出大纲、点「就这样开始」→ 带读一个节点（先猜、讲解、检查）→ 大纲点亮。 */
export const learn: Play = async (stage, scene, say) => {
  const state = scene.learn
  say('新对话里点「学习这一段」')
  stage.place({ x: 960, y: 790 })
  stage.look('.tw-task-learn', 1.6)
  await stage.wait(500)
  await click(stage, '.tw-task-learn')
  state.stage = 'setup'
  // 设定表一出来，镜头就跟过去、鼠标马上走开：停在原处正好挨着「开始」，像是点了它。
  await stage.wait(0)
  stage.look('.tl-setup', 1.55, [.5, .48])

  say('勾选范围，选目标')
  await click(stage, '.tl-ch-1 i')
  state.ticked = true
  await stage.wait(450)
  await stage.move('.tl-goals', { at: [.17, .5] })
  await stage.move('.tl-goals', { at: [.83, .5], ms: 900 })
  await stage.wait(450)
  await click(stage, '.tl-start')
  // 大纲一栏在助手栏左边长出来，页面跟着缩小让出位置。
  state.stage = 'probe'; state.shown = 1; scene.talk = '第5章 特征值'
  stage.look({ x: 1000, y: 400 }, 1.3)
  await stage.tween(450, k => { scene.zoom = 1 - k * .28 })
  await stage.wait(300)

  say('先摸底，答完一起提交')
  await write(stage, scene, 1, 350)
  state.shown = 3
  await stage.wait(500)
  await peek(stage, scene, '.tl-q-0', 500)
  stage.look('.tl-q-0', 1.6, [.5, .5])
  await stage.wait(300)
  await click(stage, '.tl-q-0 .tl-opt-1')
  state.picked[0] = 1
  await stage.wait(300)
  await click(stage, '.tl-q-0 .tl-sure-2')
  state.sure[0] = 2
  await stage.wait(400)
  stage.look('.tl-q-1', 1.6, [.5, .62])
  await peek(stage, scene, null, 700)
  await click(stage, '.tl-q-1 .tl-opt-0')
  state.picked[1] = 0
  await stage.wait(400)
  await click(stage, '.tl-all b')
  state.sent[0] = true; state.sent[1] = true; state.shown = 4
  await stage.wait(600)
  await write(stage, scene, 4, 700)

  say('看过大纲，点「就这样开始」')
  state.stage = 'plan'
  stage.look('.tl-plan', 1.45, [.55, .3])
  await stage.wait(1400)
  stage.look('.tl-accept', 1.45)
  await stage.wait(300)
  await click(stage, '.tl-accept')
  state.stage = 'teach'; state.current = 0; state.shown = 6
  await stage.wait(250)
  stage.look('.tl-plan', 1.45, [.55, .3])
  await stage.wait(900)
  await write(stage, scene, 6, 300)

  say('每一步先猜')
  state.shown = 8
  await stage.wait(450)
  stage.look('.tl-q-2', 1.6, [.5, .5])
  await stage.wait(300)
  await click(stage, '.tl-q-2 .tl-opt-1')
  state.picked[2] = 1
  await stage.wait(350)
  await click(stage, '.tl-q-2 .tl-submit')
  state.sent[2] = true; state.shown = 9
  await stage.wait(700)

  say('再讲解，标着原文出处')
  await write(stage, scene, 9, 1300)
  stage.look('.tl-cite', 1.6, [.5, 1.6])
  await stage.move('.tl-cite', { at: [.2, .85], ms: 700 })
  await stage.wait(900)

  say('读完点开检查题')
  state.shown = 11
  await stage.wait(400)
  await click(stage, '.tl-open')
  state.opened = true
  await stage.wait(450)
  stage.look('.tl-q-3', 1.6, [.5, .5])
  await stage.wait(250)
  await click(stage, '.tl-q-3 .tl-opt-2')
  state.picked[3] = 2
  await stage.wait(350)
  await click(stage, '.tl-q-3 .tl-submit')
  state.sent[3] = true; state.shown = 12
  await stage.wait(600)

  say('答对了，大纲上这一步点亮')
  stage.look('.tl-plan', 1.5, [.6, .32])
  await stage.wait(450)
  state.passed = 1; state.current = 1
  await stage.wait(2200)
}
