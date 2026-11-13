// 流形、神经网络之外的画面：生物、物理、群论、算法。每个画面自己管动画，画在同一张慢慢自转的草稿上。
import type { Vec } from './manifolds.ts'

export type Project = (x: number, y: number, z: number) => [number, number, number]
export type Env = { context: CanvasRenderingContext2D; project: Project; t: number; fade: number; ink: string; red: string; hand: string; width: number; height: number }
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
  const [x, y] = env.project(at[0], at[1], at[2])
  env.context.globalAlpha = alpha * env.fade; env.context.fillStyle = color; env.context.font = `17px ${env.hand}`
  env.context.fillText(text, x + dx, y + dy)
}
function dotAt(env: Env, at: Vec, radius: number, alpha: number, color: string) {
  const [x, y] = env.project(at[0], at[1], at[2])
  env.context.globalAlpha = alpha * env.fade; env.context.fillStyle = color
  env.context.beginPath(); env.context.arc(x, y, radius, 0, TAU); env.context.fill()
}

// ---- DNA 双螺旋：自己拧着转，上端解旋成两条单链（复制叉上下游走） ----
function dna(): Painter {
  const STEPS = 150, TURNS = 3.1, R = .25, H = 1.95, PAIRS = 36, LEAN = .32
  const cl = Math.cos(LEAN), sl = Math.sin(LEAN)
  return env => {
    const spin = env.t / 11000 * TAU
    const fork = .42 + .26 * Math.sin(env.t / 8000)
    const at = (s: number, strand: number, reach = 1): Vec => {
      const y = (s - .5) * H, open = smooth((y - fork) / .4)
      const a = s * TURNS * TAU + spin + strand * 2.5
      const r = R * (1 + open * 1.25) * reach, x = r * Math.cos(a) + (strand ? 1 : -1) * open * .1
      return [x * cl - y * sl, x * sl + y * cl, r * Math.sin(a)]
    }
    const strands = new Layers(env.project), rungs = new Layers(env.project)
    for (let strand = 0; strand < 2; strand++) for (let k = 0; k < STEPS; k++) strands.line(at(k / STEPS, strand), at((k + 1) / STEPS, strand))
    for (let k = 0; k < PAIRS; k++) {
      const s = (k + .5) / PAIRS, open = smooth(((s - .5) * H - fork) / .4)
      const a = at(s, 0), b = at(s, 1)
      if (open < .12) rungs.line(a, b)
      else { rungs.line(a, mix(a, b, .5 - open * .32)); rungs.line(b, mix(b, a, .5 - open * .32)) }
    }
    strands.stroke(env, .12, .09, 1.5)
    rungs.stroke(env, .07, .06, 1)
    label(env, "5′", at(0, 0), .4, env.red, -18, 14); label(env, "3′", at(0, 1), .4, env.red, 8, 14)
    label(env, 'replication fork', at(.5 + fork / H, 1), .34, env.red, 16, 0)
  }
}

// ---- 洛伦兹吸引子：两条起点只差千分之一的轨道，先重合、后分道扬镳 ----
function lorenz(): Painter {
  const TRAIL = 1500
  const orbits = [{ p: [1, 1, 20] as Vec, trail: [] as Vec[] }, { p: [1.001, 1, 20] as Vec, trail: [] as Vec[] }]
  let done = 0
  const advance = () => {
    for (const orbit of orbits) {
      for (let k = 0; k < 2; k++) {
        const [x, y, z] = orbit.p, h = .004
        orbit.p = [x + 10 * (y - x) * h, y + (x * (28 - z) - y) * h, z + (x * y - 8 / 3 * z) * h]
      }
      orbit.trail.push([orbit.p[0] / 25, (orbit.p[2] - 25) / 25, orbit.p[1] / 25])
      if (orbit.trail.length > TRAIL) orbit.trail.shift()
    }
  }
  for (let k = 0; k < 500; k++) advance()
  return env => {
    const target = Math.floor(env.t / 16)
    if (target - done > 40) done = target - 40
    while (done < target) { advance(); done++ }
    orbits.forEach((orbit, which) => {
      const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], count = orbit.trail.length
      let previous: [number, number, number] | undefined
      orbit.trail.forEach((point, k) => {
        const here = env.project(point[0], point[1], point[2])
        if (previous) { const path = paths[Math.min(3, Math.floor(k / count * 4))]!; path.moveTo(previous[0], previous[1]); path.lineTo(here[0], here[1]) }
        previous = here
      })
      env.context.strokeStyle = which ? env.red : env.ink
      paths.forEach((path, level) => { env.context.globalAlpha = (which ? .05 + level * .07 : .06 + level * .08) * env.fade; env.context.lineWidth = 1 + level * .12; env.context.stroke(path) })
      dotAt(env, orbit.trail[count - 1]!, 3, .6, which ? env.red : env.ink)
    })
    label(env, 'x₀', orbits[0].trail.at(-1)!, .4); label(env, 'x₀ + ε', orbits[1].trail.at(-1)!, .45, env.red, 6, 14)
  }
}

