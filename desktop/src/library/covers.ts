/**
 * 书目卡片的显示封面：默认图标、首页预览，或用户自己选的图片。
 *
 * 封面是一张压缩过的小 JPEG（最长边 480px），按文档存在本机文档库的设置里（`cover.v1.<id>`），
 * 另有一份索引记录哪些文档换过封面，启动时只读这些。同一本书的多个副本共用一个封面。
 */
import { reactive } from 'vue'
import { library } from '../sdk'

const KEY = 'cover.v1.'
const INDEX = 'cover.v1.index'
const EDGE = 480
// 设置值最多 1 MB；封面压到这个大小以内。
const MAX_CHARS = 900_000

export type CoverKind = 'page' | 'image'
export type Cover = { kind: CoverKind; image: string }
/** 已加载的自定义封面，按文档 id。没有条目的文档显示默认图标。 */
export const covers = reactive(new Map<string, Cover>())
let loaded: Promise<void> | undefined

const keyFor = (id: string) => KEY + id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
const COVER_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/
export function validCover(value: unknown): value is Cover {
  const cover = value as Cover
  return !!cover && (cover.kind === 'page' || cover.kind === 'image') && typeof cover.image === 'string' && cover.image.length <= MAX_CHARS && COVER_IMAGE.test(cover.image)
}

async function readIndex(): Promise<string[]> {
  try { const list = JSON.parse(await library.getSetting(INDEX) || '[]'); return Array.isArray(list) ? list.filter(item => typeof item === 'string') : [] }
  catch { return [] }
}

export function loadCovers(): Promise<void> {
  loaded ??= (async () => {
    for (const id of await readIndex()) {
      try {
        const cover = JSON.parse(await library.getSetting(keyFor(id)) || 'null')
        if (validCover(cover)) covers.set(id, cover)
      } catch { /* 读不出的封面按默认图标显示 */ }
    }
  })()
  return loaded
}

export async function setCover(id: string, cover: Cover | null): Promise<void> {
  await loadCovers()
  if (cover && !validCover(cover)) throw new Error('封面图片无效。')
  const index = new Set(await readIndex())
  if (cover) { await library.setSetting(keyFor(id), JSON.stringify(cover)); index.add(id); covers.set(id, cover) }
  else { await library.setSetting(keyFor(id), 'null'); index.delete(id); covers.delete(id) }
  await library.setSetting(INDEX, JSON.stringify([...index]))
}

/** Scale a drawable into a JPEG no longer than EDGE on its longest side, shrinking quality until it fits. */
function encode(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
  const paint = canvas.getContext('2d', { willReadFrequently: true })!
  paint.fillStyle = '#fff'; paint.fillRect(0, 0, canvas.width, canvas.height)
  paint.imageSmoothingQuality = 'high'
  paint.drawImage(source, 0, 0, canvas.width, canvas.height)
  let quality = .86, data = canvas.toDataURL('image/jpeg', quality)
  while (data.length > MAX_CHARS && quality > .4) { quality -= .12; data = canvas.toDataURL('image/jpeg', quality) }
  canvas.width = canvas.height = 0
  if (data.length > MAX_CHARS) throw new Error('图片太大，无法用作封面。')
  return data
}

/** A cover from an image file the user picked. */
export async function imageCover(file: File): Promise<Cover> {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('请选择 PNG、JPEG、WebP、GIF 或 BMP 图片。')
  if (file.size > 30 * 1024 * 1024) throw new Error('图片超过 30 MB。')
  const bitmap = await createImageBitmap(file)
  try { return { kind: 'image', image: encode(bitmap, bitmap.width, bitmap.height) } }
  finally { bitmap.close() }
}

/** The first page as a cover: PDF page 1, or the start of a Markdown document typeset like a page. */
export async function pageCover(doc: { id: string; kind: 'pdf' | 'markdown'; name: string }): Promise<Cover> {
  const { openAiContext } = await import('../document/ai-context.mjs')
  const resource: any = await openAiContext(doc, { page: 1 }, new AbortController().signal)
  try {
    if (doc.kind === 'pdf') {
      const page = await resource.context.pdf.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(3, EDGE * 1.5 / Math.max(base.width, base.height)) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      const paint = canvas.getContext('2d')!
      paint.fillStyle = '#fff'; paint.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: paint, canvas, viewport }).promise
      page.cleanup()
      try { return { kind: 'page', image: encode(canvas, canvas.width, canvas.height) } }
      finally { canvas.width = canvas.height = 0 }
    }
    return { kind: 'page', image: encode(markdownPage(resource.context.text || '', doc.name), 600, 800) }
  } finally { await resource.close() }
}

/** Typesets the opening of a Markdown file onto a white page: title, then the first paragraphs. */
function markdownPage(source: string, name: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 600; canvas.height = 800
  const paint = canvas.getContext('2d')!
  paint.fillStyle = '#fff'; paint.fillRect(0, 0, 600, 800)
  const lines = source.replace(/\r/g, '').split('\n')
  const heading = lines.find(line => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim() || name.replace(/\.(md|markdown)$/i, '')
  const body = lines.filter(line => line.trim() && !/^#\s+/.test(line) && !/^(```|\||!\[|<)/.test(line.trim())).map(line => line.replace(/^#{2,6}\s+|[*_`>]|\[(.*?)\]\(.*?\)/g, '$1').trim())
  const serif = "'Anthropic Serif','Source Han Serif SC','Noto Serif CJK SC','Songti SC',serif"
  const wrap = (text: string, font: string, width: number) => {
    paint.font = font
    const out: string[] = []
    let line = ''
    for (const char of text) {
      if (paint.measureText(line + char).width > width && line) { out.push(line); line = char.trim() ? char : '' }
      else line += char
    }
    if (line) out.push(line)
    return out
  }
  let y = 120
  paint.fillStyle = '#1d2129'
  for (const line of wrap(heading, `700 40px ${serif}`, 480).slice(0, 3)) { paint.font = `700 40px ${serif}`; paint.fillText(line, 60, y); y += 52 }
  paint.fillStyle = '#d7dbe2'; paint.fillRect(60, y - 14, 480, 2)
  y += 34
  paint.fillStyle = '#4a505b'
  for (const paragraph of body) {
    for (const line of wrap(paragraph, `400 22px ${serif}`, 480)) {
      if (y > 760) return canvas
      paint.font = `400 22px ${serif}`; paint.fillText(line, 60, y); y += 34
    }
    y += 14
  }
  return canvas
}
