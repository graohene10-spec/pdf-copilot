// 铅笔草稿背景上旋转的流形：几种较复杂的曲面 / 纤维化的参数化，画成线框；
// 旁边随机浮现的微分几何定理与定义，其中一部分直接画在流形上（切平面、法向量、坐标卡……）。
// 网格只算一次（单位球内居中），每帧只做旋转与投影。

export type Vec = [number, number, number]
type Param = (u: number, v: number) => Vec
/** 一块参数曲面：定义域 [u0,u1]×[v0,v1]，画 nu × nv 的网格。 */
type Patch = { f: Param; u: [number, number]; v: [number, number]; nu: number; nv: number; wrapU?: boolean; wrapV?: boolean; stepU?: number; stepV?: number }
/** 一条参数曲线，t ∈ [0, 2π) 闭合。 */
type Curve = { f: (t: number) => Vec; n: number }
type Shape = { patches?: Patch[]; curves?: Curve[] }

export type ManifoldId = 'calabi' | 'hopf' | 'klein' | 'boy' | 'breather' | 'dini' | 'knot'
/** 画好的线框：点、折线（点的下标），以及把参数映到画布坐标系（已居中缩放）的函数，用来在流形上画切平面等。 */
export type Mesh = {
  points: Float32Array
  lines: Uint32Array[]
  closed: boolean[]
  surface: ((u: number, v: number) => Vec)[] // 每块曲面一个，已归一化
  domains: { u: [number, number]; v: [number, number] }[]
  curves: ((t: number) => Vec)[] // 已归一化
}
/** tilt：观察的俯角（弧度），默认 0.42；扁平的形状从高一点看更清楚。 */
export type Manifold = { id: ManifoldId; name: string; facts: string[]; shape: () => Shape; tilt?: number }

const TAU = Math.PI * 2

// ---- 几种流形 ---------------------------------------------------------------

type C = [number, number]
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const cdiv = (a: C, b: C): C => { const d = b[0] ** 2 + b[1] ** 2; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d] }
const cpow = (a: C, n: number): C => { let out: C = [1, 0]; for (let k = 0; k < n; k++) out = cmul(out, a); return out }
const cpowReal = (a: C, p: number): C => { const r = Math.hypot(a[0], a[1]) ** p, t = Math.atan2(a[1], a[0]) * p; return [r * Math.cos(t), r * Math.sin(t)] }
const cexpI = (t: number): C => [Math.cos(t), Math.sin(t)]

// Calabi–Yau：五次 Fermat 曲面 z₁⁵ + z₂⁵ = 1 的一张实截面（Hanson 的画法），5 × 5 = 25 块拼起来。
function calabi(): Shape {
  const n = 5, alpha = Math.PI / 4
  const patches: Patch[] = []
  for (let k1 = 0; k1 < n; k1++) for (let k2 = 0; k2 < n; k2++) {
    patches.push({
      u: [-1, 1], v: [0, Math.PI / 2], nu: 7, nv: 7,
      f: (x, y) => {
        const cosh: C = [Math.cosh(x) * Math.cos(y), Math.sinh(x) * Math.sin(y)]
        const sinh: C = [Math.sinh(x) * Math.cos(y), Math.cosh(x) * Math.sin(y)]
        const z1 = cmul(cexpI(TAU * k1 / n), cpowReal(cosh, 2 / n))
        const z2 = cmul(cexpI(TAU * k2 / n), cpowReal([sinh[1], -sinh[0]], 2 / n))
        return [z1[0], Math.cos(alpha) * z1[1] + Math.sin(alpha) * z2[1], z2[0]]
      },
    })
  }
  return { patches }
}

// Hopf 纤维化 S¹ → S³ → S²：S² 上几圈纬线上的点，各自的纤维（S³ 里的大圆）经球极投影成 ℝ³ 里互相链接的圆。
function hopf(): Shape {
  // 取 S² 上三圈纬线：同一圈上各点的纤维拼成一个环面，三层环面一层套一层；每条纤维都是一个 Villarceau 圆。
  const curves: Curve[] = []
  for (const [eta, count, shift] of [[1.08, 12, 0], [1.25, 14, .4], [1.42, 16, .8]] as const) {
    for (let k = 0; k < count; k++) {
      const phi = TAU * k / count + shift
      curves.push({ n: 72, f: t => {
        const x1 = Math.cos(t + phi) * Math.sin(eta), x2 = Math.sin(t + phi) * Math.sin(eta)
        const x3 = Math.cos(t) * Math.cos(eta), x4 = Math.sin(t) * Math.cos(eta)
        const d = 1 - x4
        return [x1 / d, x3 / d, x2 / d]
      } })
    }
  }
  return { curves }
}

