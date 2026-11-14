// GB300 的 JS 绘制在 Worker 中执行；GPU 进程仍与界面共享，不能仅靠 Worker 隔离合成开销。
// 界面只在换画面、尺寸或颜色变了、需要暂停 / 继续时发消息过来；每一帧由这里自己的 requestAnimationFrame 驱动。
import { sketchById, resetSprites, type Painter } from './scenes'

const scope = self as any
let canvas: any, context: any, painter: Painter | undefined
let frame = 0, base = 0, nextFrame = 0, running = true, still = false
const view = { width: 1, height: 1, offsetX: 0, offsetY: 0, ink: '#2e2d2a', red: '#c8553d', paper: '#efe9db', grid: { size: 24, x: 0, y: 0 } }

function draw(now: number) {
  if (!context) return
  context.setTransform(1, 0, 0, 1, view.offsetX, view.offsetY)
  context.clearRect(-view.offsetX, -view.offsetY, view.width, view.height)
  if (!painter) return
  context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = view.ink
  painter({ context, project: () => [0, 0, 0], t: still ? 20000 : Math.max(0, now - base), fade: 1, ink: view.ink, red: view.red, paper: view.paper, hand: '',
    width: view.width - view.offsetX, height: view.height - view.offsetY, size: 0, camera: 1, full: { x: -view.offsetX, y: -view.offsetY, w: view.width, h: view.height }, grid: view.grid })
  context.globalAlpha = 1
}
// Preserve the existing highest target. Lower rendering cost, not animation FPS.
function tick(now: number) {
  frame = 0
  if (!nextFrame || now + .25 >= nextFrame) {
    // Preserve the 60 Hz cadence on displays whose refresh rate is not a
    // multiple of 60. Restarting the interval at each rAF caps 160 Hz at 53 Hz.
    nextFrame = nextFrame ? nextFrame + 1000 / 60 : now + 1000 / 60
    if (nextFrame < now - .25) nextFrame = now + 1000 / 60
    draw(now)
  }
  loop()
}
function loop() { if (!frame && running && !still && painter) frame = scope.requestAnimationFrame(tick) }
function halt() { if (frame) scope.cancelAnimationFrame(frame); frame = 0; nextFrame = 0 }

scope.onmessage = ({ data }: MessageEvent) => {
  if (data.type === 'init') {
    canvas = data.canvas; context = canvas.getContext('2d')
    canvas.addEventListener?.('contextrestored', () => { resetSprites(); draw(performance.now()) })
  } else if (data.type === 'scene') {
    painter = data.id ? sketchById(data.id)?.create() : undefined
    base = performance.now() - (data.elapsed || 0)
    halt(); draw(performance.now()); loop()
  } else if (data.type === 'view') {
    Object.assign(view, data.view)
    still = Boolean(data.still)
    if (canvas && (canvas.width !== view.width || canvas.height !== view.height)) { canvas.width = Math.max(1, view.width); canvas.height = Math.max(1, view.height) }
    draw(performance.now()); if (still) halt(); else loop()
  } else if (data.type === 'run') { running = true; loop() }
  else if (data.type === 'halt') { running = false; halt() }
}
