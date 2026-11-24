// 搜对话：标题和消息内容一起搜。先找一字不差的；找不到再放宽——
// 字按顺序出现、中间隔几个字也算（打「特征向」能找到「特征值与特征向量」），或者打错、多打了一个字也算。
export type Snippet = { before: string; hit: string; after: string }
export type Found<T> = { item: T; score: number; title: Snippet | null; snippet: Snippet | null; messageId?: string }
type Talk = { title?: string; updatedAt?: number; messages: { id: string; content: string; auto?: boolean; summary?: boolean }[] }
type Range = { start: number; end: number; loose: boolean }

/** 在一段（已转小写的）文字里找一个词。 */
export function locate(hay: string, token: string): Range | null {
  const exact = hay.indexOf(token)
  if (exact >= 0) return { start: exact, end: exact + token.length, loose: false }
  const chars = [...token]
  if (chars.length < 3) return null
  // 字按顺序出现，整段不超过词的两倍长。
  const loose = within(hay, chars, token.length * 2)
  if (loose || chars.length < 4) return loose
  // 打错或多打了一个字：去掉任意一个字后，剩下的按顺序出现。
  for (let i = 0; i < chars.length; i++) {
    const found = within(hay, chars.filter((_, at) => at !== i), token.length * 2)
    if (found) return found
  }
  return null
}
function within(hay: string, chars: string[], room: number): Range | null {
  let best: Range | null = null
  const size = chars.join('').length
  for (let from = hay.indexOf(chars[0]!); from >= 0; from = hay.indexOf(chars[0]!, from + 1)) {
    const span = hay.slice(from, from + room)
    let pos = chars[0]!.length, ok = true
    for (let i = 1; i < chars.length; i++) { const next = span.indexOf(chars[i]!, pos); if (next < 0) { ok = false; break } pos = next + chars[i]!.length }
    if (ok && (!best || pos < best.end - best.start)) { best = { start: from, end: from + pos, loose: true }; if (pos <= size + 1) break }
  }
  return best
}
const flat = (text: string) => text.replace(/\s+/g, ' ')
function cut(text: string, range: Range, lead: number, tail: number): Snippet {
  const from = Math.max(0, range.start - lead), to = Math.min(text.length, range.end + tail)
  return { before: (from > 0 ? '…' : '') + flat(text.slice(from, range.start)), hit: flat(text.slice(range.start, range.end)), after: flat(text.slice(range.end, to)) + (to < text.length ? '…' : '') }
}
/** 空格隔开的每个词都要找到（在标题或任意一条消息里）。标题里找到的排前面，一字不差的排前面，再按新旧。 */
export function searchTalks<T extends Talk>(list: T[], query: string, limit = 80): Found<T>[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)
  if (!tokens.length) return []
  const found: Found<T>[] = []
  for (const item of list) {
    const title = item.title || '', low = title.toLowerCase()
    const texts = item.messages.filter(message => !message.auto && !message.summary && message.content)
    let lows: string[] | undefined
    let score = 0, titleHit: Snippet | null = null, snippet: Snippet | null = null, messageId: string | undefined, missed = false
    for (const token of tokens) {
      const inTitle = locate(low, token)
      if (inTitle) { score += inTitle.loose ? 6 : 10; titleHit ||= cut(title, inTitle, title.length, title.length); if (!inTitle.loose) continue }
      lows ||= texts.map(message => message.content.toLowerCase())
      // 内容里先找一字不差的，再放宽。
      let at = lows.findIndex(text => text.includes(token)), range = at >= 0 ? locate(lows[at]!, token) : null
      if (!range && !inTitle) for (at = 0; at < lows.length; at++) { range = locate(lows[at]!, token); if (range) break }
      if (range) { score += range.loose ? 2 : 4; if (!snippet) { snippet = cut(texts[at]!.content, range, 14, 48); messageId = texts[at]!.id } }
      else if (!inTitle) { missed = true; break }
    }
    if (!missed) found.push({ item, score, title: titleHit, snippet, messageId })
  }
  return found.sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0)).slice(0, limit)
}
