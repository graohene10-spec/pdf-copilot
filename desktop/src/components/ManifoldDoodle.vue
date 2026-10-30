<script setup lang="ts">
// 铅笔草稿的格子纸上，一个铅笔画的流形慢慢自转 360°；旁边随机浮现微分几何的定理与定义，
// 其中一部分直接画在流形上（切平面、坐标基、法向量、度量圆、坐标卡、Stokes 边界、积分曲线），跟着流形一起转。
// 每隔一段随机的时间换一种流形，换的时候像重新画一遍。
// 只画线框：每帧旋转、投影几千个点，按远近分四档深浅一次画完；转得很慢（56 秒一圈），每秒 15 帧就够顺，窗口不可见时停下。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { manifoldById, nextManifold, buildMesh, THEOREMS, type Mesh, type Note as Knowledge, type Visual, type Vec } from '../sketch/manifolds'

const props = defineProps<{ shapes: string[] }>()

const canvas = ref<HTMLCanvasElement>()
const current = ref<string>()
type Note = { key: number; text: string; slot: number; drawn: boolean; leaving: boolean }
const notes = ref<Note[]>([])

const PERIOD = 56000 // 一整圈 56 秒
const DRAW_IN = 1800 // 换流形时「画出来」的时长
const FRAME = 1000 / 15
const SLOTS = 4
const SURFACE_VISUALS: Visual[] = ['tangent', 'basis', 'normal', 'metric', 'chart', 'stokes', 'field', 'curve']
const CURVE_VISUALS: Visual[] = ['field', 'curve']

let mesh: Mesh | undefined
let baseTilt = .42
let jitter: Float32Array | undefined
let frame = 0, last = 0, start = 0, drawnAt = 0, width = 0, height = 0, ratio = 1
let switchTimer: ReturnType<typeof setTimeout> | undefined
let noteTimer: ReturnType<typeof setTimeout> | undefined
let noteKey = 0, slotIndex = 0
let bag: Knowledge[] = []
let ink = '#2e2d2a', red = '#c8553d'
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
const timers = new Set<ReturnType<typeof setTimeout>>()

/** 画在流形上的示意：在哪块曲面、哪个参数点，什么时候出现 / 开始淡出。 */
type Drawing = { visual: Visual; patch: number; u: number; v: number; curve: number; t: number; born: number; fading: number }
let drawing: Drawing | undefined

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
  const manifold = id ? manifoldById(id) : undefined
  if (!manifold) return
  current.value = id
  mesh = buildMesh(manifold)
  baseTilt = manifold.tilt ?? .42
  jitter = seeded(mesh.points.length / 3)
  drawnAt = performance.now()
  bag = []
  if (drawing) drawing.fading = drawnAt
  for (const note of notes.value) note.leaving = true
  scheduleSwitch()
}

function scheduleSwitch() {
  clearTimeout(switchTimer)
  if (props.shapes.length < 2 || reduced.matches) return
  // 35–75 秒随机换一种。
  switchTimer = setTimeout(() => choose(nextManifold(props.shapes, current.value)), 35000 + Math.random() * 40000)
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
  if (!element || !context || !mesh || !jitter) return
  const { points, lines, closed } = mesh
  const count = points.length / 3
  const angle = reduced.matches ? .6 : ((now - start) / PERIOD) * Math.PI * 2
  const tilt = baseTilt + Math.sin(angle * .5) * .06
  const ca = Math.cos(angle), sa = Math.sin(angle), ct = Math.cos(tilt), st = Math.sin(tilt)
  const size = Math.min(width * .62, height) * .46, cx = width * .56, cy = height * .52, camera = 3.4
  // 把模型坐标投到画布：绕竖轴自转，再向前倾一点，看得到上面。
  const project: Project = (x, y, z) => {
    const x1 = x * ca + z * sa, z1 = -x * sa + z * ca
    const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct
    const perspective = camera / (camera + z2)
    return [cx + x1 * size * perspective, cy - y2 * size * perspective, (1 - z2) / 2]
  }
  const sx = new Float32Array(count), sy = new Float32Array(count), depth = new Float32Array(count)
  for (let k = 0; k < count; k++) {
    const [x, y, d] = project(points[k * 3]!, points[k * 3 + 1]!, points[k * 3 + 2]!)
    sx[k] = x; sy[k] = y; depth[k] = d
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = ink
  // 换流形时线一条条画出来。
  const reveal = reduced.matches ? 1 : Math.min(1, (now - drawnAt) / DRAW_IN)
  const visible = Math.ceil(lines.length * reveal)
  for (const pass of [0, 1]) {
    const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()]
    const offset = pass * 2
    for (let l = 0; l < visible; l++) {
      const line = lines[l]!, steps = closed[l] ? line.length : line.length - 1
      for (let s = 0; s < steps; s++) {
        const a = line[s]!, b = line[(s + 1) % line.length]!
        const level = Math.min(3, Math.max(0, Math.floor((depth[a]! + depth[b]!) * 2)))
        if (pass && level < 2) continue // 错开的第二笔只描近处两档，远处本来就淡
        const path = paths[level]!
        path.moveTo(sx[a]! + jitter[a * 4 + offset]!, sy[a]! + jitter[a * 4 + offset + 1]!)
        path.lineTo(sx[b]! + jitter[b * 4 + offset]!, sy[b]! + jitter[b * 4 + offset + 1]!)
      }
    }
    // 远处的线淡，近处的线深；第二遍是错开一点的淡笔，像铅笔来回描。
    paths.forEach((path, level) => {
      if (pass && level < 2) return
      // 只是背景：整体很淡，不和书页、卡片抢眼。
      context.globalAlpha = (.06 + level * .085) * (pass ? .35 : 1)
      context.lineWidth = pass ? .7 : .9 + level * .1
      context.stroke(path)
    })
  }
  if (drawing && reveal >= 1) drawVisual(context, drawing, now, project)
  context.globalAlpha = 1
}

