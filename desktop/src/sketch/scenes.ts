// 流形、神经网络之外的画面：生物、物理、群论、算法。每个画面自己管动画，画在同一张慢慢自转的草稿上。
import type { Vec } from './manifolds.ts'

export type Project = (x: number, y: number, z: number) => [number, number, number]
/** size：模型里 1 个单位在画布中心是多少像素；full：整块桌面（画面的常规区域之外也能画）。 */
export type Env = { context: CanvasRenderingContext2D; project: Project; t: number; fade: number; ink: string; red: string; paper: string; hand: string; width: number; height: number; size: number; camera: number; full: { x: number; y: number; w: number; h: number } }
export type Painter = (env: Env) => void
export type Sketch = { id: string; name: string; tilt: number; zoom?: number; camera?: number; facts: string[]; create: () => Painter }

const TAU = Math.PI * 2
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t) }
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const mix = (a: Vec, b: Vec, t: number): Vec => add(a, mul(sub(b, a), t))
/** 稳定的伪随机数：同一个 n 总给同一个值。 */
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

/** 按远近分四档的线：近处深、远处浅。 */
class Layers {
  paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()]
  project: Project
  constructor(project: Project) { this.project = project }
  line(a: Vec, b: Vec) {
    const p = this.project(a[0], a[1], a[2]), q = this.project(b[0], b[1], b[2])
    const path = this.paths[clamp(Math.floor((p[2] + q[2]) * 2), 0, 3)]!
    path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1])
  }
  stroke(env: Env, base: number, step: number, width: number, color = env.ink) {
    env.context.strokeStyle = color
    this.paths.forEach((path, level) => { env.context.globalAlpha = (base + level * step) * env.fade; env.context.lineWidth = width + level * .1; env.context.stroke(path) })
  }
}

function label(env: Env, text: string, at: Vec, alpha = .42, color = env.ink, dx = 6, dy = -4) {
  if (env.width < 420) return // 缩略图里不写字
  const [x, y] = env.project(at[0], at[1], at[2])
  env.context.globalAlpha = alpha * env.fade; env.context.fillStyle = color; env.context.font = `17px ${env.hand}`
  env.context.fillText(text, x + dx, y + dy)
}
function dotAt(env: Env, at: Vec, radius: number, alpha: number, color: string) {
  const [x, y] = env.project(at[0], at[1], at[2])
  env.context.globalAlpha = alpha * env.fade; env.context.fillStyle = color
  env.context.beginPath(); env.context.arc(x, y, radius, 0, TAU); env.context.fill()
}

/** 球棍模型：球按远近排序、用纸色填实，近的挡住远的。kind：0 空心、1 铅笔淡填、2 红笔淡填、3 红笔深填；bonds 是 (a, b, 样式) 三元组，样式 0 实线、1 虚线、2 红线。 */
type Model = { points: Vec[]; radius: number[]; kind: number[]; bonds: number[] }
function ballsAndSticks(env: Env, model: Model, place: (p: Vec) => Vec, hot?: Set<number>) {
  const c = env.context, n = model.points.length, m = model.bonds.length / 3
  const sx = new Float32Array(n), sy = new Float32Array(n), depth = new Float32Array(n + m), pr = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const q = place(model.points[i]!), [x, y, d] = env.project(q[0], q[1], q[2])
    sx[i] = x; sy[i] = y; depth[i] = d; pr[i] = model.radius[i]! * env.size * env.camera / (env.camera + 1 - 2 * d)
  }
  for (let j = 0; j < m; j++) depth[n + j] = (depth[model.bonds[j * 3]!]! + depth[model.bonds[j * 3 + 1]!]!) / 2 - 1e-4
  const order = Array.from({ length: n + m }, (_, k) => k).sort((a, b) => depth[a]! - depth[b]!)
  for (const id of order) {
    const near = clamp(depth[id]!, 0, 1)
    if (id < n) {
      c.beginPath(); c.arc(sx[id]!, sy[id]!, pr[id]!, 0, TAU)
      c.globalAlpha = env.fade; c.fillStyle = env.paper; c.fill()
      const kind = model.kind[id]!
      if (kind) { c.globalAlpha = (kind === 1 ? .2 : kind === 2 ? .3 : .6) * (.5 + .5 * near) * env.fade; c.fillStyle = kind === 1 ? env.ink : env.red; c.fill() }
      c.globalAlpha = (.14 + .4 * near) * env.fade; c.strokeStyle = env.ink; c.lineWidth = 1; c.stroke()
    } else {
      const j = id - n, a = model.bonds[j * 3]!, b = model.bonds[j * 3 + 1]!, style = hot?.has(j) ? 2 : model.bonds[j * 3 + 2]!
      const dx = sx[b]! - sx[a]!, dy = sy[b]! - sy[a]!, length = Math.hypot(dx, dy)
      if (length <= pr[a]! + pr[b]!) continue
      const ux = dx / length, uy = dy / length
      c.beginPath(); c.moveTo(sx[a]! + ux * pr[a]!, sy[a]! + uy * pr[a]!); c.lineTo(sx[b]! - ux * pr[b]!, sy[b]! - uy * pr[b]!)
      c.setLineDash(style === 1 ? [3, 3] : [])
      c.globalAlpha = (style === 2 ? .7 : .12 + .4 * near) * env.fade; c.strokeStyle = style === 2 ? env.red : env.ink; c.lineWidth = style === 2 ? 1.8 : 1.3; c.stroke()
    }
  }
  c.setLineDash([])
}
function corner(env: Env, lines: string[], y = .8) {
  if (env.width < 420) return
  env.context.globalAlpha = .42 * env.fade; env.context.fillStyle = env.ink; env.context.font = `18px ${env.hand}`
  lines.forEach((line, k) => env.context.fillText(line, env.width * .05, env.height * y + k * 24))
}

// ---- DNA 双螺旋：B 型 DNA 的球棍模型——磷酸、脱氧核糖、碱基的每个重原子，碱基对之间的氢键是虚线；红笔逐对「读」过去 ----
type Residue = { atoms: [string, number, number][]; bonds: [number, number][] }
// 碱基在标准参考系里的坐标（Å，Olson 等 2001）；第一个原子连着糖的 C1′。
const BASE: Record<string, Residue> = {
  A: { atoms: [['N', -1.291, 4.498], ['C', .024, 4.897], ['N', .877, 3.902], ['C', .071, 2.771], ['C', .369, 1.398], ['N', 1.611, .909], ['N', -.668, .532], ['C', -1.912, 1.023], ['N', -2.32, 2.29], ['C', -1.267, 3.124]], bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [6, 7], [7, 8], [8, 9], [9, 3], [9, 0]] },
  G: { atoms: [['N', -1.289, 4.551], ['C', .023, 4.962], ['N', .87, 3.969], ['C', .071, 2.833], ['C', .424, 1.46], ['O', 1.554, .955], ['N', -.7, .641], ['C', -1.999, 1.087], ['N', -2.949, .139], ['N', -2.342, 2.364], ['C', -1.265, 3.177]], bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [6, 7], [7, 8], [7, 9], [9, 10], [10, 3], [10, 0]] },
  T: { atoms: [['N', -1.284, 4.5], ['C', -1.462, 3.135], ['O', -2.562, 2.608], ['N', -.298, 2.407], ['C', .994, 2.897], ['O', 1.944, 2.119], ['C', 1.106, 4.338], ['C', 2.466, 4.961], ['C', -.024, 5.057]], bonds: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [4, 6], [6, 7], [6, 8], [8, 0]] },
  C: { atoms: [['N', -1.285, 4.542], ['C', -1.472, 3.158], ['O', -2.628, 2.709], ['N', -.391, 2.344], ['C', .837, 2.868], ['N', 1.875, 2.027], ['C', 1.056, 4.275], ['C', -.023, 5.068]], bonds: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [4, 6], [6, 7], [7, 0]] },
}
// 氢键：嘌呤的第几个原子对嘧啶的第几个原子。A=T 两条，G≡C 三条。
const HBONDS: Record<string, [number, number][]> = { A: [[5, 5], [6, 3]], G: [[5, 5], [6, 3], [8, 2]] }
const PARTNER: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
// 糖–磷酸骨架（柱坐标：半径 Å、相对 C1′ 的角度 °、高度 Å）：C1′ C2′ C3′ C4′ O4′ C5′ O5′ P OP1 OP2 O3′。
const BACKBONE: [string, number, number, number][] = [['C', 5.9, 0, 0], ['C', 7.1, 5, .6], ['C', 8, -3, .5], ['C', 7.7, -12, .9], ['O', 6.3, -13, .4], ['C', 8.4, -20, .3], ['O', 8.9, -24, -.6], ['P', 8.91, -30, -1.19], ['O', 10.2, -33, -1], ['O', 9, -36, -2.3], ['O', 8.6, 1, 1.4]]
const BACKBONE_BONDS: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [3, 5], [5, 6], [6, 7], [7, 8], [7, 9], [2, 10]]
const ELEMENT: Record<string, [number, number]> = { C: [.4, 0], N: [.38, 1], O: [.38, 2], P: [.58, 3] } // 半径 Å、填色

