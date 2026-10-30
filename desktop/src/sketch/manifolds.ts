import { NETWORKS } from './networks.ts'
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

export type ManifoldId = 'calabi' | 'hopf' | 'klein' | 'boy' | 'breather' | 'dini' | 'knot' | 'torus'
/** 画好的线框：点、折线（点的下标），以及把参数映到画布坐标系（已居中缩放）的函数，用来在流形上画切平面等。 */
export type Mesh = {
  points: Float32Array
  lines: Uint32Array[]
  closed: boolean[]
  surface: ((u: number, v: number) => Vec)[] // 每块曲面一个，已归一化
  domains: { u: [number, number]; v: [number, number]; wrapU?: boolean; wrapV?: boolean }[]
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

// 环面（甜甜圈）：R = 1、r = .42，参数两个方向都首尾相接。
function torus(): Shape {
  const R = 1, r = .42
  return { patches: [{ u: [0, TAU], v: [0, TAU], nu: 56, nv: 26, wrapU: true, wrapV: true, f: (u, v) => [(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)] }] }
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
    'Calabi–Yau manifold: a compact Kähler manifold with vanishing first Chern class c₁ = 0',
    'Yau’s theorem: every compact Kähler manifold with c₁ = 0 admits a Ricci-flat metric',
    'A real slice of the quintic z₁⁵ + z₂⁵ = 1, stitched from 25 patches',
  ] },
  { id: 'hopf', name: 'Hopf 纤维化', shape: hopf, tilt: 1.0, facts: [
    'Hopf fibration S¹ → S³ → S²: every fibre is a great circle of S³',
    'Any two Hopf fibres are linked exactly once',
    'π₃(S²) ≅ ℤ, generated by the Hopf map',
  ] },
  { id: 'klein', name: '克莱因瓶', shape: klein, facts: [
    'The Klein bottle is non-orientable with χ = 0; it immerses but does not embed in ℝ³',
    'K ≅ ℝP² # ℝP², π₁(K) = ⟨a, b | abab⁻¹ = 1⟩',
  ] },
  { id: 'boy', name: 'Boy 曲面', shape: boy, facts: [
    'Boy’s surface: an immersion of ℝP² in ℝ³ without cusps',
    'ℝP² = S² / (x ∼ −x): χ = 1, π₁ = ℤ/2',
  ] },
  { id: 'breather', name: 'Breather 曲面', shape: breather, facts: [
    'The breather surface has constant Gaussian curvature K = −1',
    'Pseudospherical surfaces correspond to solutions of the sine-Gordon equation φᵤᵥ = sin φ',
  ] },
  { id: 'dini', name: 'Dini 曲面', shape: dini, facts: [
    'Dini’s surface: a twisted pseudosphere of constant negative curvature',
    'Hilbert: no complete surface of constant negative curvature immerses isometrically in ℝ³',
  ] },
  { id: 'torus', name: '环面（甜甜圈）', shape: torus, tilt: .62, facts: [
    'The torus T² = S¹ × S¹ has Euler characteristic 0, so ∫ K dA = 0',
    'On the torus K > 0 on the outer half and K < 0 around the hole',
    'The flat torus ℝ² / ℤ² carries a metric with K ≡ 0, and it embeds C¹-isometrically in ℝ³ (Nash–Kuiper)',
    'A coffee mug and a doughnut are homeomorphic: both are genus-one surfaces',
    'π₁(T²) = ℤ × ℤ: loops are counted by how often they wind around each circle',
  ] },
  { id: 'knot', name: '环面纽结', shape: knot, facts: [
    'The (2, 5) torus knot winds twice around one axis of a torus and five times around the other',
    'The boundary of a tubular neighbourhood of a knot is a torus T²',
  ] },
]

export function manifoldById(id: string) { return MANIFOLDS.find(item => item.id === id) }

/** 背景里轮换的全部画面：流形与神经网络（设置里可以挑选）。 */
export const SCENES: { id: string; name: string; kind: 'manifold' | 'network' }[] = [
  ...MANIFOLDS.map(item => ({ id: item.id, name: item.name, kind: 'manifold' as const })),
  ...NETWORKS.map(item => ({ id: item.id, name: item.name, kind: 'network' as const })),
]
export const MANIFOLD_IDS = SCENES.map(item => item.id)

/** Next scene to show: a different one from the list when there is a choice. */
export function nextManifold(ids: string[], current: string | undefined, random = Math.random): string | undefined {
  const pool = ids.filter(id => MANIFOLD_IDS.includes(id))
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
    domains: (shape.patches || []).map(patch => ({ u: patch.u, v: patch.v, wrapU: patch.wrapU, wrapV: patch.wrapV })),
    curves: (shape.curves || []).map(curve => (t: number) => normalize(curve.f(t))),
  }
}

// ---- 浮现的定理与定义 ----------------------------------------------------------

