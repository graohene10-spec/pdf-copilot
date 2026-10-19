/**
 * 光线折射：让玻璃有一圈透镜般的厚边。
 *
 * 每块玻璃按自身的尺寸和圆角生成一张位移图：R/G 通道是往玻璃内侧取样的偏移（越靠边越强，中间平坦处为零），
 * B 通道是透镜边的范围。滤镜把身后的画面分成两份——中间照常磨砂（模糊 + 饱和度，数值取自这块玻璃的
 * --lens-blur / --lens-saturate），边缘用几乎不模糊的原画面经 feDisplacementMap 弯折后盖在上面：
 * 照片、页面和光斑在边缘被拉伸、弯曲，像隔着一块有厚度的凸透镜看过去，即使中间模糊得很重也看得出来。
 * 小块玻璃（菜单、提示、工具条）再把红、蓝通道错开一点点，边缘出现很淡的色散。文字画在玻璃之上，不参与扭曲。
 *
 * 位移图按尺寸缓存、同尺寸的玻璃共用一个滤镜；尺寸变化时稍后重算，期间旧图随元素拉伸。
 * 关闭「光线折射」、实底玻璃、减少透明度或高对比度时整个效果撤掉，玻璃退回普通的模糊。
 */

const SELECTOR = [
  '.app-sidebar', '.app-topbar', '.library-search', '.document-card', '.reader-tools', '.document-outline', '.reading-pill',
  '.selection-context', '.document-details', '.answer-notice', '.toast-message', '.confirm-dialog', '.selection-ask',
  '.glass-tooltip', '.context-menu', '.ai-pane', '.history-menu', '.rail-preview', '.settings-dialog', '.split-picker',
  '.update-card', '.ink-palette', '.capture-thinking', '.thought-bubble', '.capture-quick-footer button', '.chrome-tag',
].join(',')
const NS = 'http://www.w3.org/2000/svg'
// 透镜边的宽度（px）；最大偏移是它的一半。
const MAX_BEZEL = 24
const MIN_BEZEL = 6
// 位移图最多这么多像素，大面板按比例降低分辨率（但透镜边至少保留 5 个像素）。
const MAX_PIXELS = 140_000
// 小于这个面积的玻璃加一点色散。
const DISPERSION_AREA = 70_000
const SPARE_FILTERS = 12

export type LensShape = { width: number; height: number; radius: number }
export type LensMaterial = { blur: number; saturate: number }

/** Bezel width for a glass of this size: thin on small controls, capped on panels. */
export function bezelFor({ width, height }: LensShape): number {
  return Math.max(MIN_BEZEL, Math.min(MAX_BEZEL, Math.min(width, height) * .3))
}

/**
 * Lens map for a rounded rectangle: RGBA bytes where R/G encode the inward sampling offset
 * (128 = none, ±127 = half the filter scale) and B how much of the bent rim covers the frosted middle.
 * Pixels outside the shape or past the bezel stay neutral.
 */
