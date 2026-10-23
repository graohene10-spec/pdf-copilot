// 阅读助手的「门面」文字：空白页的问候、输入框的占位语、思考时的动词。都按种子随机，同一段对话里保持不变。
import type { GreetingStyle } from '../settings/model'

export type Greeting = { text: string; source?: string; lang: 'en' | 'zh' }
type Slot = { from: number; to: number; english: string[]; poems: [string, string][] }

// 时段从清晨 5 点起算，凌晨记作 24–29 点。古诗只选与读书或时辰相合的句子，出处写全。
const SLOTS: Slot[] = [
  { from: 5, to: 9, english: ['Good morning', 'Morning, sunshine', 'Coffee first?', 'Rise and read'],
    poems: [['黑发不知勤学早，白首方悔读书迟', '颜真卿《劝学》'], ['日出江花红胜火，春来江水绿如蓝', '白居易《忆江南》'], ['书卷多情似故人，晨昏忧乐每相亲', '于谦《观书》']] },
  { from: 9, to: 12, english: ['Good morning', 'A fine morning for ideas', 'Shall we begin?', 'Morning, scholar'],
    poems: [['问渠那得清如许？为有源头活水来', '朱熹《观书有感》'], ['旧书不厌百回读，熟读深思子自知', '苏轼《送安惇秀才失解西归》'], ['纸上得来终觉浅，绝知此事要躬行', '陆游《冬夜读书示子聿》']] },
  { from: 12, to: 14, english: ['Good afternoon', 'Lunch, then a chapter?', 'Midday, mid-chapter'],
    poems: [['日长睡起无情思，闲看儿童捉柳花', '杨万里《闲居初夏午睡起》'], ['书卷多情似故人，晨昏忧乐每相亲', '于谦《观书》']] },
  { from: 14, to: 18, english: ['Good afternoon', 'Fancy a cup of tea?', 'Tea and theorems?', 'Slow light, slow reading'],
    poems: [['闲坐小窗读周易，不知春去几多时', '叶采《暮春即事》'], ['读书不觉已春深，一寸光阴一寸金', '王贞白《白鹿洞二首》'], ['千淘万漉虽辛苦，吹尽狂沙始到金', '刘禹锡《浪淘沙》']] },
  { from: 18, to: 20, english: ['Good evening', 'The sky is turning gold', 'Evening, reader'],
    poems: [['夕阳无限好，只是近黄昏', '李商隐《登乐游原》'], ['落霞与孤鹜齐飞，秋水共长天一色', '王勃《滕王阁序》']] },
  { from: 20, to: 23, english: ['Good evening', 'The moon is beautiful, isn’t it?', 'A quiet night for reading'],
    poems: [['粗缯大布裹生涯，腹有诗书气自华', '苏轼《和董传留别》'], ['眼前直下三千字，胸次全无一点尘', '于谦《观书》'], ['古人学问无遗力，少壮工夫老始成', '陆游《冬夜读书示子聿》']] },
  { from: 23, to: 29, english: ['The moon is beautiful, isn’t it?', 'Burning the midnight oil?', 'Still up? So am I', 'Stars out, pages open'],
    poems: [['三更灯火五更鸡，正是男儿读书时', '颜真卿《劝学》'], ['晚来天欲雪，能饮一杯无', '白居易《问刘十九》'], ['今夜偏知春气暖，虫声新透绿窗纱', '刘方平《月夜》'], ['明月别枝惊鹊，清风半夜鸣蝉', '辛弃疾《西江月·夜行黄沙道中》']] },
]

const pick = <T>(list: T[], random: number) => list[Math.min(list.length - 1, Math.floor(Math.max(0, random) * list.length))]!

/** The empty-screen greeting for this hour: an English salutation, a classical line, or one of the user's own lines. */
export function greetingFor(date: Date, random = Math.random(), style: GreetingStyle = 'mixed', custom = ''): Greeting {
  const hour = date.getHours() < 5 ? date.getHours() + 24 : date.getHours()
  const slot = SLOTS.find(item => hour >= item.from && hour < item.to) || SLOTS[3]!
  const own = customLines(custom)
  if (style === 'custom' && own.length) return { text: pick(own, random), lang: /[一-鿿]/.test(pick(own, random)) ? 'zh' : 'en' }
  // 「两者」：同一个随机数的前半落在英文，后半落在古诗，各自再按比例挑一句。
  const poetry = style === 'poetry' || (style === 'mixed' && random >= .5)
  const local = style === 'mixed' ? (random >= .5 ? random - .5 : random) * 2 : random
  if (poetry) { const [text, source] = pick(slot.poems, local); return { text, source, lang: 'zh' } }
  return { text: pick(slot.english, local), lang: 'en' }
}

export function customLines(text: string) { return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 60) }

// 输入框空着时的占位语：学术严谨的提问习惯，或一句典故、格言。
// 输入框的提示语：正常一点、幽默一点，像同学之间随口说的话。
export const PLACEHOLDERS = [
  '这段到底在说啥？用人话讲一遍。',
  '来一个最直白、最直接、最不绕弯子的解释。',
  '这个公式，能不能先别推导，先说它想干嘛？',
  '假装我是个聪明但没上过这门课的人。',
  '这一页的重点是什么？三句话以内。',
  '举个生活里的例子吧，越接地气越好。',
  '这里有坑吗？考试会怎么考？',
  '把这一段翻译成中文，再解释一下。',
  '我看懂了每个字，但连起来不懂。',
  '你这个 AI 蠢得要命，语无伦次，老子要退钱。（先认真回答这一段）',
  '先建立唯一基线，再做可追溯备份，先进行最小改动，跑一轮烟测，检查 89 个门禁是否通过……算了，先解释这页。',
  '这个结论是怎么来的？哪一步最关键？',
  '帮我出三道题检验一下我到底懂没懂。',
  '和上一章讲的有什么关系？',
]
export function placeholderFor(random = Math.random()) { return pick(PLACEHOLDERS, random) }

// 思考时的动词，学 Claude Code：每段回答随机一个，配上省略号。
export const THINKING_VERBS = ['Thinking', 'Pondering', 'Contemplating', 'Ruminating', 'Musing', 'Deliberating', 'Mulling', 'Cogitating', 'Reflecting', 'Considering', 'Reasoning', 'Puzzling', 'Percolating', 'Brewing', 'Synthesizing', 'Untangling', 'Distilling', 'Deciphering']
export function thinkingVerb(seed: string) {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return THINKING_VERBS[hash % THINKING_VERBS.length]!
}
/** Claude Code 的转动星标：六个字形来回循环。 */
export const SPINNER_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
