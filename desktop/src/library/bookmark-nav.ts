// 书签之间的跳转：按它们在书里的位置（0–1）找当前位置之前或之后最近的一个。
/** The nearest bookmark strictly before (-1) or after (+1) the current spot, by location in the document (0–1). */
export function neighbour(list: { id: string; ratio: number }[], current: number, direction: 1 | -1, epsilon = .004) {
  const sorted = [...list].sort((a, b) => a.ratio - b.ratio)
  return direction > 0 ? sorted.find(mark => mark.ratio > current + epsilon) : sorted.reverse().find(mark => mark.ratio < current - epsilon)
}
