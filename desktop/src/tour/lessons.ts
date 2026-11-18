import type { Director } from './director'

/* 示意界面的状态：脚本只改这里，画面跟着变。 */
export type Scene = {
  /** 那句话已经选中了多少个字。 */
  selected: number
  card: 'none' | 'open' | 'pinned'
  /** 卡片出现在书页上的位置。 */
  cardAt: { x: number; y: number }
  running: boolean
  /** 解释已经写出来的字数。 */
  words: number
  drawn: boolean
  /** 书页往上滚了多少。 */
  scroll: number
}

export const freshScene = (): Scene => ({ selected: 0, card: 'none', cardAt: { x: 0, y: 0 }, running: false, words: 0, drawn: false, scroll: 0 })

export const SENTENCE = '若存在非零向量 v 使得 Av = λv，则称 λ 为 A 的特征值，v 为属于 λ 的特征向量。'
export const ANSWER = '大多数向量被 A 作用后会转向。特征向量是例外：它留在原来那条直线上，只被拉长或缩短 λ 倍。'

export type Caption = { text: string; keys?: string[]; mouse?: boolean }
export type Play = (stage: Director['api'], scene: Scene, say: (caption: Caption | string) => void) => Promise<void>
export type Lesson = { id: string; title: string; note: string; play?: Play }

const explain: Play = async (stage, scene, say) => {
  say('找到看不懂的句子')
  await stage.wait(700)
  stage.place({ x: 1010, y: 770 })
  await stage.move('.tw-a', { look: 1.95, ms: 1250 })
  await stage.wait(380)

  say('拖动鼠标选中它')
  stage.look('.tw-target', 1.95)
  stage.press()
  await stage.move('.tw-b', { ms: 1700, step: k => { scene.selected = Math.round(k * SENTENCE.length) } })
  stage.release()
  await stage.wait(620)

  say({ text: '按一下鼠标中键', mouse: true })
  await stage.wait(520)
  await stage.click('middle')
  const corner = stage.locate('.tw-page', [0, 0]), tip = stage.locate('.tw-b')
  scene.cardAt = { x: Math.max(48, Math.min(tip.x - corner.x - 150, 250)), y: tip.y - corner.y + 22 }
  scene.card = 'open'; scene.running = true
  await stage.wait(80)
  const card = stage.locate('.tw-card', [.5, 0])
  stage.look({ x: card.x, y: card.y + 150 }, 1.6)
  await stage.wait(520)

  say('解释显示在选区旁边')
  await stage.tween(2300, k => { scene.words = Math.round(k * ANSWER.length) }, true)
  scene.drawn = true
  await stage.wait(1500)
  scene.running = false
  await stage.wait(500)

  say('点图钉固定卡片')
  await stage.move('.tw-pin')
  await stage.wait(160)
  await stage.click()
  scene.card = 'pinned'
  await stage.wait(900)

  say('固定后卡片随页面滚动')
  stage.look(null, 1)
  await stage.move('.tw-page', { at: [.2, .62], ms: 1100 })
  await stage.tween(1500, k => { scene.scroll = k * 190 })
  await stage.wait(420)
  await stage.tween(1300, k => { scene.scroll = 190 - k * 130 })
  await stage.wait(500)

  say({ text: '直接用图解释', keys: ['Shift', '中键'], mouse: true })
  await stage.wait(2200)
}

/* 教程的章节。没有 play 的还没做，列表里先占位。 */
export const LESSONS: Lesson[] = [
  { id: 'explain', title: '快速解释', note: '选中文字后按中键', play: explain },
  { id: 'visual', title: '用图解释', note: '图解、可拖的模拟、合集' },
  { id: 'assistant', title: '阅读助手', note: '带着选区和框选提问' },
  { id: 'translate', title: '翻译', note: '划词翻译与翻译栏' },
  { id: 'ink', title: '标记', note: '钢笔、荧光笔、下划线' },
  { id: 'bookmark', title: '书签', note: '艺术史书签，侧栏汇总' },
  { id: 'library', title: '文库', note: '导入、搜索、分组、收藏' },
  { id: 'tabs', title: '多文档', note: '标签页与并排阅读' },
  { id: 'view', title: '阅读视图', note: '目录、搜索、缩放、收起界面' },
  { id: 'focus', title: '计时', note: '倒计时与闹钟' },
  { id: 'look', title: '外观', note: '四种风格、深浅色、底板' },
  { id: 'models', title: '接入 AI', note: 'Codex 或自己的密钥' },
]
