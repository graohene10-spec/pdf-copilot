/**
 * 图解：讲概念用的静态示意图（韦恩图、嵌套、映射、关系图 / 交换图、推理链、概念树、运算表、轮换、数轴、象限）。
 * 和 intelligent-ui.ts 里的组件一样由模型写 JSON、这里用 SVG + DOM 画出来，不执行任何模型给的代码。
 *
 * 画法统一：细线、少量主色，重点（focus）描一道主色并带一点光；铅笔草稿主题下线条手绘、重点换成红铅笔。
 * 图上的文字都是 HTML 叠在 SVG 上，支持 Markdown 和 $...$ 公式。
 *
 * DIAGRAM_SKILLS 是给模型看的「图解目录」：每一种图写明适合讲什么、JSON 怎么写，模型按内容自己挑。
 */
import { renderMarkdown } from './render'

// ---- 小工具 -------------------------------------------------------------------
const SVG = 'http://www.w3.org/2000/svg'
type Attributes = Record<string, string | number | undefined>
function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (content) write(element, content)
  return element
}
function s(tag: string, attributes: Attributes = {}) {
  const element = document.createElementNS(SVG, tag)
  for (const [name, value] of Object.entries(attributes)) if (value !== undefined) element.setAttribute(name, String(value))
  return element
}
/** 截短文字，但不把公式切成半截：切到 $...$ 中间时退回到那个 $ 之前。 */
const text = (value: unknown, limit = 120) => {
  const whole = String(value ?? '')
  if (whole.length <= limit) return whole
  let cut = whole.slice(0, limit)
  if ((cut.match(/(?<!\\)\$/g) || []).length % 2) cut = cut.slice(0, cut.lastIndexOf('$'))
  return cut.trimEnd() + '…'
}
const list = (value: unknown, limit = 40): any[] => Array.isArray(value) ? value.slice(0, limit) : []
const num = (value: unknown, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback }
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
/** 一行文字：按 Markdown 渲染（公式、加粗都行），去掉外面那层段落。 */
function write(element: Element, value: string) {
  if (!/[$*_`\\]/.test(value)) { element.textContent = value; return }
  element.innerHTML = renderMarkdown(value).trim().replace(/^<p>/, '').replace(/<\/p>$/, '').replace(/<\/p>\s*<p>/g, '<br>')
}

let serial = 0
type Canvas = { card: HTMLElement; wrap: HTMLElement; svg: SVGSVGElement; ink: SVGGElement; id: string; W: number; H: number
  label: (x: number, y: number, value: string, options?: { className?: string; note?: string; align?: 'center' | 'left' | 'right'; anchor?: 'middle' | 'top' | 'bottom' }) => HTMLElement }
/** 一张图的底子：卡片、标题、按 viewBox 等比缩放的 SVG，再加一层放文字的 HTML。 */
function canvas(root: HTMLElement, spec: any, W: number, H: number): Canvas {
  const card = h('section', 'iui-card iui-dia-card')
  if (spec.title) card.append(h('h4', 'iui-title', text(spec.title, 80)))
  const wrap = h('div', 'iui-dia'); wrap.style.aspectRatio = `${W} / ${H}`
  const id = `iui-d${++serial}`
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': text(spec.title || spec.type, 80) }) as SVGSVGElement
  const defs = s('defs')
  // 箭头两种：普通和重点；草稿主题的手绘抖动滤镜（别的主题用 CSS 关掉）。
  for (const [name, className] of [['a', 'iui-ah'], ['h', 'iui-ah hot']]) {
    const marker = s('marker', { id: `${id}-${name}`, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' })
    marker.append(s('path', { d: 'M1 1.2L8.6 5L1 8.8', class: className }))
    defs.append(marker)
  }
  const wobble = s('filter', { id: `${id}-w`, x: '-5%', y: '-5%', width: '110%', height: '110%' })
  wobble.append(s('feTurbulence', { type: 'fractalNoise', baseFrequency: .012, numOctaves: 1, seed: serial % 97 }), s('feDisplacementMap', { in: 'SourceGraphic', scale: 3 }))
  defs.append(wobble)
  svg.append(defs)
  const ink = s('g', { class: 'ink', filter: `url(#${id}-w)` }) as SVGGElement
  svg.append(ink)
  const layer = h('div', 'iui-dia-labels')
  wrap.append(svg, layer)
  card.append(wrap)
  if (spec.note) card.append(h('p', 'iui-sub iui-dia-note', text(spec.note, 300)))
  root.append(card)
  // 文字排好之后：超出图框的挪回来，自由摆放的说明（不贴着点和节点的）彼此压住了就往下错开。
  let frame = 0
  const refit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => settle(wrap)) }
  new ResizeObserver(refit).observe(wrap)
  refit()
  const label: Canvas['label'] = (x, y, value, options = {}) => {
    const element = h('span', `iui-dl ${options.className || ''}`.trim(), text(value, 160))
    element.style.left = `${x / W * 100}%`; element.style.top = `${y / H * 100}%`
    if (options.align) element.dataset.align = options.align
    if (options.anchor) element.dataset.anchor = options.anchor
    if (options.note) { element.dataset.tip = text(options.note, 200); element.classList.add('has-note') }
    layer.append(element)
    return element
  }
  return { card, wrap, svg, ink, id, W, H, label }
}
const FREE = ['region', 'edge', 'set', 'muted']
function settle(wrap: HTMLElement) {
  if (!wrap.isConnected) return
  const labels = [...wrap.querySelectorAll<HTMLElement>('.iui-dl')]
  for (const label of labels) { label.style.marginLeft = ''; label.style.marginTop = '' }
  const box = wrap.getBoundingClientRect()
  if (!box.width) return
  const free = (label: HTMLElement) => FREE.some(name => label.classList.contains(name))
  const placed: DOMRect[] = []
  // 先放贴着图形的（点、节点），再放自由的说明去躲它们。
  for (const label of [...labels.filter(item => !free(item)), ...labels.filter(free)]) {
    const r = label.getBoundingClientRect()
    let dx = 0, dy = 0
    if (r.left + dx < box.left + 2) dx = box.left + 2 - r.left
    if (r.right + dx > box.right - 2) dx = Math.max(box.left + 2 - r.left, box.right - 2 - r.right)
    if (free(label)) {
      for (let round = 0; round < 6; round++) {
        const hit = placed.find(p => r.left + dx < p.right && r.right + dx > p.left && r.top + dy < p.bottom && r.bottom + dy > p.top)
        if (!hit) break
        dy += hit.bottom - (r.top + dy) + 2
      }
      if (r.bottom + dy > box.bottom + 18) dy = box.bottom + 18 - r.bottom
    }
    if (dx) label.style.marginLeft = `${dx}px`
    if (dy) label.style.marginTop = `${dy}px`
    placed.push(new DOMRect(r.left + dx, r.top + dy, r.width, r.height))
  }
}
const arrowHead = (c: Canvas, hot = false) => `url(#${c.id}-${hot ? 'h' : 'a'})`
/** 从 a 指向 b、两头各让开 gapA / gapB 的一段，bend 是向左弯的程度（0 是直线）。 */
function arrowPath(ax: number, ay: number, bx: number, by: number, gapA: number, gapB: number, bend = 0) {
  const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length
  const sx = ax + ux * gapA, sy = ay + uy * gapA, ex = bx - ux * gapB, ey = by - uy * gapB
  if (!bend) return `M${sx.toFixed(1)} ${sy.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`
  const mx = (sx + ex) / 2 - uy * bend, my = (sy + ey) / 2 + ux * bend
  return `M${sx.toFixed(1)} ${sy.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`
}
/** 椭圆形节点（宽 rx、高 ry）边界上朝 (dx, dy) 方向的距离。 */
const ellipseGap = (rx: number, ry: number, dx: number, dy: number) => { const a = Math.atan2(dy, dx); return 1 / Math.sqrt((Math.cos(a) / rx) ** 2 + (Math.sin(a) / ry) ** 2) }

// ---- 韦恩图 -------------------------------------------------------------------
function venn(spec: any, root: HTMLElement) {
  const sets = list(spec.sets, 3).map((item: any) => typeof item === 'string' ? { label: item } : item)
  if (sets.length < 2) throw new Error('韦恩图至少要两个集合')
  const three = sets.length === 3, c = canvas(root, spec, 560, three ? 340 : 280)
  const R = three ? 98 : 104
  const centers: [number, number][] = three ? [[218, 128], [342, 128], [280, 228]] : [[212, 140], [348, 140]]
  const names = sets.map((item: any, index: number) => text(item.id ?? item.label, 40) || String(index))
  const indexOf = (name: unknown) => names.indexOf(text(name, 40))
  // 全集的框。
  c.ink.append(s('rect', { class: 'iui-shape soft', x: 14, y: 12, width: c.W - 28, height: c.H - 24, rx: 14 }))
  if (spec.universe) c.label(28, 28, text(spec.universe, 40), { className: 'muted', align: 'left' })
  // 高亮的区域：在 in 里的集合取交集、不在 in 里的挖掉。
  const regions = list(spec.regions, 8)
  const clip = (index: number) => { const id = `${c.id}-c${index}`; if (!c.svg.querySelector(`#${id}`)) { const path = s('clipPath', { id }); path.append(s('circle', { cx: centers[index]![0], cy: centers[index]![1], r: R })); c.svg.querySelector('defs')!.append(path) } return `url(#${id})` }
  regions.forEach((region: any, order: number) => {
    if (!region?.focus && !region?.fill) return
    const inside = list(region.in ?? region.sets, 3).map(indexOf).filter((index: number) => index >= 0)
    const mask = s('mask', { id: `${c.id}-m${order}` })
    mask.append(s('rect', { x: 0, y: 0, width: c.W, height: c.H, fill: '#fff' }))
    centers.forEach(([x, y], index) => { if (!inside.includes(index)) mask.append(s('circle', { cx: x, cy: y, r: R, fill: '#000' })) })
    c.svg.querySelector('defs')!.append(mask)
    let shape: SVGElement = s('rect', { class: `iui-region${region.focus ? ' hot' : ''}`, x: 14, y: 12, width: c.W - 28, height: c.H - 24, rx: 14 })
    for (const index of inside) { const group = s('g', { 'clip-path': clip(index) }); group.append(shape); shape = group }
    const group = s('g', { mask: `url(#${c.id}-m${order})` }); group.append(shape)
    c.svg.insertBefore(group, c.ink)
  })
  sets.forEach((item: any, index: number) => {
    const [x, y] = centers[index]!
    c.ink.append(s('circle', { class: `iui-shape${item.focus ? ' hot' : ''}`, cx: x, cy: y, r: R }))
    const away = three ? [[-.78, -.86], [.78, -.86], [-.92, .7]][index]! : [[-.62, -1.02], [.62, -1.02]][index]!
    c.label(x + away[0]! * R, y + away[1]! * R, text(item.label, 60), { className: `set${item.focus ? ' hot' : ''}`, note: item.note })
  })
  // 各区域的文字：先算出每个区域大致的中心。
  const spot = (inside: number[]): [number, number] => {
    if (!inside.length) return [c.W - 60, c.H - 30]
    if (!three) return inside.length === 2 ? [280, 140] : inside[0] === 0 ? [158, 140] : [402, 140]
    const key = [...inside].sort().join('')
    return ({ 0: [176, 104], 1: [384, 104], 2: [280, 282], '01': [280, 92], '02': [222, 198], '12': [338, 198], '012': [280, 162] } as Record<string, [number, number]>)[key] || [280, 162]
  }
  for (const region of regions) {
    if (!region?.label) continue
    const inside = list(region.in ?? region.sets, 3).map(indexOf).filter((index: number) => index >= 0)
    const [x, y] = spot(inside)
    c.label(x, y, text(region.label, 80), { className: `region venn-region${inside.length > 1 ? ' tight' : ''}${region.focus ? ' hot' : ''}`, note: region.note })
  }
}

// ---- 嵌套（一层套一层） ----------------------------------------------------------
function nest(spec: any, root: HTMLElement) {
  const items = list(spec.items, 6).map((item: any) => typeof item === 'string' ? { label: item } : item)
  if (!items.length) throw new Error('嵌套图需要 items')
  const c = canvas(root, spec, 560, 90 + items.length * 46)
  const step = 34, focus = num(spec.focus, -1)
  items.forEach((item: any, index: number) => {
    const x = 14 + index * step, y = 12 + index * 36, width = c.W - 28 - index * step * 2, height = c.H - 24 - index * 72
    const hot = item.focus || focus === index
    c.ink.append(s('rect', { class: `iui-shape${hot ? ' hot' : ''}${index === items.length - 1 ? ' fill' : ''}`, x, y, width, height: Math.max(30, height), rx: Math.max(10, 22 - index * 2) }))
    const last = index === items.length - 1
    c.label(last ? c.W / 2 : x + 14, last ? y + Math.max(30, height) / 2 : y + 16, text(item.label, 80), { className: `set${hot ? ' hot' : ''}`, align: last ? 'center' : 'left', note: item.note })
    if (item.example && !last) c.label(c.W - x - 14, y + 16, text(item.example, 60), { className: 'muted', align: 'right' })
  })
}

// ---- 映射（函数、同态） -------------------------------------------------------
function map(spec: any, root: HTMLElement) {
  const side = (value: any) => ({ label: text(value?.label, 60), items: list(value?.items, 9).map((item: any) => text(item, 40)) })
  const from = side(spec.from), to = side(spec.to)
  if (!from.items.length || !to.items.length) throw new Error('映射图需要 from.items 和 to.items')
  // 第一行：两边的集合名；第二行（中间）：映射名。点和箭头从第三行开始，不和标题挤在一起。
  const rows = Math.max(from.items.length, to.items.length), named = Boolean(spec.name), top = named ? 92 : 70, gap = 36
  const c = canvas(root, spec, 560, top + rows * gap + 18)
  const LX = 140, RX = 420
  const ys = (count: number) => Array.from({ length: count }, (_, index) => top + (rows - count) * gap / 2 + index * gap)
  const left = ys(from.items.length), right = ys(to.items.length), mid = top + (rows - 1) * gap / 2, ry = rows * gap / 2 + 18
  c.ink.append(s('ellipse', { class: 'iui-shape', cx: LX, cy: mid, rx: 96, ry }), s('ellipse', { class: 'iui-shape', cx: RX, cy: mid, rx: 96, ry }))
  c.label(LX, 18, from.label, { className: 'set title' }); c.label(RX, 18, to.label, { className: 'set title' })
  if (named) c.label(280, 46, text(spec.name, 80), { className: 'set hot' })
  // 圈出一组点（核、像……）：虚线框住，说明写在图下面的图例里，不再挤在图边上。
  const legend: [string, string][] = []
  for (const mark of list(spec.marks, 4)) {
    const onLeft = mark.side !== 'to', names = onLeft ? from.items : to.items, ysOf = onLeft ? left : right, x = onLeft ? LX : RX
    const hits = list(mark.items, 9).map((item: any) => names.indexOf(text(item, 40))).filter((index: number) => index >= 0)
    if (!hits.length) continue
    const y0 = Math.min(...hits.map((index: number) => ysOf[index]!)) - 13, y1 = Math.max(...hits.map((index: number) => ysOf[index]!)) + 13
    c.ink.append(s('rect', { class: 'iui-shape hot dashed', x: x - 82, y: y0, width: 164, height: y1 - y0, rx: 13 }))
    // 框上编号，和图下的图例一一对应。
    if (mark.label) { legend.push([String(legend.length + 1), text(mark.label, 120)]); c.label(onLeft ? x - 82 : x + 82, y0, legend.at(-1)![0], { className: 'mark-no' }) }
  }
  from.items.forEach((item, index) => { c.ink.append(s('circle', { class: 'iui-dot-mark', cx: LX + 30, cy: left[index], r: 3.2 })); c.label(LX + 20, left[index]!, item, { align: 'right', className: 'item' }) })
  to.items.forEach((item, index) => { c.ink.append(s('circle', { class: 'iui-dot-mark', cx: RX - 30, cy: right[index], r: 3.2 })); c.label(RX - 20, right[index]!, item, { align: 'left', className: 'item' }) })
  for (const arrow of list(spec.arrows, 30)) {
    const pair = Array.isArray(arrow) ? arrow : [arrow?.from, arrow?.to]
    const a = from.items.indexOf(text(pair[0], 40)), b = to.items.indexOf(text(pair[1], 40))
    if (a < 0 || b < 0) continue
    const hot = !Array.isArray(arrow) && arrow.focus
    c.ink.append(s('path', { class: `iui-edge${hot ? ' hot' : ''}`, d: arrowPath(LX + 30, left[a]!, RX - 30, right[b]!, 6, 7, (right[b]! - left[a]!) * .08), 'marker-end': arrowHead(c, hot) }))
  }
  if (legend.length) {
    const box = h('div', 'iui-dia-legend')
    for (const [no, label] of legend) { const row = h('span', 'iui-dia-key'); row.append(h('i', '', no), h('span', '', label)); box.append(row) }
    c.wrap.after(box)
  }
}

// ---- 关系图 / 交换图 -------------------------------------------------------------
function graph(spec: any, root: HTMLElement) {
  const nodes = list(spec.nodes, 12).map((item: any, index: number) => typeof item === 'string' ? { id: item, label: item } : { ...item, id: text(item.id ?? item.label ?? index, 40) })
  if (!nodes.length) throw new Error('关系图需要 nodes')
  const placed = nodes.every((node: any) => Array.isArray(node.at))
  let cols = 1, rows = 1
  if (placed) { cols = Math.max(...nodes.map((node: any) => num(node.at[0]))) + 1; rows = Math.max(...nodes.map((node: any) => num(node.at[1]))) + 1 }
  const H = placed ? 70 + Math.max(0, rows - 1) * 120 + 40 : 320
  const c = canvas(root, spec, 560, H)
  // 没给位置：排在一个圆上。给了 [列, 行]：按格子排（交换图就是这样）。
  const position = new Map<string, [number, number]>()
  nodes.forEach((node: any, index: number) => {
    if (placed) position.set(node.id, [cols === 1 ? 280 : 90 + num(node.at[0]) / (cols - 1) * 380, 55 + num(node.at[1]) * 120])
    else { const angle = -Math.PI / 2 + index / nodes.length * Math.PI * 2; position.set(node.id, [280 + Math.cos(angle) * 200, 160 + Math.sin(angle) * 118]) }
  })
  const RX = 44, RY = 17
  for (const edge of list(spec.edges ?? spec.arrows, 24)) {
    const a = position.get(text(edge?.from, 40)), b = position.get(text(edge?.to, 40))
    if (!a || !b) continue
    const hot = Boolean(edge.focus), bend = num(edge.bend) * 40
    const dx = b[0] - a[0], dy = b[1] - a[1]
    c.ink.append(s('path', { class: `iui-edge${hot ? ' hot' : ''}${edge.dashed ? ' dashed' : ''}`, d: arrowPath(a[0], a[1], b[0], b[1], ellipseGap(RX, RY, dx, dy) + 3, ellipseGap(RX, RY, -dx, -dy) + 4, bend), 'marker-end': edge.both || edge.undirected ? undefined : arrowHead(c, hot), 'marker-start': edge.both ? arrowHead(c, hot) : undefined }))
    if (edge.label) {
      const length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length, push = 14 + Math.abs(bend) * .5
      const side = bend >= 0 ? 1 : -1
      c.label((a[0] + b[0]) / 2 + nx * push * side, (a[1] + b[1]) / 2 + ny * push * side, text(edge.label, 40), { className: `edge${hot ? ' hot' : ''}` })
    }
  }
  for (const node of nodes) {
    const [x, y] = position.get(node.id)!
    c.label(x, y, text(node.label ?? node.id, 40), { className: `node${node.focus ? ' hot' : ''}`, note: node.note })
  }
}

// ---- 推理链 -------------------------------------------------------------------
function flow(spec: any, root: HTMLElement) {
  const steps = list(spec.steps, 8).map((item: any) => typeof item === 'string' ? { label: item } : item)
  if (!steps.length) throw new Error('推理链需要 steps')
  const card = h('section', 'iui-card iui-dia-card')
  if (spec.title) card.append(h('h4', 'iui-title', text(spec.title, 80)))
  const chain = h('ol', `iui-flow${spec.direction === 'right' ? ' across' : ''}`)
  steps.forEach((step: any, index: number) => {
    const item = h('li', `iui-step${step.focus || step.key ? ' hot' : ''}`)
    item.append(h('span', 'iui-step-no', String(index + 1)))
    const body = h('div', 'iui-step-body')
    body.append(h('div', 'iui-step-text', text(step.label ?? step.text, 200)))
    if (step.because || step.note) body.append(h('small', 'iui-step-why', text(step.because ?? step.note, 160)))
    item.append(body); chain.append(item)
  })
  card.append(chain)
  if (spec.note) card.append(h('p', 'iui-sub iui-dia-note', text(spec.note, 300)))
  root.append(card)
}

// ---- 概念树 -------------------------------------------------------------------
function tree(spec: any, root: HTMLElement) {
  type Node = { label: string; note?: string; focus?: boolean; children: Node[]; x: number; depth: number }
  let count = 0
  const read = (value: any, depth: number): Node | null => {
    if (!value || depth > 4 || count >= 24) return null
    count++
    const node: Node = typeof value === 'string' ? { label: value, children: [], x: 0, depth } : { label: text(value.label, 50), note: value.note, focus: value.focus, children: [], x: 0, depth }
    if (typeof value === 'object') for (const child of list(value.children, 8)) { const next = read(child, depth + 1); if (next) node.children.push(next) }
    return node
  }
  const top = read(spec.root ?? spec, 0)
  if (!top) throw new Error('概念树需要 root')
  let leaves = 0, depth = 0
  const layout = (node: Node) => { depth = Math.max(depth, node.depth); if (!node.children.length) node.x = leaves++; else { node.children.forEach(layout); node.x = (node.children[0]!.x + node.children.at(-1)!.x) / 2 } }
  layout(top)
  const c = canvas(root, spec, 560, 60 + depth * 86 + 30)
  const px = (x: number) => leaves <= 1 ? 280 : 60 + x / (leaves - 1) * 440, py = (d: number) => 36 + d * 86
  const draw = (node: Node) => {
    for (const child of node.children) {
      const x0 = px(node.x), y0 = py(node.depth) + 16, x1 = px(child.x), y1 = py(child.depth) - 16, mid = (y0 + y1) / 2
      c.ink.append(s('path', { class: `iui-edge${child.focus ? ' hot' : ''}`, d: `M${x0} ${y0}C${x0} ${mid} ${x1} ${mid} ${x1} ${y1}` }))
      draw(child)
    }
    c.label(px(node.x), py(node.depth), node.label, { className: `node${node.focus ? ' hot' : ''}${node.depth === 0 ? ' root' : ''}`, note: node.note })
  }
  draw(top)
}

// ---- 运算表（凯莱表） -------------------------------------------------------------
function optable(spec: any, root: HTMLElement) {
  const rows = list(spec.rows ?? spec.elements, 12).map((item: any) => text(item, 16))
  const cols = list(spec.cols ?? spec.elements, 12).map((item: any) => text(item, 16))
  const cells = list(spec.cells, 12).map((row: any) => list(row, 12).map((cell: any) => text(cell, 16)))
  if (!rows.length || !cols.length) throw new Error('运算表需要 rows / cols 和 cells')
  const card = h('section', 'iui-card iui-dia-card')
  if (spec.title) card.append(h('h4', 'iui-title', text(spec.title, 80)))
  // 同一个结果同一种颜色：一眼看出单位元的位置、子群的方块、是不是对称（交换）。
  const values = [...new Set(cells.flat())], hue = (value: string) => values.indexOf(value)
  const focusCells = new Set(list(spec.focus, 40).map((pair: any) => `${pair?.[0]},${pair?.[1]}`))
  const table = h('table', 'iui-optable'), head = h('tr')
  head.append(h('th', 'op', text(spec.op ?? '∘', 40)))
  for (const col of cols) head.append(h('th', '', col))
  table.append(head)
  rows.forEach((row, r) => {
    const line = h('tr'); line.append(h('th', '', row))
    cols.forEach((_, k) => {
      const value = cells[r]?.[k] ?? '', cell = h('td', focusCells.has(`${row},${cols[k]}`) || focusCells.has(`${r},${k}`) ? 'hot' : '', value)
      if (value) cell.style.setProperty('--hue', String(hue(value) * 360 / Math.max(1, values.length)))
      cell.addEventListener('pointerenter', () => table.querySelectorAll(`tr > :nth-child(${k + 2})`).forEach(element => element.classList.add('cross')))
      cell.addEventListener('pointerleave', () => table.querySelectorAll('.cross').forEach(element => element.classList.remove('cross')))
      line.append(cell)
    })
    table.append(line)
  })
  const scroll = h('div', 'iui-optable-wrap'); scroll.append(table); card.append(scroll)
  if (spec.note) card.append(h('p', 'iui-sub iui-dia-note', text(spec.note, 300)))
  root.append(card)
}

// ---- 轮换（置换的循环结构） ---------------------------------------------------------
function cycle(spec: any, root: HTMLElement) {
  const points = list(spec.points, 12).map((item: any) => text(item, 12))
  if (!points.length) throw new Error('轮换图需要 points')
  const c = canvas(root, spec, 560, 300)
  const R = 104, CX = 280, CY = 150
  const at = (name: string): [number, number] => { const index = points.indexOf(name), angle = -Math.PI / 2 + index / points.length * Math.PI * 2; return [CX + Math.cos(angle) * R, CY + Math.sin(angle) * R] }
  c.ink.append(s('circle', { class: 'iui-shape soft', cx: CX, cy: CY, r: R }))
  list(spec.cycles, 8).forEach((cyc: any, order: number) => {
    const members = list(cyc, 12).map((item: any) => text(item, 12)).filter((name: string) => points.includes(name))
    const hot = order === num(spec.focus, -1)
    if (members.length === 1) { const [x, y] = at(members[0]!), dx = x - CX, dy = y - CY, l = Math.hypot(dx, dy) || 1; c.ink.append(s('circle', { class: `iui-edge${hot ? ' hot' : ''}`, cx: x + dx / l * 22, cy: y + dy / l * 22, r: 11 })); return }
    members.forEach((name: string, index: number) => {
      const a = at(name), b = at(members[(index + 1) % members.length]!)
      c.ink.append(s('path', { class: `iui-edge tone-${order % 5 + 1}${hot ? ' hot' : ''}`, d: arrowPath(a[0], a[1], b[0], b[1], 15, 16, members.length === 2 ? 26 : -Math.hypot(b[0] - a[0], b[1] - a[1]) * .12), 'marker-end': arrowHead(c, hot) }))
    })
  })
  for (const name of points) { const [x, y] = at(name); c.label(x, y, name, { className: 'node point' }) }
  if (spec.label) c.label(CX, CY, text(spec.label, 40), { className: 'set' })
}

// ---- 数轴 ---------------------------------------------------------------------
function axis(spec: any, root: HTMLElement) {
  const intervals = list(spec.intervals, 6), marks = list(spec.points, 10)
  const values = [...intervals.flatMap((item: any) => [num(item.from, NaN), num(item.to, NaN)]), ...marks.map((item: any) => num(item.at, NaN))].filter(Number.isFinite)
  let min = num(spec.min, values.length ? Math.min(...values) : 0), max = num(spec.max, values.length ? Math.max(...values) : 1)
  if (!(max > min)) { min -= 1; max += 1 }
  const pad = (max - min) * .08; if (spec.min === undefined) min -= pad; if (spec.max === undefined) max += pad
  const c = canvas(root, spec, 560, 120 + intervals.length * 26)
  const base = c.H - 46, px = (value: number) => 30 + (clamp(value, min, max) - min) / (max - min) * 500
  c.ink.append(s('path', { class: 'iui-edge', d: `M18 ${base}L544 ${base}`, 'marker-end': arrowHead(c) }))
  const ticks = list(spec.ticks, 14).length ? list(spec.ticks, 14).map((item: any) => num(item)) : []
  for (const tick of ticks) { c.ink.append(s('path', { class: 'iui-edge', d: `M${px(tick)} ${base - 5}L${px(tick)} ${base + 5}` })); c.label(px(tick), base + 18, String(tick), { className: 'muted' }) }
  intervals.forEach((item: any, index: number) => {
    const from = num(item.from, min), to = num(item.to, max), y = base - 22 - index * 26, hot = Boolean(item.focus)
    const open = Array.isArray(item.open) ? item.open : [Boolean(item.open), Boolean(item.open)]
    const tone = `tone-${index % 5 + 1}${hot ? ' hot' : ''}`
    c.ink.append(s('path', { class: `iui-span ${tone}`, d: `M${px(from)} ${y}L${px(to)} ${y}` }))
    c.ink.append(s('path', { class: 'iui-edge faint', d: `M${px(from)} ${y}L${px(from)} ${base}M${px(to)} ${y}L${px(to)} ${base}` }))
    ;[[from, open[0]], [to, open[1]]].forEach(([value, hollow]) => { if (Number.isFinite(value) && value >= min && value <= max) c.ink.append(s('circle', { class: `iui-end ${tone}${hollow ? ' open' : ''}`, cx: px(value as number), cy: y, r: 4.5 })) })
    if (item.label) c.label((px(from) + px(to)) / 2, y - 13, text(item.label, 40), { className: `region${hot ? ' hot' : ''}` })
  })
  for (const mark of marks) {
    const x = px(num(mark.at)), hot = Boolean(mark.focus)
    c.ink.append(s('circle', { class: `iui-end${hot ? ' hot' : ''}${mark.open ? ' open' : ''}`, cx: x, cy: base, r: 4.5 }))
    if (mark.label) c.label(x, base + 18, text(mark.label, 30), { className: hot ? 'region hot' : '' })
  }
}

// ---- 象限 ---------------------------------------------------------------------
function quadrant(spec: any, root: HTMLElement) {
  const c = canvas(root, spec, 560, 360)
  const L = 70, R = 530, T = 22, B = 318, MX = (L + R) / 2, MY = (T + B) / 2
  c.ink.append(s('rect', { class: 'iui-shape soft', x: L, y: T, width: R - L, height: B - T, rx: 12 }))
  c.ink.append(s('path', { class: 'iui-edge', d: `M${MX} ${T}L${MX} ${B}M${L} ${MY}L${R} ${MY}` }))
  const x = spec.x || {}, y = spec.y || {}
  if (x.low) c.label(L + 8, B + 16, text(x.low, 30), { className: 'muted', align: 'left' })
  if (x.high) c.label(R - 8, B + 16, text(x.high, 30), { className: 'muted', align: 'right' })
  if (x.label) c.label(MX, B + 30, text(x.label, 30), { className: 'set' })
  if (y.high) c.label(L - 8, T + 12, text(y.high, 20), { className: 'muted', align: 'right' })
  if (y.low) c.label(L - 8, B - 12, text(y.low, 20), { className: 'muted', align: 'right' })
  if (y.label) c.label(L - 8, MY, text(y.label, 20), { className: 'set', align: 'right' })
  const boxes: Record<string, [number, number]> = { tl: [L, T], tr: [MX, T], bl: [L, MY], br: [MX, MY] }
  for (const [key, title] of Object.entries(spec.names || {})) { const box = boxes[key]; if (box) c.label(box[0] + 12, box[1] + 16, text(title, 30), { className: 'region', align: 'left' }) }
  const groups = new Map<string, any[]>()
  for (const item of list(spec.items, 16)) { const key = boxes[item?.q] ? item.q : 'tl'; groups.set(key, [...(groups.get(key) || []), item]) }
  for (const [key, items] of groups) {
    const [x0, y0] = boxes[key]!, width = MX - L, height = MY - T
    items.forEach((item, index) => {
      const columns = items.length > 3 ? 2 : 1, col = index % columns, row = Math.floor(index / columns), rowsCount = Math.ceil(items.length / columns)
      c.label(x0 + width * (col + .5) / columns, y0 + 30 + (height - 30) * (row + .5) / rowsCount, text(item.label, 40), { className: `node${item.focus ? ' hot' : ''}`, note: item.note })
    })
  }
}

export const diagramBuilders: Record<string, (spec: any, root: HTMLElement) => void> = { venn, nest, map, graph, commute: graph, flow, tree, optable, cycle, axis, quadrant }

/** 给模型看的图解目录：像一组技能，每种写明适合讲什么、怎么写；模型按概念的结构自己挑。 */
export const DIAGRAM_SKILLS: { type: string; name: string; when: string; json: string }[] = [
  { type: 'venn', name: '韦恩图', when: '两三个概念之间的交集、包含、「既是…又是…」「是…但不是…」', json: '{"type":"venn","title":"","universe":"全集名（可省）","sets":[{"id":"A","label":"循环群"},{"id":"B","label":"阿贝尔群"}],"regions":[{"in":["A","B"],"label":"$\\\\mathbb{Z}_n$"},{"in":["B"],"label":"$\\\\mathbb{Z}_2\\\\times\\\\mathbb{Z}_2$","focus":true}]}（region 的 in 写它恰好属于哪几个集合；in 为空表示都不属于；focus 高亮）' },
  { type: 'nest', name: '嵌套图', when: '一层套一层的从属关系（A ⊃ B ⊃ C），外层在前', json: '{"type":"nest","items":[{"label":"群","example":"$S_3$"},{"label":"阿贝尔群"},{"label":"循环群","focus":true}]}' },
  { type: 'map', name: '映射图', when: '函数、同态、对应关系；单射 / 满射、核与像', json: '{"type":"map","name":"$\\\\varphi$","from":{"label":"$G$","items":["e","a","b"]},"to":{"label":"$H$","items":["1","-1"]},"arrows":[["e","1"],["a","-1"],["b","-1"]],"marks":[{"side":"from","items":["e"],"label":"$\\\\ker\\\\varphi$"}]}' },
  { type: 'graph', name: '关系图 / 交换图', when: '概念之间的关系网；交换图（两条路径殊途同归）用 at 指定 [列,行] 摆成方块或三角', json: '{"type":"graph","nodes":[{"id":"G","at":[0,0]},{"id":"G2","label":"$G$","at":[1,0]},{"id":"G3","label":"$G$","at":[0,1]},{"id":"G4","label":"$G$","at":[1,1]}],"edges":[{"from":"G","to":"G2","label":"$R_b$"},{"from":"G","to":"G3","label":"$L_a$"},{"from":"G2","to":"G4","label":"$L_a$"},{"from":"G3","to":"G4","label":"$R_b$","focus":true}]}（不给 at 就排成一圈；edge 可加 dashed、bend:-1~1、both）' },
  { type: 'flow', name: '推理链', when: '证明或推导的骨架：从条件到结论的几步，标出关键一步和每步的依据', json: '{"type":"flow","steps":[{"label":"设 $ab=ba$","because":"已知"},{"label":"…","because":"结合律","focus":true},{"label":"结论"}]}（direction:"right" 横排）' },
  { type: 'tree', name: '概念树', when: '分类、上下位概念、一个概念分成哪几种', json: '{"type":"tree","root":{"label":"群","children":[{"label":"有限群","children":["循环群","对称群"]},{"label":"无限群"}]}}' },
  { type: 'optable', name: '运算表', when: '有限群 / 有限结构的乘法表（凯莱表）：同一结果同色，看单位元、交换性、子群', json: '{"type":"optable","op":"∘","rows":["e","a","b"],"cols":["e","a","b"],"cells":[["e","a","b"],["a","b","e"],["b","e","a"]],"focus":[["a","b"]]}' },
  { type: 'cycle', name: '轮换图', when: '置换的循环结构、元素的轨道', json: '{"type":"cycle","label":"$\\\\sigma=(1\\\\,2\\\\,3)$","points":["1","2","3","4"],"cycles":[["1","2","3"],["4"]]}' },
  { type: 'axis', name: '数轴', when: '区间、不等式的解集、取值范围、邻域、极限', json: '{"type":"axis","ticks":[0,1,2],"intervals":[{"from":0,"to":1,"open":[true,false],"label":"$(0,1]$"}],"points":[{"at":2,"label":"$x_0$","focus":true}]}' },
  { type: 'quadrant', name: '象限图', when: '用两个性质把一批对象分成四类', json: '{"type":"quadrant","x":{"label":"阶","low":"有限","high":"无限"},"y":{"label":"交换性","low":"不交换","high":"交换"},"items":[{"label":"$\\\\mathbb{Z}_6$","q":"tl"},{"label":"$\\\\mathbb{Z}$","q":"tr"},{"label":"$S_3$","q":"bl"},{"label":"$GL_2(\\\\mathbb{R})$","q":"br"}]}（q：tl 左上 / tr 右上 / bl 左下 / br 右下）' },
]

export const DIAGRAM_INSTRUCTIONS = [
  '讲概念时优先用图解：先想清楚这个概念的结构是什么（包含？交集？映射？推导？分类？运算？区间？），再从下面的图解目录里挑最贴切的一种（最多两种），放进语言标记为 ui 的代码块。图上的文字要短，公式写成 $...$；用 focus 标出最关键的那一处。不要为了互动而做互动。',
  '图解目录：',
  ...DIAGRAM_SKILLS.map(item => `- ${item.type}（${item.name}）——适合：${item.when}。写法：${item.json}`),
].join('\n')
