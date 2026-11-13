// 流形、神经网络之外的画面：生物、物理、群论、算法。每个画面自己管动画，画在同一张慢慢自转的草稿上。
import type { Vec } from './manifolds.ts'

export type Project = (x: number, y: number, z: number) => [number, number, number]
/** size：模型里 1 个单位在画布中心是多少像素；full：整块桌面（画面的常规区域之外也能画）。 */
export type Env = { context: CanvasRenderingContext2D; project: Project; t: number; fade: number; ink: string; red: string; paper: string; hand: string; width: number; height: number; size: number; camera: number; full: { x: number; y: number; w: number; h: number }; grid: { size: number; x: number; y: number } }
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

type Model = { points: Vec[]; radius: number[]; kind: number[]; bonds: number[]; shaded?: boolean }
// 手画的小球：只用纸色、铅笔、红笔三种平涂，不打高光；右下角划几道铅笔斜线当阴影。按颜色各画一张小图，用的时候缩放贴上去。
const sprites = new Map<string, HTMLCanvasElement[]>()
function shadedBalls(env: Env) {
  const key = `${env.paper}|${env.ink}|${env.red}`
  let set = sprites.get(key)
  if (set) return set
  const SIZE = 72
  set = [0, 1, 2, 3].map(kind => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE
    const c = canvas.getContext('2d')!, r = SIZE / 2
    c.beginPath(); c.arc(r, r, r - 1, 0, TAU); c.clip()
    c.fillStyle = env.paper; c.fillRect(0, 0, SIZE, SIZE)
    if (kind) { c.globalAlpha = kind === 1 ? .72 : .8; c.fillStyle = kind === 1 ? env.ink : env.red; c.fillRect(0, 0, SIZE, SIZE); c.globalAlpha = 1 }
    // 阴影：只留右下的一弯月牙，在里面划斜线。
    const moon = new Path2D(); moon.rect(0, 0, SIZE, SIZE); moon.arc(r * .7, r * .7, r * .98, 0, TAU)
    c.clip(moon, 'evenodd')
    c.strokeStyle = env.ink; c.globalAlpha = kind === 1 ? 0 : .6; c.lineWidth = 2.6; c.lineCap = 'round'
    for (let k = -SIZE; k < SIZE * 2; k += 9) { c.beginPath(); c.moveTo(k, SIZE); c.lineTo(k + SIZE, 0); c.stroke() }
    return canvas
  })
  sprites.set(key, set)
  return set
}
/** 球棍模型：球按远近排序、用纸色填实，近的挡住远的。kind：0 空心、1 铅笔淡填、2 红笔淡填、3 红笔深填；bonds 是 (a, b, 样式) 三元组，样式 0 实线、1 虚线、2 红线、3 粗而淡的带子。shaded：球带明暗，远处的褪进纸里，近处的线更粗更深。 */
function ballsAndSticks(env: Env, model: Model, place: (p: Vec) => Vec, hot?: Set<number>, veil?: (p: Vec) => number) {
  const c = env.context, n = model.points.length, m = model.bonds.length / 3
  const sx = new Float32Array(n), sy = new Float32Array(n), depth = new Float32Array(n + m), pr = new Float32Array(n)
  const seen = new Float32Array(n).fill(1)
  let low = Infinity, high = -Infinity
  for (let i = 0; i < n; i++) {
    const q = place(model.points[i]!), [x, y, d] = env.project(q[0], q[1], q[2])
    sx[i] = x; sy[i] = y; depth[i] = d; pr[i] = model.radius[i]! * env.size * env.camera / (env.camera + 1 - 2 * d)
    if (veil) seen[i] = veil(model.points[i]!)
    if (d < low) low = d
    if (d > high) high = d
  }
  for (let j = 0; j < m; j++) depth[n + j] = (depth[model.bonds[j * 3]!]! + depth[model.bonds[j * 3 + 1]!]!) / 2 - 1e-4
  const order = Array.from({ length: n + m }, (_, k) => k).sort((a, b) => depth[a]! - depth[b]!)
  const balls = model.shaded ? shadedBalls(env) : undefined
  for (const id of order) {
    // shaded：远近按模型自己的前后拉满；否则按画面的绝对深度。
    const near = model.shaded ? clamp((depth[id]! - low) / (high - low || 1), 0, 1) : clamp(depth[id]!, 0, 1)
    if (id < n) {
      const r = pr[id]!, kind = model.kind[id]!, show = seen[id]! * env.fade
      if (show < .02) continue
      c.beginPath(); c.arc(sx[id]!, sy[id]!, r, 0, TAU)
      if (balls) {
        c.globalAlpha = show; c.drawImage(balls[kind]!, sx[id]! - r, sy[id]! - r, r * 2, r * 2)
        c.globalAlpha = .8 * (1 - near) ** 1.3 * show; c.fillStyle = env.paper; c.fill()
        c.globalAlpha = (.1 + .45 * near) * show; c.strokeStyle = env.ink; c.lineWidth = .6 + .7 * near; c.stroke()
        continue
      }
      c.globalAlpha = env.fade; c.fillStyle = env.paper; c.fill()
      if (kind) { c.globalAlpha = (kind === 1 ? .2 : kind === 2 ? .3 : .6) * (.5 + .5 * near) * env.fade; c.fillStyle = kind === 1 ? env.ink : env.red; c.fill() }
      c.globalAlpha = (.14 + .4 * near) * env.fade; c.strokeStyle = env.ink; c.lineWidth = 1; c.stroke()
    } else {
      const j = id - n, a = model.bonds[j * 3]!, b = model.bonds[j * 3 + 1]!, style = hot?.has(j) ? 2 : model.bonds[j * 3 + 2]!
      const dx = sx[b]! - sx[a]!, dy = sy[b]! - sy[a]!, length = Math.hypot(dx, dy)
      const show = Math.min(seen[a]!, seen[b]!) * env.fade
      if (length <= pr[a]! + pr[b]! || show < .02) continue
      const ux = dx / length, uy = dy / length
      c.beginPath(); c.moveTo(sx[a]! + ux * pr[a]!, sy[a]! + uy * pr[a]!); c.lineTo(sx[b]! - ux * pr[b]!, sy[b]! - uy * pr[b]!)
      c.setLineDash(style === 1 ? [3, 3] : [])
      c.strokeStyle = style === 2 ? env.red : env.ink
      if (style === 3) { c.globalAlpha = (.03 + .08 * near) * show; c.lineWidth = (pr[a]! + pr[b]!) * 1.1 }
      else if (balls) { c.globalAlpha = (style === 2 ? .3 + .4 * near : .05 + .45 * near * near) * show; c.lineWidth = (style === 2 ? 1.4 : style === 1 ? .8 : 1) + 1.3 * near }
      else { c.globalAlpha = (style === 2 ? .7 : .12 + .4 * near) * env.fade; c.lineWidth = style === 2 ? 1.8 : 1.3 }
      c.stroke()
    }
  }
  c.setLineDash([])
}
function corner(env: Env, lines: string[], y = .74) {
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
const ELEMENT: Record<string, [number, number]> = { C: [.36, 0], N: [.35, 1], O: [.35, 2], P: [.6, 3] } // 半径 Å、填色

function dna(): Painter {
  // 一条没有尽头的螺旋：画面里是其中二十来对碱基，整条链沿轴缓缓滑过去（看上去就是在慢慢地转），两头褪进纸里。
  const PAIRS = 22, RISE = 3.38, TWIST = 36 * Math.PI / 180, SCALE = .05, LEAN = .42, PITCH = .32, PER_PAIR = 9000
  const letterAt = (index: number) => 'ATGC'[Math.floor(hash(index * 1.7 + 3) * 4)]!
  let model: Model = { points: [], radius: [], kind: [], bonds: [], shaded: true }, hydrogen: number[][] = [], first = NaN
  const build = (start: number) => {
    first = start; hydrogen = []
    model = { points: [], radius: [], kind: [], bonds: [], shaded: true }
    const phosphate: number[][] = [[], []], oxygen3: number[][] = [[], []]
    const push = (element: string, x: number, y: number, z: number) => { const [radius, kind] = ELEMENT[element]!; model.points.push([x, y, z]); model.radius.push(radius * SCALE); model.kind.push(kind); return model.points.length - 1 }
    for (let k = 0; k < PAIRS; k++) {
      const letter = letterAt(start + k), turn = (start + k) * TWIST, ct = Math.cos(turn), st = Math.sin(turn), height = (k - PAIRS / 2) * RISE, base: number[][] = []
      for (let strand = 0; strand < 2; strand++) {
        const flip = strand ? -1 : 1
        // 第二条链是第一条绕碱基对的二重轴转 180°：(x, y, z) → (x, −y, −z)。
        const put = (element: string, x: number, y: number, z: number) => push(element, x * ct - y * flip * st, x * st + y * flip * ct, z * flip + height)
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
      hydrogen.push(list)
    }
    // 相邻核苷酸：O3′ 接下一个的磷（第一条链向上，第二条链向下）；另沿两条链的磷原子各画一条粗而淡的带子。
    for (let k = 0; k + 1 < PAIRS; k++) { model.bonds.push(oxygen3[0]![k]!, phosphate[0]![k + 1]!, 0); model.bonds.push(oxygen3[1]![k + 1]!, phosphate[1]![k]!, 0); for (const strand of [0, 1]) model.bonds.push(phosphate[strand]![k]!, phosphate[strand]![k + 1]!, 3) }
  }
  const cl = Math.cos(LEAN), sl = Math.sin(LEAN), cp = Math.cos(PITCH), sp = Math.sin(PITCH), reach = PAIRS / 2 * RISE
  return env => {
    const passed = env.t / PER_PAIR, start = Math.floor(passed), slide = (passed - start) * RISE
    if (start !== first) build(start)
    // 先沿轴滑动，再侧倾，再朝镜头俯过来。
    const place = (p: Vec): Vec => { const x = p[0] * SCALE, z = p[1] * SCALE, y = (p[2] - slide + RISE / 2) * SCALE, y1 = x * sl + y * cl; return [x * cl - y * sl, y1 * cp - z * sp + .05, y1 * sp + z * cp] }
    const veil = (p: Vec) => smooth((reach - Math.abs(p[2] - slide + RISE / 2)) / (reach * .3))
    const middle = PAIRS / 2, letter = letterAt(start + middle)
    ballsAndSticks(env, model, place, new Set(hydrogen[middle]), veil)
    label(env, `${letter} ${letter === 'G' || letter === 'C' ? '≡' : '='} ${PARTNER[letter]}`, place([14, 0, 0]), .5, env.red, 10, 5)
    corner(env, ['B-DNA · 10.5 bp / turn · 3.4 Å rise', 'C paper · N pencil · O, P red'])
  }
}

// ---- 洛伦兹吸引子：两条起点只差千分之一的轨道、一团起初挤在一起的点（慢慢抹满整个吸引子）、坐标轴与不动点、左下角 x(t) ----
function lorenz(): Painter {
  const TRAIL = 2400, CLOUD = 160, RESET = 120000
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
    const c = env.context, target = Math.floor(env.t / 48)
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
    c.fillStyle = env.red; c.globalAlpha = .3 * env.fade; c.fill(specks)
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
    const c = env.context, STEP = 2800, steps = Math.floor(env.t / STEP)
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
    corner(env, [`g = … ${word.slice(-10).join(' ')}  =  ${cycles(element[now]!)}`, `a = ${cycles(a)},  b = ${cycles(b)}`, 'a² = b⁵ = (ab)³ = e,   |A₅| = 60'])
  }
}

// ---- 墨西哥帽势：一群小球从帽顶各自滚向谷底的不同方向（对称性自发破缺），先径向振荡（希格斯模），再沿谷绕圈（戈德斯通模）；地面上是等势线和小球的影子 ----
function higgs(): Painter {
  const HEIGHT = .62, WIDE = .78, CYCLE = 40, BALLS = 3, FLOOR = -.5, RINGS = 13, SPOKES = 40, RIM = 1.3, SLOW = .4
  const surface = (r: number, a: number, lift = 0): Vec => [r * Math.cos(a) * WIDE, HEIGHT * (r * r - 1) ** 2 - .3 + lift, r * Math.sin(a) * WIDE]
  const state = (seconds: number, start: number): [number, number] => {
    const u = seconds - 2
    if (u <= 0) return [.03, start]
    return [1 - Math.exp(-u / .9) * Math.cos(2.3 * u), start + .45 * (u - 3 * (1 - Math.exp(-u / 3)))]
  }
  return env => {
    const c = env.context
    // 地面：两条轴、谷底那一圈的投影。
    const floor = new Layers(env.project), ground = (r: number, a: number): Vec => [r * Math.cos(a) * WIDE, FLOOR, r * Math.sin(a) * WIDE]
    floor.line(ground(1.7, Math.PI), ground(1.7, 0)); floor.line(ground(1.7, -Math.PI / 2), ground(1.7, Math.PI / 2))
    floor.stroke(env, .08, .05, 1)
    const circle = new Layers(env.project)
    for (let s = 0; s < 72; s += 2) circle.line(ground(1, s / 72 * TAU), ground(1, (s + 1) / 72 * TAU))
    circle.stroke(env, .08, .05, 1, env.red)
    label(env, 'Re φ', ground(1.7, 0), .4); label(env, 'Im φ', ground(1.7, Math.PI / 2), .4)
    // 曲面：一格格的小面片，从远到近画，每片用纸色填实——近处的帽檐挡住后面的线，立体才看得清。小球按远近夹在面片之间。
    const grid: [number, number, number][][] = []
    for (let k = 0; k <= RINGS; k++) { const ring: [number, number, number][] = []; for (let s = 0; s < SPOKES; s++) ring.push(env.project(...surface(k / RINGS * RIM, s / SPOKES * TAU))); grid.push(ring) }
    const valley = Math.round(RINGS / RIM)
    const faces: { depth: number; k: number; s: number }[] = []
    for (let k = 0; k < RINGS; k++) for (let s = 0; s < SPOKES; s++) faces.push({ depth: (grid[k]![s]![2] + grid[k + 1]![(s + 1) % SPOKES]![2]) / 2, k, s })
    const balls = Array.from({ length: BALLS }, (_, index) => {
      const local = env.t / 1000 * SLOW + index * CYCLE / BALLS, seconds = local % CYCLE, start = hash(Math.floor(local / CYCLE) * 7 + index) * TAU
      const [r, a] = state(seconds, start), at = surface(r, a, .035)
      return { seconds, start, at, depth: env.project(...at)[2] + .012, show: clamp((CYCLE - seconds) / 2, 0, 1) * clamp(seconds / 1, 0, 1) }
    })
    const drawBall = (ball: typeof balls[number]) => {
      c.strokeStyle = env.red; c.lineWidth = 1.6
      for (let j = 0; j < 30; j++) {
        const [r0, a0] = state(ball.seconds - (j + 1) * .12, ball.start), [r1, a1] = state(ball.seconds - j * .12, ball.start)
        const p = env.project(...surface(r0, a0, .03)), q = env.project(...surface(r1, a1, .03))
        c.globalAlpha = .4 * (1 - j / 30) * ball.show * env.fade
        c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke()
      }
      const [x, y] = env.project(...ball.at)
      c.beginPath(); c.arc(x, y, 5.5, 0, TAU); c.globalAlpha = ball.show * env.fade; c.fillStyle = env.paper; c.fill(); c.globalAlpha = .7 * ball.show * env.fade; c.fillStyle = env.red; c.fill()
    }
    const order = [...faces.map(face => ({ ...face, ball: -1 })), ...balls.map((ball, index) => ({ depth: ball.depth, k: 0, s: 0, ball: index }))].sort((a, b) => a.depth - b.depth)
    c.lineWidth = 1
    for (const item of order) {
      if (item.ball >= 0) { drawBall(balls[item.ball]!); c.lineWidth = 1; continue }
      const a = grid[item.k]![item.s]!, b = grid[item.k + 1]![item.s]!, d = grid[item.k + 1]![(item.s + 1) % SPOKES]!, e = grid[item.k]![(item.s + 1) % SPOKES]!
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.lineTo(e[0], e[1]); c.closePath()
      c.globalAlpha = .93 * env.fade; c.fillStyle = env.paper; c.fill()
      c.globalAlpha = (.05 + .2 * clamp(item.depth, 0, 1)) * env.fade; c.strokeStyle = env.ink; c.stroke()
      if (item.k + 1 === valley) { c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.globalAlpha = (.2 + .35 * clamp(item.depth, 0, 1)) * env.fade; c.strokeStyle = env.red; c.lineWidth = 1.4; c.stroke(); c.lineWidth = 1 }
    }
    label(env, 'V(φ) = λ(|φ|² − v²)²', surface(RIM, 3.5), .45, env.ink, -160, -12)
    label(env, '|φ| = v', ground(1, 2.4), .42, env.red, -52, 16)
    corner(env, ['radial: Higgs mode', 'along the valley: Goldstone mode'])
  }
}

// ---- Dijkstra：每个顶点一确定最短距离，就升到与距离成正比的高度——最短路径树像一座山慢慢长出来；到 t 后沿树描出最短路径 ----
function dijkstra(): Painter {
  const COLS = 13, ROWS = 8, TICK = 480, HOLD = 10000, RISE = .22, FLOOR = .1
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
    const lift = (i: number) => state.when[i]! < 0 || state.when[i]! >= count ? 0 : state.distance[i]! * RISE * smooth((clock - state.when[i]!) / 2.5) * smooth(sinking)
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
      const reversed = [...state.path].reverse(), shown = clamp((env.t - state.started - state.order.length * TICK) / 3000, 0, 1) * (reversed.length - 1)
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
    corner(env, [finished ? `settled ${state.order.length} of ${nodes.length} vertices` : `Q = { ${state.queue[Math.min(count, state.queue.length - 1)]} }`, 'height = d(s, v)'])
  }
}

