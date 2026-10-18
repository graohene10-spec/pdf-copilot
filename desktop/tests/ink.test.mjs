import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePoint, toPageUnits, seededRandom, snapUnderline, underlineCenterline, strokePath, strokeHit,
  serializeInk, parseInk, inkKey, emptyInk, countPoints, INK_GRID, MAX_INK_POINTS, PAGE_UNITS,
} from '../src/reader/ink/model.ts'
import { InkStore, acquireInkStore, releaseInkStore } from '../src/reader/ink/store.ts'

const stroke = (overrides = {}) => ({ id: 'a1', tool: 'pen', color: '#c62f2a', size: .004, seed: 7, points: [.1, .1, .2, .12, .3, .1], ...overrides })
function memory(initial = {}) {
  const values = new Map(Object.entries(initial)), writes = []
  return { values, writes, async getSetting(key) { return values.get(key) ?? null }, async setSetting(key, value) { writes.push([key, value]); values.set(key, value) } }
}

test('client points normalize to the page and clamp at its edges', () => {
  const rect = { left: 100, top: 50, width: 400, height: 600 }
  assert.deepEqual(normalizePoint(300, 350, rect), [.5, .5])
  assert.deepEqual(normalizePoint(50, 900, rect), [0, 1])
  assert.deepEqual(normalizePoint(10, 10, { left: 0, top: 0, width: 0, height: 10 }), [0, 0])
  // Zoom changes the rectangle, not the stored coordinate.
  assert.deepEqual(normalizePoint(200, 100, { left: 0, top: 0, width: 400, height: 200 }), normalizePoint(400, 200, { left: 0, top: 0, width: 800, height: 400 }))
  assert.deepEqual(toPageUnits([.5, .5, 1, 1], 1.3), [[PAGE_UNITS / 2, PAGE_UNITS * .65], [PAGE_UNITS, PAGE_UNITS * 1.3]])
})

test('serialization round-trips strokes on the integer grid with a version field', () => {
  const document = emptyInk()
  document.pages.set(3, [stroke(), stroke({ id: 'u1', tool: 'underline', points: [.1, .5, .8, .5], seed: 99 })])
  document.pages.set(1, [stroke({ id: 'h1', tool: 'highlighter', color: '#ffd02e', size: .026 })])
  const raw = serializeInk(document)
  const value = JSON.parse(raw)
  assert.equal(value.version, 1)
  assert.deepEqual(Object.keys(value.pages), ['1', '3'])
  // Delta encoding after the first point keeps long strokes compact.
  assert.deepEqual(value.pages['3'][0].points, [1000, 1000, 1000, 200, 1000, -200])
  const restored = parseInk(raw)
  assert.deepEqual([...restored.pages.keys()], [1, 3])
  const original = document.pages.get(3)[0], copy = restored.pages.get(3)[0]
  assert.equal(copy.tool, 'pen'); assert.equal(copy.color, '#c62f2a'); assert.equal(copy.seed, 7)
  copy.points.forEach((value, index) => assert.ok(Math.abs(value - original.points[index]) <= 1 / INK_GRID))
  assert.equal(restored.pages.get(3)[1].tool, 'underline')
  assert.equal(countPoints(restored), 3 + 2 + 3)
})

test('stored data is validated: bad versions, tools, colors, sizes and short strokes are skipped', () => {
  assert.equal(parseInk('not json').pages.size, 0)
  assert.equal(parseInk(JSON.stringify({ version: 2, pages: { 1: [] } })).pages.size, 0)
  assert.equal(parseInk(JSON.stringify({ version: 1, pages: [] })).pages.size, 0)
  assert.equal(parseInk(null).pages.size, 0)
  const good = { id: 'ok', tool: 'pen', color: '#112233', size: .004, seed: 1, points: [10, 10, 5, 5] }
  const raw = JSON.stringify({ version: 1, pages: {
    1: [good, { ...good, id: 'one-point', points: [1, 1] }, { ...good, id: 'odd', points: [1, 1, 2] }, { ...good, id: 'tool', tool: 'laser' }, { ...good, id: 'color', color: 'red' }, { ...good, id: 'size', size: 5 }, { ...good, id: 'float', points: [1.5, 1, 2, 2] }],
    0: [good], abc: [good], '__proto__': [good], 2: 'nope',
  } })
  const parsed = parseInk(raw)
  assert.deepEqual([...parsed.pages.keys()], [1])
  assert.deepEqual(parsed.pages.get(1).map(stroke => stroke.id), ['ok'])
  // Coordinates outside the page clamp; duplicate ids are replaced.
  const clamped = parseInk(JSON.stringify({ version: 1, pages: { 1: [{ ...good, points: [-50, 20000, 0, 0] }, good] } })).pages.get(1)
  assert.deepEqual(clamped[0].points, [0, 1, 0, 1])
  assert.notEqual(clamped[0].id, clamped[1].id)
  // Serialization never writes strokes with fewer than two points.
  const document = emptyInk(); document.pages.set(1, [stroke({ points: [.1, .1] })])
  assert.deepEqual(JSON.parse(serializeInk(document)).pages, {})
})

