// Hand-drawn PDF markup: pure geometry, storage format and hit testing.
//
// Points are stored normalized to the page (0..1 of its width and height), so
// marks stay on the same words at every zoom level. Geometry is drawn in
// "page units", where the page is PAGE_UNITS wide and PAGE_UNITS * aspect
// tall (aspect = height / width); stroke sizes are relative to page width.
import { getStroke, type StrokeOptions } from 'perfect-freehand'

export type InkTool = 'pen' | 'highlighter' | 'underline'
export type InkMode = InkTool | 'eraser'
export interface InkStroke {
  id: string
  tool: InkTool
  /** #rrggbb in page space (pages are white paper in both themes). */
  color: string
  /** Base diameter as a fraction of the page width. */
  size: number
  /** Seeds the underline's wobble so the line is identical on every render. */
  seed: number
  /** Flat normalized pairs [x0, y0, x1, y1, ...]; an underline keeps only its two ends. */
  points: number[]
}
export interface InkDocument { version: 1; pages: Map<number, InkStroke[]> }

export const INK_VERSION = 1
export const PAGE_UNITS = 1000
/** Stored coordinates are integers in 1/INK_GRID of the page (sub-pixel at 400% zoom). */
export const INK_GRID = 10000
export const MAX_INK_POINTS = 120_000
export const MAX_STROKE_POINTS = 6000
/** The native settings table refuses values over 1 MiB. */
export const MAX_INK_CHARS = 1_000_000
export const INK_TOOLS: readonly InkTool[] = ['pen', 'highlighter', 'underline']

export interface InkColor { value: string; label: string }
export const INK_COLORS: readonly InkColor[] = [
  { value: '#c62f2a', label: '红墨水' },
  { value: '#1d4fae', label: '蓝墨水' },
  { value: '#3b3f45', label: '石墨' },
  { value: '#ffd02e', label: '黄色荧光' },
  { value: '#6fdc5c', label: '绿色荧光' },
]
export const DEFAULT_COLORS: Readonly<Record<InkTool, string>> = { pen: '#c62f2a', highlighter: '#ffd02e', underline: '#c62f2a' }
/** Fractions of page width: a ~0.7mm ballpoint and a ~5mm highlighter on an A4 page. */
export const DEFAULT_SIZES: Readonly<Record<InkTool, number>> = { pen: .0032, highlighter: .024, underline: .0036 }
export const HIGHLIGHTER_OPACITY = .5

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Client coordinates → normalized page coordinates, clamped to the page. */
export function normalizePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): [number, number] {
  if (!(rect.width > 0) || !(rect.height > 0)) return [0, 0]
  return [clamp01((clientX - rect.left) / rect.width), clamp01((clientY - rect.top) / rect.height)]
}

/** Normalized flat pairs → page-unit points. */
export function toPageUnits(points: readonly number[], aspect: number): [number, number][] {
  const result: [number, number][] = []
  for (let index = 0; index + 1 < points.length; index += 2) result.push([points[index] * PAGE_UNITS, points[index + 1] * PAGE_UNITS * aspect])
  return result
}

/** Deterministic PRNG (mulberry32); the same seed always draws the same line. */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** A nearly level drag becomes level; the wobble supplies the hand-drawn feel. */
export function snapUnderline(start: [number, number], end: [number, number], maxDegrees = 7): [number, number] {
  const dx = end[0] - start[0], dy = end[1] - start[1]
  if (!dx && !dy) return [end[0], end[1]]
  const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI)
  return angle <= maxDegrees || angle >= 180 - maxDegrees ? [end[0], start[1]] : [end[0], end[1]]
}

/**
 * Centerline of a hand-drawn underline in page units, as [x, y, pressure].
 * A low-frequency wobble, a slight bow and varying pressure — no per-point
 * noise, so the outline stays smooth like a quick pen stroke along a ruler-free line.
 */
