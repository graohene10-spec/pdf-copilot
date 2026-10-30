<script setup lang="ts">
// 铅笔草稿的格子纸上，一个铅笔画的流形或神经网络慢慢自转（四分钟一圈），旁边缓缓浮现英文的定理、定义。
// 流形上的一部分知识直接画在曲面上（切平面、坐标基、法向量、度量圆、坐标卡、Stokes 边界、积分曲线、测地线、指数映射、平行移动、密切圆、主方向）；
// 神经网络则演示训练：前向传播的信号一层层走过去，反向传播的梯度（红笔）一层层走回来，权重随之变化，歇 5 秒再来下一轮；角落里画损失曲线。
// 每隔 4–8 分钟随机换一个画面，换的时候像重新画一遍。每秒 30 帧，窗口不可见时停下。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { manifoldById, nextManifold, buildMesh, THEOREMS, type Mesh, type Note as Knowledge, type Visual, type Vec } from '../sketch/manifolds'
import { networkById, ML_FACTS, type Graph } from '../sketch/networks'

const props = defineProps<{ shapes: string[] }>()

const canvas = ref<HTMLCanvasElement>()
const current = ref<string>()
type Note = { key: number; text: string; slot: number; drawn: boolean; leaving: boolean }
const notes = ref<Note[]>([])

const PERIOD = 240000 // 一整圈四分钟
const DRAW_IN = 2600 // 换画面时「画出来」的时长
const FRAME = 1000 / 30
const SLOTS = 5 // 三条在场、一条正在淡去，新的一条总有空位
const NOTE_EVERY = 9000 // 每 9 秒写一条
const NOTE_STAYS = 25000 // 每条停留 25 秒（加上缓慢的浮现与淡去，同时最多三条）
const NOTE_MAX = 3
const RECENT = 40 // 最近写过的这么多条不再重复（跨画面也算）
const STEP = 5200 // 一次训练迭代：前向一半，反向一半
const REST = 5000 // 每轮迭代之后歇 5 秒，再开始下一轮
const SURFACE_VISUALS: Visual[] = ['tangent', 'basis', 'normal', 'metric', 'chart', 'stokes', 'field', 'curve', 'geodesic', 'exp', 'transport', 'curvature', 'principal']
const CURVE_VISUALS: Visual[] = ['field', 'curve']

let mesh: Mesh | undefined
let graph: Graph | undefined
let baseTilt = .42
let jitter: Float32Array | undefined
let frame = 0, last = 0, start = 0, drawnAt = 0, width = 0, height = 0, ratio = 1
let switchTimer: ReturnType<typeof setTimeout> | undefined
let noteTimer: ReturnType<typeof setTimeout> | undefined
let noteKey = 0, slotIndex = 0
let bag: Knowledge[] = []
const recent: string[] = []
let ink = '#2e2d2a', red = '#c8553d'
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
const timers = new Set<ReturnType<typeof setTimeout>>()

/** 画在流形上的示意：在哪块曲面、哪个参数点，什么时候出现 / 开始淡出。 */
type Drawing = { visual: Visual; patch: number; u: number; v: number; curve: number; t: number; born: number; fading: number }
let drawing: Drawing | undefined

/** 神经网络的训练状态：每条连线的权重（反向传播经过时从旧值变到新值）、这一步被加强的连线（会闪一下）、迭代次数、损失曲线。 */
type Training = { from: Float32Array; to: Float32Array; flash: Uint8Array; step: number; losses: number[] }
let training: Training | undefined

// 每个顶点固定一点手抖（两遍笔画各一份），线条稳定地「不直」，不会逐帧闪。
function seeded(count: number) {
  let seed = 7
  const out = new Float32Array(count * 4)
  for (let k = 0; k < out.length; k++) { seed = (seed * 16807) % 2147483647; out[k] = (seed / 2147483647 - .5) * 1.6 }
  return out
}

function later(callback: () => void, delay: number) {
  const timer = setTimeout(() => { timers.delete(timer); callback() }, delay)
  timers.add(timer)
  return timer
}

function choose(id: string | undefined) {
  if (!id) return
  const manifold = manifoldById(id), network = networkById(id)
  if (!manifold && !network) return
  current.value = id
  mesh = manifold ? buildMesh(manifold) : undefined
  graph = network ? network.build() : undefined
  training = graph ? newTraining(graph) : undefined
  baseTilt = manifold?.tilt ?? (network ? .32 : .42)
  jitter = seeded(mesh ? mesh.points.length / 3 : graph!.nodes.length / 3)
  drawnAt = performance.now()
  bag = []
  if (drawing) drawing.fading = drawnAt
  for (const note of notes.value) note.leaving = true
  scheduleSwitch()
}

function scheduleSwitch() {
  clearTimeout(switchTimer)
  if (props.shapes.length < 2 || reduced.matches) return
  // 4–8 分钟随机换一个画面。
  switchTimer = setTimeout(() => choose(nextManifold(props.shapes, current.value)), 240000 + Math.random() * 240000)
}

function resize() {
  const element = canvas.value
  if (!element) return
  const box = element.getBoundingClientRect()
  ratio = 1 // 铅笔线本来就软，背景按 1 倍分辨率画，大画布也省
  width = box.width; height = box.height
  element.width = Math.max(1, Math.round(width * ratio))
  element.height = Math.max(1, Math.round(height * ratio))
}

function readInk() {
  const style = getComputedStyle(document.documentElement)
  ink = style.getPropertyValue('--pencil').trim() || '#2e2d2a'
  red = style.getPropertyValue('--red-pencil').trim() || '#c8553d'
}