// ---- A₅ 的凯莱图：截角二十面体。五边形的边是 5 阶生成元 b，连接两个五边形的边是对合 a；红点沿生成元随机游走 ----
function cayley(): Painter {
  const phi = (1 + Math.sqrt(5)) / 2, vertices: Vec[] = []
  for (const [a, b, c] of [[0, 1, 3 * phi], [1, 2 + phi, 2 * phi], [phi, 2, 2 * phi + 1]] as Vec[]) {
    for (let signs = 0; signs < 8; signs++) {
      const v: Vec = [signs & 1 ? -a : a, signs & 2 ? -b : b, signs & 4 ? -c : c]
      if (!a && signs & 1) continue
      vertices.push(v, [v[1], v[2], v[0]], [v[2], v[0], v[1]])
    }
  }
  const neighbours = vertices.map((v, i) => vertices.flatMap((w, j) => i !== j && Math.abs(dot(sub(v, w), sub(v, w)) - 4) < .01 ? [j] : []))
  // 每个顶点：两条五边形边夹角 108°（点积最大），剩下那条是对合边。
  const flip: number[] = [], next: number[] = []
  vertices.forEach((v, i) => {
    const n = neighbours[i]!, e = n.map(j => sub(vertices[j]!, v))
    const pairs = [[0, 1, 2], [0, 2, 1], [1, 2, 0]] as const
    const [p, q, a] = [...pairs].sort((x, y) => dot(e[y[0]]!, e[y[1]]!) - dot(e[x[0]]!, e[x[1]]!))[0]!
    flip[i] = n[a]!
    const centre = add(add(v, vertices[n[p]!]!), vertices[n[q]!]!)
    next[i] = dot(cross(v, vertices[n[p]!]!), centre) > 0 ? n[p]! : n[q]!
  })
  const scale = .92 / Math.hypot(...vertices[0]!)
  const points = vertices.map(v => mul(v, scale))
  const walk = [0], word: string[] = []
  return env => {
    const STEP = 800, steps = Math.floor(env.t / STEP)
    while (walk.length - 1 < steps) {
      const here = walk.at(-1)!, useFlip = word.at(-1) !== 'a' && Math.random() < .45
      walk.push(useFlip ? flip[here]! : next[here]!); word.push(useFlip ? 'a' : 'b')
      if (walk.length > 40) { walk.splice(0, 20); word.splice(0, 20) }
    }
    const pentagons = new Layers(env.project), flips = new Layers(env.project)
    points.forEach((p, i) => { pentagons.line(p, points[next[i]!]!); if (flip[i]! > i) flips.line(p, points[flip[i]!]!) })
    pentagons.stroke(env, .08, .08, 1.1)
    env.context.setLineDash([4, 4]); flips.stroke(env, .07, .07, 1); env.context.setLineDash([])
    // 走过的路：越新越深；最后一步正在走。
    const within = (env.t % STEP) / STEP, tail = walk.slice(-13)
    env.context.strokeStyle = env.red; env.context.lineWidth = 1.8
    let head = points[tail[0]!]!
    for (let k = 1; k < tail.length; k++) {
      const a = points[tail[k - 1]!]!, last = k === tail.length - 1, b = last ? mix(a, points[tail[k]!]!, smooth(within * 1.4)) : points[tail[k]!]!
      const p = env.project(a[0], a[1], a[2]), q = env.project(b[0], b[1], b[2])
      env.context.globalAlpha = (.08 + .42 * k / tail.length) * env.fade
      env.context.beginPath(); env.context.moveTo(p[0], p[1]); env.context.lineTo(q[0], q[1]); env.context.stroke()
      head = b
    }
    dotAt(env, head, 3.4, .7, env.red)
    label(env, 'g', head, .5, env.red)
    env.context.globalAlpha = .42 * env.fade; env.context.fillStyle = env.ink; env.context.font = `18px ${env.hand}`
    env.context.fillText(`g = … ${word.slice(-9).join(' ')}`, env.width * .06, env.height * .8)
    env.context.fillText('a² = b⁵ = (ab)³ = e', env.width * .06, env.height * .8 + 24)
  }
}