function dna(): Painter {
  const PAIRS = 12, RISE = 3.38, TWIST = 36 * Math.PI / 180, SCALE = 1.95 / (PAIRS * RISE), LEAN = .3
  const model: Model = { points: [], radius: [], kind: [], bonds: [] }
  const sequence = Array.from({ length: PAIRS }, () => 'ATGC'[Math.floor(Math.random() * 4)]!)
  const hydrogen: number[][] = [], middles: Vec[] = [], phosphate: number[][] = [[], []], oxygen3: number[][] = [[], []]
  const push = (element: string, x: number, y: number, z: number) => { const [radius, kind] = ELEMENT[element]!; model.points.push([x, y, z]); model.radius.push(radius * SCALE); model.kind.push(kind); return model.points.length - 1 }
  sequence.forEach((letter, k) => {
    const turn = k * TWIST, ct = Math.cos(turn), st = Math.sin(turn), base: number[][] = []
    for (let strand = 0; strand < 2; strand++) {
      const flip = strand ? -1 : 1
      // 第二条链是第一条绕碱基对的二重轴转 180°：(x, y, z) → (x, −y, −z)。
      const put = (element: string, x: number, y: number, z: number) => push(element, x * ct - y * flip * st, x * st + y * flip * ct, z * flip + k * RISE)
      const sugar = BACKBONE.map(([element, r, degrees, z]) => { const a = (114.9 + degrees) * Math.PI / 180; return put(element, r * Math.cos(a), r * Math.sin(a), z) })
      for (const [a, b] of BACKBONE_BONDS) model.bonds.push(sugar[a]!, sugar[b]!, 0)
      const residue = BASE[strand ? PARTNER[letter]! : letter]!
      const atoms = residue.atoms.map(([element, x, y]) => put(element, x, y, 0))
      for (const [a, b] of residue.bonds) model.bonds.push(atoms[a]!, atoms[b]!, 0)
      model.bonds.push(sugar[0]!, atoms[0]!, 0)
      base.push(atoms); phosphate[strand]!.push(sugar[7]!); oxygen3[strand]!.push(sugar[10]!)
    }
    const purineFirst = letter === 'A' || letter === 'G', list: number[] = []
    for (const [p, q] of HBONDS[purineFirst ? letter : PARTNER[letter]!]!) { list.push(model.bonds.length / 3); model.bonds.push(base[purineFirst ? 0 : 1]![p]!, base[purineFirst ? 1 : 0]![q]!, 1) }
    hydrogen.push(list); middles.push([0, 0, k * RISE])
  })
  // 相邻核苷酸：O3′ 接下一个的磷（第一条链向上，第二条链向下）。
  for (let k = 0; k + 1 < PAIRS; k++) { model.bonds.push(oxygen3[0]![k]!, phosphate[0]![k + 1]!, 0); model.bonds.push(oxygen3[1]![k + 1]!, phosphate[1]![k]!, 0) }
  const cl = Math.cos(LEAN), sl = Math.sin(LEAN), half = (PAIRS - 1) * RISE / 2
  return env => {
    const spin = env.t / 24000 * TAU, cs = Math.cos(spin), ss = Math.sin(spin)
    const place = (p: Vec): Vec => { const x = (p[0] * cs - p[1] * ss) * SCALE, z = (p[0] * ss + p[1] * cs) * SCALE, y = (p[2] - half) * SCALE; return [x * cl - y * sl, x * sl + y * cl, z] }
    const reading = Math.floor(env.t / 1800) % PAIRS
    ballsAndSticks(env, model, place, new Set(hydrogen[reading]))
    const letter = sequence[reading]!, strong = letter === 'G' || letter === 'C'
    label(env, `${letter} ${strong ? '≡' : '='} ${PARTNER[letter]}`, place([13, 0, middles[reading]![2]]), .55, env.red, 10, 5)
    label(env, "5′", place([-2.5, 9.5, -3]), .45, env.red, -6, 16); label(env, "3′", place([-2.5, -9.5, -3]), .45, env.red, -6, 16)
    label(env, "3′", place([-2.5 * Math.cos((PAIRS - 1) * TWIST) - 9.5 * Math.sin((PAIRS - 1) * TWIST), -2.5 * Math.sin((PAIRS - 1) * TWIST) + 9.5 * Math.cos((PAIRS - 1) * TWIST), half * 2 + 3]), .45, env.red, 0, -8)
    corner(env, ['B-DNA · 10.5 bp / turn · 3.4 Å rise', '○ C   ◍ N   ● O / P'], .84)
  }
}