/** 画在流形上的示意：切平面、坐标基、法向量 / 高斯映射、度量圆、坐标卡、Stokes 边界、向量场与积分曲线、测地线、指数映射、平行移动、密切圆、主方向。 */
export type Visual = 'tangent' | 'basis' | 'normal' | 'metric' | 'chart' | 'stokes' | 'field' | 'curve' | 'geodesic' | 'exp' | 'transport' | 'curvature' | 'principal'
export type Note = { text: string; visual?: Visual }

export const THEOREMS: Note[] = [
  { text: 'Tangent space TₚM: velocities at p of all smooth curves through p — an n-dimensional vector space', visual: 'tangent' },
  { text: 'Coordinate basis {∂/∂u, ∂/∂v} spans TₚM, and coordinate fields commute: [∂/∂u, ∂/∂v] = 0', visual: 'basis' },
  { text: 'Gauss map N : M → S²; shape operator S = −dN, Gaussian curvature K = det S', visual: 'normal' },
  { text: 'Riemannian metric g: a smoothly varying inner product gₚ on each tangent space', visual: 'metric' },
  { text: 'Chart (U, φ): φ : U → φ(U) ⊂ ℝⁿ is a homeomorphism, and transition maps are smooth', visual: 'chart' },
  { text: 'Stokes’ theorem: ∫M dω = ∫∂M ω', visual: 'stokes' },
  { text: 'A vector field X ∈ Γ(TM) has integral curves γ′(t) = X(γ(t))', visual: 'field' },
  { text: 'A smooth curve γ : (−ε, ε) → M with γ(0) = p has velocity γ′(0) ∈ TₚM', visual: 'curve' },
  { text: 'Theorema Egregium: Gaussian curvature K = k₁k₂ depends only on the first fundamental form', visual: 'principal' },
  { text: 'Gauss–Bonnet: ∫M K dA + ∫∂M k_g ds = 2π χ(M)' },
  { text: 'Whitney embedding: every smooth n-manifold embeds in ℝ²ⁿ' },
  { text: 'Nash embedding: every Riemannian manifold embeds isometrically in some ℝᴺ' },
  { text: 'Hairy ball theorem: S² has no nowhere-vanishing continuous tangent field' },
  { text: 'Levi-Civita connection: the unique torsion-free connection compatible with the metric', visual: 'transport' },
  { text: 'Geodesics satisfy ∇γ′ γ′ = 0 and locally minimise length', visual: 'geodesic' },
  { text: 'Hopf–Rinow: on a complete Riemannian manifold any two points are joined by a minimising geodesic', visual: 'exp' },
  { text: 'de Rham: Hᵏ_dR(M) ≅ Hᵏ(M; ℝ)' },
  { text: 'd² = 0, and dually the boundary of a boundary is empty: ∂² = 0' },
  { text: 'Poincaré lemma: on a contractible domain every closed form is exact' },
  { text: 'Sard: the critical values of a smooth map have measure zero' },
  { text: 'Inverse function theorem: if dfₚ is invertible, f is a local diffeomorphism near p' },
  { text: 'Curvature: R(X, Y)Z = ∇X∇Y Z − ∇Y∇X Z − ∇[X,Y] Z' },
  { text: 'Second Bianchi identity: (∇X R)(Y, Z) + (∇Y R)(Z, X) + (∇Z R)(X, Y) = 0' },
  { text: 'Frobenius: a distribution is integrable iff it is closed under the Lie bracket' },
  { text: 'Chern–Gauss–Bonnet: ∫M Pf(Ω) = (2π)ⁿ χ(M)' },
  { text: 'Poincaré duality: Hᵏ(M) ≅ Hₙ₋ₖ(M) for closed oriented n-manifolds' },
  { text: 'Morse theory: indices of critical points build the cell structure of M' },
  { text: 'Lie derivative 𝓛X Y = [X, Y] measures how Y changes along the flow of X' },
  // 可以画在曲面上的
  { text: 'A geodesic is locally the straightest path: its acceleration is normal to the surface', visual: 'geodesic' },
  { text: 'Geodesic equation: ẍᵏ + Γᵏᵢⱼ ẋⁱ ẋʲ = 0', visual: 'geodesic' },
  { text: 'Clairaut: on a surface of revolution r · cos ψ is constant along every geodesic', visual: 'geodesic' },
  { text: 'Exponential map expₚ : TₚM → M sends v to γᵥ(1), a local diffeomorphism near 0', visual: 'exp' },
  { text: 'Gauss lemma: small geodesic spheres meet the radial geodesics at right angles', visual: 'exp' },
  { text: 'Geodesic circle: C(r) = 2πr − (π/3) K r³ + O(r⁴)', visual: 'exp' },
  { text: 'Parallel transport along γ solves ∇γ′ V = 0 and is an isometry between tangent spaces', visual: 'transport' },
  { text: 'Holonomy: transporting a vector around a small loop turns it by ∬ K dA', visual: 'transport' },
  { text: 'Christoffel symbols: Γᵏᵢⱼ = ½ gᵏˡ (∂ᵢ gⱼₗ + ∂ⱼ gᵢₗ − ∂ₗ gᵢⱼ)', visual: 'transport' },
  { text: 'Curvature of a curve: κ = |γ′ × γ″| / |γ′|³, and the osculating circle has radius 1/κ', visual: 'curvature' },
  { text: 'Meusnier: curves through p with the same tangent share the normal curvature κₙ = κ cos θ', visual: 'curvature' },
  { text: 'Frenet–Serret: T′ = κN, N′ = −κT + τB, B′ = −τN', visual: 'curvature' },
  { text: 'Principal curvatures k₁, k₂: eigenvalues of the shape operator, along orthogonal principal directions', visual: 'principal' },
  { text: 'Euler: normal curvature κₙ(θ) = k₁ cos²θ + k₂ sin²θ', visual: 'principal' },
  { text: 'Mean curvature H = (k₁ + k₂) / 2; minimal surfaces have H = 0', visual: 'principal' },
  { text: 'Gaussian curvature K = (LN − M²) / (EG − F²)', visual: 'principal' },
  { text: 'First fundamental form: ds² = E du² + 2F du dv + G dv²', visual: 'metric' },
  { text: 'Isometry: a map that preserves the metric, so lengths, angles and areas', visual: 'metric' },
  { text: 'Area element: dA = √(EG − F²) du dv', visual: 'chart' },
  { text: 'Atlas: charts covering M whose transition maps φ ∘ ψ⁻¹ are smooth', visual: 'chart' },
  { text: 'Divergence theorem: ∫Ω div X dV = ∫∂Ω ⟨X, n⟩ dA', visual: 'stokes' },
  { text: 'Green: ∮∂D P dx + Q dy = ∬D (∂Q/∂x − ∂P/∂y) dA', visual: 'stokes' },
  { text: 'Flow of X: d/dt φₜ(p) = X(φₜ(p)), and φₛ ∘ φₜ = φₛ₊ₜ', visual: 'field' },
  { text: 'Differential dfₚ : TₚM → T_f(p)N pushes velocities forward', visual: 'curve' },
  { text: 'A surface in ℝ³ is orientable iff it has a continuous unit normal field', visual: 'normal' },
  { text: 'Second fundamental form: II = L du² + 2M du dv + N dv², with L = ⟨fᵤᵤ, N⟩', visual: 'normal' },
  { text: 'Tangent bundle TM = ⊔ TₚM is itself a 2n-dimensional manifold', visual: 'tangent' },
  { text: 'Cotangent space T*ₚM: linear functionals on TₚM, spanned by du, dv', visual: 'basis' },
  // 只写字的
  { text: 'Euler characteristic: χ = V − E + F for any triangulation' },
  { text: 'Closed surfaces are spheres, connected sums of tori, or connected sums of projective planes' },
  { text: 'Bonnet–Myers: Ric ≥ (n − 1)k > 0 forces diam ≤ π/√k and a finite fundamental group' },
  { text: 'Cartan–Hadamard: a complete, simply connected manifold with K ≤ 0 is diffeomorphic to ℝⁿ' },
  { text: 'Uniformization: every simply connected Riemann surface is the disc, the plane or the sphere' },
  { text: 'Ricci flow: ∂g/∂t = −2 Ric' },
  { text: 'Hodge: every de Rham class has a unique harmonic representative' },
  { text: 'A Lie group is a manifold with smooth group operations; Tₑ G is its Lie algebra' },
  { text: 'Cartan’s magic formula: 𝓛X = d ιX + ιX d' },
  { text: 'Wedge product: α ∧ β = (−1)ᵏˡ β ∧ α' },
  { text: 'Leibniz rule: d(α ∧ β) = dα ∧ β + (−1)ᵏ α ∧ dβ' },
  { text: 'Jacobi equation: D²J/dt² + R(J, γ′)γ′ = 0' },
  { text: 'Sectional curvature: K(X, Y) = ⟨R(X, Y)Y, X⟩ / (|X|²|Y|² − ⟨X, Y⟩²)' },
  { text: 'Ricci curvature: Ric(X, Y) = tr(Z ↦ R(Z, X)Y)' },
  { text: 'Einstein manifold: Ric = λg' },
  { text: 'Codazzi–Mainardi: (∇X S)Y = (∇Y S)X' },
  { text: 'Regular value theorem: f⁻¹(c) is a submanifold of dimension n − k' },
  { text: 'Brouwer: every continuous map Dⁿ → Dⁿ has a fixed point' },
  { text: 'Partitions of unity exist subordinate to any open cover of a smooth manifold' },
  { text: 'Pullback commutes with d: f*(dω) = d(f*ω)' },
  { text: 'Vector bundle: locally U × ℝᵏ, glued by transition functions in GL(k)' },
  { text: 'Lie bracket: [X, Y]f = X(Yf) − Y(Xf)' },
  { text: 'Hopf: the index sum of a vector field with isolated zeros equals χ(M)' },
]