// ---- 墨西哥帽势：小球从帽顶滚进谷底（对称性自发破缺），径向振荡是希格斯模，沿谷绕圈是戈德斯通模 ----
function higgs(): Painter {
  const HEIGHT = .6, WIDE = .72, CYCLE = 26000
  const surface = (r: number, a: number, lift = 0): Vec => [r * Math.cos(a) * WIDE, HEIGHT * (r * r - 1) ** 2 - .32 + lift, r * Math.sin(a) * WIDE]
  const ball = (seconds: number, start: number): Vec => {
    const u = seconds - 1.4
    if (u <= 0) return surface(.03, start, .035)
    const r = 1 - Math.exp(-u / 2.8) * Math.cos(2.5 * u)
    return surface(r, start + .6 * (u - 2.8 * (1 - Math.exp(-u / 2.8))), .035)
  }
  return env => {
    const mesh = new Layers(env.project)
    for (let k = 1; k <= 10; k++) { const r = k / 10 * 1.42; for (let s = 0; s < 40; s++) mesh.line(surface(r, s / 40 * TAU), surface(r, (s + 1) / 40 * TAU)) }
    for (let s = 0; s < 18; s++) for (let k = 0; k < 14; k++) mesh.line(surface(k / 14 * 1.42, s / 18 * TAU), surface((k + 1) / 14 * 1.42, s / 18 * TAU))
    mesh.stroke(env, .05, .06, 1)
    // 谷底的一圈：简并的真空。
    const valley = new Layers(env.project)
    for (let s = 0; s < 60; s += 2) valley.line(surface(1, s / 60 * TAU, .004), surface(1, (s + 1) / 60 * TAU, .004))
    valley.stroke(env, .14, .1, 1.3, env.red)
    const cycle = Math.floor(env.t / CYCLE), seconds = (env.t % CYCLE) / 1000, start = hash(cycle) * TAU
    const leaving = clamp((CYCLE / 1000 - seconds) / 1.5, 0, 1)
    env.context.strokeStyle = env.red; env.context.lineWidth = 1.6
    for (let k = 0; k < 40; k++) {
      const a = ball(seconds - (k + 1) * .09, start), b = ball(seconds - k * .09, start)
      const p = env.project(a[0], a[1], a[2]), q = env.project(b[0], b[1], b[2])
      env.context.globalAlpha = .4 * (1 - k / 40) * leaving * env.fade
      env.context.beginPath(); env.context.moveTo(p[0], p[1]); env.context.lineTo(q[0], q[1]); env.context.stroke()
    }
    dotAt(env, ball(seconds, start), 5, .75 * leaving, env.red)
    label(env, 'V(φ) = λ(|φ|² − v²)²', surface(1.42, .5), .42)
    label(env, '|φ| = v', surface(1, 2.6), .42, env.red)
  }
}

