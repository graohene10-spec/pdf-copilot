import { normalizeBackground } from '../settings/background.ts'
import type { GlassLegibility, GlassTint } from '../settings/model.ts'

type Ink = 'dark' | 'light'
type RGB = readonly [number, number, number]
type PixelGrid = { width: number; height: number; pixels: Uint8ClampedArray }
/** What the runtime writes on one element: ink (undefined = keep the stylesheet's), a minimum glass opacity, a photo tint, a text halo. */
type Look = { ink?: Ink; floor: number; tint?: RGB; halo: boolean }
type Original = { variables: Map<string, { value: string; priority: string }>; attribute: string | null; look: Look; signature: string; key: string }
export type GlassOptions = { legibility: GlassLegibility; compensation: number; tint: GlassTint }
const SIZE = 64
const DARK: RGB = [22, 26, 32]
const LIGHT: RGB = [242, 244, 247]
const COLORS: Record<Ink, string> = { dark: '#161a20', light: '#f2f4f7' }
const INK_VARIABLES = ['--ink', '--control-ink', '--secondary', '--muted']
const VARIABLES = [...INK_VARIABLES, '--glass-label-shadow', '--glass-floor', '--glass-rgb-1', '--glass-rgb-2', '--glass-rgb-3']
// 补偿强度 100% 时玻璃上的文字至少达到这个对比度（WCAG AA 4.5，再留一点余量给照片的局部起伏）。
const TARGET_CONTRAST = 4.8
// 低于这个对比度时给文字加一圈很淡的光晕，代替整块玻璃继续加厚。
const HALO_BELOW = 4.5
const SHADOWS: Record<Ink, { plain: string; halo: string }> = {
  dark: { plain: '0 1px 1px rgb(255 255 255 / .12)', halo: '0 0 3px rgb(255 255 255 / .45), 0 0 1px rgb(255 255 255 / .55)' },
  light: { plain: '0 1px 1px rgb(0 0 0 / .16)', halo: '0 0 3px rgb(0 0 0 / .45), 0 0 1px rgb(0 0 0 / .55)' },
}
const TEXT_REGIONS = '.breadcrumb,.library-search>kbd,.library-summary>div,.library-summary>.summary-note,.library-list-heading>span,.library-empty>h2,.library-empty>p,.library-empty>small,.document-card-title h3,.document-meta,.document-progress>span'
// Tabs take the top bar's ink rather than their own: per-tab sampling could leave one tab dark on a dark bar.
const TARGETS = '.ai-pane,.app-sidebar,.app-topbar,.library-heading,.library-search,.view-switch,.library-sort,.sort-direction,.arrange-reset,.library-summary,.library-toolbar,.library-list-heading,.library-empty,.document-card,.reader-tools,.document-details,' + TEXT_REGIONS
const EXCLUDED = '.answer-code-block,.answer-diagram,.history-menu,.rail-preview,.model-card,.question-editor,.document-collection.list,.settings-backdrop,.dialog-backdrop,.settings-dialog,.confirm-dialog,.markdown-paper,.pdf-scroll,.message-content,.document-cover,.user-question,.ai-selection-context,.message-code,.message-math,.source-pill'

function luminance(rgb: RGB): number {
  const channels = rgb.map(value => {
    const channel = Math.max(0, Math.min(255, value)) / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  })
  return .2126 * channels[0]! + .7152 * channels[1]! + .0722 * channels[2]!
}

function ratio(background: number, foreground: number): number {
  return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05)
}

/** WCAG contrast after compositing, with hysteresis for continuous adjustments. */
export function chooseGlassInk(background: RGB, previous?: Ink): Ink {
  const light = luminance(background)
  const darkContrast = ratio(light, luminance(DARK))
  const lightContrast = ratio(light, luminance(LIGHT))
  const best: Ink = darkContrast >= lightContrast ? 'dark' : 'light'
  if (!previous || previous === best) return best
  const oldContrast = previous === 'dark' ? darkContrast : lightContrast
  const nextContrast = best === 'dark' ? darkContrast : lightContrast
  return nextContrast > oldContrast * 1.12 ? best : previous
}