// ---- 康威生命游戏：直接拿桌面的格子纸当格点，一格一个细胞；一门高斯帕滑翔机枪加一片随机初始图样，刚出生的细胞用红笔，刚死的留一点淡影 ----
const GUN = ['........................O', '......................O.O', '............OO......OO............OO', '...........O...O....OO............OO', 'OO........O.....O...OO', 'OO........O...O.OO....O.O', '..........O.....O.......O', '...........O...O', '............OO']
function life(): Painter {
  const TICK = 1100
  let W = 0, H = 0, cells = new Uint8Array(0), before = new Uint8Array(0), generation = 0, seeded = 0, calm = 0, population = 0, done = 0
  const seed = () => {
    cells = new Uint8Array(W * H); before = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x > W * .5 && Math.random() < .3) cells[y * W + x] = 1
    if (W > 44 && H > 16) GUN.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'O') cells[(y + 5) * W + x + 4] = 1 }))
    seeded = generation; calm = 0
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
    before = cells; cells = out; population = alive; generation++
    if (alive < 14 || calm > 40 || generation - seeded > 600) seed()
  }
  return env => {
    const c = env.context, size = env.grid.size, { x: left, y: top, w, h } = env.full
    const x0 = env.grid.x - Math.ceil((env.grid.x - left) / size) * size, y0 = env.grid.y - Math.ceil((env.grid.y - top) / size) * size
    const columns = Math.ceil((left + w - x0) / size), rows = Math.ceil((top + h - y0) / size)
    if (columns !== W || rows !== H) { W = columns; H = rows; seed(); for (let k = 0; k < 8; k++) step(); done = Math.floor(env.t / TICK) }
    const target = Math.floor(env.t / TICK)
    if (target - done > 2) done = target - 2
    while (done < target) { step(); done++ }
    const old = new Path2D(), born = new Path2D(), ghost = new Path2D()
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i] && !before[i]) continue
      (cells[i] ? before[i] ? old : born : ghost).rect(x0 + (i % W) * size + 2, y0 + Math.floor(i / W) * size + 2, size - 3, size - 3)
    }
    c.fillStyle = env.ink; c.globalAlpha = .045 * env.fade; c.fill(ghost)
    c.globalAlpha = .17 * env.fade; c.fill(old)
    c.fillStyle = env.red; c.globalAlpha = .26 * env.fade; c.fill(born)
    corner(env, [`generation ${generation - seeded} · population ${population}`, 'B3 / S23'])
  }
}

