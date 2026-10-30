import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strokeInRect, PAGE_UNITS } from '../src/reader/ink/model.ts'
import { InkStore } from '../src/reader/ink/store.ts'
import { bandRect, combineSelection } from '../src/ui/rubber-band.ts'

const stroke = (overrides = {}) => ({ id: 'a1', tool: 'pen', color: '#c62f2a', size: .004, seed: 7, points: [.1, .1, .2, .12, .3, .1], ...overrides })

test('library rubber band: rectangle from any drag direction; replace, add and toggle', () => {
  assert.deepEqual(bandRect([50, 80], [10, 20]), { left: 10, top: 20, width: 40, height: 60 })
  const base = new Set(['a', 'b'])
  assert.deepEqual([...combineSelection(base, ['c'], 'replace')], ['c'])
  assert.deepEqual([...combineSelection(base, ['b', 'c'], 'add')].sort(), ['a', 'b', 'c'])
  assert.deepEqual([...combineSelection(base, ['b', 'c'], 'toggle')].sort(), ['a', 'c'])
  assert.deepEqual([...base].sort(), ['a', 'b'], 'the base selection is not mutated')
})

test('ink select box: catches strokes with any part inside, including the middle of an underline', () => {
  const aspect = 1.3, box = (l, t, r, b) => ({ left: l * PAGE_UNITS, top: t * PAGE_UNITS * aspect, right: r * PAGE_UNITS, bottom: b * PAGE_UNITS * aspect })
  assert.ok(strokeInRect(stroke(), box(.15, .05, .25, .15), aspect))
  assert.ok(!strokeInRect(stroke(), box(.5, .5, .6, .6), aspect))
  const underline = stroke({ tool: 'underline', points: [.1, .5, .9, .5] })
  assert.ok(strokeInRect(underline, box(.45, .48, .55, .52), aspect), 'box around the middle of a long underline')
})

test('ink selection: delete across pages and recolour are single undo steps', () => {
  const store = new InkStore(undefined, null, 1)
  store.add(1, stroke({ id: 'p1a' })); store.add(1, stroke({ id: 'p1b' })); store.add(2, stroke({ id: 'p2a' }))
  assert.ok(store.recolor(new Map([[1, new Set(['p1a'])], [2, new Set(['p2a'])]]), '#1d4fae'))
  assert.deepEqual([...store.strokes(1), ...store.strokes(2)].map(item => item.color), ['#1d4fae', '#c62f2a', '#1d4fae'])
  assert.ok(store.eraseSelection(new Map([[1, new Set(['p1a', 'p1b'])], [2, new Set(['p2a'])]])))
  assert.equal(store.hasInk, false)
  store.undo()
  assert.deepEqual(store.strokes(1).map(item => item.id), ['p1a', 'p1b'])
  assert.deepEqual(store.strokes(2).map(item => item.id), ['p2a'])
  store.undo()
  assert.deepEqual([...store.strokes(1), ...store.strokes(2)].map(item => item.color), ['#c62f2a', '#c62f2a', '#c62f2a'])
  assert.equal(store.recolor(new Map([[1, new Set(['nope'])]]), '#000000'), false)
})