// ---- 向量小工具 ----
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec): Vec => scale(a, 1 / (Math.hypot(...a) || 1))

type Project = (x: number, y: number, z: number) => [number, number, number]

function draw(now: number) {
  const element = canvas.value, context = element?.getContext('2d')
  if (!element || !context || !jitter || (!mesh && !graph)) return
  const angle = reduced.matches ? .6 : ((now - start) / PERIOD) * Math.PI * 2
  const tilt = baseTilt + Math.sin(angle * .5) * .05
  const ca = Math.cos(angle), sa = Math.sin(angle), ct = Math.cos(tilt), st = Math.sin(tilt)
  // 神经网络比流形稀疏，画得更大一些占住画面；透视也放缓，转到近处时不至于冲出画布。
  const size = Math.min(width * .62, height) * (graph ? .64 : .46), cx = width * .56, cy = height * .52, camera = graph ? 5 : 3.4
  // 把模型坐标投到画布：绕竖轴自转，再向前倾一点，看得到上面。
  const project: Project = (x, y, z) => {
    const x1 = x * ca + z * sa, z1 = -x * sa + z * ca
    const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct
    const perspective = camera / (camera + z2)
    return [cx + x1 * size * perspective, cy - y2 * size * perspective, (1 - z2) / 2]
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = ink
  // 换画面时线一条条画出来。
  const reveal = reduced.matches ? 1 : Math.min(1, (now - drawnAt) / DRAW_IN)
  if (mesh) drawMesh(context, mesh, project, reveal)
  else if (graph && training) drawNetwork(context, graph, training, project, reveal, now)
  if (mesh && drawing && reveal >= 1) drawVisual(context, drawing, now, project)
  context.globalAlpha = 1
}

function drawMesh(context: CanvasRenderingContext2D, { points, lines, closed }: Mesh, project: Project, reveal: number) {
  const count = points.length / 3
  const sx = new Float32Array(count), sy = new Float32Array(count), depth = new Float32Array(count)
  for (let k = 0; k < count; k++) {
    const [x, y, d] = project(points[k * 3]!, points[k * 3 + 1]!, points[k * 3 + 2]!)
    sx[k] = x; sy[k] = y; depth[k] = d
  }
  const visible = Math.ceil(lines.length * reveal)
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()]
  for (let l = 0; l < visible; l++) {
    const line = lines[l]!, steps = closed[l] ? line.length : line.length - 1
    for (let s = 0; s < steps; s++) {
      const a = line[s]!, b = line[(s + 1) % line.length]!
      const path = paths[Math.min(3, Math.max(0, Math.floor((depth[a]! + depth[b]!) * 2)))]!
      path.moveTo(sx[a]! + jitter![a * 4]!, sy[a]! + jitter![a * 4 + 1]!)
      path.lineTo(sx[b]! + jitter![b * 4]!, sy[b]! + jitter![b * 4 + 1]!)
    }
  }
  // 只是背景：整体很淡，远处的线更淡，不和书页、卡片抢眼。
  paths.forEach((path, level) => {
    context.globalAlpha = .06 + level * .085
    context.lineWidth = .9 + level * .1
    context.stroke(path)
  })
}

// ---- 神经网络与训练 ----
const FLASH_RISE = 120, FLASH_FADE = 700 // 连线被加强时闪一下：120 ms 亮起，700 ms 淡回去

function newTraining(net: Graph): Training {
  const from = initialWeights(net)
  const state: Training = { from, to: from, flash: new Uint8Array(from.length), step: 0, losses: [] }
  planUpdate(net, state)
  return state
}

function initialWeights(net: Graph) {
  return net.attention ? attentionWeights(net, 1) : Float32Array.from({ length: net.edges.length / 2 }, () => Math.random() * 2 - 1)
}

// 注意力权重：每个词元对所有词元的一行 softmax，越训练越「尖」。连线顺序与 networks.ts 一致：行 → 头 → i → j。
function attentionWeights(net: Graph, sharpness: number) {
  const tokens = net.attention!.tokens, out = new Float32Array(net.edges.length / 2)
  for (let m = 0; m < net.attention!.rows * 2; m++) {
    for (let i = 0; i < tokens; i++) {
      const logits = Array.from({ length: tokens }, (_, j) => (Math.random() * 2 + (i === j ? .8 : 0)) * sharpness)
      const max = Math.max(...logits), exps = logits.map(value => Math.exp(value - max)), sum = exps.reduce((x, y) => x + y, 0)
      exps.forEach((value, j) => { out[m * tokens * tokens + i * tokens + j] = Math.min(1, value / sum * tokens * .7) })
    }
  }
  return out
}

/** 算出这一步要更新到的权重，并挑出每层加强最多的几条连线（每层最多约一成、不超过 16 条），反向传播经过时让它们闪一下。 */
function planUpdate(net: Graph, state: Training) {
  const rate = Math.max(.16, .55 / Math.sqrt(state.step + 1))
  state.to = net.attention
    ? attentionWeights(net, 1 + Math.min(2.5, state.step / 25))
    : Float32Array.from(state.from, w => Math.max(-1, Math.min(1, w + (Math.random() * 2 - 1) * rate)))
  const gains = Float32Array.from(state.to, (w, e) => Math.abs(w) - Math.abs(state.from[e]!))
  const sizes = new Uint16Array(net.stages), taken = new Uint16Array(net.stages)
  for (const stage of net.stage) sizes[stage]++
  state.flash = new Uint8Array(gains.length)
  for (const e of Array.from(gains.keys()).sort((a, b) => gains[b]! - gains[a]!)) {
    const stage = net.stage[e]!
    if (gains[e]! < .06) break
    if (taken[stage]! >= Math.min(16, Math.max(3, Math.ceil(sizes[stage]! * .1)))) continue
    taken[stage]++
    state.flash[e] = 1
  }
}