// ---- Dijkstra：从 s 一圈圈向外确定最短距离，到 t 后描出最短路径，再换一对起点终点 ----
function dijkstra(): Painter {
  const COLS = 9, ROWS = 6, TICK = 170, HOLD = 5000
  type Run = { order: number[]; previous: Int16Array; path: number[]; source: number; target: number; started: number }
  let nodes: Vec[] = [], edges: [number, number][] = [], near: number[][] = [], run: Run | undefined, runs = 0
  const build = (seed: number) => {
    nodes = []; edges = []
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) nodes.push([(c / (COLS - 1) - .5) * 2.3 + (hash(seed + r * 31 + c) - .5) * .16, 0, (r / (ROWS - 1) - .5) * 1.45 + (hash(seed + 500 + r * 31 + c) - .5) * .16])
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c
      if (c + 1 < COLS && hash(seed + i * 3) < .78) edges.push([i, i + 1])
      if (r + 1 < ROWS && hash(seed + i * 3 + 1) < .78) edges.push([i, i + COLS])
      if (c + 1 < COLS && r + 1 < ROWS && hash(seed + i * 3 + 2) < .3) edges.push(hash(seed + i) < .5 ? [i, i + COLS + 1] : [i + 1, i + COLS])
    }
    near = nodes.map(() => [])
    for (const [a, b] of edges) { near[a]!.push(b); near[b]!.push(a) }
  }
  const begin = (now: number) => {
    if (runs % 3 === 0) build(runs * 17 + 1)
    const source = Math.floor(hash(runs * 5 + 2) * ROWS) * COLS, target = Math.floor(hash(runs * 5 + 3) * ROWS) * COLS + COLS - 1
    const distance = new Float32Array(nodes.length).fill(Infinity), previous = new Int16Array(nodes.length).fill(-1), settled = new Uint8Array(nodes.length), order: number[] = []
    distance[source] = 0
    for (;;) {
      let best = -1
      for (let i = 0; i < nodes.length; i++) if (!settled[i] && distance[i]! < Infinity && (best < 0 || distance[i]! < distance[best]!)) best = i
      if (best < 0) break
      settled[best] = 1; order.push(best)
      if (best === target) break
      for (const j of near[best]!) { const d = distance[best]! + Math.hypot(...sub(nodes[j]!, nodes[best]!)); if (d < distance[j]!) { distance[j] = d; previous[j] = best } }
    }
    const path: number[] = []
    if (settled[target]) for (let i = target; i >= 0; i = previous[i]!) path.push(i)
    runs++
    run = { order, previous, path, source, target, started: now }
  }
  return env => {
    if (!run || env.t - run.started > run.order.length * TICK + HOLD) begin(env.t)
    const state = run!, count = Math.min(state.order.length, Math.floor((env.t - state.started) / TICK) + 1), finished = count >= state.order.length
    const all = new Layers(env.project), tree = new Layers(env.project)
    for (const [a, b] of edges) all.line(nodes[a]!, nodes[b]!)
    all.stroke(env, .07, .05, 1)
    const settled = new Uint8Array(nodes.length)
    for (let k = 0; k < count; k++) { const i = state.order[k]!; settled[i] = 1; if (state.previous[i]! >= 0) tree.line(nodes[i]!, nodes[state.previous[i]!]!) }
    tree.stroke(env, .16, .07, 1.3, env.red)
    if (finished && state.path.length > 1) {
      const shown = clamp((env.t - state.started - state.order.length * TICK) / 900, 0, 1) * (state.path.length - 1)
      env.context.strokeStyle = env.red; env.context.lineWidth = 2.6; env.context.globalAlpha = .55 * env.fade
      env.context.beginPath()
      const reversed = [...state.path].reverse()
      reversed.forEach((i, k) => {
        if (k > shown + 1) return
        const from = nodes[reversed[Math.max(0, k - 1)]!]!, point = k > shown ? mix(from, nodes[i]!, shown - (k - 1)) : nodes[i]!
        const [x, y] = env.project(point[0], point[1], point[2]); if (k) env.context.lineTo(x, y); else env.context.moveTo(x, y)
      })
      env.context.stroke()
    }
    const open = new Path2D(), closed = new Path2D()
    nodes.forEach((node, i) => { const [x, y] = env.project(node[0], node[1], node[2]); const path = settled[i] ? closed : open; path.moveTo(x + 3.2, y); path.arc(x, y, 3.2, 0, TAU) })
    env.context.strokeStyle = env.ink; env.context.lineWidth = 1; env.context.globalAlpha = .26 * env.fade; env.context.stroke(open)
    env.context.fillStyle = env.red; env.context.globalAlpha = .45 * env.fade; env.context.fill(closed)
    if (!finished) { const [x, y] = env.project(...nodes[state.order[count - 1]!]!); env.context.strokeStyle = env.red; env.context.globalAlpha = .5 * env.fade; env.context.beginPath(); env.context.arc(x, y, 7, 0, TAU); env.context.stroke() }
    label(env, 's', nodes[state.source]!, .5, env.red, -16, -6); label(env, 't', nodes[state.target]!, .5, env.red, 8, -6)
  }
}