const mix = (below: RGB, color: RGB, alpha: number): RGB => below.map((channel, index) => channel * (1 - alpha) + color[index]! * alpha) as unknown as RGB

/** 补偿强度（0–100）对应的目标对比度：0 不补偿，100 为 4.8:1。 */
export function targetContrast(compensation: number): number {
  const amount = Math.max(0, Math.min(100, compensation)) / 100
  return amount ? 1 + (TARGET_CONTRAST - 1) * amount : 0
}

/** Contrast of the theme ink on glass of the given opacity over a photo color. */
export function glassContrast(below: RGB, material: RGB, alpha: number, ink: Ink): number {
  return ratio(luminance(mix(below, material, alpha)), luminance(ink === 'dark' ? DARK : LIGHT))
}

/**
 * 「取自底图」的玻璃底色：保留身后照片的色相和一点饱和度，亮度仍按主题（浅色主题很浅、深色主题很深），
 * 玻璃于是带着底图的颜色，而不是一层乳白或灰雾。
 */
export function photoTint(photo: RGB, theme: 'light' | 'dark'): RGB {
  const [red, green, blue] = photo.map(channel => Math.max(0, Math.min(255, channel)) / 255) as [number, number, number]
  const high = Math.max(red, green, blue), low = Math.min(red, green, blue), delta = high - low
  let hue = 0
  if (delta) hue = high === red ? ((green - blue) / delta + 6) % 6 : high === green ? (blue - red) / delta + 2 : (red - green) / delta + 4
  const lightness = (high + low) / 2
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0
  const targetLightness = theme === 'dark' ? .17 : .93
  const targetSaturation = Math.min(saturation, theme === 'dark' ? .36 : .5) * .85
  const chroma = (1 - Math.abs(2 * targetLightness - 1)) * targetSaturation
  const x = chroma * (1 - Math.abs(hue % 2 - 1)), m = targetLightness - chroma / 2
  const [r, g, b] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/**
 * The least opacity this glass needs so the theme's own ink stays readable on the photo below.
 * Instead of switching a dark-theme panel to dark text (it would look like a light-theme panel),
 * the glass simply gets denser until the text reaches the target contrast.
 */
export function glassFloor(below: RGB, material: RGB, ink: Ink, target = TARGET_CONTRAST): number {
  const foreground = luminance(ink === 'dark' ? DARK : LIGHT)
  const readable = (alpha: number) => ratio(luminance(mix(below, material, alpha)), foreground) >= target
  if (readable(0)) return 0
  if (!readable(1)) return 1
  let low = 0, high = 1
  for (let step = 0; step < 14; step++) { const middle = (low + high) / 2; if (readable(middle)) high = middle; else low = middle }
  return Math.ceil(high * 50) / 50
}

function materialColor(value: string): { rgb: RGB; alpha: number } {
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value)
  if (rgb) return { rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(value)
  if (srgb) return { rgb: [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255], alpha: srgb[4] === undefined ? 1 : Number(srgb[4]) }
  return { rgb: [0, 0, 0], alpha: 0 }
}

async function readPixels(dataUrl: string, document: Document): Promise<PixelGrid> {
  const separator = dataUrl.indexOf(',')
  const binary = atob(dataUrl.slice(separator + 1))
  const bytes = Uint8Array.from(binary, value => value.charCodeAt(0))
  const blob = new Blob([bytes], { type: dataUrl.slice(5, dataUrl.indexOf(';')) })
  const win = document.defaultView!
  let source: CanvasImageSource | undefined
  let bitmap: ImageBitmap | undefined
  let image: HTMLImageElement | undefined
  let url: string | undefined
  let canvas: HTMLCanvasElement | undefined
  let width = 0, height = 0
  try {
    if (typeof win.createImageBitmap === 'function') {
      try { bitmap = await win.createImageBitmap(blob); source = bitmap; width = bitmap.width; height = bitmap.height }
      catch { /* The image element fallback supports the same validated raster. */ }
    }
    if (!source) {
      url = URL.createObjectURL(blob)
      image = document.createElement('img')
      image.src = url
      await image.decode()
      source = image; width = image.naturalWidth; height = image.naturalHeight
    }
    if (!width || !height || width > 2560 || height > 2560 || width * height > 4_000_000) throw new Error('底板图片尺寸无效。')
    canvas = document.createElement('canvas')
    canvas.width = SIZE; canvas.height = SIZE
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!context) throw new Error('无法读取底板图片。')
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    context.fillStyle = '#fff'; context.fillRect(0, 0, SIZE, SIZE)
    context.drawImage(source, 0, 0, SIZE, SIZE)
    return { width, height, pixels: context.getImageData(0, 0, SIZE, SIZE).data }
  } finally {
    bitmap?.close()
    if (image) image.src = ''
    if (url) URL.revokeObjectURL(url)
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}

function photoColor(grid: PixelGrid, shell: DOMRect, rectangle: DOMRect): RGB {
  const scale = Math.max(shell.width / grid.width, shell.height / grid.height)
  const width = grid.width * scale, height = grid.height * scale
  const left = shell.left + (shell.width - width) / 2, top = shell.top + (shell.height - height) / 2
  const x0 = Math.max(0, Math.min(SIZE, (rectangle.left - left) / width * SIZE))
  const y0 = Math.max(0, Math.min(SIZE, (rectangle.top - top) / height * SIZE))
  const x1 = Math.max(x0, Math.min(SIZE, (rectangle.right - left) / width * SIZE))
  const y1 = Math.max(y0, Math.min(SIZE, (rectangle.bottom - top) / height * SIZE))
  let red = 0, green = 0, blue = 0, total = 0
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const weight = Math.max(0, Math.min(x1, x + 1) - Math.max(x0, x)) * Math.max(0, Math.min(y1, y + 1) - Math.max(y0, y))
      const index = (y * SIZE + x) * 4
      red += grid.pixels[index]! * weight; green += grid.pixels[index + 1]! * weight; blue += grid.pixels[index + 2]! * weight; total += weight
    }
  }
  return total ? [red / total, green / total, blue / total] : [255, 255, 255]
}