/** 一次迭代结束：新权重落定，记下这一步的损失，再计划下一步。 */
function stepTraining(net: Graph, state: Training) {
  state.step++
  state.from = state.to
  const loss = 2.3 * Math.exp(-state.step / 22) + .18 + (Math.random() - .5) * .16 * Math.exp(-state.step / 60)
  state.losses.push(Math.max(.05, loss))
  if (state.losses.length > 120) state.losses.shift()
  planUpdate(net, state)
}

function drawNetwork(context: CanvasRenderingContext2D, net: Graph, state: Training, project: Project, reveal: number, now: number) {
  const elapsed = now - drawnAt
  const step = Math.floor(elapsed / (STEP + REST))
  while (state.step < step) stepTraining(net, state)
  const time = elapsed % (STEP + REST) // 0–STEP/2 前向，STEP/2–STEP 反向，之后歇着
  const forward = time < STEP / 2, resting = time >= STEP
  // 反向传播从输出层一层层往回走；走到哪一层，那一层的权重就更新。歇着的时候闪光慢慢淡完。
  const backTime = forward ? 0 : time - STEP / 2
  const back = Math.min(1, backTime / (STEP / 2))
  const progress = forward ? time / (STEP / 2) : back
  const stageStart = (stage: number) => (net.stages - 1 - stage) / net.stages // 反向时这一层开始更新的进度
  const count = net.nodes.length / 3
  const sx = new Float32Array(count), sy = new Float32Array(count), depth = new Float32Array(count)
  for (let k = 0; k < count; k++) {
    const [x, y, d] = project(net.nodes[k * 3]!, net.nodes[k * 3 + 1]!, net.nodes[k * 3 + 2]!)
    sx[k] = x + jitter![k * 4]!; sy[k] = y + jitter![k * 4 + 1]!; depth[k] = d
  }
  const edges = net.edges.length / 2, visible = Math.ceil(edges * reveal)
  // 连线：权重越大越深，整体很浅，密的地方也看得清结构。四档深浅各一条路径；刚被加强的连线另画三档闪光。
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()]
  const flashes = [new Path2D(), new Path2D(), new Path2D()]
  const updated = (e: number) => forward ? 0 : Math.max(0, Math.min(1, (back - stageStart(net.stage[e]!)) * net.stages))
  const weight = (e: number) => { const u = updated(e); return Math.abs(state.from[e]! + (state.to[e]! - state.from[e]!) * u * u * (3 - 2 * u)) }
  const flash = (e: number) => {
    if (forward || !state.flash[e]) return 0
    const since = backTime - stageStart(net.stage[e]!) * STEP / 2
    return since < 0 ? 0 : since < FLASH_RISE ? since / FLASH_RISE : Math.max(0, 1 - (since - FLASH_RISE) / FLASH_FADE)
  }
  const curve = (path: Path2D, e: number, a: number, b: number) => {
    const bend = net.bend[e]!
    if (!bend) { path.moveTo(sx[a]!, sy[a]!); path.lineTo(sx[b]!, sy[b]!); return }
    // 注意力头：中点沿 z 鼓出去，画成一段弧。
    const mid = (k: number) => (net.nodes[a * 3 + k]! + net.nodes[b * 3 + k]!) / 2
    const [mx, my] = project(mid(0), mid(1), mid(2) + bend)
    path.moveTo(sx[a]!, sy[a]!); path.quadraticCurveTo(2 * mx - (sx[a]! + sx[b]!) / 2, 2 * my - (sy[a]! + sy[b]!) / 2, sx[b]!, sy[b]!)
  }
  for (let e = 0; e < visible; e++) {
    const a = net.edges[e * 2]!, b = net.edges[e * 2 + 1]!
    const glow = reduced.matches ? 0 : flash(e)
    if (glow > .05) { curve(flashes[Math.min(2, Math.floor(glow * 3))]!, e, a, b); continue }
    const level = Math.min(3, Math.floor(weight(e) * 3 + (depth[a]! + depth[b]!) * .3))
    curve(paths[level]!, e, a, b)
  }
  paths.forEach((path, level) => { context.globalAlpha = .018 + level * .03; context.lineWidth = .6 + level * .2; context.stroke(path) })
  flashes.forEach((path, level) => { context.globalAlpha = .12 + level * .1; context.lineWidth = 1 + level * .25; context.stroke(path) })
  // 外框：特征图、注意力块、编码 z。
  context.globalAlpha = .11; context.lineWidth = 1
  context.setLineDash([5, 4])
  for (const frame of net.frames) {
    context.beginPath()
    frame.forEach((p, k) => { const [x, y] = project(p[0], p[1], p[2]); if (k) context.lineTo(x, y); else context.moveTo(x, y) })
    context.closePath(); context.stroke()
  }
  context.setLineDash([])
  // 神经元：小圆圈；前向信号经过时轻轻点亮。
  const active = forward ? Math.floor(progress * net.stages) : net.stages - 1 - Math.floor(progress * net.stages)
  const within = (progress * net.stages) % 1
  context.globalAlpha = .26; context.lineWidth = 1
  const circles = new Path2D()
  for (let k = 0; k < count; k++) { circles.moveTo(sx[k]! + 3.2, sy[k]!); circles.arc(sx[k]!, sy[k]!, 3.2, 0, Math.PI * 2) }
  context.stroke(circles)
  if (reveal < 1 || reduced.matches) return
  if (resting) { drawLoss(context, state); return }
  // 信号：前向是铅笔点，沿着这一步的连线从左走到右；反向是红点，沿着连线走回来。
  context.fillStyle = forward ? ink : red
  context.globalAlpha = .45
  const dots = new Path2D()
  let shown = 0
  for (let e = 0; e < edges && shown < 90; e++) {
    if (net.stage[e] !== active || weight(e) < .35) continue
    if ((e * 7) % 3 && edges > 300) continue // 连线很多时只挑一部分画信号
    const a = net.edges[e * 2]!, b = net.edges[e * 2 + 1]!
    const t = forward ? within : 1 - within
    const x = sx[a]! + (sx[b]! - sx[a]!) * t, y = sy[a]! + (sy[b]! - sy[a]!) * t
    dots.moveTo(x + 2.2, y); dots.arc(x, y, 2.2, 0, Math.PI * 2)
    shown++
  }
  context.fill(dots)
  // CNN：卷积核在输入上滑动，框出当前的 3×3 窗口。
  if (net.kernel && forward && active === 0) {
    const patch = net.kernel.outputs[Math.floor(within * net.kernel.outputs.length) % net.kernel.outputs.length]!
    context.strokeStyle = red; context.globalAlpha = .4; context.lineWidth = 1.2
    const xs = patch.map(i => sx[i]!), ys = patch.map(i => sy[i]!)
    context.strokeRect(Math.min(...xs) - 5, Math.min(...ys) - 5, Math.max(...xs) - Math.min(...xs) + 10, Math.max(...ys) - Math.min(...ys) + 10)
    context.strokeStyle = ink
  }
  drawLoss(context, state)
}