export function underlineCenterline(start: [number, number], end: [number, number], size: number, seed: number): [number, number, number][] {
  const dx = end[0] - start[0], dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  if (!(length > 1e-6) || !(size > 0)) return []
  const random = seededRandom(seed)
  const ux = dx / length, uy = dy / length, nx = -uy, ny = ux
  const count = Math.max(8, Math.min(240, Math.ceil(length / Math.max(size * .7, 1e-3))))
  const amplitude = Math.min(size * .5, length * .015)
  const f1 = .55 + random() * .8, f2 = 1.4 + random() * 1.6, f3 = .7 + random() * 1.3
  const p1 = random() * Math.PI * 2, p2 = random() * Math.PI * 2, p3 = random() * Math.PI * 2
  const bow = (random() - .5) * Math.min(size * 1.1, length * .02)
  const heavy = .62 + random() * .12
  const points: [number, number, number][] = []
  for (let index = 0; index <= count; index++) {
    const t = index / count
    const offset = amplitude * (.65 * Math.sin(2 * Math.PI * f1 * t + p1) + .35 * Math.sin(2 * Math.PI * f2 * t + p2)) + bow * Math.sin(Math.PI * t)
    // The pen lands with some weight and lifts lighter toward the end.
    const pressure = Math.min(1, Math.max(.15, heavy * (1.08 - .3 * t) + .14 * Math.sin(2 * Math.PI * f3 * t + p3)))
    points.push([start[0] + ux * length * t + nx * offset, start[1] + uy * length * t + ny * offset, pressure])
  }
  return points
}

export function strokeOptions(tool: InkTool, size: number, last = true): StrokeOptions {
  if (tool === 'highlighter') return { size, thinning: .08, smoothing: .7, streamline: .55, simulatePressure: false, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }, last }
  if (tool === 'underline') return { size, thinning: .55, smoothing: .55, streamline: .2, simulatePressure: false, start: { cap: true, taper: size * 2 }, end: { cap: true, taper: size * 4 }, last }
  // Pen: simulated pressure thins fast movements, and both ends taper like a nib.
  return { size, thinning: .58, smoothing: .62, streamline: .42, simulatePressure: true, start: { cap: true, taper: size * 2.5 }, end: { cap: true, taper: size * 3.5 }, last }
}

const fixed = (value: number) => Math.round(value * 100) / 100
/** Closed outline polygon → smooth SVG path (quadratic midpoints). */
export function outlineToPath(outline: number[][]): string {
  if (outline.length < 3) return ''
  const mid = (a: number[], b: number[]) => `${fixed((a[0] + b[0]) / 2)},${fixed((a[1] + b[1]) / 2)}`
  let path = `M${fixed(outline[0][0])},${fixed(outline[0][1])} Q${fixed(outline[1][0])},${fixed(outline[1][1])} ${mid(outline[1], outline[2])} T`
  for (let index = 2; index < outline.length - 1; index++) path += `${mid(outline[index], outline[index + 1])} `
  return `${path}Z`
}

/** SVG path data for a stroke at the given page aspect (height / width). */
export function strokePath(stroke: Pick<InkStroke, 'tool' | 'size' | 'seed' | 'points'>, aspect: number, last = true): string {
  const size = stroke.size * PAGE_UNITS
  const points = toPageUnits(stroke.points, aspect)
  if (points.length < 2) return ''
  if (stroke.tool === 'underline') {
    const line = underlineCenterline(points[0], points[points.length - 1], size, stroke.seed)
    return line.length ? outlineToPath(getStroke(line, strokeOptions('underline', size, true))) : ''
  }
  return outlineToPath(getStroke(points, strokeOptions(stroke.tool, size, last)))
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** True when an eraser of `radius` page units at `point` (page units) touches the stroke. */
export function strokeHit(stroke: Pick<InkStroke, 'tool' | 'size' | 'points'>, point: [number, number], radius: number, aspect: number): boolean {
  const points = toPageUnits(stroke.points, aspect)
  if (!points.length) return false
  const centerline = stroke.tool === 'underline' ? [points[0], points[points.length - 1]] : points
  // Highlighters are wide; pens thin. Count most of the drawn half-width as ink.
  const reach = radius + stroke.size * PAGE_UNITS * (stroke.tool === 'highlighter' ? .5 : .75)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of centerline) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  if (point[0] < minX - reach || point[0] > maxX + reach || point[1] < minY - reach || point[1] > maxY + reach) return false
  if (centerline.length === 1) return Math.hypot(point[0] - centerline[0][0], point[1] - centerline[0][1]) <= reach
  for (let index = 1; index < centerline.length; index++) {
    const a = centerline[index - 1], b = centerline[index]
    if (segmentDistance(point[0], point[1], a[0], a[1], b[0], b[1]) <= reach) return true
  }
  return false
}

