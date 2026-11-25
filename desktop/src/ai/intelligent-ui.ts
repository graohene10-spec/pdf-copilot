/**
 * Intelligent UI：回答里的 ```ui 代码块是一段 JSON，这里把它画成能操作的界面——
 * 指标卡片、图表（折线 / 柱状 / 饼图 / 散点）、可筛选的表格、拖动参数实时重算的模拟、带「交给助手」按钮的表单。
 * 全部用原生 DOM 和 SVG 画，不执行模型给的任何代码：公式只走下面这个小小的表达式求值器。
 */
import { renderMarkdown } from './render'
import { diagramBuilders, DIAGRAM_CATALOG } from './diagrams'

// ---- 表达式求值：数字、变量、+ - * / ^、比较、三目、常用数学函数 -------------------
type Scope = Record<string, number>
type Compiled = (scope: Scope) => number
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
  sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, pow: Math.pow, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
}
const CONSTANTS: Scope = { pi: Math.PI, PI: Math.PI, e: Math.E, tau: Math.PI * 2 }

export function compileExpression(source: string): Compiled {
  const tokens = String(source).match(/\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|<=|>=|==|!=|&&|\|\||[-+*/^(),<>?:!]/g) || []
  if (tokens.join('').length !== String(source).replace(/\s+/g, '').length || tokens.length > 400) throw new Error('表达式里有不认识的符号')
  let at = 0
  const peek = () => tokens[at], take = () => tokens[at++]
  const expect = (token: string) => { if (take() !== token) throw new Error(`表达式缺少 ${token}`) }
  const ternary = (): Compiled => {
    const condition = or()
    if (peek() !== '?') return condition
    take(); const yes = ternary(); expect(':'); const no = ternary()
    return scope => condition(scope) ? yes(scope) : no(scope)
  }
  const binary = (next: () => Compiled, operators: Record<string, (a: number, b: number) => number>) => (): Compiled => {
    let left = next()
    while (peek()! in operators) { const run = operators[take()!]!, a = left, b = next(); left = scope => run(a(scope), b(scope)) }
    return left
  }
  const unary = (): Compiled => {
    if (peek() === '-') { take(); const value = unary(); return scope => -value(scope) }
    if (peek() === '+') { take(); return unary() }
    if (peek() === '!') { take(); const value = unary(); return scope => value(scope) ? 0 : 1 }
    return power()
  }
  const power = (): Compiled => {
    const base = atom()
    if (peek() !== '^') return base
    take(); const exponent = unary()
    return scope => Math.pow(base(scope), exponent(scope))
  }
  const atom = (): Compiled => {
    const token = take()
    if (token === undefined) throw new Error('表达式不完整')
    if (token === '(') { const inner = ternary(); expect(')'); return inner }
    if (/^[\d.]/.test(token)) { const value = Number(token); return () => value }
    if (/^[A-Za-z_]/.test(token)) {
      if (peek() === '(') {
        take(); const args: Compiled[] = []
        if (peek() !== ')') for (;;) { args.push(ternary()); if (peek() === ',') take(); else break }
        expect(')')
        const run = FUNCTIONS[token]
        if (!run) throw new Error(`不支持函数 ${token}`)
        return scope => run(...args.map(arg => arg(scope)))
      }
      return scope => Object.hasOwn(scope, token) ? Number(scope[token]) : Object.hasOwn(CONSTANTS, token) ? CONSTANTS[token]! : NaN
    }
    throw new Error(`表达式里不该出现 ${token}`)
  }
  const product = binary(unary, { '*': (a, b) => a * b, '/': (a, b) => a / b })
  const sum = binary(product, { '+': (a, b) => a + b, '-': (a, b) => a - b })
  const compare = binary(sum, { '<': (a, b) => +(a < b), '>': (a, b) => +(a > b), '<=': (a, b) => +(a <= b), '>=': (a, b) => +(a >= b), '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b) })
  const and = binary(compare, { '&&': (a, b) => +(Boolean(a) && Boolean(b)) })
  const or = binary(and, { '||': (a, b) => +(Boolean(a) || Boolean(b)) })
  const result = ternary()
  if (at < tokens.length) throw new Error('表达式多出了内容')
  return result
}

// 文字里带 $...$ 的公式：按 Markdown 渲染成一行（按钮、下拉项除外），其余原样当文字。
const MATH = /\$[^$\n]+\$|\\\(|\\\[/
function write(element: Element, value: string) {
  if (!MATH.test(value) || /^(BUTTON|OPTION|INPUT|TEXTAREA)$/.test(element.tagName)) { element.textContent = value; return }
  element.innerHTML = renderMarkdown(value).trim().replace(/^<p>/, '').replace(/<\/p>$/, '').replace(/<\/p>\s*<p>/g, '<br>')
}
// ---- DOM 小工具 ---------------------------------------------------------------
const SVG = 'http://www.w3.org/2000/svg'
type Attributes = Record<string, string | number | undefined>
function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) write(element, text)
  return element
}
function s(tag: string, attributes: Attributes = {}, text = '') {
  const element = document.createElementNS(SVG, tag)
  for (const [name, value] of Object.entries(attributes)) if (value !== undefined) element.setAttribute(name, String(value))
  if (text) element.textContent = text
  return element
}
const text = (value: unknown, limit = 200) => String(value ?? '').slice(0, limit)
const list = (value: unknown, limit = 200): any[] => Array.isArray(value) ? value.slice(0, limit) : []
const number = (value: unknown, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback }
const TONES = new Set(['good', 'warn', 'bad', 'info'])
const tone = (value: unknown) => TONES.has(String(value)) ? ` tone-${value}` : ''
function format(value: number, digits = 3) {
  if (!Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)) return value.toExponential(2)
  return String(Number(value.toFixed(Math.min(6, Math.max(0, digits)))))
}
/** 好看的刻度：1、2、5 × 10ⁿ。 */
function ticks(low: number, high: number, count = 5) {
  if (!(high > low)) { high = low + 1; low -= 1 }
  const raw = (high - low) / count, power = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(m => m * power).find(m => m >= raw)!
  const first = Math.floor(low / step) * step, out: number[] = []
  for (let value = first; value <= high + step * .5 && out.length < 12; value += step) out.push(Number(value.toPrecision(12)))
  return out
}

// ---- 图表 ---------------------------------------------------------------------
type Series = { name: string; points: [number, number][] }
const W = 560, PAD = { left: 46, right: 14, top: 10, bottom: 36 }
/** 一张卡片：标题和副标题排在卡头左边，右边留给「重置」这类操作。 */
function frame(root: HTMLElement, title?: string, subtitle?: string) {
  const card = h('section', 'iui-card')
  if (title || subtitle) {
    const head = h('header', 'iui-head'), heading = h('div', 'iui-heading')
    if (title) heading.append(h('h4', 'iui-title', text(title, 80)))
    if (subtitle) heading.append(h('p', 'iui-sub', text(subtitle, 300)))
    head.append(heading); card.append(head)
  }
  root.append(card)
  return card
}
/** 图是按 viewBox 等比缩放的：画得窄时刻度文字跟着缩成一点点。按实际宽度把字号放回 10px 左右（最多放大到 1.8 倍，免得刻度挤在一起）。 */
const widths = new ResizeObserver(entries => { for (const entry of entries) (entry.target as SVGElement).style.setProperty('--k', String(Math.min(1.8, Math.max(1, W / Math.max(1, entry.contentRect.width) * .9)).toFixed(2))) })
function legible(svg: SVGSVGElement) { widths.observe(svg) }
function tooltipFor(host: HTMLElement) {
  const tip = h('div', 'iui-tip'); tip.hidden = true; host.append(tip)
  return {
    show(event: MouseEvent, title: string, lines: string[]) {
      tip.replaceChildren(h('strong', '', title), ...lines.map(line => h('span', '', line)))
      const box = host.getBoundingClientRect()
      tip.hidden = false
      tip.style.left = `${Math.min(box.width - tip.offsetWidth - 4, Math.max(4, event.clientX - box.left + 12))}px`
      tip.style.top = `${Math.max(4, event.clientY - box.top - tip.offsetHeight - 10)}px`
    },
    hide() { tip.hidden = true },
  }
}
/** 直角坐标的图：折线、散点、柱状共用坐标轴。categories 有值时横轴是分类。 */
function plot(host: HTMLElement, kind: 'line' | 'scatter' | 'bar', series: Series[], options: { categories?: string[]; xLabel?: string; yLabel?: string; unit?: string }) {
  host.replaceChildren()
  // 图上方一行：左边纵轴名，右边图例；横轴名在图下靠右。都不压在刻度上。
  if (options.yLabel || series.length > 1 || series[0]?.name) {
    const top = h('div', 'iui-plot-head')
    top.append(h('span', 'iui-ylabel', text(options.yLabel, 24)))
    if (series.length > 1 || series[0]?.name) top.append(legend(series.map(item => item.name)))
    host.append(top)
  }
  // 窄处（对话栏、快速解释卡片）把图画得高一些，否则曲线被压扁成一条。
  const H = (host.clientWidth || W) < 440 ? 380 : 300
  const wrap = h('div', 'iui-plot'), svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }) as SVGSVGElement
  wrap.append(svg); host.append(wrap)
  legible(svg)
  const tip = tooltipFor(wrap)
  const all = series.flatMap(item => item.points).filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  if (!all.length) { host.append(h('p', 'iui-sub', '没有可画的数据')); return }
  const categories = options.categories
  let x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]))
  let y0 = Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]))
  if (kind === 'bar' || y0 > 0 && y0 < (y1 - y0) * .6) y0 = Math.min(0, y0)
  const yTicks = ticks(y0, y1); y0 = Math.min(y0, yTicks[0]!); y1 = Math.max(y1, yTicks.at(-1)!)
  if (categories) { x0 = -.5; x1 = categories.length - .5 } else if (!(x1 > x0)) { x0 -= 1; x1 += 1 }
  const px = (x: number) => PAD.left + (x - x0) / (x1 - x0) * (W - PAD.left - PAD.right)
  const py = (y: number) => H - PAD.bottom - (y - y0) / (y1 - y0) * (H - PAD.top - PAD.bottom)
  for (const tick of yTicks) {
    svg.append(s('line', { class: 'iui-grid', x1: PAD.left, x2: W - PAD.right, y1: py(tick), y2: py(tick) }))
    svg.append(s('text', { class: 'iui-axis', x: PAD.left - 8, y: py(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, format(tick) + (options.unit || '')))
  }
  if (categories) categories.forEach((name, index) => { if (categories.length <= 14 || index % Math.ceil(categories.length / 12) === 0) svg.append(s('text', { class: 'iui-axis', x: px(index), y: H - PAD.bottom + 12, 'text-anchor': 'middle', 'dominant-baseline': 'hanging' }, text(name, 12))) })
  else for (const tick of ticks(x0, x1, 6)) if (tick >= x0 && tick <= x1) {
    svg.append(s('line', { class: 'iui-grid', x1: px(tick), x2: px(tick), y1: PAD.top, y2: H - PAD.bottom }))
    svg.append(s('text', { class: 'iui-axis', x: px(tick), y: H - PAD.bottom + 12, 'text-anchor': 'middle', 'dominant-baseline': 'hanging' }, format(tick)))
  }
  svg.append(s('line', { class: 'iui-base', x1: PAD.left, x2: W - PAD.right, y1: py(Math.max(y0, Math.min(y1, 0))), y2: py(Math.max(y0, Math.min(y1, 0))) }))
  const label = (index: number, point: [number, number]) => categories ? categories[index] ?? '' : format(point[0])
  series.forEach((item, order) => {
    const color = `var(--iui-${order % 5 + 1})`
    if (kind === 'line') {
      const path = item.points.filter(p => Number.isFinite(p[1])).map((p, index) => `${index ? 'L' : 'M'}${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join('')
      svg.append(s('path', { class: 'iui-line', d: path, stroke: color }))
    }
    if (kind === 'bar') {
      const band = (W - PAD.left - PAD.right) / (categories?.length || item.points.length), width = Math.min(72, band * .72 / series.length)
      item.points.forEach((p, index) => {
        const x = px(categories ? index : p[0]) - width * series.length / 2 + order * width, top = py(Math.max(0, p[1])), bottom = py(Math.min(0, p[1]))
        const bar = s('rect', { class: 'iui-bar', x, y: top, width: Math.max(1, width - 3), height: Math.max(1, bottom - top), rx: 4, fill: color })
        bar.addEventListener('pointermove', event => tip.show(event as MouseEvent, label(index, p), [`${item.name}  ${format(p[1])}${options.unit || ''}`]))
        bar.addEventListener('pointerleave', tip.hide)
        svg.append(bar)
      })
    }
    if (kind === 'scatter' || kind === 'line' && item.points.length <= 40) item.points.forEach((p, index) => {
      if (!Number.isFinite(p[1])) return
      const dot = s('circle', { class: 'iui-dot', cx: px(p[0]), cy: py(p[1]), r: kind === 'scatter' ? 4.5 : 3, fill: color })
      dot.addEventListener('pointermove', event => tip.show(event as MouseEvent, label(index, p), [`${item.name}  ${format(p[1])}${options.unit || ''}`]))
      dot.addEventListener('pointerleave', tip.hide)
      svg.append(dot)
    })
  })
  if (options.xLabel) host.append(h('p', 'iui-xlabel', text(options.xLabel, 40)))
}
function legend(names: string[]) {
  const row = h('div', 'iui-legend')
  names.forEach((name, order) => { if (!name) return; const item = h('span', '', text(name, 30)); item.style.setProperty('--dot', `var(--iui-${order % 5 + 1})`); row.append(item) })
  return row
}
function pie(host: HTMLElement, items: { label: string; value: number }[]) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  if (!(total > 0)) { host.append(h('p', 'iui-sub', '没有可画的数据')); return }
  const wrap = h('div', 'iui-plot iui-pie'), svg = s('svg', { viewBox: '0 0 240 240', role: 'img' }), tip = tooltipFor(wrap)
  let angle = -Math.PI / 2
  items.forEach((item, order) => {
    const share = Math.max(0, item.value) / total, end = angle + share * Math.PI * 2, large = share > .5 ? 1 : 0
    const point = (a: number, r: number) => `${(120 + r * Math.cos(a)).toFixed(2)} ${(120 + r * Math.sin(a)).toFixed(2)}`
    const d = share >= .9999
      ? `M120 20A100 100 0 1 1 119.99 20ZM120 70A50 50 0 1 0 120.01 70Z`
      : `M${point(angle, 100)}A100 100 0 ${large} 1 ${point(end, 100)}L${point(end, 52)}A52 52 0 ${large} 0 ${point(angle, 52)}Z`
    const slice = s('path', { class: 'iui-slice', d, fill: `var(--iui-${order % 5 + 1})`, 'fill-rule': 'evenodd' })
    slice.addEventListener('pointermove', event => tip.show(event as MouseEvent, item.label, [`${format(item.value)} · ${(share * 100).toFixed(1)}%`]))
    slice.addEventListener('pointerleave', tip.hide)
    svg.append(slice); angle = end
  })
  wrap.append(svg, legend(items.map(item => item.label))); host.append(wrap)
}

// ---- 各种组件 -----------------------------------------------------------------
type Context = { onAction?: (prompt: string) => void }
type Builder = (spec: any, root: HTMLElement, context: Context) => void

const builders: Record<string, Builder> = {
  ...diagramBuilders,
  stack(spec, root, context) { for (const child of list(spec.children, 12)) build(child, root, context) },
  text(spec, root) { const block = h('div', 'iui-text'); block.innerHTML = renderMarkdown(text(spec.text, 4000)); root.append(block) },
  badges(spec, root) {
    const row = h('div', 'iui-badges')
    for (const item of list(spec.items, 12)) row.append(h('span', 'iui-badge' + tone(item?.tone), text(typeof item === 'string' ? item : item?.text, 40)))
    root.append(row)
  },
  cards(spec, root) {
    const grid = h('div', 'iui-cards')
    for (const item of list(spec.items, 8)) {
      const card = h('div', 'iui-metric')
      if (item?.badge) card.append(h('span', 'iui-badge' + tone(item.tone || 'good'), text(item.badge, 16)))
      card.append(h('strong', 'iui-value' + tone(item?.tone), text(item?.value, 24)), h('span', 'iui-label', text(item?.label, 40)))
      if (item?.note) card.append(h('small', 'iui-note', text(item.note, 400)))
      grid.append(card)
    }
    root.append(grid)
  },
  chart(spec, root) {
    const card = frame(root, spec.title, spec.subtitle), kind = ['line', 'bar', 'pie', 'scatter'].includes(spec.kind) ? spec.kind : 'line'
    if (kind === 'pie') { pie(card, list(spec.items, 12).map(item => ({ label: text(item?.label, 30), value: number(item?.value) }))); return }
    const categories = Array.isArray(spec.x) && spec.x.some((value: unknown) => typeof value === 'string') ? list(spec.x, 60).map(value => text(value, 20)) : undefined
    const series: Series[] = list(spec.series, 5).map(item => ({ name: text(item?.name, 30), points: Array.isArray(item?.points)
      ? list(item.points, 600).map(point => [number(point?.[0], NaN), number(point?.[1], NaN)] as [number, number])
      : list(item?.data, 600).map((value, index) => [categories ? index : number(spec.x?.[index], index), number(value, NaN)] as [number, number]) }))
    // 画在卡片里自己的一格：plot 每次会清空它的容器，不能把卡头一起清掉。
    const body = h('div'); card.append(body)
    plot(body, kind, series, { categories: kind === 'scatter' ? undefined : categories, xLabel: spec.xLabel, yLabel: spec.yLabel, unit: text(spec.unit, 6) })
  },
  table(spec, root) {
    const card = frame(root, spec.title, spec.subtitle), columns = list(spec.columns, 8).map(value => text(value, 30)), rows = list(spec.rows, 100).map(row => list(row, 8))
    const filterIndex = typeof spec.filter === 'number' ? spec.filter : columns.indexOf(String(spec.filter))
    const table = h('table', 'iui-table'), head = h('tr'), body = h('tbody')
    // 整列都是数（可带单位、百分号）的列右对齐，个位对着个位。
    const numeric = columns.map((_, index) => rows.length > 0 && rows.every(row => /^[-+−]?[\d.,]+\s*(%|[A-Za-z]{0,4}|[一-鿿]{0,2})$/.test(text(row[index]?.text ?? row[index]).trim())))
    columns.forEach((column, index) => head.append(h('th', numeric[index] ? 'num' : '', column)))
    const thead = h('thead'); thead.append(head); table.append(thead, body)
    const draw = (only?: string) => {
      body.replaceChildren()
      for (const row of rows) {
        if (only !== undefined && text(row[filterIndex]?.text ?? row[filterIndex]) !== only) continue
        const line = h('tr')
        columns.forEach((_, index) => {
          const cell = row[index], td = h('td', numeric[index] ? 'num' : '')
          if (cell && typeof cell === 'object') td.append(h('span', 'iui-badge' + tone(cell.tone), text(cell.text, 40))); else write(td, text(cell, 200))
          line.append(td)
        })
        body.append(line)
      }
    }
    if (filterIndex >= 0 && filterIndex < columns.length) {
      const values = [...new Set(rows.map(row => text(row[filterIndex]?.text ?? row[filterIndex])))].slice(0, 6), tabs = h('div', 'iui-tabs')
      const choose = (button: HTMLButtonElement, value?: string) => { for (const other of tabs.children) other.classList.toggle('on', other === button); draw(value) }
      const every = h('button', 'on', '全部'); every.type = 'button'; every.onclick = () => choose(every); tabs.append(every)
      for (const value of values) { const button = h('button', '', value); button.type = 'button'; button.onclick = () => choose(button, value); tabs.append(button) }
      card.append(tabs)
    }
    const scroller = h('div', 'iui-table-wrap'); scroller.append(table); card.append(scroller)
    if (spec.note) card.append(h('p', 'iui-sub', text(spec.note, 400)))
    draw()
  },
  // 可以拖的模拟：参数滑块和开关改变后，曲线和读数用表达式重新算。
  sim(spec, root) {
    const card = frame(root, spec.title, spec.subtitle), scope: Scope = {}
    const controls = h('div', 'iui-controls'), chart = h('div', 'iui-sim-plot'), outputs = h('div', 'iui-outputs')
    const params = list(spec.params, 6), toggles = list(spec.toggles, 4), initial: Scope = {}
    const axis = spec.plot?.x || {}, name = /^[A-Za-z_]\w*$/.test(axis.name) ? axis.name : 'x'
    let curves: { name: string; run: Compiled }[] = [], readouts: { label: string; unit: string; digits: number; run: Compiled; value: HTMLElement }[] = []
    try {
      curves = list(spec.plot?.y, 4).map(item => ({ name: text(item?.name, 30), run: compileExpression(text(item?.expr, 300)) }))
      readouts = list(spec.outputs, 6).map(item => {
        const row = h('div', 'iui-output'), value = h('strong'); row.append(h('span', '', text(item?.label, 80)), value); outputs.append(row)
        return { label: text(item?.label, 40), unit: text(item?.unit, 12), digits: number(item?.digits, 3), run: compileExpression(text(item?.expr, 300)), value }
      })
    } catch (error: any) { card.append(h('p', 'iui-error', error?.message || '表达式无法解析')); return }
    const update = () => {
      if (curves.length) {
        const from = number(axis.min, 0), to = number(axis.max, 10), steps = 240
        plot(chart, 'line', curves.map(curve => ({ name: curve.name, points: Array.from({ length: steps + 1 }, (_, index) => { const x = from + (to - from) * index / steps; return [x, curve.run({ ...scope, [name]: x })] as [number, number] }) })), { xLabel: axis.label, yLabel: spec.plot?.yLabel })
      }
      for (const item of readouts) item.value.textContent = `${format(item.run(scope), item.digits)}${item.unit ? ' ' + item.unit : ''}`
    }
    for (const param of params) {
      if (!/^[A-Za-z_]\w*$/.test(param?.name)) continue
      const min = number(param.min, 0), max = number(param.max, 10), step = number(param.step, (max - min) / 100) || .01
      scope[param.name] = initial[param.name] = Math.min(max, Math.max(min, number(param.value, (min + max) / 2)))
      // 一个参数一行：名字在左、当前值在右；下面是滑块（已拖过的一段用强调色），再下面是两端的最小 / 最大值。
      const box = h('label', 'iui-param'), value = h('strong', 'iui-param-value'), slider = h('input'), unit = param.unit ? ' ' + text(param.unit, 10) : ''
      slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.step = String(step); slider.value = String(scope[param.name])
      // 读数按步长定小数位：步长 0.05 就一直显示两位，拖动时数字不跳宽。
      const places = Math.min(4, (String(step).split('.')[1] || '').length)
      const show = () => {
        const current = scope[param.name]!
        value.textContent = `${Math.abs(current) >= 1e6 || current !== 0 && Math.abs(current) < 1e-3 ? format(current) : current.toFixed(places)}${unit}`
        slider.style.setProperty('--p', `${max > min ? (current - min) / (max - min) * 100 : 0}%`)
      }
      slider.addEventListener('input', () => { scope[param.name] = Number(slider.value); show(); update() })
      slider.dataset.name = param.name
      const scale = h('span', 'iui-scale'); scale.append(h('span', '', format(min)), h('span', '', format(max)))
      box.append(h('span', 'iui-param-name', text(param.label || param.name, 30)), value, slider, scale); controls.append(box); show()
    }
    const options = h('div', 'iui-options')
    for (const toggle of toggles) {
      if (!/^[A-Za-z_]\w*$/.test(toggle?.name)) continue
      scope[toggle.name] = initial[toggle.name] = toggle.value ? 1 : 0
      const box = h('label', 'iui-check'), input = h('input'); input.type = 'checkbox'; input.checked = Boolean(toggle.value); input.dataset.name = toggle.name
      input.addEventListener('change', () => { scope[toggle.name] = input.checked ? 1 : 0; update() })
      box.append(input, h('span', '', text(toggle.label || toggle.name, 40))); options.append(box)
    }
    // 「重置」放在卡头右上角（没有标题时放在开关那一行的右端）。
    if (params.length || toggles.length) {
      const reset = h('button', 'iui-reset', '重置'); reset.type = 'button'
      reset.onclick = () => {
        Object.assign(scope, initial)
        for (const input of card.querySelectorAll<HTMLInputElement>('input[data-name]')) { if (input.type === 'checkbox') input.checked = Boolean(initial[input.dataset.name!]); else { input.value = String(initial[input.dataset.name!]); input.dispatchEvent(new Event('input')) } }
        update()
      }
      const head = card.querySelector('.iui-head')
      if (head) head.append(reset); else options.append(reset)
    }
    // 图在上，参数紧贴在图下面，读数和公式最后。
    card.append(chart, controls)
    if (options.childElementCount) card.append(options)
    if (readouts.length) card.append(outputs)
    if (spec.formula) { const formula = h('div', 'iui-formula'); formula.innerHTML = renderMarkdown(`$$${text(spec.formula, 300)}$$`); card.append(formula) }
    if (spec.note) card.append(h('p', 'iui-sub', text(spec.note, 400)))
    update()
  },
  // 表单：填好后把内容按模板拼成一句话，交给阅读助手继续（一次新的提问）。
  form(spec, root, context) {
    const card = frame(root, spec.title, spec.subtitle), form = h('form', 'iui-form'), read: Record<string, () => string> = {}
    for (const field of list(spec.fields, 10)) {
      if (!/^[A-Za-z_]\w*$/.test(field?.name)) continue
      const kind = text(field.kind || 'text', 12), box = h('div', 'iui-field' + (kind === 'textarea' ? ' wide' : ''))
      box.append(h('span', 'iui-label', text(field.label || field.name, 40)))
      const options = list(field.options, 12).map(value => text(value, 40))
      if (kind === 'select') {
        const select = h('select'); for (const value of options) { const option = h('option', '', value); option.value = value; select.append(option) }
        if (field.value !== undefined) select.value = text(field.value, 40)
        read[field.name] = () => select.value; box.append(select)
      } else if (kind === 'radio') {
        const group = h('div', 'iui-radio'), id = `iui-${Math.random().toString(36).slice(2)}`
        options.forEach((value, index) => { const label = h('label', 'iui-check'), input = h('input'); input.type = 'radio'; input.name = id; input.value = value; input.checked = field.value === undefined ? index === 0 : text(field.value, 40) === value; label.append(input, h('span', '', value)); group.append(label) })
        read[field.name] = () => group.querySelector<HTMLInputElement>('input:checked')?.value || ''; box.append(group)
      } else if (kind === 'checkbox') {
        const label = h('label', 'iui-check'), input = h('input'); input.type = 'checkbox'; input.checked = Boolean(field.value)
        label.append(input, h('span', '', text(field.text || field.label, 60))); box.replaceChildren(label)
        read[field.name] = () => input.checked ? '是' : '否'
      } else if (kind === 'textarea') {
        const area = h('textarea'); area.rows = 3; area.value = text(field.value, 2000); area.placeholder = text(field.placeholder, 80)
        read[field.name] = () => area.value; box.append(area)
      } else {
        const input = h('input'); input.type = kind === 'number' || kind === 'date' ? kind : 'text'; input.value = text(field.value, 200); input.placeholder = text(field.placeholder, 80)
        read[field.name] = () => input.value; box.append(input)
      }
      form.append(box)
    }
    const submit = h('button', 'iui-submit', text(spec.submit?.label || '交给阅读助手', 30)); submit.type = 'submit'
    submit.disabled = !context.onAction
    form.append(submit)
    form.addEventListener('submit', event => {
      event.preventDefault()
      const template = text(spec.submit?.prompt, 2000)
      const filled = template ? template.replace(/\{([A-Za-z_]\w*)\}/g, (whole, name) => read[name] ? read[name]!() : whole)
        : Object.entries(read).map(([name, value]) => `${name}：${value()}`).join('\n')
      context.onAction?.(filled.slice(0, 6000))
    })
    card.append(form)
  },
}
function build(spec: any, root: HTMLElement, context: Context) {
  if (Array.isArray(spec)) { builders.stack!({ children: spec }, root, context); return }
  const builder = spec && typeof spec === 'object' ? builders[String(spec.type)] : undefined
  if (!builder) throw new Error(`不认识的界面类型：${text(spec?.type, 30) || '（空）'}`)
  builder(spec, root, context)
}

const waiting = new WeakMap<HTMLElement, number>()
/**
 * 一张图第一次出现时轻轻淡入、线条描出来，整段不超过半秒，不逐个弹出。
 * 回答还在写的时候整段会反复重排（界面也跟着重建），所以记下每张图第一次出现的时刻，重建时从动画的那个进度接着走，不会从头再来。
 */
const born = new Map<string, number>()
const ENTRANCE = 520
function entrance(host: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const key = host.dataset.ui || '', now = performance.now()
  if (!born.has(key)) { born.set(key, now); if (born.size > 400) born.delete(born.keys().next().value!) }
  const age = now - born.get(key)!
  if (age >= ENTRANCE) return
  // 实线才描边（虚线本身就靠 dasharray 画，跟着整体淡入）。
  for (const shape of host.querySelectorAll<SVGGeometryElement>('.iui-shape,.iui-edge,.iui-line,.iui-span'))
    if (!/\b(dashed|faint)\b/.test(shape.getAttribute('class') || '')) { shape.setAttribute('pathLength', '1'); shape.classList.add('iui-drawn') }
  host.style.setProperty('--iui-age', `${-Math.round(age)}ms`)
  host.classList.add('iui-fresh')
  // 走完就撤掉：之后拖滑块重画曲线、筛选表格都不再带入场动画。
  setTimeout(() => { host.classList.remove('iui-fresh'); for (const shape of host.querySelectorAll('.iui-drawn')) { shape.removeAttribute('pathLength'); shape.classList.remove('iui-drawn') } }, ENTRANCE - age + 60)
}
/** 把回答里所有还没画的 ```ui 块画出来。streaming：回答还在写，JSON 可能没写完，先显示占位。 */
export function mountIntelligentUi(root: HTMLElement, options: Context & { streaming?: boolean } = {}) {
  // 界面块写了超过 10 秒还没写完：告诉读者它本来就慢。
  if (!options.streaming) waiting.delete(root); else if (!waiting.has(root)) waiting.set(root, Date.now())
  const slow = Date.now() - (waiting.get(root) ?? Date.now()) >= 10000
  for (const host of root.querySelectorAll<HTMLElement>('.iui[data-ui]:not([data-mounted])')) {
    host.dataset.mounted = 'true'
    let spec: unknown
    try { spec = JSON.parse(host.dataset.ui || '') }
    catch {
      host.append(h('p', options.streaming ? 'iui-wait' : 'iui-error', options.streaming ? (slow ? '正在生成 Intelligent UI… 它比较复杂，可能会慢一些' : '正在生成 Intelligent UI…') : '这段界面描述不是合法的 JSON，无法显示。'))
      continue
    }
    try { build(spec, host, options); entrance(host) }
    catch (error: any) { host.replaceChildren(h('p', 'iui-error', error?.message || '这段界面无法显示。')) }
  }
}

/**
 * 写给模型看的说明。三份用的是同一套组件、同一个渲染器，区别在什么时候画：
 * 对话（assistant）和总结文档（document）默认是文字，只在去掉图读者明显更难懂时才画；
 * 快速解释（explain）是读者主动点了「可视化讲解」，要画，但要挑对那一种，概念确实没有可画的结构时只给文字。
 */
const WRITING = '写法：语言标记为 ui 的代码块，内容是一段 JSON（顶层是一个组件或组件数组）。图上文字要短，公式写 $...$，用 focus 标出最关键的一处。示意用的数据注明「示例」，不编造文档里没有的真实数据。sim 的表达式必须和正文公式是同一个模型，参数给合理的初值、范围和单位。'
const FOLD = '内容分层多、要读者自己点开看（大纲、分支总结）：不用 ui，在正文写折叠段落——`<details>` 单独一行，下一行 `<summary>标题</summary>`，空一行写这一层正文（可再套一层），最后 `</details>` 单独一行。只有这两个标签生效，别的 HTML 不要写。'
const PLACE = '图与文字：不看图，文字也要能读懂；图放在讲到那一处；图上已有的不在文字里再抄一遍，文字只补图上看不出的。'
// 什么结构用哪种图解：三份指引共用。图解目录本身只留名字和写法，什么时候用都写在这里，免得两处说法打架。
const STRUCTURE = '交集、「既是…又是…」→ venn；一层套一层的包含 → nest；函数、同态、核与像 → map；交换图，或箭头本身就是要点的关系 → graph；有限运算表 → optable；置换、轨道 → cycle；区间、解集、邻域 → axis；有层级的分类 → tree；按两个性质分四类 → quadrant'
const CATALOG = DIAGRAM_CATALOG.map(line => line.replace(/——适合：.*?。写法：/, '：'))
const INTERACTIVE = {
  cards: '- cards：{"type":"cards","items":[{"label":"说明","value":"98.6%","badge":"正常","tone":"good|warn|bad|info","note":""}]}',
  chart: '- chart：{"type":"chart","kind":"line|bar|scatter|pie","title":"","x":["A","B"]或数字数组,"series":[{"name":"","data":[1,2]}],"unit":"%","xLabel":"","yLabel":""}；散点用 "series":[{"name":"","points":[[x,y]]}]；饼图用 "items":[{"label":"","value":1}]',
  table: '- table：{"type":"table","title":"","columns":["项目","类别"],"rows":[["a","理论"]],"filter":"类别"}（filter 指定按哪一列做筛选标签；单元格可写成 {"text":"验证中","tone":"good"}）',
  sim: '- sim：{"type":"sim","title":"","params":[{"name":"L","label":"摆长 L","min":0.1,"max":5,"step":0.1,"value":1.2,"unit":"m"}],"toggles":[{"name":"damp","label":"加入衰减","value":false}],"plot":{"x":{"name":"t","min":0,"max":10,"label":"时间 t (s)"},"y":[{"name":"角位移","expr":"10*cos(sqrt(g/L)*t)*(damp?exp(-0.2*t):1)"}]},"outputs":[{"label":"周期","expr":"2*pi*sqrt(L/g)","unit":"s","digits":3}],"formula":"T=2\\\\pi\\\\sqrt{L/g}","note":""}；expr 只能用参数名、横轴变量、数字、+ - * / ^、比较、三目，以及 sin cos tan exp ln log10 sqrt abs min max pow floor ceil round 和常数 pi e',
  form: '- form：{"type":"form","title":"","fields":[{"name":"topic","label":"主题","kind":"text|number|date|select|radio|checkbox|textarea","options":["A","B"],"value":""}],"submit":{"label":"生成","prompt":"请按这些设置继续：主题 {topic}"}}（读者点按钮后，prompt 里的 {字段名} 换成填写的内容，作为下一个问题发给你）',
  badges: '- badges、text：{"type":"badges","items":[{"text":"","tone":"good"}]}、{"type":"text","text":"markdown"}',
}
export const UI_INSTRUCTIONS = {
  assistant: [
    '回答默认是文字。ui 代码块会被画成图解或可操作的界面，但只在通过这道检验时才画：去掉这张图，读者是否明显更难懂？是才画。',
    '必须画（读者没开口也画）：',
    '- 读者要图、要能调参数，或说没看懂而难点在结构 → 画。',
    '- 一个量随参数连续变化，曲线形状、临界点或趋势是理解的关键 → sim。',
    '- 三个以上对象在同样几个维度上比较 → table，不再配一张重复数据的图。',
    `- 概念本身就是结构：${STRUCTURE}。`,
    '- 多步推导或证明，步骤之间的依赖比每步内容更要紧 → flow。',
    '- 算法在一组具体数据上的逐步状态 → table，一行一步。',
    '- 有真实的数值序列（文档里的数据，或按公式算出的值）要看趋势 → chart。',
    '不要画：',
    '- 答案是一个事实、定义、是非或一个数。',
    '- 图只是把文字要点装进框：每个定义一张卡片、几个并列概念连成一张网。',
    '- 两三项的简单并列 → 一句话或短列表。',
    '- 没有真实数据的统计图；文字已经说完的信息再画一遍。',
    '- 闲聊、翻译、找出处；上一条回答刚画过同样的图（读者没要求重画）。',
    '数量：通常 0 处，需要时 1 处，确有两种不同需要时最多 2 处；拿不准就不画。',
    '选型：表格能说清就不用图；图解能说清就不上可交互；cards 只放读者要盯住的几个关键数；form 只在确实要读者填几项设置再继续时用。',
    PLACE,
    WRITING,
    FOLD,
    '【图解】',
    ...CATALOG,
    '【可交互】',
    ...Object.values(INTERACTIVE),
  ].join('\n'),
  // 写进文档里的（总结文档）：数量由总结设置另给（summary.ts），这里只管画不画、画什么；没有「交给助手」的表单。
  document: [
    '文档以文字为主，只在去掉图读者会明显更难懂的地方画。全篇数量跟着内容走，不是每节一张；同样的图不在各节重复。',
    `该画：概念本身是结构（${STRUCTURE}）；步骤依赖要紧的推导 → flow；量随参数连续变化、形状或临界点是关键 → sim；三个以上对象同维度比较 → table；有真实数据的趋势 → chart。`,
    '不画：定义、结论的罗列，两三项并列，把要点装进框，没有真实数据的统计图，和正文重复的信息。',
    '选型：表格说得清就不用图，图解说得清就不上可交互；不用 form。',
    PLACE,
    WRITING,
    '【图解】',
    ...CATALOG,
    '【可交互】',
    INTERACTIVE.sim, INTERACTIVE.chart, INTERACTIVE.table, INTERACTIVE.cards, INTERACTIVE.badges,
  ].join('\n'),
  // 快速解释里读者主动点了「可视化讲解」：要画，重点是挑对那一种。
  explain: [
    '这是一张就地弹出的小卡片，读者主动要了可视化讲解：用一个 ui 代码块把选中的概念讲清。要紧的是挑对那一种，不是画得多。',
    `先判断它真正的结构再选：${STRUCTURE}；证明或推导的骨架 → flow；量随参数连续变化、形状或临界点是要点 → sim；几个对象在同样几个维度上比较 → table；有真实数值 → chart。`,
    '只画一个；确有两种不同视角（如先 flow 讲推导、再 sim 看参数）才画两个。不用 form、cards，不把定义文字装进框里充数。',
    '概念确实没有可画的结构（单纯的术语、定义、事实）：不硬画，只用文字讲清，开头一句说明为什么不画。',
    WRITING,
    '【图解】',
    ...CATALOG,
    '【可交互】',
    INTERACTIVE.sim, INTERACTIVE.chart, INTERACTIVE.table,
  ].join('\n'),
}