// 左下角的损失曲线：随训练下降、带一点噪声；标上迭代次数。
function drawLoss(context: CanvasRenderingContext2D, state: Training) {
  if (state.losses.length < 2) return
  const w = Math.min(220, width * .26), h = 80, x0 = width * .06, y0 = height * .84
  context.save()
  context.globalAlpha = .3; context.lineWidth = 1; context.strokeStyle = ink
  context.beginPath(); context.moveTo(x0, y0 - h); context.lineTo(x0, y0); context.lineTo(x0 + w, y0); context.stroke()
  const max = 2.6
  context.globalAlpha = .45; context.strokeStyle = red; context.lineWidth = 1.3
  context.beginPath()
  const span = Math.max(30, state.losses.length - 1) // 横轴随训练拉长，最多保留 120 步
  state.losses.forEach((loss, k) => { const x = x0 + (k / span) * w, y = y0 - (loss / max) * h; if (k) context.lineTo(x, y); else context.moveTo(x, y) })
  context.stroke()
  context.globalAlpha = .4; context.fillStyle = ink; context.font = `15px Caveat, 'Long Cang', cursive`
  context.fillText('loss', x0 + 6, y0 - h + 4)
  context.fillText(`step ${state.step}`, x0 + w - 48, y0 + 16)
  context.restore()
}

// ---- 画在流形上的示意 ----
type Surface = (u: number, v: number) => Vec
type Domain = { u: [number, number]; v: [number, number]; wrapU?: boolean; wrapV?: boolean }
// 首尾相接的参数（环面、纽结管）走出范围时绕回另一头。
const wrap = (value: number, [low, high]: [number, number]) => low + ((((value - low) % (high - low)) + (high - low)) % (high - low))
const partials = (f: Surface, domain: Domain, u: number, v: number) => {
  const du = (domain.u[1] - domain.u[0]) * 1e-3, dv = (domain.v[1] - domain.v[0]) * 1e-3
  return [scale(sub(f(u + du, v), f(u - du, v)), 1 / (2 * du)), scale(sub(f(u, v + dv), f(u, v - dv)), 1 / (2 * dv))] as const
}
const normalAt = (f: Surface, domain: Domain, u: number, v: number) => { const [fu, fv] = partials(f, domain, u, v); return unit(cross(fu, fv)) }

/** 曲面上的测地线：沿切方向走一小步，把位移换算成参数增量（解第一基本形式），再把方向投影回新的切平面——离散的平行移动。 */
function geodesic(f: Surface, domain: Domain, u: number, v: number, direction: Vec, length: number, steps = 36): Vec[] {
  const points = [f(u, v)], h = length / steps
  let d = direction
  for (let k = 0; k < steps; k++) {
    const [fu, fv] = partials(f, domain, u, v)
    const E = dot(fu, fu), F = dot(fu, fv), G = dot(fv, fv), det = E * G - F * F
    if (!(det > 1e-12)) break
    const x = dot(fu, d) * h, y = dot(fv, d) * h
    u += (G * x - F * y) / det; v += (E * y - F * x) / det
    if (domain.wrapU) u = wrap(u, domain.u)
    if (domain.wrapV) v = wrap(v, domain.v)
    if (u < domain.u[0] || u > domain.u[1] || v < domain.v[0] || v > domain.v[1]) break
    const n = normalAt(f, domain, u, v)
    d = unit(sub(d, scale(n, dot(d, n))))
    points.push(f(u, v))
  }
  return points
}