// 经典的「瓶子」形状浸入（瓶颈穿进瓶身处自交）。
function klein(): Shape {
  return { patches: [{ u: [0, Math.PI], v: [0, TAU], nu: 40, nv: 22, wrapU: true, wrapV: true, f: (u, v) => {
    const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v)
    const x = -2 / 15 * cu * (3 * cv - 30 * su + 90 * cu ** 4 * su - 60 * cu ** 6 * su + 5 * cu * cv * su)
    const y = -1 / 15 * su * (3 * cv - 3 * cu ** 2 * cv - 48 * cu ** 4 * cv + 48 * cu ** 6 * cv - 60 * su + 5 * cu * cv * su - 5 * cu ** 3 * cv * su - 80 * cu ** 5 * cv * su + 80 * cu ** 7 * cv * su)
    const z = 2 / 15 * (3 + 5 * cu * su) * sv
    return [x, -y, z]
  } }] }
}

// Boy 曲面：ℝP² 在 ℝ³ 中的浸入，Bryant–Kusner 参数化，w 取单位圆盘。
function boy(): Shape {
  return { patches: [{ u: [.02, 1], v: [0, TAU], nu: 16, nv: 48, wrapV: true, f: (r, t) => {
    const w: C = [r * Math.cos(t), r * Math.sin(t)]
    const w3 = cpow(w, 3), w4 = cpow(w, 4), w6 = cpow(w, 6)
    const den: C = [w6[0] + Math.sqrt(5) * w3[0] - 1, w6[1] + Math.sqrt(5) * w3[1]]
    const g1 = -1.5 * cdiv(cmul(w, [1 - w4[0], -w4[1]]), den)[1]
    const g2 = -1.5 * cdiv(cmul(w, [1 + w4[0], w4[1]]), den)[0]
    const g3 = cdiv([1 + w6[0], w6[1]], den)[1] - .5
    const g = g1 * g1 + g2 * g2 + g3 * g3
    return [g1 / g, g3 / g, g2 / g]
  } }] }
}

// Breather 曲面：Sine-Gordon 方程的呼吸子解对应的伪球面，高斯曲率处处为 −1，层层褶皱。
function breather(): Shape {
  const a = .4, w = Math.sqrt(1 - a * a)
  return { patches: [{ u: [-11, 11], v: [-37.4, 37.4], nu: 28, nv: 76, f: (u, v) => {
    const den = a * ((w * Math.cosh(a * u)) ** 2 + (a * Math.sin(w * v)) ** 2)
    const x = -u + 2 * (1 - a * a) * Math.cosh(a * u) * Math.sinh(a * u) / den
    const y = 2 * w * Math.cosh(a * u) * (-(w * Math.cos(v) * Math.cos(w * v)) - Math.sin(v) * Math.sin(w * v)) / den
    const z = 2 * w * Math.cosh(a * u) * (-(w * Math.sin(v) * Math.cos(w * v)) + Math.cos(v) * Math.sin(w * v)) / den
    return [x * .5, y, z]
  } }] }
}

// Dini 曲面：扭转的伪球面，常负高斯曲率的螺旋漏斗。
function dini(): Shape {
  const a = 1, b = .18
  return { patches: [{ u: [0, 4 * Math.PI], v: [.12, 2], nu: 72, nv: 18, stepU: 2, f: (u, v) => [
    a * Math.cos(u) * Math.sin(v),
    a * (Math.cos(v) + Math.log(Math.tan(v / 2))) + b * u,
    a * Math.sin(u) * Math.sin(v),
  ] }] }
}

// (2, 5) 环面纽结的管状邻域。
function knot(): Shape {
  const p = 2, q = 5, radius = .3
  const curve = (t: number): Vec => { const r = Math.cos(q * t) + 2.2; return [r * Math.cos(p * t), -Math.sin(q * t), r * Math.sin(p * t)] }
  return { patches: [{ u: [0, TAU], v: [0, TAU], nu: 200, nv: 10, wrapU: true, wrapV: true, stepU: 4, f: (t, a) => {
    const h = 1e-3, sub = (x: Vec, y: Vec): Vec => [x[0] - y[0], x[1] - y[1], x[2] - y[2]]
    const cross = (x: Vec, y: Vec): Vec => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
    const norm = (x: Vec): Vec => { const l = Math.hypot(...x) || 1; return [x[0] / l, x[1] / l, x[2] / l] }
    const c = curve(t), tangent = norm(sub(curve(t + h), curve(t - h)))
    const normal = norm(cross(cross(tangent, sub(sub(curve(t + h), c), sub(c, curve(t - h)))), tangent))
    const binormal = cross(tangent, normal)
    return [0, 1, 2].map(k => c[k]! + radius * (Math.cos(a) * normal[k]! + Math.sin(a) * binormal[k]!)) as Vec
  } }] }
}

