/*
 * 教程动画的「导演」：一只假鼠标在一张示意的界面上点来点去，镜头跟着平滑推拉。
 *
 * 界面是一块固定大小的画布（世界坐标），镜头是画布上的一个中心点加缩放。
 * 所有等待、移动都由同一个逐帧时钟推进：暂停、窗口隐藏时时钟不走，脚本原地停住。
 */

export type Point = { x: number; y: number }
export type Target = string | Point
export type MoveOptions = { at?: [number, number]; ms?: number; step?: (k: number) => void; look?: number }

export const WORLD = { width: 1280, height: 800 }
const CANCEL = Symbol('tour-cancel')

type Job = { elapsed: number; ms: number; step?: (k: number) => void; done: () => void; fail: (reason: unknown) => void }
type Axis = { now: number; goal: number; speed: number }

/* 最小加加速度曲线：起步和收尾都没有速度突变，手移动鼠标大致就是这样。 */
const glide = (k: number) => k * k * k * (k * (k * 6 - 15) + 10)
const axis = (value: number): Axis => ({ now: value, goal: value, speed: 0 })

/* 临界阻尼：朝目标靠拢，不回弹，目标中途改变也不会顿一下。 */
function damp(item: Axis, time: number, dt: number) {
  const omega = 2 / time, x = omega * dt, decay = 1 / (1 + x + .48 * x * x + .235 * x * x * x)
  const gap = item.now - item.goal, carry = (item.speed + omega * gap) * dt
  item.speed = (item.speed - omega * carry) * decay
  item.now = item.goal + (gap + carry) * decay
}

export type Director = ReturnType<typeof createDirector>