// ---- 洛伦兹吸引子：两条起点只差千分之一的轨道、一团起初挤在一起的点（慢慢抹满整个吸引子）、坐标轴与不动点、左下角 x(t) ----
function lorenz(): Painter {
  const TRAIL = 2400, CLOUD = 260, RESET = 45000
  const flow = (p: Vec, h: number): Vec => [p[0] + 10 * (p[1] - p[0]) * h, p[1] + (p[0] * (28 - p[2]) - p[1]) * h, p[2] + (p[0] * p[1] - 8 / 3 * p[2]) * h]
  const view = (p: Vec): Vec => [p[0] / 25, (p[2] - 25) / 25, p[1] / 25]
  const orbits = [{ p: [1, 1, 20] as Vec, trail: [] as Vec[], xs: [] as number[] }, { p: [1.001, 1, 20] as Vec, trail: [] as Vec[], xs: [] as number[] }]
  let cloud: Vec[] = [], done = 0, cloudBorn = 0
  const scatter = () => { const o = orbits[0]!.p; cloud = Array.from({ length: CLOUD }, () => [o[0] + (Math.random() - .5) * .6, o[1] + (Math.random() - .5) * .6, o[2] + (Math.random() - .5) * .6] as Vec) }
  const advance = () => {
    for (const orbit of orbits) {
      orbit.p = flow(flow(orbit.p, .004), .004)
      orbit.trail.push(view(orbit.p)); orbit.xs.push(orbit.p[0])
      if (orbit.trail.length > TRAIL) orbit.trail.shift()
      if (orbit.xs.length > 700) orbit.xs.shift()
    }
    for (let k = 0; k < cloud.length; k++) cloud[k] = flow(flow(cloud[k]!, .004), .004)
  }
  for (let k = 0; k < 900; k++) advance()
  scatter()
  const fixed = Math.sqrt(8 / 3 * 27)
  return env => {
    const c = env.context, target = Math.floor(env.t / 16)
    if (target - done > 40) done = target - 40
    while (done < target) { advance(); done++ }
    if (env.t - cloudBorn > RESET) { cloudBorn = env.t; scatter() }
    // 坐标轴与刻度。
    const axes = new Layers(env.project), origin: Vec = [-24, -26, 0]
    const axis = (index: number, length: number, name: string) => {
      const end: Vec = [...origin]; end[index] += length
      axes.line(view(origin), view(end))
      for (let tick = 10; tick < length; tick += 10) { const a: Vec = [...origin], b: Vec = [...origin]; a[index] += tick; b[index] += tick; b[index === 2 ? 0 : 2] += index === 2 ? 1.2 : -1.2; axes.line(view(a), view(b)) }
      label(env, name, view(end), .4)
    }
    axis(0, 48, 'x'); axis(1, 52, 'y'); axis(2, 50, 'z')
    axes.stroke(env, .1, .06, 1)
    orbits.forEach((orbit, which) => {
      const paths = Array.from({ length: 6 }, () => new Path2D()), count = orbit.trail.length
      let previous: [number, number, number] | undefined
      orbit.trail.forEach((point, k) => {
        const here = env.project(point[0], point[1], point[2])
        if (previous) { const path = paths[Math.min(5, Math.floor(k / count * 6))]!; path.moveTo(previous[0], previous[1]); path.lineTo(here[0], here[1]) }
        previous = here
      })
      c.strokeStyle = which ? env.red : env.ink
      paths.forEach((path, level) => { c.globalAlpha = (.035 + level * .055) * env.fade; c.lineWidth = .9 + level * .1; c.stroke(path) })
      dotAt(env, orbit.trail[count - 1]!, 3.2, .65, which ? env.red : env.ink)
    })
    const specks = new Path2D()
    for (const p of cloud) { const q = view(p), [x, y] = env.project(q[0], q[1], q[2]); specks.rect(x - 1.1, y - 1.1, 2.2, 2.2) }
    c.fillStyle = env.red; c.globalAlpha = .42 * env.fade; c.fill(specks)
    for (const sign of [1, -1]) { const at = view([sign * fixed, sign * fixed, 27]); dotAt(env, at, 2.2, .45, env.ink); label(env, sign > 0 ? 'C₊' : 'C₋', at, .42) }
    label(env, 'x₀', orbits[0]!.trail.at(-1)!, .45); label(env, 'x₀ + ε', orbits[1]!.trail.at(-1)!, .5, env.red, 6, 15)
    // 左下角：两条轨道的 x(t)。先是一条线，然后分开。
    const w = Math.min(260, env.width * .28), h = 74, x0 = env.width * .05, y0 = env.height * .86
    c.globalAlpha = .28 * env.fade; c.strokeStyle = env.ink; c.lineWidth = 1
    c.beginPath(); c.moveTo(x0, y0 - h); c.lineTo(x0, y0); c.moveTo(x0, y0 - h / 2); c.lineTo(x0 + w, y0 - h / 2); c.stroke()
    orbits.forEach((orbit, which) => {
      c.beginPath(); orbit.xs.forEach((x, k) => { const px = x0 + k / 700 * w, py = y0 - h / 2 - x / 22 * h / 2; if (k) c.lineTo(px, py); else c.moveTo(px, py) })
      c.strokeStyle = which ? env.red : env.ink; c.globalAlpha = .42 * env.fade; c.lineWidth = 1.1; c.stroke()
    })
    c.globalAlpha = .42 * env.fade; c.fillStyle = env.ink; c.font = `16px ${env.hand}`; c.fillText('x(t)', x0 + 6, y0 - h + 2); c.fillText('ε = 10⁻³', x0 + w - 62, y0 + 16)
  }
}

