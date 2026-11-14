// 铅笔草稿背景上和流形轮流出现的神经网络：几种架构的神经元与连线，摆在三维里一起慢慢转，
// 动画演示训练——前向传播的信号一层层走过去，反向传播的梯度（红笔）一层层走回来，权重随之变化，角落里画损失曲线。

import type { Vec } from './manifolds.ts'

export type NetworkId = 'transformer' | 'cnn' | 'mlp' | 'lstm' | 'autoencoder' | 'resnet' | 'unet' | 'gan' | 'gnn'
/** 神经元、连线（起点、终点、所在的传播阶段）、可选的弯曲连线（注意力），以及帮助看清结构的框。 */
export type Graph = {
  nodes: Float32Array
  edges: Uint16Array // [from, to] 成对
  stage: Uint8Array // 每条连线在前向传播的第几步
  stages: number
  bend: Float32Array // 每条连线中点沿 z 方向鼓出的量（注意力头画成弧线），0 为直线
  frames: Vec[][] // 特征图、注意力块等的外框（闭合折线）
  attention?: { rows: number; tokens: number } // Transformer：注意力权重随训练变化的那几层
  kernel?: { input: number[]; size: number; side: number; outputs: number[][] } // CNN：滑动的卷积核
}
export type Network = { id: NetworkId; name: string; facts: string[]; build: () => Graph }

type Builder = { nodes: number[]; edges: number[]; stage: number[]; bend: number[]; frames: Vec[][] }
const builder = (): Builder => ({ nodes: [], edges: [], stage: [], bend: [], frames: [] })
const node = (b: Builder, p: Vec) => { b.nodes.push(...p); return b.nodes.length / 3 - 1 }
const link = (b: Builder, from: number, to: number, stage: number, bend = 0) => { b.edges.push(from, to); b.stage.push(stage); b.bend.push(bend) }

function finish(b: Builder, extra: Partial<Graph> = {}): Graph {
  // 居中并缩放到单位球附近，和流形一样大。
  const count = b.nodes.length / 3
  let cx = 0, cy = 0, cz = 0
  for (let k = 0; k < count; k++) { cx += b.nodes[k * 3]!; cy += b.nodes[k * 3 + 1]!; cz += b.nodes[k * 3 + 2]! }
  cx /= count; cy /= count; cz /= count
  let radius = 0
  for (let k = 0; k < count; k++) radius = Math.max(radius, Math.hypot(b.nodes[k * 3]! - cx, b.nodes[k * 3 + 1]! - cy, b.nodes[k * 3 + 2]! - cz))
  const s = 1 / (radius || 1)
  const normalize = (p: Vec): Vec => [(p[0] - cx) * s, (p[1] - cy) * s, (p[2] - cz) * s]
  const nodes = new Float32Array(b.nodes.length)
  for (let k = 0; k < count; k++) nodes.set(normalize([b.nodes[k * 3]!, b.nodes[k * 3 + 1]!, b.nodes[k * 3 + 2]!]), k * 3)
  const stages = b.stage.reduce((max, value) => Math.max(max, value + 1), 1)
  return {
    nodes, edges: Uint16Array.from(b.edges), stage: Uint8Array.from(b.stage), stages, bend: Float32Array.from(b.bend.map(value => value * s)),
    frames: b.frames.map(frame => frame.map(normalize)), ...extra,
  }
}

// 一层神经元排成竖着的一圈（y–z 平面里的圆），层沿 x 方向排开：转起来看得出纵深。
function ring(b: Builder, count: number, x: number, radius = .18 + count * .09): number[] {
  return Array.from({ length: count }, (_, k) => {
    const a = (k / count) * Math.PI * 2 + .3
    return node(b, [x, Math.cos(a) * radius, Math.sin(a) * radius])
  })
}
function dense(b: Builder, layers: number[][], from = 0) {
  layers.slice(0, -1).forEach((layer, l) => { for (const a of layer) for (const c of layers[l + 1]!) link(b, a, c, from + l) })
}

function mlp(): Graph {
  const b = builder()
  const layers = [5, 8, 8, 6, 3].map((count, l) => ring(b, count, l * 1.35))
  dense(b, layers)
  return finish(b)
}