export function refractionMap(shape: LensShape, bezel = bezelFor(shape), resolution = mapResolution(shape, bezel)) {
  const { width, height } = shape
  const radius = Math.max(0, Math.min(shape.radius, width / 2, height / 2))
  const columns = Math.max(2, Math.round(width * resolution)), rows = Math.max(2, Math.round(height * resolution))
  const data = new Uint8ClampedArray(columns * rows * 4)
  const halfWidth = width / 2, halfHeight = height / 2
  for (let row = 0; row < rows; row++) {
    const y = (row + .5) / rows * height - halfHeight
    for (let column = 0; column < columns; column++) {
      const x = (column + .5) / columns * width - halfWidth
      const index = (row * columns + column) * 4
      data[index] = 128; data[index + 1] = 128; data[index + 3] = 255
      // Signed distance to the rounded rectangle and its outward normal.
      const qx = Math.abs(x) - (halfWidth - radius), qy = Math.abs(y) - (halfHeight - radius)
      const distance = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius)
      if (distance < 0 || distance >= bezel) continue
      let nx = 0, ny = 0
      if (qx > 0 && qy > 0) { const length = Math.hypot(qx, qy) || 1; nx = qx / length * Math.sign(x); ny = qy / length * Math.sign(y) }
      else if (qx > qy) nx = Math.sign(x)
      else ny = Math.sign(y)
      // 凸透镜的边：越靠外缘弯折越强，向内平滑地衰减到零（smoothstep，两端都没有折痕）。
      // 偏移的变化率保持小于 1，边缘只是被拉伸放大，不会把身后的内容翻折成条纹。
      const edge = 1 - distance / bezel
      const strength = edge * edge * (3 - 2 * edge)
      data[index] = Math.round(128 - nx * strength * 127)
      data[index + 1] = Math.round(128 - ny * strength * 127)
      // 透镜边与磨砂之间平滑过渡，靠外缘几乎完全是弯折后的清晰画面。
      data[index + 2] = Math.round(Math.min(1, edge * 1.25) ** 1.2 * 255)
    }
  }
  return { columns, rows, data }
}

export function mapResolution({ width, height }: LensShape, bezel: number): number {
  const budget = Math.sqrt(MAX_PIXELS / Math.max(1, width * height))
  return Math.min(.5, Math.max(5 / bezel, budget))
}

/** The SVG filter primitives: frosted middle, bent (and on small glass, slightly dispersed) rim, then saturation. */
export function lensFilterMarkup(href: string, shape: LensShape, material: LensMaterial, bezel = bezelFor(shape)): string {
  const blur = Math.max(0, material.blur), rimBlur = Math.min(2.5, blur * .12)
  const frost = blur > .2 ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur.toFixed(1)}" result="frost"/>` : ''
  const soft = rimBlur > .3 ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${rimBlur.toFixed(1)}" result="soft"/>` : ''
  const source = soft ? 'soft' : 'SourceGraphic'
  const displace = (scale: number, result: string) => `<feDisplacementMap in="${source}" in2="lens-map" scale="${scale.toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`
  const lens = shape.width * shape.height < DISPERSION_AREA
    ? displace(bezel * 1.1, 'lens-r') + displace(bezel, 'lens-g') + displace(bezel * .9, 'lens-b')
      + '<feColorMatrix in="lens-r" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"/>'
      + '<feColorMatrix in="lens-g" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"/>'
      + '<feColorMatrix in="lens-b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"/>'
      + '<feComposite in="red" in2="green" operator="arithmetic" k2="1" k3="1" result="red-green"/>'
      + '<feComposite in="red-green" in2="blue" operator="arithmetic" k2="1" k3="1" result="lens"/>'
    : displace(bezel, 'lens')
  return `<feImage href="${href}" preserveAspectRatio="none" result="lens-map"/>${frost}${soft}${lens}`
    + '<feColorMatrix in="lens-map" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="rim"/>'
    + '<feComposite in="lens" in2="rim" operator="in" result="rim-lens"/>'
    + `<feComposite in="rim-lens" in2="${frost ? 'frost' : 'SourceGraphic'}" operator="over" result="glass"/>`
    + `<feColorMatrix in="glass" type="saturate" values="${material.saturate.toFixed(2)}"/>`
}

// 尺寸按格子取整：位移图会拉伸到元素实际大小，差几个像素看不出来；页码胶囊这类随数字变宽的玻璃不必每次重建。
const bucket = (value: number) => { const step = value < 160 ? 8 : value < 600 ? 16 : 32; return Math.max(step, Math.round(value / step) * step) }
function quantize(shape: LensShape): LensShape { return { width: bucket(shape.width), height: bucket(shape.height), radius: Math.round(shape.radius) } }
function shapeKey(shape: LensShape) { return `${shape.width}x${shape.height}r${shape.radius}` }
function lensKey(shape: LensShape, material: LensMaterial) { return `${shapeKey(shape)}b${material.blur.toFixed(1)}s${material.saturate.toFixed(2)}` }