// ---- A₅ 的凯莱图：截角二十面体的 60 个顶点就是 60 个群元素。五边形的边是 5 阶生成元 b（带箭头），虚线是对合 a；红点沿生成元游走，旁边写出它走到的置换 ----
function cayley(): Painter {
  const phi = (1 + Math.sqrt(5)) / 2, vertices: Vec[] = []
  for (const [a, b, c] of [[0, 1, 3 * phi], [1, 2 + phi, 2 * phi], [phi, 2, 2 * phi + 1]] as Vec[]) {
    for (let signs = 0; signs < 8; signs++) {
      if (!a && signs & 1) continue
      const v: Vec = [signs & 1 ? -a : a, signs & 2 ? -b : b, signs & 4 ? -c : c]
      vertices.push(v, [v[1], v[2], v[0]], [v[2], v[0], v[1]])
    }
  }
  const neighbours = vertices.map((v, i) => vertices.flatMap((w, j) => i !== j && Math.abs(dot(sub(v, w), sub(v, w)) - 4) < .01 ? [j] : []))
  const flip: number[] = [], next: number[] = []
  vertices.forEach((v, i) => {
    const n = neighbours[i]!, e = n.map(j => sub(vertices[j]!, v))
    const [p, q, a] = ([[0, 1, 2], [0, 2, 1], [1, 2, 0]] as const).slice().sort((x, y) => dot(e[y[0]]!, e[y[1]]!) - dot(e[x[0]]!, e[x[1]]!))[0]!
    flip[i] = n[a]!
    const centre = add(add(v, vertices[n[p]!]!), vertices[n[q]!]!)
    next[i] = dot(cross(v, vertices[n[p]!]!), centre) > 0 ? n[p]! : n[q]!
  })
  const scale = .95 / Math.hypot(...vertices[0]!), points = vertices.map(v => mul(v, scale))
  // 给每个顶点一个置换：b = (1 2 3 4 5)，a 取一个让 (ab)³ = e 的双对换，沿图走一遍就标好了。
  const times = (p: number[], q: number[]) => q.map(i => p[i]!), b = [1, 2, 3, 4, 0]
  const order = (p: number[]) => { let q = p, k = 1; while (q.some((v, i) => v !== i)) { q = times(q, p); k++ } return k }
  const doubles = [[1, 0, 3, 2, 4], [2, 3, 0, 1, 4], [3, 2, 1, 0, 4], [1, 0, 2, 4, 3], [4, 1, 2, 0, 3], [3, 1, 2, 0, 4], [0, 2, 1, 4, 3], [0, 4, 3, 2, 1], [4, 1, 3, 2, 0], [2, 1, 0, 4, 3], [0, 3, 4, 1, 2], [4, 3, 2, 1, 0], [1, 0, 4, 3, 2], [3, 4, 2, 0, 1], [2, 4, 0, 3, 1]]
  const a = doubles.find(candidate => order(candidate) === 2 && order(times(candidate, b)) === 3) || doubles[0]!
  const element: number[][] = []; element[0] = [0, 1, 2, 3, 4]
  for (const queue = [0]; queue.length;) { const i = queue.shift()!; for (const [j, g] of [[next[i]!, b], [flip[i]!, a]] as const) if (!element[j]) { element[j] = times(element[i]!, g); queue.push(j) } }
  const cycles = (p: number[]) => {
    const seen = new Set<number>(), out: string[] = []
    p.forEach((_, start) => { if (seen.has(start) || p[start] === start) return; const cycle: number[] = []; for (let i = start; !seen.has(i); i = p[i]!) { seen.add(i); cycle.push(i + 1) } out.push(`(${cycle.join(' ')})`) })
    return out.join('') || 'e'
  }
  const model: Model = { points, radius: points.map(() => .022), kind: points.map(() => 0), bonds: [] }
  points.forEach((_, i) => { model.bonds.push(i, next[i]!, 0); if (flip[i]! > i) model.bonds.push(i, flip[i]!, 1) })
  // 里面的正二十面体：顶点对着十二个五边形——A₅ 就是它的旋转群。
  const centres: Vec[] = []
  points.forEach((_, i) => { let sum: Vec = [0, 0, 0], j = i; for (let k = 0; k < 5; k++) { sum = add(sum, points[j]!); j = next[j]! } const centre = mul(sum, .52 / Math.hypot(...sum)); if (!centres.some(other => Math.hypot(...sub(other, centre)) < .01)) centres.push(centre) })
  const inner: [number, number][] = []
  centres.forEach((p, i) => centres.forEach((q, j) => { if (j > i && Math.hypot(...sub(p, q)) < .56) inner.push([i, j]) }))
  const walk = [0], word: string[] = []
  return env => {
    const c = env.context, STEP = 900, steps = Math.floor(env.t / STEP)
    while (walk.length - 1 < steps) {
      const here = walk.at(-1)!, useFlip = word.at(-1) !== 'a' && Math.random() < .45
      walk.push(useFlip ? flip[here]! : next[here]!); word.push(useFlip ? 'a' : 'b')
      if (walk.length > 40) { walk.splice(0, 20); word.splice(0, 20) }
    }
    const core = new Layers(env.project)
    for (const [i, j] of inner) core.line(centres[i]!, centres[j]!)
    c.setLineDash([2, 5]); core.stroke(env, .08, .05, 1); c.setLineDash([])
    // 红点所在的五边形（陪集 g⟨b⟩）淡淡涂红。
    const now = walk.at(-1)!
    c.beginPath(); for (let k = 0, j = now; k < 5; k++, j = next[j]!) { const [x, y] = env.project(...points[j]!); if (k) c.lineTo(x, y); else c.moveTo(x, y) }
    c.closePath(); c.fillStyle = env.red; c.globalAlpha = .09 * env.fade; c.fill()
    ballsAndSticks(env, model, p => p)
    // b 的方向：朝着我们的那一面，每条五边形边中间一个小箭头。
    const heads = new Path2D()
    points.forEach((p, i) => {
      const q = points[next[i]!]!, [x0, y0, d0] = env.project(...p), [x1, y1, d1] = env.project(...q)
      if (d0 + d1 < 1.15) return
      const angle = Math.atan2(y1 - y0, x1 - x0), mx = x0 + (x1 - x0) * .58, my = y0 + (y1 - y0) * .58
      heads.moveTo(mx - 6 * Math.cos(angle - .5), my - 6 * Math.sin(angle - .5)); heads.lineTo(mx, my); heads.lineTo(mx - 6 * Math.cos(angle + .5), my - 6 * Math.sin(angle + .5))
    })
    c.strokeStyle = env.ink; c.globalAlpha = .34 * env.fade; c.lineWidth = 1; c.stroke(heads)
    const within = (env.t % STEP) / STEP, tail = walk.slice(-14)
    c.strokeStyle = env.red; c.lineWidth = 2
    let head = points[tail[0]!]!
    for (let k = 1; k < tail.length; k++) {
      const from = points[tail[k - 1]!]!, to = k === tail.length - 1 ? mix(from, points[tail[k]!]!, smooth(within * 1.5)) : points[tail[k]!]!
      const p = env.project(...from), q = env.project(...to)
      c.globalAlpha = (.06 + .5 * k / tail.length) * env.fade
      c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke()
      head = to
    }
    dotAt(env, head, 4, .8, env.red)
    label(env, cycles(element[now]!), head, .6, env.red, 9, -7)
    label(env, 'e', points[0]!, .5, env.ink, 7, -6)
    corner(env, [`g = … ${word.slice(-10).join(' ')}  =  ${cycles(element[now]!)}`, `a = ${cycles(a)},  b = ${cycles(b)}`, 'a² = b⁵ = (ab)³ = e,   |A₅| = 60'], .78)
  }
}

// ---- 墨西哥帽势：一群小球从帽顶各自滚向谷底的不同方向（对称性自发破缺），先径向振荡（希格斯模），再沿谷绕圈（戈德斯通模）；地面上是等势线和小球的影子 ----
function higgs(): Painter {
  const HEIGHT = .6, WIDE = .72, CYCLE = 30000, BALLS = 7, FLOOR = -.62, RIM = 1.42
  const surface = (r: number, a: number, lift = 0): Vec => [r * Math.cos(a) * WIDE, HEIGHT * (r * r - 1) ** 2 - .32 + lift, r * Math.sin(a) * WIDE]
  const state = (seconds: number, start: number): [number, number] => {
    const u = seconds - 1.6
    if (u <= 0) return [.03, start]
    return [1 - Math.exp(-u / .8) * Math.cos(2.5 * u), start + .5 * (u - 3 * (1 - Math.exp(-u / 3)))]
  }
  return env => {
    const c = env.context
    // 地面：等势线（投影）、谷底的圆、两条轴。
    const floor = new Layers(env.project), ground = (r: number, a: number): Vec => [r * Math.cos(a) * WIDE, FLOOR, r * Math.sin(a) * WIDE]
    for (const r of [.35, .6, .8, 1.2, RIM]) for (let s = 0; s < 72; s += 2) floor.line(ground(r, s / 72 * TAU), ground(r, (s + 1) / 72 * TAU))
    floor.line(ground(1.75, Math.PI), ground(1.75, 0)); floor.line(ground(1.75, -Math.PI / 2), ground(1.75, Math.PI / 2)); floor.line([0, FLOOR, 0], [0, .52, 0])
    floor.stroke(env, .07, .05, 1)
    const circle = new Layers(env.project)
    for (let s = 0; s < 72; s++) circle.line(ground(1, s / 72 * TAU), ground(1, (s + 1) / 72 * TAU))
    circle.stroke(env, .1, .07, 1, env.red)
    label(env, 'Re φ', ground(1.75, 0), .4); label(env, 'Im φ', ground(1.75, Math.PI / 2), .4); label(env, 'V', [0, .52, 0], .4)
    const mesh = new Layers(env.project)
    for (let k = 1; k <= 14; k++) { const r = k / 14 * RIM; for (let s = 0; s < 48; s++) mesh.line(surface(r, s / 48 * TAU), surface(r, (s + 1) / 48 * TAU)) }
    for (let s = 0; s < 24; s++) for (let k = 0; k < 16; k++) mesh.line(surface(k / 16 * RIM, s / 24 * TAU), surface((k + 1) / 16 * RIM, s / 24 * TAU))
    mesh.stroke(env, .04, .05, .9)
    const valley = new Layers(env.project)
    for (let s = 0; s < 72; s += 2) valley.line(surface(1, s / 72 * TAU, .004), surface(1, (s + 1) / 72 * TAU, .004))
    valley.stroke(env, .16, .1, 1.3, env.red)
    for (let k = 0; k < BALLS; k++) {
      const local = env.t + k * CYCLE / BALLS, seconds = (local % CYCLE) / 1000, start = hash(Math.floor(local / CYCLE) * 7 + k) * TAU
      const leaving = clamp((CYCLE / 1000 - seconds) / 1.5, 0, 1) * clamp(seconds / .6, 0, 1)
      c.strokeStyle = env.red; c.lineWidth = 1.5
      for (let j = 0; j < 36; j++) {
        const [r0, a0] = state(seconds - (j + 1) * .09, start), [r1, a1] = state(seconds - j * .09, start)
        const p = env.project(...surface(r0, a0, .03)), q = env.project(...surface(r1, a1, .03))
        c.globalAlpha = .38 * (1 - j / 36) * leaving * env.fade
        c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke()
      }
      const [r, a] = state(seconds, start), at = surface(r, a, .03)
      const [x, y] = env.project(...at)
      c.beginPath(); c.arc(x, y, 5, 0, TAU); c.globalAlpha = leaving * env.fade; c.fillStyle = env.paper; c.fill(); c.globalAlpha = .6 * leaving * env.fade; c.fillStyle = env.red; c.fill()
      dotAt(env, ground(r, a), 2, .3 * leaving, env.ink)
      const drop = new Layers(env.project); drop.line(at, ground(r, a)); c.setLineDash([2, 4]); drop.stroke(env, .1 * leaving, .04 * leaving, 1); c.setLineDash([])
    }
    label(env, 'V(φ) = λ(|φ|² − v²)²', surface(RIM, 3.6), .45, env.ink, -150, -10)
    label(env, '|φ| = v', ground(1, 2.4), .45, env.red, -52, 16)
    corner(env, ['radial oscillation: Higgs mode,  m² = V″(v)', 'motion along the valley: Goldstone mode,  m = 0'], .86)
  }
}