function autoencoder(): Graph {
  const b = builder()
  const layers = [8, 5, 3, 2, 3, 5, 8].map((count, l) => ring(b, count, l * 1.05, .15 + count * .1))
  dense(b, layers)
  // 中间的编码 z 用框圈出来。
  const x = 3 * 1.05
  b.frames.push([[x, .55, .55], [x, -.55, .55], [x, -.55, -.55], [x, .55, -.55]])
  return finish(b)
}

function cnn(): Graph {
  const b = builder()
  // 输入：7×7 的像素平面；卷积：两个通道各 5×5；池化：两个通道各 2×2；全连接 6 → 输出 3。
  const plane = (side: number, x: number, z0: number, gap: number) => {
    const ids: number[] = []
    for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) ids.push(node(b, [x, (i - (side - 1) / 2) * gap, z0 + (j - (side - 1) / 2) * gap]))
    const h = (side - 1) / 2 * gap + gap * .6
    b.frames.push([[x, -h, z0 - h], [x, h, z0 - h], [x, h, z0 + h], [x, -h, z0 + h]])
    return ids
  }
  const input = plane(7, 0, 0, .42)
  const conv = [plane(5, 1.5, -1.25, .36), plane(5, 1.5, 1.25, .36)]
  const pool = [plane(2, 2.8, -.9, .55), plane(2, 2.8, .9, .55)]
  const fc = ring(b, 6, 3.9, .95)
  const out = ring(b, 3, 4.8, .55)
  const outputs: number[][] = []
  conv.forEach(channel => channel.forEach((c, k) => {
    const i = Math.floor(k / 5), j = k % 5
    const patch: number[] = []
    for (let di = 0; di < 3; di++) for (let dj = 0; dj < 3; dj++) { const a = input[(i + di) * 7 + j + dj]!; patch.push(a); link(b, a, c, 0) }
    outputs.push(patch)
  }))
  pool.forEach((channel, c) => channel.forEach((p, k) => {
    const i = Math.floor(k / 2), j = k % 2
    for (let di = 0; di < 3; di++) for (let dj = 0; dj < 3; dj++) { const ii = Math.min(4, i * 2 + di), jj = Math.min(4, j * 2 + dj); link(b, conv[c]![ii * 5 + jj]!, p, 1) }
  }))
  for (const channel of pool) for (const p of channel) for (const f of fc) link(b, p, f, 2)
  for (const f of fc) for (const o of out) link(b, f, o, 3)
  return finish(b, { kernel: { input, size: 3, side: 7, outputs } })
}

function transformer(): Graph {
  const b = builder()
  // 6 个词元，4 行（嵌入 + 3 个 block），每行之间是两个注意力头（往 +z / −z 鼓出的弧线），外加每个词元的前馈小节点。
  const tokens = 6, rows = 4
  const grid: number[][] = []
  for (let r = 0; r < rows; r++) grid.push(Array.from({ length: tokens }, (_, j) => node(b, [(j - (tokens - 1) / 2) * .62, r * 1.05, 0])))
  for (let r = 0; r < rows - 1; r++) {
    for (const bend of [.55, -.55]) for (let i = 0; i < tokens; i++) for (let j = 0; j < tokens; j++) link(b, grid[r]![i]!, grid[r + 1]![j]!, r, bend)
    // 每个 block 一个框：Multi-Head Attention + FFN。
    const y0 = r * 1.05 + .2, y1 = r * 1.05 + .85, x = (tokens - 1) / 2 * .62 + .35
    b.frames.push([[-x, y0, -.75], [x, y0, -.75], [x, y1, -.75], [-x, y1, -.75]])
  }
  return finish(b, { attention: { rows: rows - 1, tokens } })
}

function lstm(): Graph {
  const b = builder()
  // 沿时间展开 6 步：每步输入 x_t（下）、记忆单元 3 个神经元（中间一小圈）、输出 h_t（上）；单元之间是循环连接。
  const steps = 6
  const cells: number[][] = []
  for (let t = 0; t < steps; t++) {
    const x = t * .95
    const input = node(b, [x, -1, 0])
    const cell = Array.from({ length: 3 }, (_, k) => { const a = k / 3 * Math.PI * 2; return node(b, [x, Math.cos(a) * .22, Math.sin(a) * .22]) })
    const output = node(b, [x, 1, 0])
    for (const c of cell) { link(b, input, c, t); link(b, c, output, t) }
    if (t) for (const a of cells[t - 1]!) for (const c of cell) link(b, a, c, t)
    cells.push(cell)
    b.frames.push([[x - .32, -.38, -.38], [x + .32, -.38, -.38], [x + .32, .38, -.38], [x - .32, .38, -.38]])
  }
  return finish(b)
}

