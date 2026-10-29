// 阅读助手的「门面」文字：空白页的问候、输入框的占位语、思考时的动词。都按种子随机，同一段对话里保持不变。
import type { GreetingStyle } from '../settings/model'

export type Greeting = { text: string; source?: string; lang: 'en' | 'zh' }
type Slot = { from: number; to: number; english: string[]; poems: [string, string][] }

// 时段从清晨 5 点起算，凌晨记作 24–29 点。问候语由用户审定；古诗每句以句号（或问号）收尾，出处只作核对，界面不显示。
const SLOTS: Slot[] = [
  { from: 5, to: 9, english: ['Good morning', 'Morning, sunshine', 'Coffee first?', 'Rise and read'],
    poems: [['身无彩凤双飞翼，心有灵犀一点通。', '李商隐《无题》'], ['日出江花红胜火，春来江水绿如蓝。', '白居易《忆江南》'], ['曲径通幽处，禅房花木深。', '常建《题破山寺后禅院》'], ['书卷多情似故人，晨昏忧乐每相亲。', '于谦《观书》']] },
  { from: 9, to: 12, english: ['Good morning', 'A fine morning for ideas', 'Shall we begin?', 'Morning, scholar'],
    poems: [['问渠那得清如许？为有源头活水来。', '朱熹《观书有感》'], ['春色满园关不住，一枝红杏出墙来。', '叶绍翁《游园不值》'], ['是日也，天朗气清，惠风和畅。', '王羲之《兰亭集序》'], ['春风得意马蹄疾，一日看尽长安花。', '孟郊《登科后》']] },
  { from: 12, to: 14, english: ['Good afternoon', 'Lunch, then a chapter?', 'Midday, mid-chapter'],
    poems: [['日长睡起无情思，闲看儿童捉柳花。', '杨万里《闲居初夏午睡起》'], ['书卷多情似故人，晨昏忧乐每相亲。', '于谦《观书》'], ['树阴满地日当午，梦觉流莺时一声。', '苏舜钦《夏意》'], ['千淘万漉虽辛苦，吹尽狂沙始到金。', '刘禹锡《浪淘沙》']] },
  { from: 14, to: 18, english: ['Good afternoon', 'Fancy a cup of tea?', 'Tea and theorems?', 'Slow light, slow reading', 'Your account has been suspended'],
    poems: [['闲坐小窗读周易，不知春去几多时。', '叶采《暮春即事》'], ['读书不觉已春深，一寸光阴一寸金。', '王贞白《白鹿洞二首》'], ['千淘万漉虽辛苦，吹尽狂沙始到金。', '刘禹锡《浪淘沙》'], ['日午独觉无余声，山童隔竹敲茶臼。', '柳宗元《夏昼偶作》'], ['山雨欲来风满楼。', '许浑《咸阳城东楼》']] },
  { from: 18, to: 20, english: ['Good evening', 'The sky is turning gold', 'Evening, reader', 'Your account has been suspended'],
    poems: [['昨夜西风凋碧树，独上高楼，望尽天涯路。', '晏殊《蝶恋花》'], ['夕阳无限好，只是近黄昏。', '李商隐《登乐游原》'], ['夕阳牛背无人卧，带得寒鸦两两归。', '张舜民《村居》'], ['衣带渐宽终不悔，为伊消得人憔悴。', '柳永《蝶恋花》'], ['落霞与孤鹜齐飞，秋水共长天一色。', '王勃《滕王阁序》']] },
  { from: 20, to: 23, english: ['Good evening', 'The moon is beautiful, isn’t it?', 'A quiet night for reading'],
    poems: [['粗缯大布裹生涯，腹有诗书气自华。', '苏轼《和董传留别》'], ['眼前直下三千字，胸次全无一点尘。', '于谦《观书》'], ['春风若有怜花意，可否许我再少年？', '网络流传'], ['算无情更苦，莺巢暗叶，啼破幽寂。', ''], ['古木无人径，深山何处钟。', '王维《过香积寺》']] },
  { from: 23, to: 29, english: ['The moon is beautiful, isn’t it?', 'Burning the midnight oil?', 'Still up? So am I', 'Stars out, pages open', 'Your account has been suspended'],
    poems: [['老僧夜半误鸣钟。惊起西窗眠不得，捲地西风。', '辛弃疾《浪淘沙·山寺夜半闻钟》'], ['晚来天欲雪，能饮一杯无。', '白居易《问刘十九》'], ['今夜偏知春气暖，虫声新透绿窗纱。', '刘方平《月夜》'], ['明月别枝惊鹊，清风半夜鸣蝉。', '辛弃疾《西江月·夜行黄沙道中》'], ['力拔山兮气盖世，时不利兮骓不逝。', '项羽《垓下歌》']] },
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

// 输入框的提示语（用户审定）：每段对话随机一句。
export const PLACEHOLDERS: string[] = [
  '请输入文本。',
  '来一个最直白、最直接、最不绕弯子的解释。',
  '贾维斯我拉裤兜了。',
  '我是一个拥有博士学位的弱智老奶奶，为我讲解这篇论文……',
  '本应用由天才程序员Opus5.5研发。',
  '贾维斯帮我挠一下两颗红巨星和一根创世之柱。',
  'Ask Anything.',
  '豆包豆包，帮我证明黎曼猜想。',
  '询问人工智能……',
  '先建立唯一基线，再做可追溯备份，先进行最小改动，跑一轮烟测，检查 89 个门禁是否通过。',
  '你知道一斤铁和一斤棉花谁更重吗？',
  '你是一个来自2050年的拥有1000T参数的专业大模型……',
  '及其所之既倦，情随事迁，感慨系之矣。向之所欣，俯仰之间，已为陈迹，犹不能不以之兴怀。况修短随化，终期于尽。古人云：“死生亦大矣。”岂不痛哉！',
]
export function placeholderFor(random = Math.random()) { return PLACEHOLDERS.length ? pick(PLACEHOLDERS, random) : '' }

// 思考时的动词，学 Claude Code：每段回答随机一个，配上省略号。
export const THINKING_VERBS = ['Thinking', 'Pondering', 'Contemplating', 'Ruminating', 'Musing', 'Deliberating', 'Mulling', 'Cogitating', 'Reflecting', 'Considering', 'Reasoning', 'Puzzling', 'Percolating', 'Brewing', 'Synthesizing', 'Untangling', 'Distilling', 'Deciphering']
export function thinkingVerb(seed: string) {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return THINKING_VERBS[hash % THINKING_VERBS.length]!
}
/** Claude Code 的转动星标：六个字形来回循环。 */
export const SPINNER_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
/** 思考时的转动符号有好几种，每段回答随机用一种。 */
export const SPINNERS = [
  SPINNER_FRAMES,
  ['✶', '✸', '✹', '✺', '✹', '✸'],
  ['·', '✧', '✦', '✧'],
  ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  ['◐', '◓', '◑', '◒'],
  ['◜', '◠', '◝', '◞', '◡', '◟'],
  ['∙', '•', '●', '•'],
  ['❋', '✺', '✹', '✸', '✷', '✶', '✷', '✸', '✹', '✺'],
]
export function spinnerFor(seed: string) {
  let hash = 7
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
  return SPINNERS[hash % SPINNERS.length]!
}