/** 主方向：形算子 S = I⁻¹ II 的两个本征向量，换回三维的切向量。 */
function principalDirections(f: Surface, domain: Domain, u: number, v: number): Vec[] {
  const du = (domain.u[1] - domain.u[0]) * 4e-3, dv = (domain.v[1] - domain.v[0]) * 4e-3
  const [fu, fv] = partials(f, domain, u, v), n = unit(cross(fu, fv)), p = f(u, v)
  const fuu = scale(add(sub(f(u + du, v), scale(p, 2)), f(u - du, v)), 1 / (du * du))
  const fvv = scale(add(sub(f(u, v + dv), scale(p, 2)), f(u, v - dv)), 1 / (dv * dv))
  const fuv = scale(add(sub(f(u + du, v + dv), f(u + du, v - dv)), sub(f(u - du, v - dv), f(u - du, v + dv))), 1 / (4 * du * dv))
  const E = dot(fu, fu), F = dot(fu, fv), G = dot(fv, fv), L = dot(fuu, n), M = dot(fuv, n), N = dot(fvv, n), det = E * G - F * F
  if (!(det > 1e-12)) return [unit(fu), unit(cross(n, fu))]
  const s11 = (G * L - F * M) / det, s12 = (G * M - F * N) / det, s21 = (E * M - F * L) / det, s22 = (E * N - F * M) / det
  const half = (s11 + s22) / 2, root = Math.sqrt(Math.max(0, half * half - (s11 * s22 - s12 * s21)))
  if (root < 1e-6) return [unit(fu), unit(cross(n, fu))] // 脐点：每个方向都是主方向
  const first = Math.abs(s12) > 1e-9 ? add(scale(fu, s12), scale(fv, half + root - s11)) : Math.abs(s21) > 1e-9 ? add(scale(fu, half + root - s22), scale(fv, s21)) : fu
  const d1 = unit(first)
  return [d1, unit(cross(n, d1))]
}
function drawVisual(context: CanvasRenderingContext2D, item: Drawing, now: number, project: Project) {
  if (!mesh) return
  const fadeIn = Math.min(1, (now - item.born) / 2400)
  const fadeOut = item.fading ? Math.max(0, 1 - (now - item.fading) / 2400) : 1
  const alpha = fadeIn * fadeOut * .5
  if (alpha <= 0) { if (drawing === item) drawing = undefined; return }
  const P = (p: Vec) => project(p[0], p[1], p[2])
  context.save()
  context.globalAlpha = alpha
  context.strokeStyle = red
  context.fillStyle = red
  context.lineWidth = 1.6
  context.font = `17px Caveat, 'Long Cang', cursive`
  const line = (pts: Vec[], close = false, dashed = false) => {
    context.setLineDash(dashed ? [5, 4] : [])
    context.beginPath()
    pts.forEach((p, k) => { const [x, y] = P(p); if (k) context.lineTo(x, y); else context.moveTo(x, y) })
    if (close) context.closePath()
    context.stroke()
    context.setLineDash([])
  }
  const arrow = (from: Vec, to: Vec, label?: string) => {
    const [x0, y0] = P(from), [x1, y1] = P(to)
    context.beginPath(); context.moveTo(x0, y0); context.lineTo(x1, y1); context.stroke()
    const angle = Math.atan2(y1 - y0, x1 - x0), head = 7
    context.beginPath()
    context.moveTo(x1 - head * Math.cos(angle - .45), y1 - head * Math.sin(angle - .45))
    context.lineTo(x1, y1)
    context.lineTo(x1 - head * Math.cos(angle + .45), y1 - head * Math.sin(angle + .45))
    context.stroke()
    if (label) context.fillText(label, x1 + 4 * Math.cos(angle) + 3, y1 + 4 * Math.sin(angle) + 4)
  }
  const dotAt = (p: Vec, label?: string) => {
    const [x, y] = P(p)
    context.beginPath(); context.arc(x, y, 2.6, 0, Math.PI * 2); context.fill()
    if (label) context.fillText(label, x - 14, y - 6)
  }

  if (mesh.curves.length) {
    // 纤维化：沿一条纤维（Hopf 向量场的积分曲线）画切向量。
    const curve = mesh.curves[item.curve % mesh.curves.length]!
    context.lineWidth = 2
    line(Array.from({ length: 65 }, (_, k) => curve(k / 64 * Math.PI * 2)), true)
    context.lineWidth = 1.5
    const tangentAt = (t: number) => unit(sub(curve(t + 1e-3), curve(t - 1e-3)))
    if (item.visual === 'field') for (let k = 0; k < 8; k++) { const t = k / 8 * Math.PI * 2; arrow(curve(t), add(curve(t), scale(tangentAt(t), .16)), k === 0 ? 'X' : undefined) }
    else { dotAt(curve(item.t), 'p'); arrow(curve(item.t), add(curve(item.t), scale(tangentAt(item.t), .28)), 'γ′(0)') }
    context.restore()
    return
  }

  const f = mesh.surface[item.patch % mesh.surface.length]!
  const domain = mesh.domains[item.patch % mesh.domains.length]!
  const du = (domain.u[1] - domain.u[0]) * 1e-3, dv = (domain.v[1] - domain.v[0]) * 1e-3
  const p = f(item.u, item.v)
  const fu = unit(sub(f(item.u + du, item.v), f(item.u - du, item.v)))
  const fv = unit(sub(f(item.u, item.v + dv), f(item.u, item.v - dv)))
  // 切平面的一组正交基（Gram–Schmidt）。
  const e1 = fu, e2 = unit(sub(fv, scale(fu, dot(fu, fv))))
  const span = { u: (domain.u[1] - domain.u[0]) * .08, v: (domain.v[1] - domain.v[0]) * .08 }
  const clampU = (u: number) => Math.min(domain.u[1], Math.max(domain.u[0], u)), clampV = (v: number) => Math.min(domain.v[1], Math.max(domain.v[0], v))
  const square = (a: number) => [add(add(p, scale(e1, a)), scale(e2, a)), add(add(p, scale(e1, -a)), scale(e2, a)), add(add(p, scale(e1, -a)), scale(e2, -a)), add(add(p, scale(e1, a)), scale(e2, -a))]

  switch (item.visual) {
    case 'tangent': {
      const a = .22, corners = square(a)
      line(corners, true)
      context.globalAlpha = alpha * .35
      for (let k = 1; k < 6; k++) { const s = -a + 2 * a * k / 6; line([add(add(p, scale(e1, s)), scale(e2, -a)), add(add(p, scale(e1, s)), scale(e2, a))]) }
      context.globalAlpha = alpha
      dotAt(p, 'p')
      const [x, y] = P(corners[0]!); context.fillText('TₚM', x + 4, y)
      break
    }
    case 'basis': {
      dotAt(p, 'p')
      arrow(p, add(p, scale(fu, .26)), '∂u')
      arrow(p, add(p, scale(fv, .26)), '∂v')
      line([add(p, scale(fu, .26)), add(add(p, scale(fu, .26)), scale(fv, .26)), add(p, scale(fv, .26))], false, true)
      break
    }
    case 'normal': {
      // 沿一条坐标曲线画几根单位法向量：高斯映射把它们送到 S² 上。
      line(Array.from({ length: 25 }, (_, k) => f(clampU(item.u - span.u * 1.8 + span.u * 3.6 * k / 24), item.v)))
      for (let k = -3; k <= 3; k++) {
        const u = clampU(item.u + k * span.u * .6), q = f(u, item.v)
        const n = unit(cross(sub(f(u + du, item.v), f(u - du, item.v)), sub(f(u, item.v + dv), f(u, item.v - dv))))
        arrow(q, add(q, scale(n, .22)), k === 0 ? 'N' : undefined)
      }
      break
    }
    case 'metric': {
      const r = .15
      line(Array.from({ length: 41 }, (_, k) => { const t = k / 40 * Math.PI * 2; return add(p, add(scale(e1, r * Math.cos(t)), scale(e2, r * Math.sin(t)))) }), true)
      context.globalAlpha = alpha * .4
      line(square(.24), true, true)
      context.globalAlpha = alpha
      dotAt(p)
      arrow(p, add(p, scale(e1, r)))
      const [x, y] = P(add(p, scale(e2, r))); context.fillText('gₚ(v, v) = 1', x + 6, y - 4)
      break
    }
    case 'chart':
    case 'stokes': {
      const u0 = clampU(item.u - span.u), u1 = clampU(item.u + span.u), v0 = clampV(item.v - span.v), v1 = clampV(item.v + span.v)
      const at = (s: number, t: number) => f(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t)
      const edge = (from: [number, number], to: [number, number]) => Array.from({ length: 13 }, (_, k) => at(from[0] + (to[0] - from[0]) * k / 12, from[1] + (to[1] - from[1]) * k / 12))
      context.lineWidth = 2
      line([...edge([0, 0], [1, 0]), ...edge([1, 0], [1, 1]), ...edge([1, 1], [0, 1]), ...edge([0, 1], [0, 0])], true)
      context.lineWidth = 1.2
      if (item.visual === 'chart') {
        context.globalAlpha = alpha * .55
        for (let k = 1; k < 5; k++) { line(edge([k / 5, 0], [k / 5, 1])); line(edge([0, k / 5], [1, k / 5])) }
        context.globalAlpha = alpha
        const [x, y] = P(at(1, 1)); context.fillText('(U, φ)', x + 6, y)
      } else {
        // 边界的定向：沿着走的箭头；里面淡淡的斜线表示区域 M。
        for (const [s, t, s2, t2] of [[.45, 0, .6, 0], [1, .45, 1, .6], [.55, 1, .4, 1], [0, .55, 0, .4]] as const) arrow(at(s, t), at(s2, t2))
        context.globalAlpha = alpha * .3
        for (let k = 1; k < 8; k++) line([at(k / 8, 0), at(0, k / 8)])
        context.globalAlpha = alpha
        const [x, y] = P(at(1, 0)); context.fillText('∂M', x + 6, y)
      }
      break
    }
    case 'field': {
      // 向量场 ∂/∂u：它的积分曲线就是坐标曲线 v = 常数。
      line(Array.from({ length: 41 }, (_, k) => f(domain.u[0] + (domain.u[1] - domain.u[0]) * k / 40, item.v)))
      for (let k = 2; k < 40; k += 5) {
        const u = domain.u[0] + (domain.u[1] - domain.u[0]) * k / 40, q = f(u, item.v)
        arrow(q, add(q, scale(unit(sub(f(u + du, item.v), f(u - du, item.v))), .14)), k === 2 ? 'X' : undefined)
      }
      break
    }
    case 'curve': {
      line(Array.from({ length: 31 }, (_, k) => f(clampU(item.u - span.u * 2 + span.u * 4 * k / 30), item.v)))
      dotAt(p, 'p')
      arrow(p, add(p, scale(fu, .3)), 'γ′(0)')
      break
    }
    case 'geodesic': {
      // 一条测地线：从 p 沿某个方向「一直往前走」，两头都画。
      const direction = add(scale(e1, Math.cos(item.t)), scale(e2, Math.sin(item.t)))
      const forth = geodesic(f, domain, item.u, item.v, direction, .7), backward = geodesic(f, domain, item.u, item.v, scale(direction, -1), .7)
      context.lineWidth = 1.8
      line([...backward.reverse(), ...forth.slice(1)])
      context.lineWidth = 1.4
      dotAt(p, 'p')
      arrow(p, add(p, scale(direction, .2)), 'γ′')
      break
    }
    case 'exp': {
      // 指数映射：从 p 出发、各个方向等长的测地线，端点连成一个测地圆。
      const ends: Vec[] = []
      context.lineWidth = 1.2
      for (let k = 0; k < 10; k++) {
        const a = k / 10 * Math.PI * 2, path = geodesic(f, domain, item.u, item.v, add(scale(e1, Math.cos(a)), scale(e2, Math.sin(a))), .3)
        line(path)
        ends.push(path[path.length - 1]!)
      }
      context.lineWidth = 1.6
      line(ends, true, true)
      dotAt(p, 'p')
      const [x, y] = P(ends[1]!); context.fillText('expₚ', x + 6, y)
      break
    }
    case 'transport': {
      // 平行移动：沿坐标曲线把一个切向量一路投影到新的切平面里带过去。
      const u0 = clampU(item.u - span.u * 2.2), u1 = clampU(item.u + span.u * 2.2)
      line(Array.from({ length: 31 }, (_, k) => f(u0 + (u1 - u0) * k / 30, item.v)))
      let w = unit(add(e1, e2))
      for (let k = 0; k <= 30; k++) {
        const u = u0 + (u1 - u0) * k / 30, q = f(u, item.v), n = normalAt(f, domain, u, item.v)
        w = unit(sub(w, scale(n, dot(w, n))))
        if (k % 6 === 0) arrow(q, add(q, scale(w, .16)), k === 0 ? 'V' : k === 30 ? 'P(V)' : undefined)
      }
      break
    }
    case 'curvature': {
      // 坐标曲线在 p 处的密切圆：半径 1/κ，圆心在曲线的主法线方向上。
      const h = (domain.u[1] - domain.u[0]) * 4e-3
      const c1 = scale(sub(f(item.u + h, item.v), f(item.u - h, item.v)), 1 / (2 * h))
      const c2 = scale(add(sub(f(item.u + h, item.v), scale(p, 2)), f(item.u - h, item.v)), 1 / (h * h))
      const speed = Math.hypot(...c1), kappa = Math.hypot(...cross(c1, c2)) / (speed ** 3 || 1)
      line(Array.from({ length: 31 }, (_, k) => f(clampU(item.u - span.u * 2 + span.u * 4 * k / 30), item.v)))
      dotAt(p, 'p')
      if (!(kappa > .05)) break
      const T = unit(c1), N = unit(sub(c2, scale(T, dot(c2, T)))), R = 1 / kappa, center = add(p, scale(N, R))
      const reach = Math.min(Math.PI, .9 / R)
      context.globalAlpha = alpha * .8
      line(Array.from({ length: 49 }, (_, k) => { const a = -reach + 2 * reach * k / 48; return add(center, add(scale(N, -R * Math.cos(a)), scale(T, R * Math.sin(a)))) }), reach >= Math.PI)
      context.globalAlpha = alpha
      if (R < 1.2) { line([p, center], false, true); dotAt(center) }
      const [x, y] = P(add(p, scale(N, Math.min(R, .5) / 2))); context.fillText('R = 1/κ', x + 6, y)
      break
    }
    case 'principal': {
      // 主方向：形算子的两个本征方向，互相垂直；沿它们的法曲率是 k₁、k₂。
      const directions = principalDirections(f, domain, item.u, item.v)
      dotAt(p, 'p')
      directions.forEach((d, k) => {
        context.lineWidth = k ? 1.4 : 1.8
        line([add(p, scale(d, -.2)), add(p, scale(d, .2))])
        const [x, y] = P(add(p, scale(d, .22))); context.fillText(k ? 'k₂' : 'k₁', x + 4, y)
      })
      break
    }
  }
  context.restore()
}