function shapeOf(element: HTMLElement, style: CSSStyleDeclaration): LensShape | null {
  const width = element.offsetWidth, height = element.offsetHeight
  if (width < 12 || height < 12) return null
  const value = style.borderTopLeftRadius
  const radius = value.endsWith('%') ? parseFloat(value) / 100 * Math.min(width, height) : parseFloat(value) || 0
  return quantize({ width, height, radius: Math.min(radius, width / 2, height / 2) })
}

function materialOf(style: CSSStyleDeclaration): LensMaterial {
  const blur = parseFloat(style.getPropertyValue('--lens-blur')) || 0
  const saturate = style.getPropertyValue('--lens-saturate').trim()
  return { blur, saturate: saturate.endsWith('%') ? parseFloat(saturate) / 100 : parseFloat(saturate) || 1 }
}

export function installRefraction(root: HTMLElement): () => void {
  const document = root.ownerDocument, win = document.defaultView!
  const transparency = win.matchMedia('(prefers-reduced-transparency: reduce)')
  const contrast = win.matchMedia('(forced-colors: active), (prefers-contrast: more)')
  const filters = new Map<string, { id: string; node: SVGFilterElement; users: number; idle: number }>()
  // 位移图只取决于形状：拖动透明度或模糊滑杆时只重写滤镜参数，不重画位移图。
  const maps = new Map<string, string>()
  // 每块玻璃当前使用的滤镜（null：已在观察尺寸，但太小或隐藏，暂不折射）。
  const assigned = new Map<HTMLElement, string | null>()
  const pending = new Map<HTMLElement, ReturnType<typeof setTimeout>>()
  let sequence = 0, frame = 0, disposed = false, idleClock = 0, everything = true
  const holder = document.createElementNS(NS, 'svg')
  holder.setAttribute('aria-hidden', 'true')
  holder.setAttribute('width', '0'); holder.setAttribute('height', '0')
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  document.body.append(holder)

  const enabled = () => {
    const data = document.documentElement.dataset
    return data.refraction !== 'off' && data.glass !== 'solid' && data.contrast !== 'high' && !transparency.matches && !contrast.matches
  }

  function filterFor(shape: LensShape, material: LensMaterial) {
    const key = lensKey(shape, material)
    let entry = filters.get(key)
    if (!entry) {
      const bezel = bezelFor(shape)
      let href = maps.get(shapeKey(shape))
      if (!href) {
        const { columns, rows, data } = refractionMap(shape, bezel)
        const canvas = document.createElement('canvas')
        canvas.width = columns; canvas.height = rows
        // CPU 画布：GPU 画布的 toDataURL 要从显卡回读，一次就能卡住好几帧。
        canvas.getContext('2d', { willReadFrequently: true })!.putImageData(new ImageData(data, columns, rows), 0, 0)
        href = canvas.toDataURL('image/png')
        canvas.width = canvas.height = 0
      }
      maps.delete(shapeKey(shape)); maps.set(shapeKey(shape), href)
      if (maps.size > 32) maps.delete(maps.keys().next().value!)
      const node = document.createElementNS(NS, 'filter')
      const id = `kaizhi-lens-${++sequence}`
      node.id = id
      // 滤镜区域就是元素自身的边框盒（objectBoundingBox），位移图铺满整个区域。
      for (const [name, value] of Object.entries({ x: '0', y: '0', width: '1', height: '1', 'color-interpolation-filters': 'sRGB' })) node.setAttribute(name, value)
      node.innerHTML = lensFilterMarkup(href, shape, material, bezel)
      holder.append(node)
      entry = { id, node, users: 0, idle: 0 }
      filters.set(key, entry)
    }
    return { key, entry }
  }

  function drop(key: string | null | undefined) {
    const entry = key ? filters.get(key) : undefined
    if (entry && --entry.users <= 0) entry.idle = ++idleClock
  }

  function release(element: HTMLElement) {
    clearTimeout(pending.get(element)); pending.delete(element)
    if (!assigned.has(element)) return
    drop(assigned.get(element))
    assigned.delete(element)
    element.style.removeProperty('--refraction')
    resize.unobserve(element)
  }

  function prune() {
    const idle = [...filters.entries()].filter(([, entry]) => entry.users <= 0).sort((a, b) => a[1].idle - b[1].idle)
    for (const [key, entry] of idle.slice(0, Math.max(0, idle.length - SPARE_FILTERS))) { entry.node.remove(); filters.delete(key) }
  }

  function assign(element: HTMLElement) {
    if (!assigned.has(element)) { assigned.set(element, null); resize.observe(element) }
    const style = win.getComputedStyle(element)
    const shape = shapeOf(element, style)
    const material = materialOf(style)
    const key = shape ? lensKey(shape, material) : null
    const current = assigned.get(element)
    if (current === key) return
    drop(current)
    if (!shape) { assigned.set(element, null); element.style.removeProperty('--refraction'); return }
    const { entry } = filterFor(shape, material)
    entry.users++
    assigned.set(element, key)
    element.style.setProperty('--refraction', `url(#${entry.id})`)
  }

  const resize = new ResizeObserver(entries => {
    for (const { target } of entries) {
      const element = target as HTMLElement
      if (!assigned.has(element)) continue
      // 刚显示出来的弹层（提示、菜单）立即配上透镜；已有透镜的玻璃改变尺寸时才延后重算。
      if (assigned.get(element) === null) { assign(element); continue }
      // 拖动缩放面板时不逐帧重画位移图：旧图会随元素拉伸，停下片刻后再按新尺寸生成。
      clearTimeout(pending.get(element))
      pending.set(element, setTimeout(() => { pending.delete(element); if (!disposed && assigned.has(element) && element.isConnected) { assign(element); prune() } }, 140))
    }
  })

  function scan() {
    frame = 0
    if (disposed) return
    const all = everything
    everything = false
    if (!enabled()) { for (const element of [...assigned.keys()]) release(element); prune(); return }
    const found = new Set<HTMLElement>(root.querySelectorAll<HTMLElement>(SELECTOR))
    // 弹层可能挂在 #app 之外（例如 body 下的提示）。
    for (const element of document.body.querySelectorAll<HTMLElement>(':scope > :is(' + SELECTOR + ')')) found.add(element)
    for (const element of [...assigned.keys()]) if (!found.has(element) || !element.isConnected) release(element)
    // 主题、透明度或模糊程度变化时，已有的玻璃也按新的模糊与饱和度重建滤镜。
    for (const element of found) if (all || !assigned.has(element)) assign(element)
    prune()
  }
  const schedule = () => { if (!disposed && !frame) frame = win.requestAnimationFrame(scan) }
  const scheduleAll = () => { everything = true; schedule() }

  const mutations = new MutationObserver(records => {
    for (const record of records) for (const node of [...record.addedNodes, ...record.removedNodes]) if (node.nodeType === 1) { schedule(); return }
  })
  mutations.observe(root, { childList: true, subtree: true })
  mutations.observe(document.body, { childList: true })
  const appearance = new MutationObserver(scheduleAll)
  appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['data-refraction', 'data-glass', 'data-contrast', 'data-theme', 'style'] })
  for (const query of [transparency, contrast]) query.addEventListener('change', scheduleAll)
  schedule()

  return () => {
    if (disposed) return
    disposed = true
    if (frame) win.cancelAnimationFrame(frame)
    mutations.disconnect(); appearance.disconnect(); resize.disconnect()
    for (const query of [transparency, contrast]) query.removeEventListener('change', scheduleAll)
    for (const element of [...assigned.keys()]) release(element)
    holder.remove(); filters.clear(); maps.clear()
  }
}
