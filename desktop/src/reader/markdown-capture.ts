// 框选 Markdown 的一块区域交给阅读助手：区域里的原文（公式取 LaTeX 源码）加一张截图。
//
// Markdown 不是画在画布上的，截图靠把相交的段落连同计算后的样式、用到的网页字体和本地图片
// 一起克隆进 SVG <foreignObject>，再画到画布上。网络图片取不到像素，换成同样大小的灰底占位。
import { cropImage } from '../../../extension/reader/selection.mjs'

export interface Box { left: number; top: number; width: number; height: number }

const intersects = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
const boxOf = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })

/** Top-level blocks of the rendered document (or the source view's <pre>) that the region touches. */
export function regionBlocks(article: HTMLElement, region: Box) {
  const blocks = [...article.querySelectorAll<HTMLElement>(':scope > div > *, :scope > pre')]
  return blocks.filter(block => !block.classList.contains('selection-box') && intersects(boxOf(block.getBoundingClientRect()), region))
}

/** The text under the region, in reading order; formulas as $LaTeX$ so the assistant sees the exact source. */
export function regionText(article: HTMLElement, region: Box, limit = 16000) {
  const parts: string[] = []
  let length = 0
  let lastBlock: Element | null = null
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (node instanceof Element && node.matches('.ink-layer, .selection-box')) return NodeFilter.FILTER_REJECT
      // A formula is read once, as its source; its rendered spans are skipped.
      if (parent?.closest('.katex')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const range = document.createRange()
  for (let node = walker.nextNode(); node && length < limit; node = walker.nextNode()) {
    let text = ''
    if (node instanceof Element) {
      if (!node.classList.contains('katex') || !intersects(boxOf(node.getBoundingClientRect()), region)) continue
      const source = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
      text = source ? (node.closest('.katex-display') ? `$$${source}$$` : `$${source}$`) : node.textContent || ''
    } else if (node.textContent?.trim()) {
      range.selectNodeContents(node)
      if (![...range.getClientRects()].some(rect => intersects(boxOf(rect), region))) continue
      text = node.textContent
    } else continue
    const block = (node instanceof Element ? node : node.parentElement)?.closest('p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, tr, dt, dd, figcaption, td, th') || null
    if (lastBlock && block !== lastBlock) parts.push(block?.matches('td, th') && lastBlock.matches('td, th') && block.parentElement === lastBlock.parentElement ? '\t' : '\n')
    parts.push(text); length += text.length
    lastBlock = block
  }
  range.detach()
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit)
}

// ---- Rasterizing ------------------------------------------------------------