function tick(now: number) {
  frame = 0
  if (document.hidden) return
  if (now - last >= FRAME - 2) { last = now; draw(now) }
  if (!reduced.matches) frame = requestAnimationFrame(tick)
}
function run() { if (!frame && !document.hidden) frame = requestAnimationFrame(tick) }
function halt() { cancelAnimationFrame(frame); frame = 0 }

// 随机的定理 / 定义：洗好的一袋，抽完再洗；夹几条当前画面自己的。流形上能画的就画在曲面上。
function pickKnowledge(): Knowledge | undefined {
  if (!bag.length) {
    const id = current.value || ''
    const manifold = manifoldById(id), network = networkById(id)
    if (network) bag = [...ML_FACTS, ...network.facts].map(text => ({ text }))
    else {
      const allowed = mesh?.curves.length ? CURVE_VISUALS : SURFACE_VISUALS
      bag = [...THEOREMS.filter(item => !item.visual || allowed.includes(item.visual)), ...(manifold?.facts || []).map(text => ({ text }))]
    }
    // 最近写过的先不放进来，免得老是看到同一条（候选太少时才放回去）。
    const fresh = bag.filter(item => !recent.includes(item.text))
    if (fresh.length >= 6) bag = fresh
    bag.sort(() => Math.random() - .5)
  }
  const item = bag.pop()
  if (item) { recent.push(item.text); if (recent.length > RECENT) recent.shift() }
  return item
}