// ---- 康威生命游戏：环面上的随机汤，演化到沉寂就重新撒一把 ----
function life(): Painter {
  const W = 46, H = 30, TICK = 230, CELL = 2.3 / W
  let cells = new Uint8Array(W * H), generation = 0, seeded = 0, calm = 0, population = 0
  const seed = () => { for (let i = 0; i < cells.length; i++) cells[i] = Math.random() < .3 ? 1 : 0; seeded = generation; calm = 0 }
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
    cells = out; population = alive; generation++
    if (alive < 14 || calm > 45 || generation - seeded > 700) seed()
  }
  seed()
  for (let k = 0; k < 6; k++) step()
  let done = 0
  return env => {
    const target = Math.floor(env.t / TICK)
    if (target - done > 3) done = target - 3
    while (done < target) { step(); done++ }
    const quads = new Path2D(), at = (x: number, y: number) => env.project((x - W / 2) * CELL, 0, (y - H / 2) * CELL)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!cells[y * W + x]) continue
      const a = at(x + .12, y + .12), b = at(x + .88, y + .12), c = at(x + .88, y + .88), d = at(x + .12, y + .88)
      quads.moveTo(a[0], a[1]); quads.lineTo(b[0], b[1]); quads.lineTo(c[0], c[1]); quads.lineTo(d[0], d[1]); quads.closePath()
    }
    env.context.fillStyle = env.ink; env.context.globalAlpha = .2 * env.fade; env.context.fill(quads)
    env.context.strokeStyle = env.ink; env.context.globalAlpha = .14 * env.fade; env.context.lineWidth = 1; env.context.setLineDash([5, 4])
    env.context.beginPath()
    ;[[0, 0], [W, 0], [W, H], [0, H]].forEach(([x, y], k) => { const p = at(x!, y!); if (k) env.context.lineTo(p[0], p[1]); else env.context.moveTo(p[0], p[1]) })
    env.context.closePath(); env.context.stroke(); env.context.setLineDash([])
    env.context.globalAlpha = .4 * env.fade; env.context.font = `17px ${env.hand}`
    env.context.fillText(`generation ${generation - seeded}`, env.width * .06, env.height * .84)
  }
}

// ---- 分形二叉树：每一级分叉都绕着自己的母枝转，张角缓缓开合；十级自相似 ----
function tree(): Painter {
  const DEPTH = 10, RATIO = .73
  return env => {
    const levels = Array.from({ length: DEPTH + 1 }, () => new Path2D())
    const spread = .5 + .2 * Math.sin(env.t / 7000), twist = 1.2 + env.t / 16000 * TAU
    const ct = Math.cos(twist), st = Math.sin(twist), ca = Math.cos(spread), sa = Math.sin(spread)
    const limit = Math.ceil(env.fade * DEPTH)
    const grow = (from: Vec, direction: Vec, reference: Vec, length: number, depth: number) => {
      const to = add(from, mul(direction, length))
      const p = env.project(from[0], from[1], from[2]), q = env.project(to[0], to[1], to[2])
      levels[depth]!.moveTo(p[0], p[1]); levels[depth]!.lineTo(q[0], q[1])
      if (depth >= limit) return
      const side = add(mul(reference, ct), mul(cross(direction, reference), st)), across = cross(direction, side)
      grow(to, add(mul(direction, ca), mul(side, sa)), across, length * RATIO, depth + 1)
      grow(to, add(mul(direction, ca), mul(side, -sa)), across, length * RATIO, depth + 1)
    }
    grow([0, -.95, 0], [0, 1, 0], [1, 0, 0], .46, 0)
    env.context.strokeStyle = env.ink
    levels.forEach((path, depth) => { env.context.globalAlpha = (.34 - depth * .023) * env.fade; env.context.lineWidth = Math.max(.7, 2.1 * RATIO ** depth); env.context.stroke(path) })
    label(env, 'θ', [0, -.44, 0], .45, env.red, 8, -10)
  }
}

