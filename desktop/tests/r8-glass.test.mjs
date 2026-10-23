import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { glassFloor, glassContrast, targetContrast, photoTint } from '../src/ui/glass-contrast.ts'
import { refractionMap, bezelFor, mapResolution, lensFilterMarkup } from '../src/ui/refraction.ts'
import { imageUnits } from '../src/reader/dark-pages.mjs'
import { predictionKey } from '../src/ai/predict.ts'
import { defaultPreferences, normalizePreferences, preferenceErrors, SHORTCUTS, DEFAULT_SHORTCUTS, shortcutConflicts, GLASS_LEGIBILITY, GLASS_TINTS } from '../src/settings/model.ts'

const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)

test('legibility strength: 0 turns compensation off, 100 is the old 4.8:1, lower strengths whiten the glass less', () => {
  assert.equal(targetContrast(0), 0)
  assert.equal(targetContrast(100), 4.8)
  assert.ok(Math.abs(targetContrast(50) - 2.9) < 1e-9)
  // Light-theme glass (white) over a dark starry photo with dark text: the floor is the whitening.
  const night = [20, 24, 40], white = [253, 254, 255]
  const full = glassFloor(night, white, 'dark', targetContrast(100)), half = glassFloor(night, white, 'dark', targetContrast(50))
  assert.ok(full > half && half > 0, `${full} > ${half} > 0`)
  assert.ok(glassContrast(night, white, full, 'dark') >= 4.8)
  assert.ok(glassContrast(night, white, half, 'dark') >= 2.9 && glassContrast(night, white, half, 'dark') < 4.5)
})

test('photo tint keeps the photo\'s hue at the theme\'s lightness', () => {
  const pink = [220, 120, 160]
  const light = photoTint(pink, 'light'), dark = photoTint(pink, 'dark')
  assert.ok(luminance(light) > .75, `light tint is pale (${light})`)
  assert.ok(luminance(dark) < .06, `dark tint is deep (${dark})`)
  for (const tint of [light, dark]) assert.ok(tint[0] > tint[1] && tint[2] > tint[1], `hue stays pink (${tint})`)
  const grey = photoTint([128, 128, 128], 'light')
  assert.equal(grey[0], grey[1]); assert.equal(grey[1], grey[2])
})

test('refraction map: neutral middle, inward offsets and a rim mask along the bezel, nothing outside the shape', () => {
  const shape = { width: 200, height: 80, radius: 20 }
  const bezel = bezelFor(shape)
  assert.equal(bezel, 24)
  assert.equal(bezelFor({ width: 30, height: 20, radius: 10 }), 6)
  const resolution = .5
  const { columns, rows, data } = refractionMap(shape, bezel, resolution)
  assert.equal(columns, 100); assert.equal(rows, 40)
  const at = (x, y) => { const index = (Math.floor(y * resolution) * columns + Math.floor(x * resolution)) * 4; return [...data.slice(index, index + 4)] }
  assert.deepEqual(at(100, 40), [128, 128, 0, 255], 'flat middle')
  const left = at(1, 40), right = at(199, 40), top = at(100, 1), bottom = at(100, 79)
  assert.ok(left[0] > 200 && left[1] === 128, `left edge samples to the right (${left})`)
  assert.ok(right[0] < 56 && right[1] === 128, `right edge samples to the left (${right})`)
  assert.ok(top[1] > 200 && bottom[1] < 56, 'top and bottom edges sample inward')
  assert.ok(left[2] > 200, 'the rim shows the bent image')
  assert.deepEqual(at(0.5, 0.5).slice(0, 3), [128, 128, 0], 'outside the rounded corner stays neutral')
  // The offset changes by less than one pixel per pixel: the rim magnifies instead of folding into streaks.
  const maxShift = bezel / 2
  let previous
  for (let x = 0; x < bezel; x += 2) {
    const shift = (at(x, 40)[0] - 128) / 127 * maxShift
    if (previous !== undefined) assert.ok(Math.abs(shift - previous) / 2 < 1, `slope at ${x}`)
    previous = shift
  }
  assert.ok(mapResolution({ width: 600, height: 1600, radius: 20 }, 24) * 600 * 1600 * mapResolution({ width: 600, height: 1600, radius: 20 }, 24) <= 150_000)
})