// ---- Dijkstra：每个顶点一确定最短距离，就升到与距离成正比的高度——最短路径树像一座山慢慢长出来；到 t 后沿树描出最短路径 ----
function dijkstra(): Painter {
  const COLS = 13, ROWS = 8, TICK = 110, HOLD = 6500, RISE = .22, FLOOR = -.3
  type Run = { order: number[]; when: Int16Array; distance: Float32Array; previous: Int16Array; path: number[]; queue: string[]; source: number; target: number; started: number }
  let nodes: [number, number][] = [], edges: [number, number][] = [], near: number[][] = [], run: Run | undefined, runs = 0
  const build = (seed: number) => {
    nodes = []; edges = []
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) nodes.push([(c / (COLS - 1) - .5) * 2.5 + (hash(seed + r * 31 + c) - .5) * .13, (r / (ROWS - 1) - .5) * 1.6 + (hash(seed + 500 + r * 31 + c) - .5) * .13])
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c
      if (c + 1 < COLS && hash(seed + i * 3) < .74) edges.push([i, i + 1])
      if (r + 1 < ROWS && hash(seed + i * 3 + 1) < .74) edges.push([i, i + COLS])
      if (c + 1 < COLS && r + 1 < ROWS && hash(seed + i * 3 + 2) < .34) edges.push(hash(seed + i) < .5 ? [i, i + COLS + 1] : [i + 1, i + COLS])
    }
    near = nodes.map(() => [])
    for (const [a, b] of edges) { near[a]!.push(b); near[b]!.push(a) }
  }
  const span = (a: number, b: number) => Math.hypot(nodes[a]![0] - nodes[b]![0], nodes[a]![1] - nodes[b]![1])
  const begin = (now: number) => {
    if (runs % 2 === 0) build(runs * 17 + 1)
    const source = Math.floor(hash(runs * 5 + 2) * ROWS) * COLS + Math.floor(hash(runs * 5 + 4) * 3), target = Math.floor(hash(runs * 5 + 3) * ROWS) * COLS + COLS - 1 - Math.floor(hash(runs * 5 + 6) * 3)
    const distance = new Float32Array(nodes.length).fill(Infinity), previous = new Int16Array(nodes.length).fill(-1), when = new Int16Array(nodes.length).fill(-1), order: number[] = [], queue: string[] = []
    distance[source] = 0
    for (;;) {
      const open = [...nodes.keys()].filter(i => when[i]! < 0 && distance[i]! < Infinity).sort((a, b) => distance[a]! - distance[b]!)
      if (!open.length) break
      const best = open[0]!
      queue.push(open.slice(0, 5).map(i => `v${i}: ${distance[i]!.toFixed(2)}`).join(',  ') + (open.length > 5 ? ',  …' : ''))
      when[best] = order.length; order.push(best)
      if (best === target) break
      for (const j of near[best]!) { const d = distance[best]! + span(best, j); if (d < distance[j]!) { distance[j] = d; previous[j] = best } }
    }
    const path: number[] = []
    if (when[target]! >= 0) for (let i = target; i >= 0; i = previous[i]!) path.push(i)
    runs++
    run = { order, when, distance, previous, path, queue, source, target, started: now }
  }
  return env => {
    const c = env.context
    if (!run || env.t - run.started > run.order.length * TICK + HOLD) begin(env.t)
    const state = run!, clock = (env.t - state.started) / TICK, count = Math.min(state.order.length, Math.floor(clock) + 1), finished = count >= state.order.length
    const sinking = clamp((state.order.length * TICK + HOLD - (env.t - state.started)) / 800, 0, 1)
    const lift = (i: number) => state.when[i]! < 0 || state.when[i]! >= count ? 0 : state.distance[i]! * RISE * smooth((clock - state.when[i]!) / 7) * smooth(sinking)
    const ground = (i: number): Vec => [nodes[i]![0], FLOOR, nodes[i]![1]], raised = (i: number): Vec => [nodes[i]![0], FLOOR + lift(i), nodes[i]![1]]
    const all = new Layers(env.project), drops = new Layers(env.project), tree = new Layers(env.project)
    for (const [a, b] of edges) all.line(ground(a), ground(b))
    all.stroke(env, .06, .04, 1)
    for (let k = 0; k < count; k++) { const i = state.order[k]!; drops.line(ground(i), raised(i)); if (state.previous[i]! >= 0) tree.line(raised(i), raised(state.previous[i]!)) }
    c.setLineDash([2, 4]); drops.stroke(env, .06, .03, 1); c.setLineDash([])
    tree.stroke(env, .18, .08, 1.3, env.red)
    // 还没确定、但已经在队列里的顶点：到它的那条暂定边画成虚线。
    const frontier = new Layers(env.project)
    nodes.forEach((_, i) => { if ((state.when[i]! < 0 || state.when[i]! >= count) && state.previous[i]! >= 0 && state.when[state.previous[i]!]! < count && state.when[state.previous[i]!]! >= 0) frontier.line(raised(state.previous[i]!), ground(i)) })
    if (!finished) { c.setLineDash([3, 4]); frontier.stroke(env, .1, .05, 1, env.red); c.setLineDash([]) }
    if (finished && state.path.length > 1) {
      const reversed = [...state.path].reverse(), shown = clamp((env.t - state.started - state.order.length * TICK) / 1200, 0, 1) * (reversed.length - 1)
      c.strokeStyle = env.red; c.lineWidth = 2.8; c.globalAlpha = .6 * env.fade
      c.beginPath()
      reversed.forEach((i, k) => {
        if (k > shown + 1) return
        const from = raised(reversed[Math.max(0, k - 1)]!), point = k > shown ? mix(from, raised(i), shown - (k - 1)) : raised(i)
        const [x, y] = env.project(...point); if (k) c.lineTo(x, y); else c.moveTo(x, y)
      })
      c.stroke()
      label(env, `d(s, t) = ${state.distance[state.target]!.toFixed(2)}`, raised(state.target), .55, env.red, 10, -10)
    }
    const open = new Path2D(), closed = new Path2D()
    nodes.forEach((_, i) => { const settled = state.when[i]! >= 0 && state.when[i]! < count, [x, y] = env.project(...(settled ? raised(i) : ground(i))); const path = settled ? closed : open; path.moveTo(x + 3, y); path.arc(x, y, 3, 0, TAU) })
    c.strokeStyle = env.ink; c.lineWidth = 1; c.globalAlpha = .24 * env.fade; c.stroke(open)
    c.fillStyle = env.red; c.globalAlpha = .5 * env.fade; c.fill(closed)
    if (!finished) { const [x, y] = env.project(...raised(state.order[count - 1]!)); c.strokeStyle = env.red; c.globalAlpha = .55 * env.fade; c.beginPath(); c.arc(x, y, 8, 0, TAU); c.stroke() }
    label(env, 's', raised(state.source), .55, env.red, -16, -6); label(env, 't', finished ? ground(state.target) : raised(state.target), .55, env.red, 9, 14)
    corner(env, [finished ? `settled ${state.order.length} of ${nodes.length} vertices` : `Q = { ${state.queue[Math.min(count, state.queue.length - 1)]} }`, 'height = d(s, v)'], .86)
  }
}