// ---- 机柜阵列上的波：几百个机柜排成格点，水滴落下，一圈圈起伏传开——场是每个格点上的自由度 ----
function racks(): Painter {
  const NX = 24, NZ = 15, DX = 2.5 / NX, DZ = 1.56 / NZ, HX = DX * .2, HZ = DZ * .3, TALL = .11, EVERY = 3400
  return env => {
    const seconds = env.t / 1000, latest = Math.floor(env.t / EVERY)
    const drops = [0, 1, 2, 3].map(k => latest - k).filter(k => k >= 0).map(k => ({ x: (hash(k * 2.3 + 1) - .5) * 2, z: (hash(k * 2.3 + 2) - .5) * 1.2, age: seconds - k * EVERY / 1000 }))
    const height = (x: number, z: number) => {
      let y = 0
      for (const drop of drops) { const d = Math.hypot(x - drop.x, z - drop.z) - .34 * drop.age; y += .12 * Math.cos(15 * d) * Math.exp(-((d / .3) ** 2) - drop.age / 6) }
      return y
    }
    const boxes = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], lamps = new Path2D()
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const x = (i + .5 - NX / 2) * DX, z = (j + .5 - NZ / 2) * DZ, y = height(x, z)
      const corner = (sx: number, sz: number, up: number) => env.project(x + sx * HX, y + up * TALL, z + sz * HZ)
      const low = [corner(-1, -1, 0), corner(1, -1, 0), corner(1, 1, 0), corner(-1, 1, 0)], high = [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)]
      const path = boxes[clamp(Math.floor(high[0]![2] * 4), 0, 3)]!
      for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4
        path.moveTo(low[k]![0], low[k]![1]); path.lineTo(high[k]![0], high[k]![1]); path.lineTo(high[n]![0], high[n]![1])
        path.moveTo(low[k]![0], low[k]![1]); path.lineTo(low[n]![0], low[n]![1])
      }
      // 柜门上的两道横档（计算托盘之间的分隔）。
      for (const up of [.36, .68]) { const a = corner(-1, 1, up), b = corner(1, 1, up), c = corner(1, -1, up); path.moveTo(a[0], a[1]); path.lineTo(b[0], b[1]); path.lineTo(c[0], c[1]) }
      if (y > .028) { const top = corner(0, 0, 1); lamps.moveTo(top[0] + 1.8, top[1]); lamps.arc(top[0], top[1], 1.8, 0, TAU) }
    }
    env.context.strokeStyle = env.ink
    boxes.forEach((path, level) => { env.context.globalAlpha = (.07 + level * .055) * env.fade; env.context.lineWidth = .8 + level * .08; env.context.stroke(path) })
    env.context.fillStyle = env.red; env.context.globalAlpha = .55 * env.fade; env.context.fill(lamps)
    env.context.globalAlpha = .4 * env.fade; env.context.fillStyle = env.ink; env.context.font = `17px ${env.hand}`
    env.context.fillText('∂²φ/∂t² = c² ∇²φ', env.width * .06, env.height * .84)
  }
}

export const SKETCHES: Sketch[] = [
  { id: 'dna', name: 'DNA 双螺旋', tilt: .18, create: dna, facts: [
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
  { id: 'cayley', name: '凯莱图 A₅', tilt: .36, create: cayley, facts: [
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
  { id: 'dijkstra', name: 'Dijkstra 最短路径', tilt: .92, zoom: .42, camera: 5, create: dijkstra, facts: [
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
  { id: 'life', name: '生命游戏', tilt: .92, zoom: .42, camera: 5, create: life, facts: [
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
  { id: 'tree', name: '分形二叉树', tilt: .2, create: tree, facts: [
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
  { id: 'racks', name: '机柜阵列上的波', tilt: .7, zoom: .42, camera: 5, create: racks, facts: [
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