export const MANIFOLDS: Manifold[] = [
  { id: 'calabi', name: 'Calabi–Yau', shape: calabi, facts: [
    'Calabi–Yau 流形：紧致 Kähler 流形，第一陈类 c₁ = 0',
    '丘成桐定理：c₁ = 0 的紧 Kähler 流形上存在 Ricci 平坦度量',
    '这是五次曲面 z₁⁵ + z₂⁵ = 1 的一张实截面，由 25 块拼成',
  ] },
  { id: 'hopf', name: 'Hopf 纤维化', shape: hopf, tilt: 1.0, facts: [
    'Hopf 纤维化 S¹ → S³ → S²：每条纤维是 S³ 里的一个大圆',
    '任意两条 Hopf 纤维互相链接，链环数为 1',
    'π₃(S²) ≅ ℤ，由 Hopf 映射生成',
  ] },
  { id: 'klein', name: '克莱因瓶', shape: klein, facts: [
    '克莱因瓶不可定向，χ = 0；不能嵌入 ℝ³，只能浸入',
    'K ≅ ℝP² # ℝP²，π₁(K) = ⟨a, b | abab⁻¹ = 1⟩',
  ] },
  { id: 'boy', name: 'Boy 曲面', shape: boy, facts: [
    'Boy 曲面：ℝP² 在 ℝ³ 中没有尖点的光滑浸入',
    'ℝP² = S² / (x ∼ −x)，χ = 1，π₁ = ℤ/2',
  ] },
  { id: 'breather', name: 'Breather 曲面', shape: breather, facts: [
    'Breather 曲面：高斯曲率处处 K = −1 的伪球面',
    '伪球面与 Sine-Gordon 方程 φ_uv = sin φ 的解一一对应',
  ] },
  { id: 'dini', name: 'Dini 曲面', shape: dini, facts: [
    'Dini 曲面：扭转的伪球面，常负高斯曲率',
    'Hilbert 定理：完备的常负曲率曲面不能等距浸入 ℝ³',
  ] },
  { id: 'knot', name: '环面纽结', shape: knot, facts: [
    '(2, 5) 环面纽结：可以画在环面上，绕经线 2 圈、纬线 5 圈',
    '纽结管状邻域的边界同胚于环面 T²',
  ] },
]

export const MANIFOLD_IDS = MANIFOLDS.map(item => item.id)
export function manifoldById(id: string) { return MANIFOLDS.find(item => item.id === id) }

/** Next manifold to show: a different one from the list when there is a choice. */
export function nextManifold(ids: string[], current: string | undefined, random = Math.random): string | undefined {
  const pool = ids.filter(id => manifoldById(id))
  if (!pool.length) return undefined
  const others = pool.filter(id => id !== current)
  const from = others.length ? others : pool
  return from[Math.floor(random() * from.length) % from.length]
}

/** 把一个流形离散成线框，并给出归一化（居中、缩放到单位球）后的参数函数。 */
export function buildMesh(manifold: Manifold): Mesh {
  const shape = manifold.shape()
  const raw: number[] = [], lines: Uint32Array[] = [], closed: boolean[] = []
  const add = (p: Vec) => { raw.push(p[0], p[1], p[2]); return raw.length / 3 - 1 }
  for (const patch of shape.patches || []) {
    const { nu, nv, u, v } = patch
    const at = (i: number, j: number): Vec => patch.f(u[0] + (u[1] - u[0]) * i / (patch.wrapU ? nu : nu - 1), v[0] + (v[1] - v[0]) * j / (patch.wrapV ? nv : nv - 1))
    const index: number[] = []
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) index.push(add(at(i, j)))
    for (let i = 0; i < nu; i += patch.stepU || 1) { lines.push(Uint32Array.from({ length: nv }, (_, j) => index[i * nv + j]!)); closed.push(!!patch.wrapV) }
    for (let j = 0; j < nv; j += patch.stepV || 1) { lines.push(Uint32Array.from({ length: nu }, (_, i) => index[i * nv + j]!)); closed.push(!!patch.wrapU) }
  }
  for (const curve of shape.curves || []) {
    lines.push(Uint32Array.from({ length: curve.n }, (_, k) => add(curve.f(k / curve.n * TAU))))
    closed.push(true)
  }
  // 居中并缩放到单位球内（用 98% 分位的半径，个别远点不至于把整体压得太小）。
  const count = raw.length / 3
  let cx = 0, cy = 0, cz = 0
  for (let k = 0; k < count; k++) { cx += raw[k * 3]!; cy += raw[k * 3 + 1]!; cz += raw[k * 3 + 2]! }
  cx /= count; cy /= count; cz /= count
  const radii: number[] = []
  for (let k = 0; k < count; k++) radii.push(Math.hypot(raw[k * 3]! - cx, raw[k * 3 + 1]! - cy, raw[k * 3 + 2]! - cz))
  radii.sort((a, b) => a - b)
  const scale = radii[Math.min(count - 1, Math.floor(count * .98))] || 1
  const normalize = (p: Vec): Vec => [(p[0] - cx) / scale, (p[1] - cy) / scale, (p[2] - cz) / scale]
  const points = new Float32Array(raw.length)
  for (let k = 0; k < count; k++) points.set(normalize([raw[k * 3]!, raw[k * 3 + 1]!, raw[k * 3 + 2]!]), k * 3)
  return {
    points, lines, closed,
    surface: (shape.patches || []).map(patch => (s: number, t: number) => normalize(patch.f(s, t))),
    domains: (shape.patches || []).map(patch => ({ u: patch.u, v: patch.v })),
    curves: (shape.curves || []).map(curve => (t: number) => normalize(curve.f(t))),
  }
}

