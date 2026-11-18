// 书签的画面：每一枚书签是一小幅画，画风取自艺术史上的一个流派，按年代排。
// 全是原创的几何小构图（不是哪一幅名作的复制品），静态 SVG，画一次就不再重绘。画布 96 × 40。
export type BookmarkArt = { id: string; name: string; era: string; svg: string }

// 印象派的笔触：一把短短的色点，位置和颜色固定（同一枚书签每次看到的都一样）。
function dabs() {
  const palette = ['#5b86b0', '#7fa9c9', '#a9c8d8', '#6f9e7a', '#9cc08a', '#e3a7b5', '#f1d3c9', '#b7a2d2', '#f3e7b0', '#3f6f93']
  let seed = 7, out = ''
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let index = 0; index < 64; index++) {
    const x = next() * 96, y = next() * 40, color = palette[Math.floor(next() * palette.length)]
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(3 + next() * 3).toFixed(1)}" ry="1.5" fill="${color}" opacity=".9" transform="rotate(${(-20 + next() * 40).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
  }
  return out
}
// 欧普：一圈圈黑白相间的环，圆心偏一点，看着像在鼓起来。
function rings() {
  let out = ''
  for (let index = 13; index >= 1; index--) out += `<circle cx="${(40 + index * 1.3).toFixed(1)}" cy="20" r="${index * 4.6}" fill="${index % 2 ? '#111' : '#f6f4ee'}"/>`
  return out
}
// 装饰艺术：从底边中点放射出去的金色光芒。
function rays() {
  let out = ''
  for (let index = 0; index <= 12; index++) { const a = Math.PI * index / 12; out += `<path d="M48 40L${(48 - Math.cos(a) * 70).toFixed(1)} ${(40 - Math.sin(a) * 70).toFixed(1)}" stroke="#d4a94a" stroke-width="${index % 2 ? 1 : 2.2}"/>` }
  return out
}
// 浮世绘：青海波纹样，一排排同心的弧。
function waves() {
  let out = ''
  for (let row = 0; row < 3; row++) for (let col = -1; col < 8; col++) {
    const x = col * 14 + (row % 2 ? 7 : 0), y = 26 + row * 7
    for (const [r, color] of [[7, '#1f3f6b'], [5, '#f1e6cf'], [3.2, '#1f3f6b'], [1.4, '#f1e6cf']] as const) out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`
  }
  return out
}

export const BOOKMARK_ARTS: BookmarkArt[] = [
  { id: 'classical', name: '古典', era: '古希腊', svg: `<rect width="96" height="40" fill="#1c1a17"/><defs><pattern id="bka-key" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M0 14H13V3H4V10H9" fill="none" stroke="#cf7a45" stroke-width="2.2"/></pattern></defs><rect y="12" width="96" height="16" fill="url(#bka-key)"/><path d="M0 6H96M0 34H96" stroke="#cf7a45" stroke-width="2"/><path d="M0 2.5H96M0 37.5H96" stroke="#cf7a45" stroke-width=".8"/>` },
  { id: 'renaissance', name: '文艺复兴', era: '15 世纪', svg: `<rect width="96" height="40" fill="#efe3c8"/><g fill="none" stroke="#7a5230" stroke-width=".8"><path d="M48 12L0 40M48 12L20 40M48 12L40 40M48 12L56 40M48 12L76 40M48 12L96 40M8 35H88M22 27H74M32 21H64" opacity=".55"/><circle cx="48" cy="19" r="13.5"/><rect x="36.5" y="7.5" width="23" height="23"/><path d="M48 5.5V32.5M34.5 19H61.5" opacity=".6"/></g><circle cx="48" cy="19" r="1.4" fill="#9b3b24"/>` },
  { id: 'ukiyoe', name: '浮世绘', era: '江户', svg: `<rect width="96" height="40" fill="#f1e6cf"/><circle cx="70" cy="13" r="8" fill="#c8372d"/>${waves()}<rect x="5" y="5" width="6" height="9" fill="#c8372d"/>` },
  { id: 'ink', name: '水墨', era: '宋元', svg: `<defs><linearGradient id="bka-ink1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23211e"/><stop offset="1" stop-color="#23211e" stop-opacity="0"/></linearGradient><linearGradient id="bka-ink2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a5650" stop-opacity=".8"/><stop offset="1" stop-color="#5a5650" stop-opacity="0"/></linearGradient></defs><rect width="96" height="40" fill="#f4f1ea"/><path d="M34 40L52 13Q56 8 60 14L70 26L78 19Q81 16 84 20L96 34V40Z" fill="url(#bka-ink2)"/><path d="M0 40L10 24Q14 18 19 22L26 12Q30 6 35 13L52 40Z" fill="url(#bka-ink1)"/><path d="M60 34H74" stroke="#23211e" stroke-width=".9"/><path d="M65 34L67 30L69 34" fill="none" stroke="#23211e" stroke-width=".7"/><rect x="85" y="5" width="6" height="6" rx=".8" fill="#b8322a"/>` },
  { id: 'impressionism', name: '印象派', era: '1870 年代', svg: `<rect width="96" height="40" fill="#8fb4cb"/>${dabs()}` },
  { id: 'nouveau', name: '新艺术', era: '1890 年代', svg: `<rect width="96" height="40" fill="#e9dcc0"/><g fill="none" stroke-linecap="round"><path d="M-2 36C16 6 30 46 48 20S78 2 98 24" stroke="#5c6b3a" stroke-width="2.2"/><path d="M-2 28C14 14 26 38 44 26S74 12 98 34" stroke="#b8892f" stroke-width="1.2"/></g><path d="M48 20C52 10 62 10 60 20C58 26 50 26 48 20Z" fill="#b8892f"/><path d="M26 30C22 22 28 16 34 22C32 30 28 32 26 30Z" fill="#5c6b3a"/><circle cx="76" cy="12" r="4" fill="none" stroke="#b8892f" stroke-width="1.2"/><circle cx="76" cy="12" r="1.5" fill="#9b4a2c"/>` },
  { id: 'cubism', name: '立体主义', era: '1910 年代', svg: `<rect width="96" height="40" fill="#b9a27a"/><g stroke="#2b2620" stroke-width=".9" stroke-linejoin="round"><path d="M0 0H30L18 22L0 16Z" fill="#8a7a63"/><path d="M30 0H58L44 18L18 22Z" fill="#d9c7a0"/><path d="M58 0H96V12L70 20L44 18Z" fill="#6f7f8a"/><path d="M0 16L18 22L26 40H0Z" fill="#5a4a3a"/><path d="M18 22L44 18L52 40H26Z" fill="#a8683e"/><path d="M44 18L70 20L78 40H52Z" fill="#e6d8b8"/><path d="M70 20L96 12V40H78Z" fill="#7d6b52"/></g><path d="M34 8A8 8 0 0 1 46 14" fill="none" stroke="#2b2620" stroke-width="1.1"/>` },
  { id: 'suprematism', name: '至上主义', era: '1915', svg: `<rect width="96" height="40" fill="#f2efe6"/><rect x="18" y="9" width="19" height="19" fill="#141414" transform="rotate(-11 27 18)"/><rect x="50" y="6" width="10" height="10" fill="#d1332a" transform="rotate(17 55 11)"/><rect x="42" y="25" width="38" height="4.5" fill="#141414" transform="rotate(-21 61 27)"/><rect x="68" y="8" width="18" height="3" fill="#e8b82e" transform="rotate(-21 77 9)"/><circle cx="84" cy="30" r="3.4" fill="#2a4f9e"/><rect x="8" y="30" width="12" height="2.2" fill="#d1332a" transform="rotate(-11 14 31)"/>` },
  { id: 'constructivism', name: '构成主义', era: '1920 年代', svg: `<rect width="96" height="40" fill="#ece3d0"/><path d="M52 0H96V40H34Z" fill="#161616"/><circle cx="62" cy="20" r="13" fill="#f4eee0"/><path d="M4 6L60 20L8 34Z" fill="#cf2e25"/><path d="M70 2L92 10" stroke="#cf2e25" stroke-width="3"/><path d="M72 37L94 31" stroke="#f4eee0" stroke-width="2"/><rect x="82" y="16" width="7" height="7" fill="#cf2e25"/><path d="M0 38H30" stroke="#161616" stroke-width="2.4"/>` },
  { id: 'destijl', name: '风格派', era: '1920 年代', svg: `<rect width="96" height="40" fill="#f7f5ee"/><rect width="27" height="15" fill="#d5281f"/><rect x="62" y="27" width="34" height="13" fill="#234a9f"/><rect x="27" y="27" width="35" height="13" fill="#f0c829"/><g stroke="#111" stroke-width="2.6"><path d="M27 0V40M62 0V40M0 15H62M0 27H96M80 0V27"/></g>` },
  { id: 'bauhaus', name: '包豪斯', era: '1920 年代', svg: `<rect width="96" height="40" fill="#efe9dc"/><circle cx="24" cy="20" r="12" fill="#2752a6"/><rect x="38" y="9" width="22" height="22" fill="#d6352b"/><path d="M62 31L76 7L90 31Z" fill="#efbf2c"/><path d="M6 36H90" stroke="#141414" stroke-width="1.6"/><path d="M38 9A22 22 0 0 0 16 31" fill="none" stroke="#141414" stroke-width="1.2"/>` },
  { id: 'deco', name: '装饰艺术', era: '1930 年代', svg: `<rect width="96" height="40" fill="#15161a"/>${rays()}<g fill="none" stroke="#d4a94a"><path d="M30 40A18 18 0 0 1 66 40" stroke-width="2"/><path d="M22 40A26 26 0 0 1 74 40" stroke-width=".9"/></g><path d="M36 40A12 12 0 0 1 60 40Z" fill="#d4a94a"/><path d="M0 2H96M0 5H96" stroke="#d4a94a" stroke-width=".9"/>` },
  { id: 'colorfield', name: '色域', era: '1950 年代', svg: `<defs><filter id="bka-soft" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter></defs><rect width="96" height="40" fill="#7c1f1a"/><g filter="url(#bka-soft)"><rect x="7" y="5" width="82" height="14" rx="2" fill="#e2622a"/><rect x="7" y="23" width="82" height="12" rx="2" fill="#3a1220"/></g>` },
  { id: 'pop', name: '波普', era: '1960 年代', svg: `<defs><pattern id="bka-dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.5" fill="#e3342b"/></pattern></defs><rect width="96" height="40" fill="#ffd23f"/><path d="M0 0H44L30 40H0Z" fill="#fff"/><path d="M0 0H44L30 40H0Z" fill="url(#bka-dots)"/><path d="M70 0H96V40H56Z" fill="#1f6fd1"/><path d="M52 4L57 14L67 9L64 19L76 21L66 26L70 36L59 31L53 39L50 29L39 33L44 23L35 17L46 16Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/>` },
  { id: 'op', name: '欧普', era: '1960 年代', svg: `<rect width="96" height="40" fill="#f6f4ee"/>${rings()}` },
]
const BY_ID = new Map(BOOKMARK_ARTS.map(item => [item.id, item]))

/** 一枚书签的画风：存过的用存的；老书签没存，就按它的 id 固定挑一种。 */
export function artOf(mark: { id: string; art?: string }): BookmarkArt {
  const saved = mark.art ? BY_ID.get(mark.art) : undefined
  if (saved) return saved
  let hash = 0
  for (const char of mark.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return BOOKMARK_ARTS[hash % BOOKMARK_ARTS.length]!
}
/** 新书签挑画风：这本书里用得最少的那些里随便挑一种，一本书的书签尽量各不相同。 */
export function pickArt(existing: { id: string; art?: string }[], random = Math.random) {
  const used = new Map<string, number>()
  for (const mark of existing) { const id = artOf(mark).id; used.set(id, (used.get(id) || 0) + 1) }
  const least = Math.min(...BOOKMARK_ARTS.map(item => used.get(item.id) || 0))
  const pool = BOOKMARK_ARTS.filter(item => (used.get(item.id) || 0) === least)
  return pool[Math.floor(random() * pool.length)]!.id
}
export const validArt = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id)