const fontData = new Map<string, Promise<string>>()
function dataUrl(url: string) {
  let cached = fontData.get(url)
  if (!cached) {
    cached = fetch(url).then(response => { if (!response.ok) throw new Error(String(response.status)); return response.blob() }).then(blobToDataUrl)
    cached.catch(() => fontData.delete(url))
    fontData.set(url, cached)
  }
  return cached
}
function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) })
}
const familyName = (value: string) => value.trim().replace(/^["']|["']$/g, '').toLowerCase()

/** @font-face rules of the families in use, with their files inlined (an SVG image cannot load web fonts). */
async function fontCss(families: Set<string>) {
  const rules: Promise<string>[] = []
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList
    try { list = sheet.cssRules } catch { continue }
    for (const rule of [...list]) {
      if (!(rule instanceof CSSFontFaceRule) || !families.has(familyName(rule.style.getPropertyValue('font-family')))) continue
      const base = sheet.href || document.baseURI
      const text = rule.cssText
      rules.push((async () => {
        let result = text
        for (const match of text.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
          if (match[2].startsWith('data:')) continue
          try { result = result.replace(match[0], `url("${await dataUrl(new URL(match[2], base).href)}")`) } catch { return '' }
        }
        return result
      })())
    }
  }
  return (await Promise.all(rules)).join('\n')
}

const LOGICAL = /(^|-)(block|inline)(-|$)/
function inlineStyles(source: Element, clone: Element, families: Set<string>) {
  const style = getComputedStyle(source)
  if (clone instanceof HTMLElement || clone instanceof SVGSVGElement) {
    let css = ''
    // Physical properties only: a logical twin (inset-block-start, inline-size…) listed later would override
    // the position and width set on the clone afterwards.
    for (let index = 0; index < style.length; index++) { const name = style[index]; if (!LOGICAL.test(name)) css += `${name}:${style.getPropertyValue(name)};` }
    clone.setAttribute('style', `${css}animation:none;transition:none;`)
    for (const family of style.fontFamily.split(',')) families.add(familyName(family))
  }
  // An SVG's own children keep their attributes and embedded styles.
  if (source instanceof SVGElement) return
  const sources = source.children, clones = clone.children
  for (let index = 0; index < sources.length && index < clones.length; index++) inlineStyles(sources[index], clones[index], families)
}

async function inlineImages(clone: HTMLElement, sources: HTMLImageElement[]) {
  const images = [...clone.querySelectorAll('img')]
  await Promise.all(images.map(async (image, index) => {
    const src = sources[index]?.currentSrc || image.getAttribute('src') || ''
    const local = src.startsWith('blob:') || src.startsWith('data:') || (src && new URL(src, location.href).origin === location.origin)
    if (local) { try { image.setAttribute('src', src.startsWith('data:') ? src : await dataUrl(src)); return } catch { /* fall through to the placeholder */ } }
    // Network images cannot be read back into a canvas; keep their space.
    image.removeAttribute('src'); image.removeAttribute('srcset')
    image.style.background = 'repeating-linear-gradient(45deg, rgb(128 128 128 / .14) 0 8px, rgb(128 128 128 / .22) 8px 16px)'
  }))
}

/**
 * Screenshot of a region of the rendered Markdown, as a PNG data URL.
 * `region` is in client (screen) pixels; `zoom` is the CSS zoom applied to the article.
 * Returns null when the platform refuses to rasterize the clone (the caller keeps the text).
 */
export async function captureRegion(article: HTMLElement, region: Box, zoom = 1): Promise<string | null> {
  const blocks = regionBlocks(article, region)
  const width = region.width / zoom, height = region.height / zoom
  const stage = document.createElement('div')
  const paper = getComputedStyle(article)
  stage.setAttribute('style', `position:relative;overflow:hidden;width:${width}px;height:${height}px;background:${paper.backgroundColor};color:${paper.color};font-family:${paper.fontFamily};font-size:${paper.fontSize};line-height:${paper.lineHeight};`)
  const families = new Set<string>([...paper.fontFamily.split(',')].map(familyName))
  const images: HTMLImageElement[] = []
  for (const block of blocks) {
    const box = block.getBoundingClientRect()
    const clone = block.cloneNode(true) as HTMLElement
    inlineStyles(block, clone, families)
    clone.style.position = 'absolute'
    clone.style.margin = '0'
    clone.style.boxSizing = 'border-box'
    clone.style.left = `${(box.left - region.left) / zoom}px`
    clone.style.top = `${(box.top - region.top) / zoom}px`
    clone.style.width = `${box.width / zoom}px`
    clone.style.setProperty('zoom', '1')
    clone.querySelectorAll('.selection-box').forEach(node => node.remove())
    images.push(...block.querySelectorAll('img'))
    stage.append(clone)
  }
  await inlineImages(stage, images)
  const fonts = await fontCss(families)
  const markup = new XMLSerializer().serializeToString(stage)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${fonts.replace(/<\//g, '<\\/')}</style>${markup.replace(/^<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/, '<div')}</div></foreignObject></svg>`
  const image = new Image()
  image.decoding = 'async'
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  try { await image.decode() } catch { return null }
  const scale = Math.min(3, Math.max(1, window.devicePixelRatio || 1) * zoom)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = paper.backgroundColor || '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  try { return cropImage(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height }, canvas.width, canvas.height) }
  catch { return null }
  finally { canvas.width = canvas.height = 0 }
}