export function createDirector(parts: { viewport: () => HTMLElement | null; world: () => HTMLElement | null; cursor: () => HTMLElement | null; ripples: () => HTMLElement | null }) {
  const camera = { x: axis(WORLD.width / 2), y: axis(WORLD.height / 2), zoom: axis(1) }
  const pointer = { x: WORLD.width * .62, y: WORLD.height + 40, down: false, shown: false }
  let jobs: Job[] = [], frame = 0, last = 0, paused = false, run = 0, base = 1, shown = ''
  // 画布按「最近的镜头」的清晰度排一次版（density），之后镜头推拉只是合成层的缩放，不用每帧重画文字。
  let view = { width: WORLD.width, height: WORLD.height }, density = 1, world: HTMLElement | null = null, cursor: HTMLElement | null = null

  function resize() {
    const box = parts.viewport()
    world = parts.world(); cursor = parts.cursor()
    if (box?.clientWidth) view = { width: box.clientWidth, height: box.clientHeight }
    base = Math.min(view.width / WORLD.width, view.height / WORLD.height)
    const next = Math.round(Math.min(1.6, Math.max(.7, base * 2.2)) * 20) / 20
    if (world && next !== density) { density = next; world.style.zoom = String(density) }
    else if (world && !world.style.zoom) world.style.zoom = String(density)
  }
  /* 窗口小的时候近景再推近一些，字才看得清；全景不变。 */
  const boost = (zoom: number) => 1 + (zoom - 1) * Math.min(1.6, Math.max(1, .66 / base))

  function paint() {
    if (!world || !cursor) resize()
    const scale = base * camera.zoom.now, halfW = view.width / scale / 2, halfH = view.height / scale / 2
    // 镜头不看到画布外面。
    const cx = Math.min(Math.max(camera.x.now, halfW), Math.max(halfW, WORLD.width - halfW))
    const cy = Math.min(Math.max(camera.y.now, halfH), Math.max(halfH, WORLD.height - halfH))
    const left = view.width / 2 - cx * scale, top = view.height / 2 - cy * scale
    if (world) world.style.transform = `translate3d(${left.toFixed(2)}px, ${top.toFixed(2)}px, 0) scale(${(scale / density).toFixed(4)})`
    if (cursor) {
      const grow = (1 + (camera.zoom.now - 1) * .2) * (pointer.down ? .86 : 1)
      cursor.style.transform = `translate3d(${(left + pointer.x * scale).toFixed(2)}px, ${(top + pointer.y * scale).toFixed(2)}px, 0) scale(${grow.toFixed(3)})`
      const opacity = pointer.shown ? '1' : '0'
      if (opacity !== shown) cursor.style.opacity = shown = opacity
    }
    return { left, top, scale }
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick)
    const dt = Math.min(.05, (now - last) / 1000); last = now
    if (paused || dt <= 0) return
    for (const job of jobs.slice()) {
      job.elapsed += dt * 1000
      const k = job.ms ? Math.min(1, job.elapsed / job.ms) : 1
      job.step?.(k)
      if (k >= 1) { jobs = jobs.filter(item => item !== job); job.done() }
    }
    damp(camera.x, .4, dt); damp(camera.y, .4, dt); damp(camera.zoom, .46, dt)
    paint()
  }

  function schedule(ms: number, step?: (k: number) => void) {
    return new Promise<void>((done, fail) => { jobs.push({ elapsed: 0, ms, step, done, fail }) })
  }

  /* 画布里某个元素（或它内部按比例取的一点）的世界坐标。 */
  function locate(target: Target, at: [number, number] = [.5, .5]): Point {
    if (typeof target !== 'string') return target
    const node = world?.querySelector<HTMLElement>(target)
    if (!world || !node) return { x: pointer.x, y: pointer.y }
    const frameBox = world.getBoundingClientRect(), box = node.getBoundingClientRect(), scale = frameBox.width / WORLD.width || 1
    return { x: (box.left - frameBox.left + box.width * at[0]) / scale, y: (box.top - frameBox.top + box.height * at[1]) / scale }
  }

  function ripple(kind: 'left' | 'middle' | 'right') {
    const layer = parts.ripples(); if (!layer) return
    const { left, top, scale } = paint(), dot = document.createElement('i')
    dot.className = `tour-ripple ${kind}`
    dot.style.left = `${left + pointer.x * scale}px`; dot.style.top = `${top + pointer.y * scale}px`
    layer.append(dot)
    dot.addEventListener('animationend', () => dot.remove(), { once: true })
  }

  const api = {
    wait: (ms: number) => schedule(ms),
    tween: (ms: number, step: (k: number) => void, linear = false) => schedule(ms, k => step(linear ? k : glide(k))),
    locate,
    /* 画布里某个元素的外框（世界坐标）。 */
    box(target: string) {
      const a = locate(target, [0, 0]), b = locate(target, [1, 1])
      return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
    },
    /* 一个字一个字敲出来。 */
    type(text: string, write: (value: string) => void, each = 48) {
      return schedule(Math.max(1, text.length * each), k => write(text.slice(0, Math.round(k * text.length))))
    },
    /* 镜头看向某处；zoom 省略时保持当前远近。 */
    look(target: Target | null, zoom?: number, at?: [number, number]) {
      const point = target ? locate(target, at) : { x: WORLD.width / 2, y: WORLD.height / 2 }
      camera.x.goal = point.x; camera.y.goal = point.y
      if (zoom) camera.zoom.goal = zoom > 1 ? boost(zoom) : zoom
    },
    show() { pointer.shown = true },
    hide() { pointer.shown = false },
    place(point: Point) { pointer.x = point.x; pointer.y = point.y },
    /* 鼠标走一条略带弧度的路过去；距离越远用时越长。 */
    move(target: Target, options: MoveOptions = {}) {
      const from = { x: pointer.x, y: pointer.y }, to = locate(target, options.at)
      const dx = to.x - from.x, dy = to.y - from.y, far = Math.hypot(dx, dy)
      const bend = options.step ? 0 : Math.min(46, far * .12) * (dx >= 0 ? 1 : -1)
      const mid = { x: (from.x + to.x) / 2 + (far ? -dy / far : 0) * bend, y: (from.y + to.y) / 2 + (far ? dx / far : 0) * bend }
      if (options.look) api.look(to, options.look)
      pointer.shown = true
      return schedule(options.ms ?? Math.min(760, 240 + far * .8), raw => {
        const k = glide(raw), rest = 1 - k
        pointer.x = rest * rest * from.x + 2 * rest * k * mid.x + k * k * to.x
        pointer.y = rest * rest * from.y + 2 * rest * k * mid.y + k * k * to.y
        options.step?.(k)
      })
    },
    press() { pointer.down = true },
    release() { pointer.down = false },
    async click(kind: 'left' | 'middle' | 'right' = 'left') {
      pointer.down = true; ripple(kind)
      await schedule(110)
      pointer.down = false
      await schedule(90)
    },
  }

  return {
    api,
    /* 从头播放一段脚本；上一段还没播完就作废。播完返回 true，被打断返回 false。 */
    async play(script: (stage: typeof api) => Promise<void>) {
      const mine = ++run
      for (const job of jobs) job.fail(CANCEL)
      jobs = []
      camera.x = axis(WORLD.width / 2); camera.y = axis(WORLD.height / 2); camera.zoom = axis(1)
      Object.assign(pointer, { x: WORLD.width * .62, y: WORLD.height + 40, down: false, shown: false })
      paused = false; shown = ''
      resize()
      if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick) }
      paint()
      try { await script(api); return mine === run } catch (reason) { if (reason !== CANCEL) throw reason; return false }
    },
    pause(value: boolean) { paused = value },
    get paused() { return paused },
    /* 窗口大小变了：重新量一次再画。 */
    repaint() { resize(); paint() },
    stop() {
      ++run
      for (const job of jobs) job.fail(CANCEL)
      jobs = []
      cancelAnimationFrame(frame); frame = 0
    },
  }
}