test('the total point budget caps what a document loads', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ id: `s${index}`, tool: 'pen', color: '#112233', size: .004, seed: 1, points: Array(200).fill(1) }))
  const parsed = parseInk(JSON.stringify({ version: 1, pages: { 1: many } }), 1000)
  assert.equal(countPoints(parsed), 1000)
  assert.ok(MAX_INK_POINTS >= 100000)
})

test('settings keys accept document ids only when they are valid setting names', () => {
  assert.equal(inkKey('6f1c2d8e-1b2c-4d5e-8f90-0123456789ab'), 'ink.v1.6f1c2d8e-1b2c-4d5e-8f90-0123456789ab')
  assert.equal(inkKey(undefined), null)
  assert.equal(inkKey('a/b'), null)
  assert.equal(inkKey('x'.repeat(120)), null)
})

test('the seeded underline is deterministic, wobbles slightly and tapers in pressure', () => {
  const a = underlineCenterline([100, 400], [600, 400], 4.2, 1234)
  const b = underlineCenterline([100, 400], [600, 400], 4.2, 1234)
  const c = underlineCenterline([100, 400], [600, 400], 4.2, 4321)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
  const offsets = a.map(point => point[1] - 400)
  assert.ok(Math.max(...offsets.map(Math.abs)) > .3, 'The line is not ruler-straight.')
  assert.ok(Math.max(...offsets.map(Math.abs)) < 4.2 * 1.2, 'The wobble stays within about one line width.')
  assert.ok(Math.abs(a[0][0] - 100) < 1e-9 && Math.abs(a.at(-1)[0] - 600) < 1e-9)
  const pressures = a.map(point => point[2])
  assert.ok(pressures.every(value => value >= .15 && value <= 1))
  assert.ok(new Set(pressures.map(value => value.toFixed(3))).size > 5, 'Width varies along the line.')
  // Low frequency: neighbouring offsets change smoothly (no per-point noise).
  for (let index = 1; index < offsets.length; index++) assert.ok(Math.abs(offsets[index] - offsets[index - 1]) < 1)
  assert.deepEqual(underlineCenterline([5, 5], [5, 5], 4, 1), [])
  assert.deepEqual(seededRandom(9)(), seededRandom(9)())
  // The rendered path is equally stable across renders.
  const line = { tool: 'underline', size: .0042, seed: 77, points: [.1, .3, .7, .3] }
  assert.equal(strokePath(line, 1.3), strokePath(line, 1.3))
  assert.match(strokePath(line, 1.3), /^M[\d.]+,[\d.]+ Q.+Z$/)
})

test('nearly level underline drags snap level, steep ones do not', () => {
  assert.deepEqual(snapUnderline([0, 0], [100, 8]), [100, 0])
  assert.deepEqual(snapUnderline([100, 50], [0, 55]), [0, 50])
  assert.deepEqual(snapUnderline([0, 0], [100, 40]), [100, 40])
})

test('pen and highlighter paths come from perfect-freehand outlines', () => {
  const pen = strokePath(stroke(), 1.3)
  assert.match(pen, /^M.+Z$/)
  assert.equal(strokePath(stroke({ points: [.1, .1] }), 1.3), '')
  const highlighter = strokePath(stroke({ tool: 'highlighter', size: .026 }), 1.3)
  // The wide highlighter outline spans more vertical page units than the pen.
  const spread = path => { const ys = [...path.matchAll(/,(-?[\d.]+)/g)].map(match => Number(match[1])); return Math.max(...ys) - Math.min(...ys) }
  assert.ok(spread(highlighter) > spread(pen) * 2)
})