// ---- 红黑树：一个个键插进来，先是红的；破坏了「红结点没有红孩子」就重新着色，或者把一小段子树左旋 / 右旋——只有那一段在动 ----
type RedBlack = { id: number; key: number; red: boolean; left: RedBlack | null; right: RedBlack | null; parent: RedBlack | null }
type Shot = { nodes: Map<number, { x: number; y: number; red: boolean; key: number; parent: number }>; note: string; focus: number }
function tree(): Painter {
  const STEP = 4200, MOVE = 1800, FULL = 26
  let root: RedBlack | null = null, ids = 0, shots: Shot[] = [], index = 0, since = 0
  const shoot = (note: string, focus: RedBlack | null) => {
    const nodes: Shot['nodes'] = new Map(), order: RedBlack[] = []
    const walk = (node: RedBlack | null, depth: number) => { if (!node) return; walk(node.left, depth + 1); order.push(node); nodes.set(node.id, { x: order.length - 1, y: depth, red: node.red, key: node.key, parent: node.parent?.id ?? -1 }); walk(node.right, depth + 1) }
    walk(root, 0)
    for (const spot of nodes.values()) spot.x -= (order.length - 1) / 2
    shots.push({ nodes, note, focus: focus?.id ?? -1 })
  }
  const rotate = (x: RedBlack, left: boolean) => {
    const y = (left ? x.right : x.left)!, inner = left ? y.left : y.right
    if (left) x.right = inner; else x.left = inner
    if (inner) inner.parent = x
    y.parent = x.parent
    if (!x.parent) root = y; else if (x.parent.left === x) x.parent.left = y; else x.parent.right = y
    if (left) y.left = x; else y.right = x
    x.parent = y
    shoot(`rotate ${left ? 'left' : 'right'} at ${x.key}`, y)
  }
  const insert = (key: number) => {
    let parent: RedBlack | null = null, at = root
    while (at) { parent = at; at = key < at.key ? at.left : at.right }
    let z: RedBlack = { id: ids++, key, red: true, left: null, right: null, parent }
    if (!parent) root = z; else if (key < parent.key) parent.left = z; else parent.right = z
    shoot(`insert ${key}`, z)
    while (z.parent?.red && z.parent.parent) {
      const p: RedBlack = z.parent, g: RedBlack = p.parent!, leftSide = g.left === p, uncle = leftSide ? g.right : g.left
      if (uncle?.red) { p.red = false; uncle.red = false; g.red = true; z = g; shoot('red uncle: recolour', g); continue }
      if (z === (leftSide ? p.right : p.left)) { z = p; rotate(z, leftSide) }
      z.parent!.red = false; g.red = true
      rotate(g, !leftSide)
    }
    if (root!.red) { root!.red = false; shoot('root → black', root) }
  }
  const more = () => {
    const keys = new Set<number>(); const collect = (node: RedBlack | null) => { if (node) { keys.add(node.key); collect(node.left); collect(node.right) } }
    collect(root)
    if (keys.size >= FULL) { root = null; shots.push({ nodes: new Map(), note: '', focus: -1 }); return }
    let key = 0
    do key = 1 + Math.floor(Math.random() * 98); while (keys.has(key))
    insert(key)
  }
  shots.push({ nodes: new Map(), note: '', focus: -1 })
  for (let k = 0; k < 7; k++) more()
  index = shots.length - 1
  return env => {
    const c = env.context
    while (env.t - since > STEP) { since += STEP; if (env.t - since > STEP * 3) since = env.t; index++; if (index >= shots.length) more(); if (shots.length > 40) { shots.splice(0, 20); index -= 20 } }
    const now = shots[index]!, was = shots[index - 1] ?? now, move = smooth((env.t - since) / MOVE)
    const count = Math.max(now.nodes.size, was.nodes.size, 8), dx = Math.min(44, env.width * .78 / count), dy = Math.min(66, env.height * .11), ox = env.width * .55, oy = env.height * .2
    const radius = clamp(dx * .34, 3, 12)
    const spot = (id: number): { x: number; y: number; red: boolean; key: number; show: number } | undefined => {
      const b = now.nodes.get(id), a = was.nodes.get(id)
      if (!a && !b) return undefined
      const from = a ?? { ...b!, y: b!.y - .8 }, to = b ?? a!
      return { x: ox + (from.x + (to.x - from.x) * move) * dx, y: oy + (from.y + (to.y - from.y) * move) * dy, red: move < .5 ? from.red : to.red, key: to.key, show: !a ? move : !b ? 1 - move : 1 }
    }
    const ids = new Set([...now.nodes.keys(), ...was.nodes.keys()])
    c.lineWidth = 1.1; c.strokeStyle = env.ink
    for (const id of ids) {
      const parent = (move < .5 ? was.nodes.get(id) ?? now.nodes.get(id) : now.nodes.get(id) ?? was.nodes.get(id))!.parent, a = spot(id), b = parent >= 0 ? spot(parent) : undefined
      if (!a || !b) continue
      c.globalAlpha = .3 * Math.min(a.show, b.show) * env.fade
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke()
    }
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `${Math.round(radius * 1.15)}px ${env.hand}`
    for (const id of ids) {
      const node = spot(id)!
      c.beginPath(); c.arc(node.x, node.y, radius, 0, TAU)
      c.globalAlpha = node.show * env.fade; c.fillStyle = env.paper; c.fill()
      c.globalAlpha = (node.red ? .62 : .58) * node.show * env.fade; c.fillStyle = node.red ? env.red : env.ink; c.fill()
      if (radius > 7) { c.globalAlpha = .95 * node.show * env.fade; c.fillStyle = env.paper; c.fillText(String(node.key), node.x, node.y + 1) }
      if (id === now.focus && move < 1) { c.beginPath(); c.arc(node.x, node.y, radius + 5, 0, TAU); c.globalAlpha = .5 * (1 - move) * env.fade; c.strokeStyle = env.red; c.lineWidth = 1.4; c.stroke(); c.strokeStyle = env.ink; c.lineWidth = 1.1 }
    }
    c.textAlign = 'start'; c.textBaseline = 'alphabetic'
    corner(env, [now.note, `red-black tree · n = ${now.nodes.size}`])
  }
}