// ---- 康威生命游戏：一门高斯帕滑翔机枪加一片随机汤；往下叠着前几代（时空图），刚出生的细胞用红笔 ----
const GUN = ['........................O', '......................O.O', '............OO......OO............OO', '...........O...O....OO............OO', 'OO........O.....O...OO', 'OO........O...O.OO....O.O', '..........O.....O.......O', '...........O...O', '............OO']
function life(): Painter {
  const W = 72, H = 46, TICK = 200, CELL = 2.6 / W, LAYERS = 6, GAP = .06
  let cells = new Uint8Array(W * H), history: Uint8Array[] = [], generation = 0, seeded = 0, calm = 0, population = 0
  const seed = () => {
    cells = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x > W * .55 && y > H * .3 && Math.random() < .34) cells[y * W + x] = 1
    GUN.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'O') cells[(y + 3) * W + x + 3] = 1 }))
    seeded = generation; calm = 0; history = []
  }
  const step = () => {
    const out = new Uint8Array(W * H)
    let alive = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += cells[((y + dy + H) % H) * W + (x + dx + W) % W]!
      const on = n === 3 || (n === 2 && cells[y * W + x]) ? 1 : 0
      out[y * W + x] = on; alive += on
    }
    calm = Math.abs(alive - population) <= 1 ? calm + 1 : 0
    history.unshift(cells); if (history.length > LAYERS) history.pop()
    cells = out; population = alive; generation++
    if (alive < 14 || calm > 60 || generation - seeded > 900) seed()
  }
  seed()
  for (let k = 0; k < 12; k++) step()
  let done = 0
  return env => {
    const c = env.context, target = Math.floor(env.t / TICK)
    if (target - done > 3) done = target - 3
    while (done < target) { step(); done++ }
    const quad = (path: Path2D, x: number, y: number, level: number, inset: number) => {
      const at = (dx: number, dy: number) => env.project((x + dx - W / 2) * CELL, .18 - level * GAP, (y + dy - H / 2) * CELL)
      const a = at(inset, inset), b = at(1 - inset, inset), d = at(1 - inset, 1 - inset), e = at(inset, 1 - inset)
      path.moveTo(a[0], a[1]); path.lineTo(b[0], b[1]); path.lineTo(d[0], d[1]); path.lineTo(e[0], e[1]); path.closePath()
    }
    // 从最老的一层画到最新的一层。
    for (let level = history.length; level >= 1; level--) {
      const layer = history[level - 1]!, path = new Path2D()
      for (let i = 0; i < layer.length; i++) if (layer[i]) quad(path, i % W, Math.floor(i / W), level, .3)
      c.fillStyle = env.ink; c.globalAlpha = .13 * (1 - level / (LAYERS + 1)) * env.fade; c.fill(path)
    }
    const old = new Path2D(), born = new Path2D(), before = history[0]
    for (let i = 0; i < cells.length; i++) if (cells[i]) quad(before && !before[i] ? born : old, i % W, Math.floor(i / W), 0, .1)
    c.fillStyle = env.paper; c.globalAlpha = env.fade; c.fill(old); c.fill(born)
    c.fillStyle = env.ink; c.globalAlpha = .34 * env.fade; c.fill(old)
    c.fillStyle = env.red; c.globalAlpha = .5 * env.fade; c.fill(born)
    c.strokeStyle = env.ink; c.globalAlpha = .16 * env.fade; c.lineWidth = 1; c.setLineDash([5, 4])
    for (const level of [0, LAYERS]) {
      c.beginPath()
      ;[[0, 0], [W, 0], [W, H], [0, H]].forEach(([x, y], k) => { const p = env.project((x! - W / 2) * CELL, .18 - level * GAP, (y! - H / 2) * CELL); if (k) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]) })
      c.closePath(); c.stroke()
    }
    c.setLineDash([])
    label(env, 'glider gun', [(12 - W / 2) * CELL, .18, (2 - H / 2) * CELL], .42, env.red, 0, -10)
    label(env, 't', [(-W / 2) * CELL, .18 - LAYERS * GAP, (H / 2) * CELL], .4, env.ink, -16, 10)
    corner(env, [`generation ${generation - seeded} · population ${population}`, 'B3 / S23 on a torus'], .86)
  }
}