test('eraser hit-testing reaches strokes within the radius plus their half width', () => {
  const aspect = 1.3
  const pen = stroke({ points: [.1, .1, .5, .1] })
  assert.ok(strokeHit(pen, [300, 130], 5, aspect))
  assert.ok(strokeHit(pen, [300, 136], 5, aspect))
  assert.ok(!strokeHit(pen, [300, 150], 5, aspect))
  assert.ok(!strokeHit(pen, [700, 130], 5, aspect))
  const highlighter = stroke({ tool: 'highlighter', size: .026, points: [.1, .1, .5, .1] })
  assert.ok(strokeHit(highlighter, [300, 145], 5, aspect), 'A wide highlighter is easier to hit.')
  // An underline is hit along its straight span, including between the stored ends.
  const underline = stroke({ tool: 'underline', points: [.1, .5, .9, .5] })
  assert.ok(strokeHit(underline, [500, 650], 4, aspect))
  assert.ok(!strokeHit(underline, [500, 700], 4, aspect))
  assert.ok(!strokeHit(stroke({ points: [] }), [0, 0], 100, aspect))
})

test('the store adds, erases, clears and undoes, then saves once after a debounce', async () => {
  const storage = memory()
  const store = new InkStore('doc-1', storage, 10)
  await store.loaded
  const events = []
  store.subscribe(page => events.push(page))
  assert.ok(store.add(2, stroke({ id: 'p1' })))
  assert.ok(store.add(2, stroke({ id: 'p2' })))
  assert.ok(!store.add(2, stroke({ id: 'short', points: [.1, .1] })), 'Strokes with fewer than two points are skipped.')
  assert.ok(store.erase(2, ['p1']))
  assert.deepEqual(store.strokes(2).map(item => item.id), ['p2'])
  assert.ok(store.clearPage(2)); assert.equal(store.strokes(2).length, 0)
  assert.equal(store.undo(), 2); assert.deepEqual(store.strokes(2).map(item => item.id), ['p2'])
  assert.equal(store.undo(), 2); assert.deepEqual(store.strokes(2).map(item => item.id), ['p1', 'p2'], 'Undoing an erase restores the original order.')
  assert.equal(store.undo(), 2); assert.deepEqual(store.strokes(2).map(item => item.id), ['p1'])
  assert.ok(events.length >= 5)
  await new Promise(resolve => setTimeout(resolve, 40))
  await store.flush()
  assert.equal(storage.writes.length, 1)
  assert.equal(storage.writes[0][0], 'ink.v1.doc-1')
  assert.deepEqual(parseInk(storage.writes[0][1]).pages.get(2).map(item => item.id), ['p1'])
})

test('shared stores survive split panes and a reopened reader waits for the last save', async () => {
  const storage = memory()
  const first = acquireInkStore('doc-2', storage, 5)
  const second = acquireInkStore('doc-2', storage, 5)
  assert.equal(first, second)
  await first.loaded
  first.add(1, stroke({ id: 'shared' }))
  releaseInkStore(first); releaseInkStore(second)
  const reopened = acquireInkStore('doc-2', storage, 5)
  assert.notEqual(reopened, first)
  await reopened.loaded
  assert.deepEqual(reopened.strokes(1).map(item => item.id), ['shared'])
  releaseInkStore(reopened)
  // Without a valid id there is no persistence at all.
  const local = acquireInkStore(undefined, storage, 5)
  local.add(1, stroke()); await local.flush()
  assert.equal(storage.writes.length, 1)
})

test('a failed read never overwrites stored marks', async () => {
  const storage = memory({ 'ink.v1.doc-3': 'kept' })
  storage.getSetting = async () => { throw new Error('locked') }
  const store = new InkStore('doc-3', storage, 1)
  await store.loaded
  assert.match(store.error, /无法读取标记/)
  store.add(1, stroke()); await store.flush()
  assert.equal(storage.values.get('ink.v1.doc-3'), 'kept')
})