// ---- GB300：液冷机柜一排排铺满下半个桌面，一直排到天际线。近处画出机柜的样子——上下的电源框、两组计算托盘、中间的交换机段、柜顶的冷却液软管；越远越简，连续地过渡到只剩轮廓。偶尔落下一滴水，起伏一圈圈传开 ----
function racks(): Painter {
  const WIDE = .6, DEEP = 1.1, PITCH = 3.6, TALL = 2.25, EYE = 5.6, SPEED = .09, SINGLE = 60, BLOCKS = 115, FAR = 340, EVERY = 17000, POD = 9
  return env => {
    const c = env.context, { x: left, y: top, w, h } = env.full
    const horizon = top + h * .5, middle = left + w / 2, focal = w * .85
    const seconds = env.t / 1000, camera = seconds * SPEED, latest = Math.floor(env.t / EVERY)
    const drops = [0, 1].map(k => latest - k).filter(k => k >= 0).map(k => ({ x: (hash(k * 2.3 + 1) - .5) * 30, z: k * EVERY / 1000 * SPEED + 16 + hash(k * 2.3 + 2) * 40, age: seconds - k * EVERY / 1000 }))
    const height = (x: number, z: number) => {
      let y = .07 * Math.sin(.09 * x + .05 * z + .2 * seconds)
      for (const drop of drops) { const d = Math.hypot(x - drop.x, z - drop.z) - 2.6 * drop.age; y += .55 * Math.cos(.8 * d) * Math.exp(-((d / 6) ** 2) - drop.age / 11) }
      return y
    }
    const sx = (x: number, z: number) => middle + focal * x / z, sy = (y: number, z: number) => horizon + focal * (EYE - y) / z
    c.strokeStyle = env.ink; c.lineWidth = 1; c.globalAlpha = .1 * env.fade
    c.beginPath(); c.moveTo(left, horizon); c.lineTo(left + w, horizon); c.stroke()
    const nearest = Math.max(4.5, focal * EYE / (h * .5) * .8)
    const lamps = new Path2D()
    for (let row = Math.floor((camera + FAR) / PITCH); row * PITCH - camera > nearest; row--) {
      const world = row * PITCH, z = world - camera, half = z * (w / 2) / focal + WIDE
      const clear = clamp(1 - z / FAR, 0, 1), line = .03 + .24 * clear ** 3, body = new Path2D(), shift = hash(row) * WIDE
      if (z > SINGLE) {
        if ((z > 280 && row % 3) || (z > BLOCKS && row % 2)) continue // 越远排得越密：隔排画，免得天际线糊成一条黑带
        // 中景：还是一个个方头的机柜轮廓；再远才连成平滑起伏的一线。
        const blocky = z < BLOCKS, step = blocky ? WIDE : Math.max(WIDE, z * .04), from = Math.floor(-half / step) * step + (blocky ? shift : 0)
        body.moveTo(sx(from, z), sy(0, z))
        for (let x = from; x <= half + step; x += step) { const y = sy(height(x + step / 2, world) + TALL, z); if (blocky) { body.lineTo(sx(x, z), y); body.lineTo(sx(x + step, z), y) } else body.lineTo(sx(x, z), y) }
        body.lineTo(sx(half + step, z), sy(0, z)); body.closePath()
        c.globalAlpha = env.fade; c.fillStyle = env.paper; c.fill(body)
        c.globalAlpha = line * env.fade; c.lineWidth = 1; c.stroke(body)
        continue
      }
      // 细节按机柜在屏幕上的宽度连续地淡入：先是分段，再是托盘线，最近才有把手、网孔、端口。
      const pixels = focal * WIDE / z, some = smooth((pixels - 7) / 9), more = smooth((pixels - 18) / 16), most = smooth((pixels - 40) / 30)
      const low = new Path2D(), mid = new Path2D(), fine = new Path2D(), back = z + DEEP
      for (let i = Math.floor((-half - shift) / WIDE); i * WIDE + shift < half; i++) {
        const gap = (((i + row * 4) % POD) + POD) % POD
        if (gap === POD - 1) continue // 每八个机柜留一条过道
        const x0 = i * WIDE + shift + .015, x1 = x0 + WIDE - .03, y0 = height(x0 + WIDE / 2, world), y1 = y0 + TALL
        const a = sx(x0, z), b = sx(x1, z), bottom = sy(y0, z), high = sy(y1, z), far = sy(y1, back)
        body.rect(a, high, b - a, bottom - high)
        body.moveTo(a, high); body.lineTo(sx(x0, back), far); body.lineTo(sx(x1, back), far); body.lineTo(b, high); body.closePath()
        // 过道旁边露出来的侧板。
        const side = gap === 0 && x0 > 0 ? x0 : gap === POD - 2 && x1 < 0 ? x1 : NaN
        if (side === side) {
          const edge = sx(side, z), behind = sx(side, back), floorBack = sy(y0, back)
          body.moveTo(edge, high); body.lineTo(behind, far); body.lineTo(behind, floorBack); body.lineTo(edge, bottom); body.closePath()
          if (some > 0) for (const f of [.3, .5, .7]) { low.moveTo(edge + (behind - edge) * f, high + (far - high) * f); low.lineTo(edge + (behind - edge) * f, bottom + (floorBack - bottom) * f) }
        }
        if (some > 0) {
          const wide = b - a, tall = bottom - high, l = a + wide * .07, r = b - wide * .07, at = (f: number) => high + tall * f
          const across = (path: Path2D, f: number, from = l, to = r) => { path.moveTo(from, at(f)); path.lineTo(to, at(f)) }
          // 立柱，和五段的分界：电源框 / 十个计算托盘 / 九个交换机托盘 / 八个计算托盘 / 电源框。
          for (const x of [l, r]) { low.moveTo(x, at(.02)); low.lineTo(x, at(.95)) }
          for (const f of [.02, .11, .41, .59, .83, .92, .95]) across(low, f)
          if (more > 0) {
            for (let k = 1; k < 10; k++) across(k % 2 ? fine : mid, .11 + .03 * k)
            for (let k = 1; k < 8; k++) across(k % 2 ? fine : mid, .59 + .03 * k)
            for (let k = 1; k < 9; k++) across(k % 3 ? fine : mid, .41 + .02 * k)
            across(mid, .05); across(mid, .08); across(mid, .86); across(mid, .89)
            // 柜顶：出风口，和两根往上走的冷却液软管。
            const vent = (fx: number, fz: number): [number, number] => [sx(x0 + (x1 - x0) * fx, z + DEEP * fz), sy(y1, z + DEEP * fz)]
            const [v0, v1, v2, v3] = [vent(.2, .2), vent(.8, .2), vent(.8, .6), vent(.2, .6)]
            mid.moveTo(v0[0], v0[1]); mid.lineTo(v1[0], v1[1]); mid.lineTo(v2[0], v2[1]); mid.lineTo(v3[0], v3[1]); mid.closePath()
            for (const fx of [.3, .7]) { const [hx, hy] = vent(fx, .85), up = sy(y1 + .55, z + DEEP * .85); mid.moveTo(hx, hy); mid.lineTo(hx, up); mid.quadraticCurveTo(hx, up - tall * .03, hx + wide * .12 * (fx < .5 ? -1 : 1), up - tall * .03) }
          }
          if (most > 0) {
            // 电源模块的小格、托盘两头的把手、托盘正面的一排网孔、交换机的端口、底座的脚。
            for (let k = 1; k < 6; k++) { const x = l + (r - l) * k / 6; fine.moveTo(x, at(.02)); fine.lineTo(x, at(.11)); fine.moveTo(x, at(.83)); fine.lineTo(x, at(.92)) }
            const trays = [...Array.from({ length: 10 }, (_, k) => .125 + .03 * k), ...Array.from({ length: 8 }, (_, k) => .605 + .03 * k)]
            for (const f of trays) {
              for (const x of [l + wide * .05, r - wide * .05]) fine.rect(x - wide * .012, at(f - .007), wide * .024, tall * .014)
              for (let k = 0; k < 7; k++) { const x = l + wide * (.2 + .075 * k); fine.moveTo(x, at(f)); fine.lineTo(x + wide * .035, at(f)) }
            }
            for (let k = 0; k < 9; k++) for (let j = 1; j < 12; j++) { const x = l + (r - l) * j / 12; fine.moveTo(x, at(.414 + .02 * k)); fine.lineTo(x, at(.426 + .02 * k)) }
            for (const x of [l + wide * .06, r - wide * .16]) fine.rect(x, at(.965), wide * .1, tall * .025)
            fine.rect(a + wide * .42, at(.004), wide * .16, tall * .012)
          }
        }
        if (y0 > .3) { const r = clamp(pixels * .05, .8, 3); lamps.moveTo((a + b) / 2 + r, high + (bottom - high) * .5); lamps.arc((a + b) / 2, high + (bottom - high) * .5, r, 0, TAU) }
      }
      c.globalAlpha = env.fade; c.fillStyle = env.paper; c.fill(body)
      c.globalAlpha = line * env.fade; c.lineWidth = 1; c.stroke(body)
      if (some > 0) { c.globalAlpha = line * some * env.fade; c.lineWidth = .9; c.stroke(low) }
      if (more > 0) { c.globalAlpha = line * .85 * more * env.fade; c.lineWidth = .8; c.stroke(mid) }
      if (more > 0) { c.globalAlpha = line * .7 * Math.max(most, more * .5) * env.fade; c.lineWidth = .7; c.stroke(fine) }
    }
    c.fillStyle = env.red; c.globalAlpha = .45 * env.fade; c.fill(lamps)
    c.globalAlpha = .4 * env.fade; c.fillStyle = env.ink; c.font = `18px ${env.hand}`
    c.fillText('∂²φ/∂t² = c² ∇²φ', left + w * .06, horizon - 16)
  }
}