// 和 ring 一样的一圈神经元，但圆心可以上下挪（U-Net 的 U 形、GAN 里并排的真假样本）。
function ringAt(b: Builder, count: number, x: number, y: number, radius: number, z = 0): number[] {
  return Array.from({ length: count }, (_, k) => {
    const a = (k / count) * Math.PI * 2 + .3
    return node(b, [x, y + Math.cos(a) * radius, z + Math.sin(a) * radius])
  })
}

function resnet(): Graph {
  const b = builder()
  // 六层等宽的全连接，每两层一个残差块：跳连从块的入口绕过两层，直接加到出口（画成鼓出去的弧线）。
  const layers = [6, 6, 6, 6, 6, 6, 3].map((count, l) => ring(b, count, l * 1.1, count === 3 ? .5 : .72))
  dense(b, layers)
  for (let l = 0; l + 2 < 6; l += 2) {
    layers[l]!.forEach((a, k) => link(b, a, layers[l + 2]![k]!, l + 1, .75))
    const x0 = l * 1.1 + .3, x1 = (l + 2) * 1.1 - .3
    b.frames.push([[x0, .95, -.95], [x1, .95, -.95], [x1, -.95, -.95], [x0, -.95, -.95]])
  }
  return finish(b)
}

function unet(): Graph {
  const b = builder()
  // U 形：左边一路下采样（层越来越小、位置越来越低），右边一路上采样回来；同一高度的两层之间有跳连，把细节直接递过去。
  const sizes = [9, 6, 4, 3, 4, 6, 9], depth = [0, 1, 2, 3, 2, 1, 0]
  const layers = sizes.map((count, l) => ringAt(b, count, l * 1.05, -depth[l]! * .75, .14 + count * .075))
  dense(b, layers)
  for (let l = 0; l < 3; l++) {
    const from = layers[l]!, to = layers[6 - l]!
    from.forEach((a, k) => link(b, a, to[k]!, 5 - l, .35))
  }
  const x = 3 * 1.05, y = -3 * .75
  b.frames.push([[x, y + .5, .5], [x, y - .5, .5], [x, y - .5, -.5], [x, y + .5, -.5]])
  return finish(b)
}

function gan(): Graph {
  const b = builder()
  // 生成器：噪声 z → 两层 → 假样本；旁边是真样本；判别器同时看这两堆，输出一个「真 / 假」。
  const generator = [ringAt(b, 3, 0, .8, .32), ringAt(b, 5, 1.1, .8, .5), ringAt(b, 7, 2.2, .8, .66)]
  const fake = ringAt(b, 8, 3.3, .8, .7), real = ringAt(b, 8, 3.3, -1.1, .7)
  const discriminator = [ringAt(b, 6, 4.6, -.15, .62), ringAt(b, 4, 5.6, -.15, .45), ringAt(b, 1, 6.5, -.15, 0)]
  dense(b, [...generator, fake])
  for (const sample of [fake, real]) for (const a of sample) for (const c of discriminator[0]!) link(b, a, c, 3)
  dense(b, discriminator, 4)
  for (const [x, y] of [[3.3, .8], [3.3, -1.1]] as const) b.frames.push([[x, y + .82, .82], [x, y - .82, .82], [x, y - .82, -.82], [x, y + .82, -.82]])
  return finish(b)
}

