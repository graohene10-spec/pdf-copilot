// GB300 的 WebGL 画法。画面和二维画法（scenes.ts 里的 racks）是同一套算式：同样的排、同样的波、同样的三个面，
// 只是不再一条条发绘制指令。每个机柜是一个「实例」，全部机柜一次提交给显卡：一帧一次绘制调用。
//
// 一个机柜三个面，按二维画法的次序画（先侧板、再柜顶、再正面；一排里从两头往中间；排从远到近），后画的盖住先画的：
//   侧板——朝画面中间的那一块，深一点的纸色；
//   柜顶——纸色的平行四边形；
//   正面——一张预先画好的小图（和二维画法用的是同一张，按大小分五档做成一套逐级缩小的贴图）。
// 线不是另外描的：每个面在着色器里算出像素到四条边的距离，离边半个像素以内就是线。所以线的深浅只取决于几何，
// 相邻机柜高低差一点点，露出的侧板细缝和两条边线叠出的粗细就跟着连续地变——水面一样的微波就是这么来的，没有哪一步是「够平就省掉」。
//
// 远处的排在二维画法里是另一种画法（连成一道墙）。这里用同一种机柜，靠 near 这个量在两种样子之间连续地过渡：
// 远处没有侧板，正面是一块平的颜色，线按排距变淡；近处有侧板，正面贴小图，线是实的。
import { rackFront } from './scenes'

const WIDE = .6, DEEP = 1.2, PITCH = 2.9, TALL = 2.25, EYE = 5.6, SPEED = .09, EVERY = 24000, LIFE = 60
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t) }
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

const VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aA; // 机柜左边的 x、这一排的深度 z、抬起的高度、侧板在哪一边（1 右、-1 左、0 没有；9 是天际线）
layout(location = 1) in vec4 aB; // 填色的不透明度、远处样子的线有多深、near（0 远 1 近）、远处斜边淡到多少
layout(location = 2) in vec4 aC; // 线宽的一半、正面被前一排挡住的那条线（像素）、要不要画托盘线
uniform vec2 uSize; uniform float uFocal;
uniform vec3 uPaper, uInk, uShade, uWall;
flat out vec4 vC01, vC23, vEdge, vFill, vLine, vRect, vMisc;
flat out vec2 vExtra;
out vec2 vPx;
const float WIDE = .6, DEEP = 1.2, TALL = 2.25, EYE = 5.6;
const int ORDER[6] = int[6](0, 1, 2, 0, 2, 3);
vec2 P(float x, float y, float z) { return vec2(uSize.x * .5 + uFocal * x / z, uSize.y * .5 + uFocal * (EYE - y) / z); }
vec2 away(vec2 d, float s) { return s * vec2(d.y, -d.x) / max(length(d), 1e-4); }
void main() {
  int face = gl_VertexID / 6, k = ORDER[gl_VertexID % 6];
  float x0 = aA.x, z = aA.y, y0 = aA.z, side = aA.w, x1 = x0 + WIDE, back = z + DEEP, y1 = y0 + TALL;
  float solid = aB.x, far = aB.y, near = aB.z;
  vec2 c[4]; bool gone = false;
  // 线的颜色和不透明度。近处是一种调好的浅铅笔色、不透明（几条线叠在一起不会更深）；远处是铅笔色、很淡（叠起来会深一点）。
  // 中间连续过渡：cover 是不透明度，dark 是画上去实际有多深，颜色按两者的比例调。
  float cover = mix(far, solid, near), dark = mix(far, .25 * solid, near), tone = dark / max(cover, 1e-4);
  vEdge = vec4(0.); vRect = vec4(0.); vLine = vec4(mix(uPaper, uInk, tone), aC.x);
  float ribs = 0., tall = 1.;
  if (side > 8.5) {
    // 天际线：横贯画面的一条淡线。
    gone = face != 1;
    c[0] = vec2(0., y0 - 1.5); c[1] = vec2(uSize.x, y0 - 1.5); c[2] = vec2(uSize.x, y0 - .5); c[3] = vec2(0., y0 - .5);
    vFill = vec4(uInk, solid);
  } else if (face == 0) {
    gone = side == 0. || near <= 0.;
    float x = side > 0. ? x1 : x0;
    c[0] = P(x, y1, z); c[1] = P(x, y1, back); c[2] = P(x, y0, back); c[3] = P(x, y0, z);
    vFill = vec4(uShade, solid * near); vEdge = vec4(cover * near);
  } else if (face == 1) {
    c[0] = P(x0, y1, z); c[1] = P(x0, y1, back); c[2] = P(x1, y1, back); c[3] = P(x1, y1, z);
    vFill = vec4(uPaper, solid);
    float slant = mix(far * aB.w, .25 * solid, near) / max(tone, 1e-4);
    vEdge = vec4(slant, cover, slant, cover);
  } else {
    vec2 a = P(x0, y1, z), b = P(x1, y0, z);
    float bottom = min(b.y, aC.y);
    gone = bottom <= a.y;
    c[0] = vec2(a.x - .5, a.y); c[1] = vec2(b.x + .5, a.y); c[2] = vec2(b.x + .5, bottom); c[3] = vec2(a.x - .5, bottom);
    tall = b.y - a.y;
    vRect = vec4(a.x - .5, a.y, 1. / (b.x - a.x + 1.), 1. / tall);
    vFill = vec4(uWall, solid);
    ribs = aC.z * far * .75 * (1. - near);
  }
  float s = (c[1].x - c[0].x) * (c[2].y - c[1].y) - (c[1].y - c[0].y) * (c[2].x - c[1].x) < 0. ? -1. : 1.;
  vC01 = vec4(c[0], c[1]); vC23 = vec4(c[2], c[3]);
  vMisc = vec4(float(face), near, s, 0.); vExtra = vec2(ribs, tall);
  if (gone) { gl_Position = vec4(2., 2., 2., 1.); vPx = vec2(0.); return; }
  // 每个角往外推一点：线有一半在面的外面，抗锯齿也要留出半个像素。
  vec2 here = c[k], before = c[(k + 3) % 4], after = c[(k + 1) % 4];
  vec2 n1 = away(here - before, s), n2 = away(after - here, s);
  vec2 pos = here + (n1 + n2) / max(1. + dot(n1, n2), .3) * 1.7;
  vPx = pos;
  gl_Position = vec4(pos.x / uSize.x * 2. - 1., 1. - pos.y / uSize.y * 2., 0., 1.);
}`

const FRAGMENT = `#version 300 es
precision highp float;
flat in vec4 vC01, vC23, vEdge, vFill, vLine, vRect, vMisc;
flat in vec2 vExtra;
in vec2 vPx;
uniform sampler2D uFront;
out vec4 color;
float edge(vec2 p, vec2 a, vec2 b, float s) { vec2 d = b - a; return s * dot(p - a, vec2(d.y, -d.x)) / max(length(d), 1e-4); }
void main() {
  vec2 c0 = vC01.xy, c1 = vC01.zw, c2 = vC23.xy, c3 = vC23.zw;
  float s = vMisc.z, half_ = vLine.a + .5;
  float d0 = edge(vPx, c0, c1, s), d1 = edge(vPx, c1, c2, s), d2 = edge(vPx, c2, c3, s), d3 = edge(vPx, c3, c0, s);
  float inside = clamp(.5 - max(max(d0, d1), max(d2, d3)), 0., 1.);
  // 一条边上的线：离这条边半个线宽以内，而且没有越过另外三条边。
  float l0 = clamp(half_ - abs(d0), 0., 1.) * clamp(half_ - max(max(d1, d2), d3), 0., 1.) * vEdge.x;
  float l1 = clamp(half_ - abs(d1), 0., 1.) * clamp(half_ - max(max(d0, d2), d3), 0., 1.) * vEdge.y;
  float l2 = clamp(half_ - abs(d2), 0., 1.) * clamp(half_ - max(max(d0, d1), d3), 0., 1.) * vEdge.z;
  float l3 = clamp(half_ - abs(d3), 0., 1.) * clamp(half_ - max(max(d0, d1), d2), 0., 1.) * vEdge.w;
  // 相对的两条边（很薄的柜顶上会叠在一起）像分两次描那样叠深；相邻的两条在角上只算一条。
  float line = max(1. - (1. - l0) * (1. - l2), 1. - (1. - l1) * (1. - l3));
  vec3 fill = vFill.rgb;
  if (vMisc.x > 1.5) {
    vec2 uv = (vPx - vRect.xy) * vRect.zw;
    if (vMisc.y > 0.) fill = mix(fill, texture(uFront, uv, -.5).rgb, vMisc.y);
    // 远处被波抬起来的正面不留白：横着两道托盘线。
    if (vExtra.x > 0.) { float rib = max(clamp(1. - abs(uv.y - .3) * vExtra.y, 0., 1.), clamp(1. - abs(uv.y - .62) * vExtra.y, 0., 1.)); line = max(line, rib * vExtra.x * inside); }
  }
  float body = inside * vFill.a;
  float alpha = line + body * (1. - line);
  if (alpha < .003) discard;
  color = vec4(vLine.rgb * line + fill * body * (1. - line), alpha);
}`

type Canvas = OffscreenCanvas | HTMLCanvasElement
type Wave = { kind: number; born: number; x: number; z: number; nx: number; nz: number; centre: number; age: number; gain: number; ringZ: number; planeZ: number }
export type RacksGL = { draw(t: number, view: { width: number; height: number; ink: string; paper: string }): void; clear(): void; lost(): boolean; dispose(): void }

function program(gl: WebGL2RenderingContext) {
  const build = (type: number, source: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader'); return shader }
  const made = gl.createProgram()!
  gl.attachShader(made, build(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(made, build(gl.FRAGMENT_SHADER, FRAGMENT)); gl.linkProgram(made)
  if (!gl.getProgramParameter(made, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(made) || 'link')
  return made
}
const OPTIONS = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false }
/** 这台机器能不能用：先在一张用完就丢的小画布上把着色器编一遍。主画布一旦拿了 WebGL 上下文就换不回二维的了，所以先试。 */
export function racksGLAvailable(software = false): boolean {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false
    const gl = new OffscreenCanvas(4, 4).getContext('webgl2', { ...OPTIONS, failIfMajorPerformanceCaveat: !software }) as WebGL2RenderingContext | null
    if (!gl) return false
    program(gl)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch { return false }
}

/** 一个颜色字符串（主题里的十六进制、rgb() 都行）读成 0–1 的三个数。 */
const colours = new Map<string, [number, number, number]>()
function colour(text: string): [number, number, number] {
  let made = colours.get(text)
  if (!made) {
    const probe = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!
    probe.fillStyle = text; probe.fillRect(0, 0, 1, 1)
    const data = probe.getImageData(0, 0, 1, 1).data
    colours.set(text, made = [data[0]! / 255, data[1]! / 255, data[2]! / 255])
  }
  return made
}
const mixed = (a: number[], b: number[], t: number): [number, number, number] => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t]

export function createRacksGL(canvas: Canvas, software = false): RacksGL | null {
  const gl = canvas.getContext('webgl2', { ...OPTIONS, failIfMajorPerformanceCaveat: !software }) as WebGL2RenderingContext | null
  if (!gl) return null
  const FLOATS = 12
  let made: WebGLProgram | null = null, buffer: WebGLBuffer | null = null, vao: WebGLVertexArrayObject | null = null, texture: WebGLTexture | null = null
  let uniforms: Record<string, WebGLUniformLocation | null> = {}
  let data = new Float32Array(4096 * FLOATS), room = 0, skin = ''
  // 波：和二维画法同一套——每隔一阵来一个，一滴水的圆环、推进来的平面波、两滴水的干涉；外加一层很小的常驻起伏。
  let waveIndex = -1
  let events: Omit<Wave, 'age' | 'gain' | 'ringZ' | 'planeZ'>[] = []

  function setup() {
    made = program(gl!)
    gl!.useProgram(made)
    uniforms = Object.fromEntries(['uSize', 'uFocal', 'uPaper', 'uInk', 'uShade', 'uWall', 'uFront'].map(name => [name, gl!.getUniformLocation(made!, name)]))
    vao = gl!.createVertexArray(); gl!.bindVertexArray(vao)
    buffer = gl!.createBuffer(); gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer); room = 0
    for (let k = 0; k < 3; k++) { gl!.enableVertexAttribArray(k); gl!.vertexAttribPointer(k, 4, gl!.FLOAT, false, FLOATS * 4, k * 16); gl!.vertexAttribDivisor(k, 1) }
    gl!.disable(gl!.DEPTH_TEST); gl!.enable(gl!.BLEND); gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA)
    gl!.clearColor(0, 0, 0, 0)
    texture = null; skin = ''
  }
  // 正面的小图：256、128、64、32、16 像素宽各画一张（细节随大小多起来），当成一张贴图的五级。显卡按机柜在屏幕上的大小自己在相邻两级之间调和。
  function dress(paper: string, ink: string) {
    if (!texture) texture = gl!.createTexture()
    gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, texture)
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false)
    for (let level = 0; level < 5; level++) gl!.texImage2D(gl!.TEXTURE_2D, level, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, rackFront(paper, ink, 256 >> level, 1008 >> level) as unknown as TexImageSource)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_BASE_LEVEL, 0); gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAX_LEVEL, 4)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR); gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE); gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    const p = colour(paper), i = colour(ink)
    gl!.uniform3fv(uniforms.uPaper!, p); gl!.uniform3fv(uniforms.uInk!, i)
    gl!.uniform3fv(uniforms.uShade!, mixed(p, i, .16)); gl!.uniform3fv(uniforms.uWall!, mixed(p, i, .09))
    gl!.uniform1i(uniforms.uFront!, 0)
  }
  let dead = false
  const onLost = (event: Event) => { event.preventDefault(); dead = true }
  const onRestored = () => { try { setup(); dead = false } catch { dead = true } }
  canvas.addEventListener('webglcontextlost', onLost as EventListener)
  canvas.addEventListener('webglcontextrestored', onRestored)
  try { setup() } catch { return null }

  // 这一帧所有机柜的数据，按画的先后排好；返回个数。
  function gather(t: number, w: number, h: number): number {
    const focal = w * .85, middle = w / 2, horizon = h / 2
    const sy = (y: number, z: number) => horizon + focal * (EYE - y) / z
    const nearest = Math.max(2.2, focal * (EYE - TALL - .9) / (h * .5)), FAR = Math.sqrt(focal * (EYE - TALL) * PITCH / 1.5)
    const seconds = t / 1000, camera = seconds * SPEED, latest = Math.floor(t / EVERY)
    if (latest !== waveIndex) {
      waveIndex = latest
      events = [0, 1, 2].map(k => latest - k).filter(k => k >= 0).map(k => {
        const born = k * EVERY / 1000, angle = (hash(k * 3.7 + 5) - .5) * .7 + (hash(k * 1.9 + 7) < .5 ? 0 : Math.PI), pick = hash(k * 5.1 + .3)
        return { kind: pick < .22 ? 0 : pick < .86 ? 1 : 2, born, x: (hash(k * 2.3 + 1) - .5) * 36, z: born * SPEED + 12 + hash(k * 2.3 + 2) * 30, nx: Math.sin(angle), nz: Math.cos(angle), centre: born * SPEED + 45 }
      })
    }
    const waves: Wave[] = events.map(event => { const age = seconds - event.born; return { ...event, age, gain: smooth(age / 7) * smooth((LIFE - age) / 10), ringZ: 0, planeZ: 0 } }).filter(wave => wave.gain > .001)
    const timePhase = .13 * seconds
    const ring = (x: number, z: number, age: number) => { const d = Math.hypot(x, z) - 1.7 * age, q = d / 9; return q > -3 && q < 3 ? Math.cos(.5 * d) * Math.exp(-q * q) : 0 }
    const calmFrom = .56 * focal * WIDE / 16
    // 这一刻波最多能把一个机柜压低多少：估前一排最低能低到哪，它后面挡住的那截正面就不用画。
    const swell = waves.reduce((sum, wave) => sum + (wave.kind === 0 ? .42 : wave.kind === 1 ? .37 : .62) * wave.gain, 0)
    let rowPhase = 0, rowCalm = 1
    const height = (x: number) => {
      let y = 0
      for (const wave of waves) {
        if (wave.kind === 0) y += .42 * wave.gain * ring(x - wave.x, wave.ringZ, wave.age)
        else if (wave.kind === 1) { const d = x * wave.nx + wave.planeZ + 80 - 2.9 * wave.age, q = d / 14; if (q > -3 && q < 3) y += .37 * wave.gain * Math.cos(.4 * d) * Math.exp(-q * q) }
        else y += .31 * wave.gain * (ring(x - wave.x - 7, wave.ringZ, wave.age) + ring(x - wave.x + 7, wave.ringZ, wave.age))
      }
      return y * rowCalm + .04 * Math.sin(.09 * x + rowPhase + timePhase)
    }
    // 远近之间不留接缝：排密到两个像素以下就只留一部分排（按排号里 2 的幂次分层，留下的总是同一批），走近时其余的从透明慢慢显出来。
    const presence = (row: number, z: number) => {
      const want = 4 / (focal * (EYE - TALL) * PITCH / (z * z))
      let weight = smooth((FAR - z) / (FAR * .08))
      if (want > 1) weight *= clamp(2 - want / (row & -row || 1024), 0, 1)
      return weight
    }
    let count = 0
    const put = (x0: number, z: number, lift: number, side: number, solid: number, far: number, near: number, slant: number, half: number, cut: number, ribs: number) => {
      if ((count + 1) * FLOATS > data.length) { const grown = new Float32Array(data.length * 2); grown.set(data); data = grown }
      const at = count++ * FLOATS
      data[at] = x0; data[at + 1] = z; data[at + 2] = lift; data[at + 3] = side
      data[at + 4] = solid; data[at + 5] = far; data[at + 6] = near; data[at + 7] = slant
      data[at + 8] = half; data[at + 9] = cut; data[at + 10] = ribs; data[at + 11] = 0
    }
    for (let row = Math.floor((camera + FAR) / PITCH); row * PITCH - camera > nearest; row--) {
      const world = row * PITCH, z = world - camera, half = z * (w / 2) / focal + WIDE
      const pixels = focal * WIDE / z, spacing = focal * (EYE - TALL) * PITCH / (z * z), weight = presence(row, z)
      if (weight < .02) continue
      const coarse = 4 / spacing > 1, far = (coarse ? .1 : .25 * clamp(spacing / 8, .4, 1)) * weight, solid = weight ** .6, shift = hash(row) * WIDE, back = z + DEEP
      const near = smooth((pixels - 14) / 4), slant = smooth((pixels - 8) / 8), ribs = waves.length && pixels > 2 ? 1 : 0
      rowPhase = .05 * world
      rowCalm = Math.min(1, (calmFrom / z) ** 2)
      for (const wave of waves) { wave.ringZ = world - wave.z; wave.planeZ = (world - wave.centre) * wave.nz }
      // 前一排是实的（没有在淡入淡出），它后沿以下的正面就被它挡着。
      let cut = 1e6
      const nearZ = z - PITCH
      if ((row - 1) * PITCH - camera > nearest && presence(row - 1, nearZ) > .999) cut = sy(TALL - swell * Math.min(1, (calmFrom / nearZ) ** 2) - .05, nearZ + DEEP) + 2
      const first = Math.floor((-half - shift) / WIDE), last = Math.ceil((half - shift) / WIDE), centre = Math.floor(-shift / WIDE)
      const rack = (i: number) => {
        const x0 = i * WIDE + shift, x1 = x0 + WIDE, lift = height(x0 + WIDE / 2)
        // 整个机柜都在画面外面的不画（留出线宽）。
        const a = middle + focal * x0 / z, b = middle + focal * x1 / z, a2 = middle + focal * x0 / back, b2 = middle + focal * x1 / back
        if (Math.max(a, b, a2, b2) < -3 || Math.min(a, b, a2, b2) > w + 3 || sy(lift + TALL, back) > h + 3 || sy(lift, z) < -3) return
        put(x0, z, lift, x1 < 0 ? 1 : x0 > 0 ? -1 : 0, solid, far, near, slant, coarse ? .85 : .5, cut, ribs)
      }
      // 一排里靠中间的机柜总在外侧机柜的前面，所以从两头往中间画。
      for (let i = first; i < centre; i++) rack(i)
      for (let i = last; i >= centre; i--) rack(i)
    }
    // 天际线：机柜铺到这里为止。
    put(0, 1, sy(TALL, FAR), 9, .1, 0, 0, 0, .5, 1e6, 0)
    return count
  }

  return {
    lost: () => dead || gl.isContextLost(),
    clear() { if (!dead && !gl.isContextLost()) gl.clear(gl.COLOR_BUFFER_BIT) },
    draw(t, view) {
      if (dead || gl.isContextLost() || !made) return
      const w = Math.max(1, view.width), h = Math.max(1, view.height)
      gl.viewport(0, 0, w, h)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (skin !== `${view.paper}|${view.ink}`) { skin = `${view.paper}|${view.ink}`; dress(view.paper, view.ink) }
      const count = gather(t, w, h)
      gl.uniform2f(uniforms.uSize!, w, h); gl.uniform1f(uniforms.uFocal!, w * .85)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      if (count * FLOATS > room) { room = data.length; gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW) }
      else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * FLOATS)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 18, count)
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost as EventListener); canvas.removeEventListener('webglcontextrestored', onRestored)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