function textRectangle(element: HTMLElement): DOMRect {
  const region = element.matches('.library-heading') ? element.querySelector<HTMLElement>('h1') || element : element
  const bounds = region.getBoundingClientRect()
  if (!element.matches(TEXT_REGIONS + ',.library-heading')) return bounds
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(region)
  const text = range.getBoundingClientRect()
  if (!text.width || !text.height) return bounds
  // A flex row can span both light and dark parts while its glyphs occupy only
  // one side. Measure the actual text, clipped to its visible ellipsis box.
  const left = Math.max(bounds.left, text.left), top = Math.max(bounds.top, text.top)
  const right = Math.min(bounds.right, text.right), bottom = Math.min(bounds.bottom, text.bottom)
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : bounds
}

export function installGlassContrast(root: HTMLElement): { setBackground(dataUrl: string | null): void; setOptions(options: GlassOptions): void; refresh(): void; dispose(): void } {
  const document = root.ownerDocument, win = document.defaultView!
  const original = new Map<HTMLElement, Original>()
  const observed = new Set<HTMLElement>()
  const transparency = win.matchMedia('(prefers-reduced-transparency: reduce)')
  const contrast = win.matchMedia('(forced-colors: active), (prefers-contrast: more)')
  let dataUrl: string | null = null, grid: PixelGrid | null = null
  let generation = 0, frame = 0, disposed = false
  let lastAppearanceKey = '', materialRevision = 0, settlement = 0
  let classShell: HTMLElement | null = null
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let lastPaint = -Infinity
  const MOVING = '.sidebar-enter-active,.sidebar-leave-active,.topbar-enter-active,.topbar-leave-active,.pane-enter-active,.pane-leave-active'
  let options: GlassOptions = { legibility: 'thicken', compensation: 50, tint: 'theme' }
  const resize = new ResizeObserver(refresh)
  const classes = new MutationObserver(refresh)
  classes.observe(root, { attributes: true, attributeFilter: ['class'] })

  function restore(element: HTMLElement) {
    const saved = original.get(element)
    if (!saved) return
    for (const [name, value] of saved.variables) {
      if (value.value) element.style.setProperty(name, value.value, value.priority)
      else element.style.removeProperty(name)
    }
    if (saved.attribute === null) element.removeAttribute('data-glass-ink')
    else element.setAttribute('data-glass-ink', saved.attribute)
    element.removeAttribute('data-glass-floor')
    element.removeAttribute('data-glass-tint')
    original.delete(element)
  }
  function reset() {
    settlement++
    lastAppearanceKey = ''
    for (const element of original.keys()) restore(element)
    resize.disconnect(); observed.clear(); clearTimeout(settleTimer)
  }
  // 侧栏、顶栏或助手正在弹簧伸缩时，玻璃每一帧都在变宽；这时逐帧重算可读性会让动画一顿一顿，停下后再算一次。
  function refresh() {
    if (disposed || !dataUrl || frame) return
    // 动画期间最多每 200 ms 重算一次：刚出现的面板立刻拿到正确的字色和底色，又不逐帧计算。
    if (win.document.querySelector(MOVING) && win.performance.now() - lastPaint < 200) { clearTimeout(settleTimer); settleTimer = setTimeout(refresh, 120); return }
    frame = win.requestAnimationFrame(paint)
  }
  function paint() {
    frame = 0
    lastPaint = win.performance.now()
    if (disposed) return
    const appearance = document.documentElement.dataset
    const disabled = transparency.matches || contrast.matches || appearance.contrast === 'high' || appearance.glass === 'solid' || (options.legibility === 'off' && options.tint === 'theme')
    if (!dataUrl || !grid || disabled) {
      if (!dataUrl || disabled) reset()
      return
    }
    const shell = root.matches('.app-shell') ? root : root.querySelector<HTMLElement>('.app-shell')
    if (!shell) { reset(); return }
    if (shell !== classShell) {
      classes.disconnect()
      classes.observe(root, { attributes: true, attributeFilter: ['class'] })
      if (shell !== root) classes.observe(shell, { attributes: true, attributeFilter: ['class'] })
      classShell = shell
    }
    const bounds = shell.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const targets = new Set([...root.querySelectorAll<HTMLElement>(TARGETS)].filter(element => !element.closest(EXCLUDED)))
    if (root.matches(TARGETS) && !root.closest(EXCLUDED)) targets.add(root)
    for (const control of root.querySelectorAll<HTMLElement>('button,input:not([type="checkbox"]):not([type="file"]),textarea')) {
      if (control.closest(TARGETS) && !control.closest(EXCLUDED) && !control.matches('.close-tab,[role="tab"]')) targets.add(control)
    }
    for (const element of observed) if (element !== shell && !targets.has(element)) { resize.unobserve(element); observed.delete(element); restore(element) }
    if (!observed.has(shell)) { resize.observe(shell); observed.add(shell) }
    const changes: { element: HTMLElement; look: Look; key: string }[] = []
    const appearanceKey = `${generation}:${appearance.theme}:${win.getComputedStyle(document.documentElement).getPropertyValue('--glass-transparency')}:${options.legibility}:${options.compensation}:${options.tint}`
    const appearanceChanged = appearanceKey !== lastAppearanceKey
    lastAppearanceKey = appearanceKey
    // 带底色的玻璃（侧栏、顶栏、工具条、助手、卡片……）一律用当前主题的墨色，底图压不住时只把玻璃加厚；
    // 只有直接写在图片上的文字（没有玻璃）才按身后的光色在深浅墨色之间切换。玻璃里的控件跟随所在的玻璃。
    const themeInk: Ink = appearance.theme === 'dark' ? 'light' : 'dark'
    const target = options.legibility === 'thicken' ? targetContrast(options.compensation) : 0
    const glass = new Set<HTMLElement>()
    // Complete geometry/style reads before writing foreground variables. No PDF
    // pixels, body styles, layout dimensions or pointer events are involved.
    for (const element of [...targets].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)) {
      if (!observed.has(element)) { resize.observe(element); observed.add(element) }
      let inside = false
      for (let node = element.parentElement; node && node !== shell; node = node.parentElement) if (glass.has(node)) { inside = true; break }
      if (inside) { restore(element); continue }
      const own = materialColor(win.getComputedStyle(element).backgroundColor)
      const isGlass = own.alpha > .02 && !element.matches(TEXT_REGIONS)
      if (isGlass) glass.add(element)
      const rectangle = isGlass ? element.getBoundingClientRect() : textRectangle(element)
      if (!rectangle.width || !rectangle.height || rectangle.bottom <= bounds.top || rectangle.top >= bounds.bottom || rectangle.right <= bounds.left || rectangle.left >= bounds.right) continue
      const photo = photoColor(grid, bounds, rectangle)
      let background = photo
      const key = `${appearanceKey}:${materialRevision}:${background.map(channel => Math.round(channel)).join(',')}`
      const previous = original.get(element)
      // Selected and hover backgrounds change only their neutral shade. Keep
      // the control's glyph color steady until its photo region or material
      // transparency/theme changes, rather than responding to click classes.
      if (previous?.key === key && element.matches('button,input,textarea,.file-tab')) continue
      const layers: HTMLElement[] = []
      for (let node: HTMLElement | null = isGlass ? element.parentElement : element; node && node !== shell; node = node.parentElement) layers.unshift(node)
      const materials = layers.map(layer => materialColor(win.getComputedStyle(layer).backgroundColor)).filter(material => material.alpha > 0)
      const below = (color: RGB) => materials.reduce((result, material) => mix(result, material.rgb, Math.min(1, material.alpha)), color)
      background = below(background)
      // Theme changes are deliberate contrast changes, rather than tiny shifts
      // caused by scrolling. Do not carry the old theme's hysteresis into them.
      const previousInk = !appearanceChanged && previous?.key.startsWith(`${appearanceKey}:${materialRevision}:`) ? previous.look.ink : undefined
      if (isGlass) {
        const tint = options.tint === 'photo' ? photoTint(photo, themeInk === 'light' ? 'dark' : 'light') : undefined
        const material = tint || own.rgb
        if (options.legibility === 'ink') {
          changes.push({ element, key, look: { ink: chooseGlassInk(mix(background, material, own.alpha), previousInk), floor: 0, tint, halo: false } })
          continue
        }
        if (options.legibility === 'off' || !target) {
          changes.push({ element, key, look: { ink: options.legibility === 'off' ? undefined : themeInk, floor: 0, tint, halo: false } })
          continue
        }
        // 一块玻璃可能横跨照片的亮处和暗处（例如顶栏左边压在深色上）：按约 120px 的格子分别算，取最需要加厚的一格，
        // 玻璃上任何位置的文字都够清楚；补偿强度不足 100% 时，剩下的差距用文字光晕补上，而不是让玻璃继续泛白。
        const columns = Math.min(10, Math.max(1, Math.ceil(rectangle.width / 120))), rows = Math.min(10, Math.max(1, Math.ceil(rectangle.height / 120)))
        let floor = 0, weakest = Infinity
        const cells: RGB[] = []
        for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
          const cell = new DOMRect(rectangle.left + rectangle.width * column / columns, rectangle.top + rectangle.height * row / rows, rectangle.width / columns, rectangle.height / rows)
          const color = below(photoColor(grid, bounds, cell))
          cells.push(color)
          floor = Math.max(floor, glassFloor(color, material, themeInk, target))
        }
        const alpha = Math.max(floor, own.alpha)
        for (const color of cells) weakest = Math.min(weakest, glassContrast(color, material, alpha, themeInk))
        changes.push({ element, key, look: { ink: themeInk, floor, tint, halo: weakest < HALO_BELOW } })
        continue
      }
      if (options.legibility === 'off') continue
      changes.push({ element, key, look: { ink: chooseGlassInk(background, previousInk), floor: 0, halo: false } })
    }
    for (const { element, look, key } of changes) {
      const signature = `${look.ink}|${look.floor}|${look.tint?.join(',')}|${look.halo}`
      let saved = original.get(element)
      if (!saved) {
        saved = { variables: new Map(VARIABLES.map(name => [name, { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }])), attribute: element.getAttribute('data-glass-ink'), look, signature: '', key }
        original.set(element, saved)
      } else if (saved.signature === signature) { saved.key = key; continue }
      saved.look = look
      saved.signature = signature
      saved.key = key
      const reset = (name: string) => {
        const value = saved!.variables.get(name)
        if (value?.value) element.style.setProperty(name, value.value, value.priority)
        else element.style.removeProperty(name)
      }
      if (look.ink) {
        for (const name of INK_VARIABLES) element.style.setProperty(name, COLORS[look.ink])
        element.style.setProperty('--glass-label-shadow', SHADOWS[look.ink][look.halo ? 'halo' : 'plain'])
        element.dataset.glassInk = look.ink
      } else {
        for (const name of [...INK_VARIABLES, '--glass-label-shadow']) reset(name)
        if (saved.attribute === null) element.removeAttribute('data-glass-ink')
        else element.setAttribute('data-glass-ink', saved.attribute)
      }
      if (look.floor > 0) { element.style.setProperty('--glass-floor', String(look.floor)); element.dataset.glassFloor = '' }
      else { element.style.removeProperty('--glass-floor'); element.removeAttribute('data-glass-floor') }
      if (look.tint) {
        for (const name of ['--glass-rgb-1', '--glass-rgb-2', '--glass-rgb-3']) element.style.setProperty(name, look.tint.join(' '))
        element.dataset.glassTint = ''
      } else {
        for (const name of ['--glass-rgb-1', '--glass-rgb-2', '--glass-rgb-3']) reset(name)
        element.removeAttribute('data-glass-tint')
      }
    }
    if (appearanceChanged) {
      const request = ++settlement
      // The first frame of a theme/opacity change can still contain the old
      // interpolated material color. Once those actual CSS transitions finish,
      // invalidate control keys and read the final color exactly once. Hover
      // alone does not enter this path, and idle pages schedule no frame loop.
      const materials = root.getAnimations({ subtree: true }).filter(animation =>
        'transitionProperty' in animation && ['background-color', 'fill'].includes(String(animation.transitionProperty)))
      if (materials.length) void Promise.allSettled(materials.map(animation => animation.finished)).then(() => {
        if (disposed || request !== settlement || appearanceKey !== lastAppearanceKey) return
        materialRevision++
        refresh()
      })
    }
  }
  function setOptions(next: GlassOptions) {
    if (disposed || (next.legibility === options.legibility && next.compensation === options.compensation && next.tint === options.tint)) return
    options = { ...next }
    lastAppearanceKey = ''
    // 切换方式时先撤掉上一种方式写下的颜色与厚度，再按新方式重新计算。
    for (const element of [...original.keys()]) restore(element)
    if (dataUrl && !frame) frame = win.requestAnimationFrame(paint)
  }
  function setBackground(value: string | null) {
    if (disposed || value === dataUrl) return
    generation++
    const request = generation
    const valid = value ? normalizeBackground({ name: '底板', dataUrl: value }) : null
    dataUrl = valid?.dataUrl ?? null; grid = null
    reset()
    if (!dataUrl) return
    void readPixels(dataUrl, document).then(next => {
      if (disposed || request !== generation) return
      grid = next; refresh()
    }).catch(() => {
      if (disposed || request !== generation) return
      reset()
    })
  }
  function scroll() { refresh() }
  function transition(event: TransitionEvent) { if (event.propertyName === 'background-color' && event.target instanceof Element && event.target.matches(TARGETS)) refresh() }
  const mutations = new MutationObserver(refresh)
  mutations.observe(root, { childList: true, subtree: true })
  const appearance = new MutationObserver(() => {
    // Two switches may occur before the scheduled frame and end on the same
    // theme name. The intervening material transition still needs settling.
    lastAppearanceKey = ''
    refresh()
  })
  appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-glass', 'data-contrast', 'data-background'] })
  win.addEventListener('resize', refresh, { passive: true })
  root.addEventListener('scroll', scroll, { passive: true, capture: true })
  root.addEventListener('transitionend', transition)
  for (const query of [transparency, contrast]) query.addEventListener('change', refresh)
  return {
    setBackground, setOptions, refresh,
    dispose() {
      if (disposed) return
      disposed = true; generation++
      if (frame) win.cancelAnimationFrame(frame)
      mutations.disconnect(); appearance.disconnect(); classes.disconnect(); reset()
      win.removeEventListener('resize', refresh)
      root.removeEventListener('scroll', scroll, true)
      root.removeEventListener('transitionend', transition)
      for (const query of [transparency, contrast]) query.removeEventListener('change', refresh)
      dataUrl = null; grid = null
    },
  }
}