function gnn(): Graph {
  const b = builder()
  // 同一张图抄三遍（三轮消息传递）：每一轮，每个结点从上一轮的自己和邻居那里收消息；最后全图汇总成一个读出结点。
  const points: [number, number][] = [[0, .9], [.8, .5], [.95, -.35], [.3, -.95], [-.55, -.8], [-.95, 0], [-.45, .55], [.1, 0], [.45, -.3]]
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [7, 0], [7, 6], [7, 8], [8, 2], [8, 3], [7, 5], [1, 8]]
  const neighbours = points.map((_, i) => [i, ...edges.filter(pair => pair.includes(i)).map(pair => pair[0] === i ? pair[1] : pair[0])])
  const rounds = [0, 1, 2, 3].map(r => points.map(([y, z]) => node(b, [r * 1.25, y, z])))
  for (let r = 0; r < 3; r++) {
    neighbours.forEach((list, i) => { for (const j of list) link(b, rounds[r]![j]!, rounds[r + 1]![i]!, r) })
    b.frames.push([[r * 1.25, 1.15, -1.15], [r * 1.25, 1.15, 1.15], [r * 1.25, -1.15, 1.15], [r * 1.25, -1.15, -1.15]])
  }
  const readout = node(b, [4.7, 0, 0])
  for (const a of rounds[3]!) link(b, a, readout, 3)
  return finish(b)
}

const ML_GENERAL = [
  'Backpropagation: ∂L/∂w = ∂L/∂a · ∂a/∂z · ∂z/∂w — the chain rule, layer by layer',
  'Gradient descent: w ← w − η ∇L(w)',
  'Adam: m ← β₁m + (1 − β₁)g,  v ← β₂v + (1 − β₂)g²,  w ← w − η m̂ / (√v̂ + ε)',
  'Universal approximation: one hidden layer of enough units approximates any continuous function on a compact set',
  'Cross-entropy loss: L = −Σ y log ŷ',
  'Vanishing gradients: products of small Jacobians shrink the signal with depth',
  'Residual connection: xₗ₊₁ = xₗ + F(xₗ) keeps gradients flowing',
  'Dropout randomly zeroes units during training to prevent co-adaptation',
  'Batch norm: x̂ = (x − μ) / √(σ² + ε) over the batch, then y = γx̂ + β',
  'Overfitting: training loss keeps falling while validation loss rises',
  'Softmax: σ(z)ᵢ = exp(zᵢ) / Σⱼ exp(zⱼ)',
  'Cosine schedule: η = η_max · ½ (1 + cos(π t / T)) after a short warm-up',
  'Weight decay adds λ‖w‖² and pulls weights toward zero',
  'Layer norm normalises over features; batch norm over the batch',
  'GELU(x) = x · Φ(x)',
  'Sigmoid: σ(x) = 1 / (1 + e⁻ˣ), and σ′ = σ(1 − σ)',
  'Momentum: v ← μv − η∇L,  w ← w + v',
  'Bias–variance: expected error = bias² + variance + noise',
  'Early stopping: stop when the validation loss stops improving',
  'Gradient clipping: g ← g · min(1, c / ‖g‖)',
  'A mini-batch gradient is an unbiased but noisy estimate of the full gradient',
  'He initialisation: Var(w) = 2 / fan-in for ReLU layers',
  'KL divergence: KL(p ‖ q) = Σ p log(p / q) ≥ 0',
  'Label smoothing mixes the one-hot target with a uniform distribution',
  'Double descent: test error can fall again past the interpolation threshold',
  'Scaling laws: loss falls as a power law in data, parameters and compute',
  'Contrastive learning pulls positive pairs together and pushes negatives apart',
  'Distillation: a small student learns from a large teacher’s soft targets',
  'Without nonlinearities, stacked layers collapse into a single linear map',
  'An epoch is one full pass over the training set',
]