// ---- 浮现的定理与定义 ----------------------------------------------------------

/** 画在流形上的示意：切平面、坐标基、法向量 / 高斯映射、度量圆、坐标卡、Stokes 边界、向量场与积分曲线。 */
export type Visual = 'tangent' | 'basis' | 'normal' | 'metric' | 'chart' | 'stokes' | 'field' | 'curve'
export type Note = { text: string; visual?: Visual }

export const THEOREMS: Note[] = [
  { text: '切空间 T_pM：过 p 的光滑曲线在 p 处速度向量的全体，是 n 维向量空间', visual: 'tangent' },
  { text: '坐标基 {∂/∂u, ∂/∂v} 张成 T_pM；坐标向量场可交换：[∂/∂u, ∂/∂v] = 0', visual: 'basis' },
  { text: '高斯映射 N : M → S²；形状算子 S = −dN，高斯曲率 K = det S', visual: 'normal' },
  { text: '黎曼度量 g：在每个切空间 T_pM 上光滑地给出一个内积 g_p', visual: 'metric' },
  { text: '坐标卡 (U, φ)：φ : U → φ(U) ⊂ ℝⁿ 是同胚，不同坐标卡之间的转移映射光滑', visual: 'chart' },
  { text: 'Stokes 定理：∫_M dω = ∫_∂M ω', visual: 'stokes' },
  { text: '向量场 X ∈ Γ(TM)，积分曲线满足 γ′(t) = X(γ(t))', visual: 'field' },
  { text: '光滑曲线 γ : (−ε, ε) → M，γ(0) = p，速度 γ′(0) ∈ T_pM', visual: 'curve' },
  { text: 'Gauss 绝妙定理：高斯曲率只依赖于第一基本形式，是内蕴量' },
  { text: 'Gauss–Bonnet：∫_M K dA + ∫_∂M k_g ds = 2π χ(M)' },
  { text: 'Whitney 嵌入定理：n 维光滑流形可以嵌入 ℝ²ⁿ' },
  { text: 'Nash 嵌入定理：任意黎曼流形都能等距嵌入某个 ℝᴺ' },
  { text: '毛球定理：S² 上不存在处处非零的连续切向量场' },
  { text: 'Levi-Civita 联络：唯一无挠、且与度量相容的仿射联络' },
  { text: '测地线：∇_γ′ γ′ = 0，局部上是两点间的最短线' },
  { text: 'Hopf–Rinow：完备黎曼流形上任意两点可由最短测地线连接' },
  { text: 'de Rham 定理：H^k_dR(M) ≅ H^k(M; ℝ)' },
  { text: '外微分满足 d² = 0；对偶地，边界的边界为空：∂² = 0' },
  { text: 'Poincaré 引理：可缩区域上的闭形式都是恰当形式' },
  { text: 'Sard 定理：光滑映射的临界值集合测度为零' },
  { text: '反函数定理：df_p 可逆 ⇒ f 在 p 附近是局部微分同胚' },
  { text: '曲率张量 R(X, Y)Z = ∇_X∇_Y Z − ∇_Y∇_X Z − ∇_[X,Y] Z' },
  { text: '第二 Bianchi 恒等式：∇_X R(Y, Z) + ∇_Y R(Z, X) + ∇_Z R(X, Y) = 0' },
  { text: 'Frobenius 定理：分布可积 ⇔ 它对李括号封闭' },
  { text: 'Chern–Gauss–Bonnet：∫_M Pf(Ω) = (2π)ⁿ χ(M)' },
  { text: 'Poincaré 对偶：闭可定向 n 维流形上 Hᵏ(M) ≅ H_{n−k}(M)' },
  { text: 'Morse 理论：Morse 函数临界点的指数决定流形的胞腔结构' },
  { text: '李导数 L_X Y = [X, Y]，衡量 Y 沿 X 的流的变化' },
]
