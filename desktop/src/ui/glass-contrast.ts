import { normalizeBackground } from '../settings/background.ts'

type Ink = 'dark' | 'light'
type RGB = readonly [number, number, number]
type PixelGrid = { width: number; height: number; pixels: Uint8ClampedArray }
type Original = { variables: Map<string, { value: string; priority: string }>; attribute: string | null; ink: Ink; key: string }
const SIZE = 64
const DARK: RGB = [21, 25, 24]
const LIGHT: RGB = [242, 245, 243]
const COLORS: Record<Ink, string> = { dark: '#151918', light: '#f2f5f3' }
const VARIABLES = ['--ink', '--control-ink', '--secondary', '--muted', '--glass-label-shadow']
const TEXT_REGIONS = '.breadcrumb,.library-search>kbd,.library-summary>div,.library-summary>.summary-note,.library-list-heading>span,.library-empty>h2,.library-empty>p,.library-empty>small,.document-card-title h3,.document-meta,.document-progress>span,.reading-status>span'
const TARGETS = '.app-sidebar,.app-topbar,.library-heading,.library-search,.library-summary,.library-toolbar,.library-list-heading,.library-empty,.document-card,.reader-tools,.document-outline,.reading-status,.document-details,.ai-pane,.file-tab,' + TEXT_REGIONS
const EXCLUDED = '.settings-backdrop,.dialog-backdrop,.settings-dialog,.confirm-dialog,.markdown-paper,.pdf-scroll,.message-content,.document-cover,.user-question,.ai-selection-context,.message-code,.message-math,.source-pill'

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

export function installGlassContrast(root: HTMLElement): { setBackground(dataUrl: string | null): void; refresh(): void; dispose(): void } {
  const document = root.ownerDocument, win = document.defaultView!
  const original = new Map<HTMLElement, Original>()
  const observed = new Set<HTMLElement>()
  const transparency = win.matchMedia('(prefers-reduced-transparency: reduce)')
  const contrast = win.matchMedia('(forced-colors: active), (prefers-contrast: more)')
  let dataUrl: string | null = null, grid: PixelGrid | null = null
  let generation = 0, frame = 0, disposed = false
  let classShell: HTMLElement | null = null
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
    original.delete(element)
  }
  function reset() {
    for (const element of original.keys()) restore(element)
    resize.disconnect(); observed.clear()
  }
  function refresh() {
    if (!disposed && dataUrl && !frame) frame = win.requestAnimationFrame(paint)
  }
  function paint() {
    frame = 0
    if (disposed) return
    const appearance = document.documentElement.dataset
    const disabled = transparency.matches || contrast.matches || appearance.contrast === 'high' || appearance.glass === 'solid'
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
    const changes: { element: HTMLElement; ink: Ink; key: string }[] = []
    const appearanceKey = `${generation}:${appearance.theme}:${win.getComputedStyle(document.documentElement).getPropertyValue('--glass-transparency')}`
    // Complete geometry/style reads before writing foreground variables. No PDF
    // pixels, body styles, layout dimensions or pointer events are involved.
    for (const element of targets) {
      if (!observed.has(element)) { resize.observe(element); observed.add(element) }
      const rectangle = textRectangle(element)
      if (!rectangle.width || !rectangle.height || rectangle.bottom <= bounds.top || rectangle.top >= bounds.bottom || rectangle.right <= bounds.left || rectangle.left >= bounds.right) continue
      let background = photoColor(grid, bounds, rectangle)
      const key = `${appearanceKey}:${background.map(channel => Math.round(channel)).join(',')}`
      const previous = original.get(element)
      // Selected and hover backgrounds change only their neutral shade. Keep
      // the control's glyph color steady until its photo region or material
      // transparency/theme changes, rather than responding to click classes.
      if (previous?.key === key && element.matches('button,input,textarea,.file-tab')) continue
      const layers: HTMLElement[] = []
      for (let node: HTMLElement | null = element; node && node !== shell; node = node.parentElement) layers.unshift(node)
      for (const layer of layers) {
        const folder = layer.matches('.file-tab') ? layer.querySelector<SVGElement>('.folder-fill') : null
        const material = materialColor(folder ? win.getComputedStyle(folder).fill : win.getComputedStyle(layer).backgroundColor)
        const alpha = Math.max(0, Math.min(1, material.alpha))
        if (alpha) background = background.map((channel, index) => channel * (1 - alpha) + material.rgb[index]! * alpha) as unknown as RGB
      }
      changes.push({ element, ink: chooseGlassInk(background, previous?.ink), key })
    }
    for (const { element, ink, key } of changes) {
      let saved = original.get(element)
      if (!saved) {
        saved = { variables: new Map(VARIABLES.map(name => [name, { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }])), attribute: element.getAttribute('data-glass-ink'), ink, key }
        original.set(element, saved)
      } else if (saved.ink === ink) { saved.key = key; continue }
      saved.ink = ink
      saved.key = key
      for (const name of VARIABLES) {
        const value = name === '--glass-label-shadow' ? ink === 'dark' ? '0 1px 1px rgb(255 255 255 / .12)' : '0 1px 1px rgb(0 0 0 / .16)' : COLORS[ink]
        element.style.setProperty(name, value)
      }
      element.dataset.glassInk = ink
    }
  }
  function setBackground(value: string | null) {
    if (disposed || value === dataUrl) return
    generation++
    const request = generation
    const valid = value ? normalizeBackground({ name: '底板', dataUrl: value }) : null
    dataUrl = valid?.dataUrl ?? null; grid = null
    if (!dataUrl) { reset(); return }
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
  const appearance = new MutationObserver(refresh)
  appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-glass', 'data-contrast', 'data-background'] })
  win.addEventListener('resize', refresh, { passive: true })
  root.addEventListener('scroll', scroll, { passive: true, capture: true })
  root.addEventListener('transitionend', transition)
  for (const query of [transparency, contrast]) query.addEventListener('change', refresh)
  return {
    setBackground, refresh,
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