// ---- 分形二叉树：无限放大。树 T = 树干 ∪ S₀(T) ∪ S₁(T)；镜头沿着 S₀ 的不动点一直钻进去，每钻一级画面和上一级一模一样 ----
type Matrix = [number, number, number, number, number, number, number, number, number] // 按列存
const apply = (m: Matrix, v: Vec): Vec => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]]
const product = (a: Matrix, b: Matrix): Matrix => { const c0 = apply(a, [b[0], b[1], b[2]]), c1 = apply(a, [b[3], b[4], b[5]]), c2 = apply(a, [b[6], b[7], b[8]]); return [...c0, ...c1, ...c2] }
const scaled = (m: Matrix, s: number) => m.map(value => value * s) as Matrix
const transpose = (m: Matrix): Matrix => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
function inverse(m: Matrix): Matrix {
  const [a, d, g, b, e, h, c, f, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C
  return [A / det, B / det, C / det, (c * h - b * i) / det, (a * i - c * g) / det, (b * g - a * h) / det, (b * f - c * e) / det, (c * d - a * f) / det, (a * e - b * d) / det]
}
/** 绕单位轴 axis 转 angle 的旋转矩阵。 */
function rotation(axis: Vec, angle: number): Matrix {
  const [x, y, z] = axis, c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c]
}
function tree(): Painter {
  const RATIO = .62, LEVEL = 8000, TOP = 12, BACK = 4, TIP: Vec = [0, 1, 0]
  return env => {
    const c = env.context
    const spread = .62 + .1 * Math.sin(env.t / 23000), twist = Math.PI / 2 + .35 * Math.sin(env.t / 31000)
    const ca = Math.cos(spread), sa = Math.sin(spread), ct = Math.cos(twist), st = Math.sin(twist)
    // 子枝的坐标架：y 是枝的方向，x 是参考方向。
    const child = (sign: number): Matrix => {
      const side: Vec = [ct, 0, -st], direction: Vec = [side[0] * sa * sign, ca, side[2] * sa * sign], reference: Vec = [-st, 0, -ct]
      return [...reference, ...direction, ...cross(reference, direction)] as Matrix
    }
    const turn = [child(1), child(-1)], maps = turn.map(m => scaled(m, RATIO))
    // S₀(p) = TIP + M p 的不动点 c = (I − M)⁻¹ TIP；镜头绕着 S₀ 的转轴、对着 c 做 S₀ 的分数次逆变换。
    const m0 = maps[0]!, lessM: Matrix = [1 - m0[0], -m0[1], -m0[2], -m0[3], 1 - m0[4], -m0[5], -m0[6], -m0[7], 1 - m0[8]]
    const centre = apply(inverse(lessM), TIP), r0 = turn[0]!
    const angle = Math.acos(clamp((r0[0] + r0[4] + r0[8] - 1) / 2, -1, 1)), sine = 2 * Math.sin(angle) || 1
    const axis: Vec = [(r0[5] - r0[7]) / sine, (r0[6] - r0[2]) / sine, (r0[1] - r0[3]) / sine]
    const s = (env.t / LEVEL) % 1, zoom = 1.5 * RATIO ** -s, HOME: Vec = [.05, .3, 0]
    const view = scaled(rotation(axis, -s * angle), zoom)
    const paths = Array.from({ length: TOP + BACK + 2 }, () => new Path2D())
    const limit = 1.6 / env.size
    let drawn = 0
    const grow = (origin: Vec, frame: Matrix, depth: number) => {
      const length = zoom * RATIO ** depth
      if (depth > TOP || length < limit || drawn > 5200) return
      // 整棵子树都在以 origin 为心、约 2.7 倍枝长的球里：离画面太远就不画。
      if (Math.hypot(origin[0], origin[1] - .1, origin[2]) - 2.7 * length > 2.5) return
      const tip = add(origin, apply(frame, TIP)), p = env.project(...origin), q = env.project(...tip), path = paths[depth + BACK]!
      path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); drawn++
      grow(tip, product(frame, maps[0]!), depth + 1); grow(tip, product(frame, maps[1]!), depth + 1)
    }
    // 这一级的树，再往外补几级祖先：祖先的树干和它的另一半（S₁ 那一支）。
    let origin = add(HOME, apply(view, mul(centre, -1))), frame = view
    grow(origin, frame, 0)
    const back = scaled(transpose(r0), 1 / RATIO)
    for (let n = 1; n <= BACK; n++) {
      frame = product(frame, back); origin = sub(origin, apply(frame, TIP))
      const tip = add(origin, apply(frame, TIP)), p = env.project(...origin), q = env.project(...tip), path = paths[BACK - n]!
      path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1])
      grow(tip, product(frame, maps[1]!), 1 - n)
    }
    c.strokeStyle = env.ink
    paths.forEach((path, index) => {
      const level = index - BACK - s // 连续的级数：每钻一级，所有枝都退一级
      c.globalAlpha = .34 * smooth((level + 4) / 3) * (1 - smooth((level - TOP + 2.5) / 2.5)) * env.fade
      c.lineWidth = clamp(2.4 * RATIO ** level, .55, 4.5)
      c.stroke(path)
    })
    dotAt(env, HOME, 2.4, .5, env.red)
    label(env, 'p* = S₀(p*)', HOME, .5, env.red, 8, -8)
    corner(env, ['T = trunk ∪ S₀(T) ∪ S₁(T)', `zoom × ${(1 / RATIO).toFixed(2)}ⁿ,  n = ${Math.floor(env.t / LEVEL)}`], .86)
  }
}

// ---- 机柜的海：机柜一排排铺满下半个桌面，一直排到天际线；水滴落下，起伏一圈圈传开，远处还有缓缓的涌浪。镜头慢慢向前飞 ----
function racks(): Painter {
  const WIDE = .8, DEEP = 1.2, PITCH = 3.6, TALL = 2.2, EYE = 7.5, SPEED = .55, SINGLE = 50, FAR = 480, EVERY = 3600
  return env => {
    const c = env.context, { x: left, y: top, w, h } = env.full
    const horizon = top + h * .5, middle = left + w / 2, focal = w * .85
    const seconds = env.t / 1000, camera = seconds * SPEED, latest = Math.floor(env.t / EVERY)
    const drops = [0, 1, 2, 3, 4].map(k => latest - k).filter(k => k >= 0).map(k => ({ x: (hash(k * 2.3 + 1) - .5) * 70, z: k * EVERY / 1000 * SPEED + 26 + hash(k * 2.3 + 2) * 75, age: seconds - k * EVERY / 1000 }))
    const height = (x: number, z: number) => {
      let y = .32 * Math.sin(.1 * x + .06 * z + .5 * seconds) + .3 * Math.sin(.045 * z - .08 * x - .37 * seconds)
      for (const drop of drops) { const d = Math.hypot(x - drop.x, z - drop.z) - 8.5 * drop.age; y += 1.25 * Math.cos(.85 * d) * Math.exp(-((d / 7) ** 2) - drop.age / 8) }
      return y
    }
    const sx = (x: number, z: number) => middle + focal * x / z, sy = (y: number, z: number) => horizon + focal * (EYE - y) / z
    c.strokeStyle = env.ink; c.lineWidth = 1; c.globalAlpha = .12 * env.fade
    c.beginPath(); c.moveTo(left, horizon); c.lineTo(left + w, horizon); c.stroke()
    const nearest = Math.max(5, focal * EYE / (h * .5) * .72)
    const lamps = new Path2D()
    for (let row = Math.floor((camera + FAR) / PITCH); row * PITCH - camera > nearest; row--) {
      const world = row * PITCH, z = world - camera, half = z * (w / 2) / focal + WIDE
      const clear = clamp(1 - z / FAR, 0, 1), body = new Path2D()
      if (z > SINGLE) {
        // 远处：一排机柜连成一道起伏的墙。
        const step = Math.max(WIDE, z * .03), from = Math.floor(-half / step) * step
        body.moveTo(sx(from, z), sy(0, z))
        for (let x = from; x <= half + step; x += step) body.lineTo(sx(x, z), sy(height(x, world) + TALL, z))
        body.lineTo(sx(half + step, z), sy(0, z)); body.closePath()
        c.globalAlpha = env.fade; c.fillStyle = env.paper; c.fill(body)
        c.globalAlpha = .13 * clear ** 1.3 * env.fade; c.stroke(body)
        continue
      }
      const detail = new Path2D(), back = z + DEEP, shift = hash(row) * WIDE
      for (let i = Math.floor(-half / WIDE); i * WIDE < half; i++) {
        const x0 = i * WIDE + shift + .02, x1 = x0 + WIDE - .04, y0 = height(x0 + WIDE / 2, world), y1 = y0 + TALL
        const a = sx(x0, z), b = sx(x1, z), low = sy(y0, z), high = sy(y1, z)
        body.rect(a, high, b - a, low - high)
        const far = sy(y1, back)
        body.moveTo(a, high); body.lineTo(sx(x0, back), far); body.lineTo(sx(x1, back), far); body.lineTo(b, high); body.closePath()
        if (z < 34) {
          // 柜门：一格格的计算托盘，中间一段是交换机；起伏到高处时柜顶亮灯。
          const inset = (b - a) * .1
          for (let k = 1; k < 7; k++) { if (k === 4) continue; const y = high + (low - high) * k / 7; detail.moveTo(a + inset, y); detail.lineTo(b - inset, y) }
          detail.moveTo(a + inset, high + (low - high) * .05); detail.lineTo(a + inset, low - (low - high) * .05)
        }
        if (y0 > .55) { const r = clamp(60 / z, .8, 2.6); lamps.moveTo((a + b) / 2 + r, high + (low - high) * .5); lamps.arc((a + b) / 2, high + (low - high) * .5, r, 0, TAU) }
      }
      c.globalAlpha = env.fade; c.fillStyle = env.paper; c.fill(body)
      c.globalAlpha = (.07 + .2 * clear) * env.fade; c.lineWidth = 1; c.stroke(body)
      c.globalAlpha = (.04 + .1 * clear) * env.fade; c.lineWidth = .8; c.stroke(detail)
    }
    c.fillStyle = env.red; c.globalAlpha = .5 * env.fade; c.fill(lamps)
    c.globalAlpha = .42 * env.fade; c.fillStyle = env.ink; c.font = `18px ${env.hand}`
    c.fillText('∂²φ/∂t² = c² ∇²φ', left + w * .06, horizon - 16)
  }
}