export const SKETCHES: Sketch[] = [
  { id: 'dna', name: 'DNA 双螺旋', tilt: .1, zoom: .5, camera: 2.8, create: dna, facts: [
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
  { id: 'higgs', name: '墨西哥帽势', tilt: -.5, zoom: .5, create: higgs, facts: [
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
  { id: 'dijkstra', name: 'Dijkstra 最短路径', tilt: -.72, zoom: .44, camera: 5, create: dijkstra, facts: [
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
  { id: 'life', name: '生命游戏', tilt: .8, create: life, facts: [
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
  { id: 'tree', name: '红黑树', tilt: .2, create: tree, facts: [
    'Red-black tree: every node is red or black; the root and the NIL leaves are black.',
    'A red node never has a red child.',
    'Every path from a node down to a leaf passes the same number of black nodes.',
    'Height ≤ 2 log₂(n + 1): search, insert and delete are O(log n).',
    'A rotation is O(1) and preserves the in-order sequence of keys.',
    'Insertion: colour the new node red, then recolour or rotate — at most two rotations.',
    'Deletion needs at most three rotations.',
    'Red-black trees are 2-3-4 trees in disguise (Guibas–Sedgewick, 1978).',
    'An AVL tree is more strictly balanced; a red-black tree rotates less on update.',
    'Catalan: the number of binary trees with n nodes is Cₙ = (2n)! / ((n + 1)! n!).',
  ] },
  { id: 'racks', name: 'GB300', tilt: .7, create: racks, facts: [
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