// ---- 画在流形上的示意 ----
function drawVisual(context: CanvasRenderingContext2D, item: Drawing, now: number, project: Project) {
  if (!mesh) return
  const fadeIn = Math.min(1, (now - item.born) / 700)
  const fadeOut = item.fading ? Math.max(0, 1 - (now - item.fading) / 900) : 1
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
      const [x, y] = P(corners[0]!); context.fillText('T_pM', x + 4, y)
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
      const [x, y] = P(add(p, scale(e2, r))); context.fillText('g_p(v, v) = 1', x + 6, y - 4)
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

// 随机的定理 / 定义：洗好的一袋，抽完再洗；夹几条当前流形自己的小知识。能画的就画在流形上。
function pickKnowledge(): Knowledge | undefined {
  if (!bag.length) {
    const manifold = current.value ? manifoldById(current.value) : undefined
    const allowed = mesh?.curves.length ? CURVE_VISUALS : SURFACE_VISUALS
    const usable = THEOREMS.filter(item => !item.visual || allowed.includes(item.visual))
    bag = [...usable, ...(manifold?.facts || []).map(text => ({ text }))].sort(() => Math.random() - .5)
  }
  return bag.pop()
}

function nextNote() {
  const knowledge = document.hidden ? undefined : pickKnowledge()
  if (knowledge && mesh) {
    const drawn = !!knowledge.visual && !reduced.matches
    const note: Note = { key: ++noteKey, text: knowledge.text, slot: slotIndex++ % SLOTS, drawn, leaving: false }
    notes.value = [...notes.value, note]
    if (drawn) {
      const now = performance.now()
      if (drawing) drawing.fading = now
      const patch = Math.floor(Math.random() * Math.max(1, mesh.surface.length))
      const domain = mesh.domains[patch]
      const pick = (range?: [number, number]) => range ? range[0] + (range[1] - range[0]) * (.25 + Math.random() * .5) : 0
      drawing = { visual: knowledge.visual!, patch, u: pick(domain?.u), v: pick(domain?.v), curve: Math.floor(Math.random() * Math.max(1, mesh.curves.length)), t: Math.random() * Math.PI * 2, born: now, fading: 0 }
    }
    const mine = drawing
    later(() => {
      const live = notes.value.find(item => item.key === note.key)
      if (live) live.leaving = true
      if (drawn && drawing && drawing === mine) drawing.fading = performance.now()
      later(() => { notes.value = notes.value.filter(item => item.key !== note.key) }, 900)
    }, drawn ? 9000 : 10500)
  }
  noteTimer = setTimeout(nextNote, reduced.matches ? 60000 : 4600)
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
  noteTimer = setTimeout(nextNote, 1600)
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
.manifold-doodle{position:absolute;inset:0 0 0 250px;z-index:-1;pointer-events:none;color:var(--pencil);font-family:'Long Cang','Caveat',cursive;animation:manifold-in 1.2s var(--ease-out) both}
/* 流形是背景的主体：几乎占满文档库右侧的整块桌面，被卡片、面板挡住一部分也无妨。 */
.manifold-canvas{position:absolute;inset:4% 2% 0 6%;width:92%;height:96%}
.manifold-note{position:absolute;max-width:min(18vw,240px);margin:0;font-size:16px;line-height:1.5;color:var(--surface-muted);--note-opacity:.55;opacity:var(--note-opacity);animation:manifold-write 1.1s var(--ease-soft) both;transition:opacity .9s var(--ease-out),translate .9s var(--ease-out)}
/* 画在流形上的那一条用红笔写，前面一道红色短线，和画上去的示意对得上。 */
.manifold-note.drawn{color:color-mix(in srgb,var(--red-pencil) 75%,var(--surface-muted))}
.manifold-note.drawn::before{content:'';position:absolute;left:-14px;top:.75em;width:9px;height:2px;border-radius:2px;background:var(--red-pencil)}
.manifold-note.leaving{--note-opacity:0;translate:0 -6px}
/* 手写的知识避开顶上的标题与工具条，沿右侧和底边排开。 */
.slot-0{right:1.5%;top:27%;rotate:-1.5deg;text-align:right}
.slot-1{right:1.5%;top:51%;rotate:1.5deg;text-align:right}
.slot-2{right:1.5%;top:75%;rotate:1deg;text-align:right}
.slot-3{left:30%;top:87%;rotate:-1.5deg}
@keyframes manifold-in{from{opacity:0}to{opacity:1}}
/* 一笔写出来：从左到右露出（只动 clip-path，淡出用的 opacity 不被动画占住）。 */
@keyframes manifold-write{from{clip-path:inset(-40% 100% -40% -10%)}to{clip-path:inset(-40% -40% -40% -10%)}}
@media (prefers-reduced-motion:reduce){.manifold-doodle,.manifold-note{animation:none}}
</style>