function retire(note: Note) {
  const live = notes.value.find(item => item.key === note.key)
  if (!live || live.leaving) return
  live.leaving = true
  if (live.drawn && drawing) drawing.fading = performance.now()
  later(() => { notes.value = notes.value.filter(item => item.key !== note.key) }, 3000)
}

function nextNote() {
  const knowledge = document.hidden ? undefined : pickKnowledge()
  if (knowledge) {
    // 同时最多三条：再写新的之前，先让最早的那条淡去。
    const showing = notes.value.filter(item => !item.leaving)
    if (showing.length >= NOTE_MAX) retire(showing[0]!)
    const drawn = !!knowledge.visual && !!mesh && !reduced.matches
    // 流形上一次只画一个示意：新的示意出现时，旧的那条不再用红笔标出。
    if (drawn) for (const item of notes.value) item.drawn = false
    const note: Note = { key: ++noteKey, text: knowledge.text, slot: slotIndex++ % SLOTS, drawn, leaving: false }
    notes.value = [...notes.value, note]
    if (drawn && mesh) {
      const now = performance.now()
      if (drawing) drawing.fading = now
      const patch = Math.floor(Math.random() * Math.max(1, mesh.surface.length))
      const domain = mesh.domains[patch]
      const pick = (range?: [number, number]) => range ? range[0] + (range[1] - range[0]) * (.25 + Math.random() * .5) : 0
      drawing = { visual: knowledge.visual!, patch, u: pick(domain?.u), v: pick(domain?.v), curve: Math.floor(Math.random() * Math.max(1, mesh.curves.length)), t: Math.random() * Math.PI * 2, born: now, fading: 0 }
    }
    later(() => retire(note), NOTE_STAYS)
  }
  noteTimer = setTimeout(nextNote, reduced.matches ? 60000 : NOTE_EVERY)
}