test('lens filter: frosted middle with the element\'s own blur, a bent rim, dispersion only on small glass', () => {
  const small = lensFilterMarkup('data:,', { width: 120, height: 40, radius: 20 }, { blur: 20, saturate: 1.85 })
  assert.match(small, /stdDeviation="20\.0" result="frost"/)
  assert.equal((small.match(/feDisplacementMap/g) || []).length, 3)
  assert.match(small, /type="saturate" values="1\.85"/)
  const panel = lensFilterMarkup('data:,', { width: 420, height: 800, radius: 20 }, { blur: 0, saturate: 1.6 })
  assert.equal((panel.match(/feDisplacementMap/g) || []).length, 1)
  assert.doesNotMatch(panel, /result="frost"/, 'no blur at 0')
  assert.match(panel, /in2="SourceGraphic" operator="over"/)
})

test('glass and markup settings: defaults, normalization and validation', () => {
  const defaults = defaultPreferences()
  assert.deepEqual([defaults.appearance.glassRefraction, defaults.appearance.glassLegibility, defaults.appearance.glassCompensation, defaults.appearance.glassTint], [true, 'thicken', 50, 'theme'])
  const normalized = normalizePreferences({ appearance: { glassRefraction: false, glassLegibility: 'bogus', glassCompensation: 180, glassTint: 'photo' } })
  assert.deepEqual([normalized.appearance.glassRefraction, normalized.appearance.glassLegibility, normalized.appearance.glassCompensation, normalized.appearance.glassTint], [false, 'thicken', 100, 'photo'])
  assert.deepEqual(GLASS_LEGIBILITY.map(item => item.id), ['thicken', 'ink', 'off'])
  assert.deepEqual(GLASS_TINTS.map(item => item.id), ['theme', 'photo'])
  assert.deepEqual(preferenceErrors(normalized), [])
  assert.ok(preferenceErrors({ ...normalized, appearance: { ...normalized.appearance, glassLegibility: 'x' } }).length)
  assert.deepEqual(['inkPen', 'inkHighlighter', 'inkUnderline'].map(action => DEFAULT_SHORTCUTS[action]), ['Alt+Digit1', 'Alt+Digit2', 'Alt+Digit3'])
  assert.ok(['inkPen', 'inkHighlighter', 'inkUnderline'].every(action => SHORTCUTS.some(item => item.action === action)))
  assert.deepEqual(shortcutConflicts(defaults.shortcuts), [])
  // Earlier saved preferences gain the new defaults.
  assert.equal(normalizePreferences({ version: 3, shortcuts: { sidebar: 'Ctrl+KeyB' } }).shortcuts.inkHighlighter, 'Alt+Digit2')
})

test('image positions in page units come from the render\'s own operator list', () => {
  const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4 }
  const list = { fnArray: [1, 3, 4, 2], argsArray: [null, [200, 0, 0, 100, 50, 300], ['img'], null] }
  const viewport = { scale: 2, transform: [2, 0, 0, -2, 0, 1200] }
  assert.deepEqual(imageUnits(list, viewport, OPS), [{ x: 50, y: 200, width: 200, height: 100 }])
})

test('predictions without the document switch do not read the page, and are cached separately', () => {
  const base = { document: { id: 'd', title: 't', kind: 'pdf' }, page: 3, selection: '', history: [{ role: 'user', content: 'hi' }] }
  assert.notEqual(predictionKey({ ...base, includePage: false }), predictionKey(base))
})

test('the shell no longer uses GPU canvases for lens maps or cover encoding', async () => {
  for (const file of ['src/ui/refraction.ts', 'src/library/covers.ts']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.match(source, /willReadFrequently: true/, file)
  }
  // Light theme never reads page pixels for the dark-mode photo layer.
  const viewer = await readFile(new URL('../src/reader/continuous.mjs', import.meta.url), 'utf8')
  assert.match(viewer, /const known = darkTheme\(\) &&/)
  assert.doesNotMatch(viewer, /getOperatorList\(/)
})

test('edge highlight defaults to half strength and is clamped', () => {
  assert.equal(defaultPreferences().appearance.glassHighlight, 50)
  assert.equal(normalizePreferences({ appearance: { glassHighlight: 140 } }).appearance.glassHighlight, 100)
  assert.equal(normalizePreferences({ appearance: { glassHighlight: 20 } }).appearance.glassHighlight, 20)
  assert.equal(normalizePreferences({ appearance: {} }).appearance.glassHighlight, 50)
  assert.ok(preferenceErrors({ ...defaultPreferences(), appearance: { ...defaultPreferences().appearance, glassHighlight: 101 } }).some(error => error.includes('边缘高光')))
})