export const NETWORKS: Network[] = [
  { id: 'transformer', name: 'Transformer', build: transformer, facts: [
    'Attention(Q, K, V) = softmax(QKᵀ / √dₖ) V',
    'Multi-head attention: h heads attend in different subspaces, then concatenate',
    'Self-attention costs O(n² · d) in the sequence length n',
    'Positional encodings tell the model the order of tokens',
    'Each block: x ← x + MHA(LN(x)),  x ← x + FFN(LN(x))',
    'Causal mask: token t attends only to tokens ≤ t',
    'Feed-forward block: FFN(x) = W₂ GELU(W₁ x)',
    'KV cache: decoding reuses the keys and values of earlier tokens',
  ] },
  { id: 'cnn', name: 'CNN', build: cnn, facts: [
    'Convolution: (f ∗ k)[i, j] = Σ f[i + m, j + n] · k[m, n] — one kernel slides over the whole image',
    'Weight sharing makes convolution translation-equivariant',
    'Pooling summarises a neighbourhood and widens the receptive field',
    'The receptive field grows with depth: rₗ = rₗ₋₁ + (k − 1) · stride',
    'Output size: ⌊(n + 2p − k) / s⌋ + 1',
    '1 × 1 convolutions mix channels without looking at neighbours',
    'Max pooling keeps the strongest activation in each window',
  ] },
  { id: 'mlp', name: 'MLP', build: mlp, facts: [
    'Each layer computes a = σ(Wx + b)',
    'ReLU(x) = max(0, x): cheap, and keeps gradients alive for x > 0',
    'Xavier / He initialisation keeps activations at a stable scale through depth',
    'Depth lets a network compose simple features into complex ones',
  ] },
  { id: 'lstm', name: 'LSTM', build: lstm, facts: [
    'Vanilla RNN: hₜ = tanh(W hₜ₋₁ + U xₜ + b)',
    'LSTM gates f, i, o decide what to forget, write and read',
    'Cell state: cₜ = fₜ ⊙ cₜ₋₁ + iₜ ⊙ c̃ₜ',
    'Backpropagation through time unrolls the recurrence over the sequence',
    'GRU: update and reset gates, no separate cell state',
    'The cell state carries gradients almost unchanged — the constant error carousel',
  ] },
  { id: 'autoencoder', name: '自编码器', build: autoencoder, facts: [
    'An encoder squeezes x into a low-dimensional code z; a decoder reconstructs x̂',
    'Reconstruction loss: ‖x − x̂‖²',
    'Denoising autoencoder: reconstruct x from a corrupted copy x̃',
    'Reparameterisation trick: z = μ + σ ⊙ ε,  ε ~ 𝒩(0, I)',
    'VAE: maximise the ELBO  E[log p(x | z)] − KL(q(z | x) ‖ p(z))',
  ] },
]

NETWORKS.push(
  { id: 'resnet', name: 'ResNet', build: resnet, facts: [
    'Residual block: y = x + F(x) — the layers learn a correction to the identity',
    'The skip path gives gradients a shortcut: ∂y/∂x = I + ∂F/∂x',
    'ResNets made networks with hundreds of layers trainable (He et al., 2015)',
    'A deep ResNet behaves like an ensemble of many shallower paths',
    'Pre-activation: BN → ReLU → conv keeps the skip path clean',
    'Highway networks gate the skip; ResNets leave it open',
  ] },
  { id: 'unet', name: 'U-Net', build: unet, facts: [
    'U-Net: a contracting path, a bottleneck, and an expanding path of the same depth',
    'Skip connections copy fine detail from the encoder straight to the decoder',
    'Transposed convolution upsamples a feature map with learned weights',
    'Diffusion models use a U-Net to predict the noise ε added to xₜ',
    'Dice loss: 1 − 2|A ∩ B| / (|A| + |B|) for segmentation masks',
    'Downsampling trades resolution for a wider receptive field',
  ] },
  { id: 'gan', name: 'GAN', build: gan, facts: [
    'GAN: min_G max_D  E[log D(x)] + E[log(1 − D(G(z)))]',
    'The generator never sees real data — only the discriminator’s gradient',
    'At the optimum D*(x) = p_data / (p_data + p_g), and the game minimises the JS divergence',
    'Mode collapse: the generator covers only a few modes of the data',
    'WGAN replaces the JS divergence with the Wasserstein distance and a Lipschitz critic',
    'Non-saturating loss: train G to maximise log D(G(z))',
  ] },
  { id: 'gnn', name: '图神经网络', build: gnn, facts: [
    'Message passing: hᵥ ← φ(hᵥ, ⊕ᵤ∈N(v) ψ(hᵤ, hᵥ, eᵤᵥ))',
    'GCN layer: H′ = σ(D̃⁻½ Ã D̃⁻½ H W)',
    'After k rounds a node has seen its k-hop neighbourhood',
    'The aggregation must be permutation-invariant: sum, mean or max',
    'Message-passing GNNs are at most as powerful as the 1-WL isomorphism test',
    'Over-smoothing: with many layers, node features become indistinguishable',
    'Graph attention: neighbours are weighted by learned coefficients αᵤᵥ',
  ] },
)

export const ML_FACTS = ML_GENERAL
export function networkById(id: string) { return NETWORKS.find(item => item.id === id) }