function visibility() { if (document.hidden) halt(); else run() }
const resizer = new ResizeObserver(() => { resize(); if (!frame) draw(performance.now()) })
const themeWatch = new MutationObserver(() => { readInk(); if (!frame) draw(performance.now()) })

watch(() => props.shapes.join(','), () => { if (!current.value || !props.shapes.includes(current.value)) choose(nextManifold(props.shapes, undefined)); else scheduleSwitch() })

onMounted(() => {
  readInk()
  start = performance.now()
  choose(nextManifold(props.shapes, undefined))
  resize()
  draw(performance.now())
  if (canvas.value) resizer.observe(canvas.value)
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style'] })
  document.addEventListener('visibilitychange', visibility)
  run()
  noteTimer = setTimeout(nextNote, 2500)
})
onBeforeUnmount(() => {
  halt(); clearTimeout(switchTimer); clearTimeout(noteTimer)
  for (const timer of timers) clearTimeout(timer)
  resizer.disconnect(); themeWatch.disconnect()
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <div class="manifold-doodle" aria-hidden="true">
    <canvas ref="canvas" class="manifold-canvas" />
    <p v-for="note in notes" :key="note.key" class="manifold-note" :class="[`slot-${note.slot}`, { drawn: note.drawn, leaving: note.leaving }]">{{ note.text }}</p>
  </div>
</template>

<style scoped>
/* 画在桌面的格子纸上：在所有纸片后面，不接收鼠标。 */
.manifold-doodle{position:absolute;inset:0 0 0 250px;z-index:-1;pointer-events:none;color:var(--pencil);font-family:'Caveat','Long Cang',cursive;animation:manifold-in 2.4s var(--ease-out) both}
/* 画面是背景的主体：几乎占满文档库右侧的整块桌面，被卡片、面板挡住一部分也无妨。 */
.manifold-canvas{position:absolute;inset:4% 2% 0 6%;width:92%;height:96%}
/* 知识缓缓浮现、缓缓淡去：只动透明度和一点点位移。 */
.manifold-note{position:absolute;max-width:min(20vw,270px);margin:0;font-size:17px;line-height:1.4;color:var(--surface-muted);opacity:.55;animation:manifold-note-in 3s var(--ease-soft) backwards;transition:opacity 3s var(--ease-soft),translate 3s var(--ease-soft)}
/* 画在流形上的那一条用红笔写，前面一道红色短线，和画上去的示意对得上。 */
.manifold-note.drawn{color:color-mix(in srgb,var(--red-pencil) 75%,var(--surface-muted))}
.manifold-note.drawn::before{content:'';position:absolute;left:-14px;top:.7em;width:9px;height:2px;border-radius:2px;background:var(--red-pencil)}
.manifold-note.leaving{opacity:0;translate:0 -8px}
/* 手写的知识避开顶上的标题与工具条，沿右侧和底边排开。 */
.slot-0{right:1.5%;top:27%;rotate:-1.5deg;text-align:right}
.slot-1{right:1.5%;top:51%;rotate:1.5deg;text-align:right}
.slot-2{right:1.5%;top:75%;rotate:1deg;text-align:right}
.slot-3{left:30%;top:87%;rotate:-1.5deg}
.slot-4{left:58%;top:88%;rotate:1deg}
@keyframes manifold-in{from{opacity:0}to{opacity:1}}
@keyframes manifold-note-in{from{opacity:0;translate:0 8px}to{opacity:.55;translate:0 0}}
@media (prefers-reduced-motion:reduce){.manifold-doodle,.manifold-note{animation:none}}
</style>