export const SKETCHES: Sketch[] = [
  { id: 'dna', name: 'DNA 双螺旋', tilt: .2, zoom: .54, create: dna, facts: [
    'B-DNA: a right-handed double helix, about 10.5 base pairs per turn, 3.4 Å rise per base pair.',
    'Chargaff: [A] = [T] and [G] = [C].',
    'A pairs with T through two hydrogen bonds; G pairs with C through three.',
    'The two strands are antiparallel: one runs 5′ → 3′, the other 3′ → 5′.',
    'Replication is semiconservative (Meselson–Stahl, 1958).',
    'DNA polymerase extends only in the 5′ → 3′ direction; the lagging strand is made in Okazaki fragments.',
    'Helicase unwinds the helix at the replication fork; topoisomerase relieves the supercoiling ahead of it.',
    'Central dogma: DNA → RNA → protein.',
    'The human genome: about 3.2 × 10⁹ base pairs, two metres of DNA in every nucleus.',
  ] },
  { id: 'lorenz', name: '洛伦兹吸引子', tilt: .3, zoom: .5, create: lorenz, facts: [
    'Lorenz system: ẋ = σ(y − x), ẏ = x(ρ − z) − y, ż = xy − βz, with σ = 10, ρ = 28, β = 8/3.',
    'Sensitive dependence on initial conditions: nearby orbits separate like e^{λt}, λ ≈ 0.906.',
    'The Lorenz attractor has Hausdorff dimension about 2.06.',
    'Deterministic, bounded, and never periodic.',
    'Volumes contract: ∇·F = −(σ + 1 + β) < 0, so the attractor has zero volume.',
    'Tucker (2002): the Lorenz attractor exists — Smale’s 14th problem.',
    'For ρ < 1 the origin is globally stable; a pitchfork bifurcation occurs at ρ = 1.',
    'Poincaré–Bendixson: chaos needs at least three dimensions in a continuous flow.',
    'Lorenz, 1963: “Deterministic Nonperiodic Flow”.',
  ] },
  { id: 'cayley', name: '凯莱图 A₅', tilt: .36, zoom: .5, create: cayley, facts: [
    'A₅ = ⟨a, b | a² = b⁵ = (ab)³ = e⟩, of order 60.',
    'The Cayley graph of A₅ on these generators is the truncated icosahedron.',
    'A₅ is the smallest non-abelian simple group.',
    'A₅ is the rotation group of the icosahedron.',
    'Lagrange: the order of a subgroup divides the order of the group.',
    'Cayley: every group embeds in a symmetric group.',
    'Aₙ is simple for n ≥ 5 — hence the general quintic is not solvable by radicals.',
    'Orbit–stabilizer: |G| = |Orb(x)| · |Stab(x)|.',
    'Sylow: if pᵏ divides |G|, then G has a subgroup of order pᵏ.',
    'First isomorphism theorem: G / ker φ ≅ im φ.',
  ] },
  { id: 'higgs', name: '墨西哥帽势', tilt: .5, zoom: .5, create: higgs, facts: [
    'V(φ) = λ(|φ|² − v²)²: the Lagrangian has a U(1) symmetry, the vacuum does not.',
    'Spontaneous symmetry breaking: the ground state is less symmetric than the laws.',
    'Goldstone: each broken continuous symmetry gives a massless boson — motion along the valley.',
    'The radial oscillation is the Higgs mode, with m² = V″(v).',
    'Higgs mechanism: in a gauge theory the Goldstone boson is eaten and the gauge boson becomes massive.',
    'Electroweak: SU(2) × U(1)_Y → U(1)_em, v ≈ 246 GeV.',
    'ℒ = ∂_μφ* ∂^μφ − V(φ).',
    'Noether: every continuous symmetry gives a conserved current, ∂_μ j^μ = 0.',
    'Ginzburg–Landau: the same potential describes a superconductor below T_c.',
  ] },
  { id: 'dijkstra', name: 'Dijkstra 最短路径', tilt: .72, zoom: .44, camera: 5, create: dijkstra, facts: [
    'Dijkstra: repeatedly settle the unsettled vertex with the smallest tentative distance.',
    'Relaxation: if d(u) + w(u, v) < d(v), set d(v) ← d(u) + w(u, v).',
    'With a binary heap Dijkstra runs in O((V + E) log V); with a Fibonacci heap, O(E + V log V).',
    'Dijkstra needs non-negative weights; Bellman–Ford handles negative edges in O(VE).',
    'Every subpath of a shortest path is itself a shortest path.',
    'The predecessor pointers form a shortest-path tree rooted at s.',
    'A* = Dijkstra + an admissible heuristic: f(n) = g(n) + h(n).',
    'Floyd–Warshall: all-pairs shortest paths in O(V³).',
    'Euler: a connected graph has an Eulerian circuit iff every vertex has even degree.',
    'Max-flow = min-cut (Ford–Fulkerson).',
  ] },
  { id: 'life', name: '生命游戏', tilt: .8, zoom: .39, camera: 5, create: life, facts: [
    'Conway’s Life, rule B3/S23: a dead cell with 3 neighbours is born; a live cell with 2 or 3 survives.',
    'The Game of Life is Turing complete.',
    'A glider moves one cell diagonally every four generations.',
    'Gosper’s glider gun (1970): the first pattern found with unbounded growth.',
    'Garden of Eden: a configuration with no predecessor.',
    'Rule 110, a one-dimensional cellular automaton, is also universal (Cook, 2004).',
    'Halting problem: no algorithm decides whether every program halts.',
    'Church–Turing thesis: the computable functions are exactly those a Turing machine can compute.',
    'Rice: every non-trivial semantic property of programs is undecidable.',
  ] },
  { id: 'tree', name: '分形二叉树', tilt: .22, zoom: .5, create: tree, facts: [
    'A binary tree of depth n has 2ⁿ⁺¹ − 1 nodes.',
    'Self-similarity: every subtree is a scaled copy of the whole.',
    'Similarity dimension: D = log N / log(1/r); here N = 2.',
    'Total branch length: Σ (2r)ᵏ — finite iff r < 1/2.',
    'A balanced binary search tree: search, insert, delete in O(log n).',
    'Catalan: the number of binary trees with n nodes is Cₙ = (2n)! / ((n + 1)! n!).',
    'König’s lemma: an infinite, finitely branching tree has an infinite path.',
    'The boundary of the infinite binary tree is a Cantor set.',
    'Master theorem: T(n) = 2T(n/2) + O(n) ⇒ T(n) = O(n log n).',
    'A heap is a complete binary tree stored in an array: children of i are 2i + 1 and 2i + 2.',
  ] },
  { id: 'racks', name: '机柜的海', tilt: .7, create: racks, facts: [
    'A field is a degree of freedom at every point; a lattice makes that literal.',
    'Wave equation: ∂²φ/∂t² = c² ∇²φ.',
    'Lattice dispersion: ω(k) = 2√(K/m) |sin(ka/2)|.',
    'In two dimensions the amplitude of a circular wave falls off like 1/√r.',
    'Huygens: every point on a wavefront is the source of a secondary wavelet.',
    'Quantize each normal mode of the lattice and you get phonons.',
    'Klein–Gordon: (□ + m²)φ = 0.',
    'Amdahl: speedup ≤ 1 / ((1 − p) + p/n).',
    'Stencil computation: each cell is updated from its neighbours — embarrassingly parallel across a cluster.',
    'Superposition: solutions of a linear wave equation add.',
  ] },
]

export function sketchById(id: string) { return SKETCHES.find(item => item.id === id) }