export function countPoints(document: InkDocument) {
  let total = 0
  for (const strokes of document.pages.values()) for (const stroke of strokes) total += stroke.points.length / 2
  return total
}

export function strokeId(random = Math.random) {
  return `${Date.now().toString(36)}${Math.floor(random() * 0x100000000).toString(36)}`.slice(0, 24)
}

/** Settings key for a document, or null when the id cannot be a settings key. */
export function inkKey(documentId: string | undefined | null) {
  return documentId && /^[A-Za-z0-9._-]{1,90}$/.test(documentId) ? `ink.v1.${documentId}` : null
}

export const emptyInk = (): InkDocument => ({ version: INK_VERSION, pages: new Map() })

/** Compact JSON: integer grid coordinates, delta-encoded after the first point. */
export function serializeInk(document: InkDocument): string {
  const pages: Record<string, unknown[]> = {}
  for (const [page, strokes] of [...document.pages.entries()].sort(([a], [b]) => a - b)) {
    const stored = strokes.filter(stroke => stroke.points.length >= 4).map(stroke => {
      const points: number[] = []
      let x = 0, y = 0
      for (let index = 0; index + 1 < stroke.points.length; index += 2) {
        const nx = Math.round(clamp01(stroke.points[index]) * INK_GRID), ny = Math.round(clamp01(stroke.points[index + 1]) * INK_GRID)
        points.push(nx - x, ny - y); x = nx; y = ny
      }
      return { id: stroke.id, tool: stroke.tool, color: stroke.color, size: Math.round(stroke.size * 1e6) / 1e6, seed: stroke.seed >>> 0, points }
    })
    if (stored.length) pages[String(page)] = stored
  }
  return JSON.stringify({ version: INK_VERSION, grid: INK_GRID, pages })
}

const COLOR = /^#[0-9a-f]{6}$/i
/** Parse stored ink. Never throws: invalid data yields an empty or partial document. */
export function parseInk(raw: string | null | undefined, maxPoints = MAX_INK_POINTS): InkDocument {
  const document = emptyInk()
  if (!raw) return document
  let value: any
  try { value = JSON.parse(raw) } catch { return document }
  if (!value || typeof value !== 'object' || value.version !== INK_VERSION || !value.pages || typeof value.pages !== 'object' || Array.isArray(value.pages)) return document
  const grid = value.grid === undefined ? INK_GRID : value.grid
  if (!Number.isInteger(grid) || grid < 100 || grid > 1e6) return document
  let total = 0
  const ids = new Set<string>()
  const pages = Object.keys(value.pages).filter(key => /^[1-9]\d{0,5}$/.test(key)).map(Number).sort((a, b) => a - b)
  for (const page of pages) {
    const list = value.pages[String(page)]
    if (!Array.isArray(list)) continue
    const strokes: InkStroke[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object' || !INK_TOOLS.includes(item.tool) || typeof item.color !== 'string' || !COLOR.test(item.color)) continue
      if (typeof item.size !== 'number' || !(item.size > 0) || item.size > .2 || !Array.isArray(item.points) || item.points.length % 2 || item.points.length < 4) continue
      if (item.points.length / 2 > MAX_STROKE_POINTS || !item.points.every((value: unknown) => Number.isInteger(value))) continue
      const count = item.tool === 'underline' ? 2 : item.points.length / 2
      if (total + count > maxPoints) continue
      const points: number[] = []
      let x = 0, y = 0
      for (let index = 0; index < item.points.length; index += 2) { x += item.points[index]; y += item.points[index + 1]; points.push(clamp01(x / grid), clamp01(y / grid)) }
      const kept = item.tool === 'underline' ? [points[0], points[1], points[points.length - 2], points[points.length - 1]] : points
      let id = typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(item.id) ? item.id : strokeId()
      while (ids.has(id)) id = strokeId()
      ids.add(id)
      strokes.push({ id, tool: item.tool, color: item.color.toLowerCase(), size: item.size, seed: Number.isInteger(item.seed) ? item.seed >>> 0 : 0, points: kept })
      total += count
    }
    if (strokes.length) document.pages.set(page, strokes)
  }
  return document
}
