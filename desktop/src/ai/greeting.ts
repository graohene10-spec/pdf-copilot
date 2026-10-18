// 阅读助手空白页的问候：按当地时间分段，每段几句，打开时随机挑一句。
const GREETINGS: { from: number; to: number; lines: string[] }[] = [
  { from: 5, to: 9, lines: ['早安，今天读点什么？', '晨光正好，适合翻开一本书', '早，先读一页再说', '新的一天，从一个问题开始'] },
  { from: 9, to: 12, lines: ['上午好，正是专注的时候', '上午好，从哪一页开始？', '趁头脑清醒，啃块硬骨头', '上午好，把难懂的留给我'] },
  { from: 12, to: 14, lines: ['午安，边吃边读也不错', '午间片刻，读两页再歇', '午安，慢一点也没关系', '吃饱了，正好想点问题'] },
  { from: 14, to: 18, lines: ['下午好，来杯茶吧', '午后的光，适合慢慢读', '下午好，读到哪儿了？', '泡壶茶，把这一章读透'] },
  { from: 18, to: 20, lines: ['傍晚好，收个尾吧', '黄昏时分，再读一节', '傍晚好，今天学到了什么？'] },
  { from: 20, to: 23, lines: ['晚上好，安静的时间到了', '夜读时分，一盏灯就够', '晚上好，今天的疑问交给我', '夜色正好，适合想深一点'] },
  { from: 23, to: 29, lines: ['夜深了，别熬太晚', '深夜还在读？我陪你', '星光作伴，再看最后一页', '这么晚了，挑个小问题吧'] },
]

export function greetingFor(date: Date, random = Math.random()): string {
  const hour = date.getHours() < 5 ? date.getHours() + 24 : date.getHours()
  const slot = GREETINGS.find(item => hour >= item.from && hour < item.to) || GREETINGS[3]!
  return slot.lines[Math.min(slot.lines.length - 1, Math.floor(random * slot.lines.length))]!
}
