import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { greetingFor, customLines, placeholderFor, PLACEHOLDERS, thinkingVerb, THINKING_VERBS, SPINNER_FRAMES, SPINNERS, spinnerFor } from '../src/ai/greeting.ts'
import { cleanQuestion } from '../src/ai/predict.ts'
import { glassFloor, chooseGlassInk } from '../src/ui/glass-contrast.ts'
import { imageRectangles, looksLikePaper, DARK_TONE } from '../src/reader/dark-pages.mjs'
import { defaultPreferences, normalizePreferences, preferenceErrors } from '../src/settings/model.ts'

const at = hour => new Date(2026, 9, 18, hour, 30)

test('greeting styles: English salutations, classical lines with their source, both, or the user\'s own lines', () => {
  const english = greetingFor(at(15), .3, 'english')
  assert.equal(english.lang, 'en'); assert.equal(english.source, undefined)
  const poem = greetingFor(at(15), .3, 'poetry')
  assert.equal(poem.lang, 'zh'); assert.match(poem.source, /《.+》/)
  assert.equal(greetingFor(at(15), .2, 'mixed').lang, 'en')
  assert.equal(greetingFor(at(15), .7, 'mixed').lang, 'zh')
  assert.equal(greetingFor(at(15), .99, 'custom', 'Fancy a cup of tea?\n\n  月色真美  ').text, '月色真美')
  // A custom style without any line falls back to the built-in lines.
  assert.ok(greetingFor(at(15), .5, 'custom', '   ').text.length > 0)
  assert.deepEqual(customLines('a\n\n b \r\nc'), ['a', 'b', 'c'])
  for (const hour of [0, 4, 5, 8, 9, 12, 13, 14, 17, 18, 20, 22, 23]) for (const style of ['english', 'poetry']) assert.ok(greetingFor(at(hour), .5, style).text)
})

test('every classical line ends with a full stop (or a question mark)', () => {
  for (let hour = 0; hour < 24; hour++) for (const random of [.01, .2, .4, .6, .8, .99]) {
    const { text } = greetingFor(at(hour), random, 'poetry')
    assert.match(text, /[。？]$/, text)
  }
})

test('placeholders and thinking verbs are picked deterministically', () => {
  assert.equal(PLACEHOLDERS.length, 14)
  assert.ok(PLACEHOLDERS.includes('来一个最直白、最直接、最不绕弯子的解释。'))
  assert.ok(PLACEHOLDERS.includes(placeholderFor(.5)))
  assert.equal(placeholderFor(.5), placeholderFor(.5))
  assert.ok(THINKING_VERBS.includes(thinkingVerb('message-1')))
  assert.equal(thinkingVerb('message-1'), thinkingVerb('message-1'))
  assert.deepEqual(SPINNER_FRAMES.slice(0, 6), ['·', '✢', '✳', '✶', '✻', '✽'])
  assert.ok(SPINNERS.length >= 6 && SPINNERS.includes(spinnerFor('message-1')))
  assert.equal(spinnerFor('message-1'), spinnerFor('message-1'))
  assert.ok(new Set(Array.from({ length: 40 }, (_, index) => spinnerFor(`m-${index}`))).size > 3)
})

test('predicted questions keep one clean line', () => {
  assert.equal(cleanQuestion('“这一节的核心假设是什么？”\n解释……'), '这一节的核心假设是什么？')
  assert.equal(cleanQuestion('问题：为什么要归一化？'), '为什么要归一化？')
  assert.equal(cleanQuestion('1. What does eq. (3) assume?'), 'What does eq. (3) assume?')
  assert.equal(cleanQuestion('\n\n'), '')
  assert.equal(cleanQuestion('x'.repeat(200)), '')
})

test('glass keeps the theme ink and only gets denser when the photo below is too bright or too dark', () => {
  const darkGlass = [36, 43, 47], lightGlass = [253, 254, 255]
  assert.equal(glassFloor([20, 20, 30], darkGlass, 'light'), 0)
  const bright = glassFloor([240, 230, 245], darkGlass, 'light')
  assert.ok(bright > .5 && bright <= 1, `bright photo needs a dense dark glass (${bright})`)
  assert.equal(glassFloor([250, 250, 250], lightGlass, 'dark'), 0)
  const dark = glassFloor([20, 30, 60], lightGlass, 'dark')
  assert.ok(dark > .4 && dark <= 1, `dark photo needs a dense light glass (${dark})`)
  // Bare text over a photo still switches ink.
  assert.equal(chooseGlassInk([250, 250, 250]), 'dark')
})

test('dark PDF pages: images are found through the transform stack, and paper-like images are told apart from photos', () => {
  const OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, beginGroup: 76, endGroup: 77, beginAnnotation: 80, endAnnotation: 81, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageXObjectRepeat: 88 }
  const viewport = [1, 0, 0, -1, 0, 650]
  const list = { fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintFormXObjectBegin, OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintFormXObjectEnd],
    argsArray: [null, [240, 0, 0, 180, 45, 250], ['img1', 64, 48], null, [[1, 0, 0, 1, 10, 20], null], null, [100, 0, 0, 50, 0, 0], ['img2', 10, 10], null, null] }
  assert.deepEqual(imageRectangles(list, viewport, OPS), [{ x: 45, y: 220, width: 240, height: 180 }, { x: 10, y: 580, width: 100, height: 50 }])
  const grid = (color, count = 64) => Uint8ClampedArray.from({ length: count * 4 }, (_, index) => index % 4 === 3 ? 255 : color[index % 4])
  assert.equal(looksLikePaper(grid([246, 246, 246])), true)
  assert.equal(looksLikePaper(grid([220, 60, 40])), false)
  assert.equal(looksLikePaper(grid([30, 30, 30])), false)
  assert.ok(DARK_TONE.background > .08 && DARK_TONE.foreground < .95 && DARK_TONE.exponent < 1)
})

test('assistant greeting and prediction preferences normalize and validate', () => {
  assert.deepEqual(defaultPreferences().assistant.greeting, { style: 'mixed', custom: '' })
  assert.equal(defaultPreferences().assistant.predictQuestions, true)
  assert.deepEqual(normalizePreferences({ assistant: { greeting: { style: 'custom', custom: '月色真美' }, predictQuestions: false } }).assistant.greeting, { style: 'custom', custom: '月色真美' })
  assert.equal(normalizePreferences({ assistant: { predictQuestions: false } }).assistant.predictQuestions, false)
  assert.equal(normalizePreferences({ assistant: { greeting: { style: 'custom', custom: '  ' } } }).assistant.greeting.style, 'mixed')
  assert.equal(normalizePreferences({ assistant: { greeting: { style: 'bogus' } } }).assistant.greeting.style, 'mixed')
  const invalid = defaultPreferences(); invalid.assistant.greeting = { style: 'custom', custom: '' }
  assert.ok(preferenceErrors(invalid).some(error => error.includes('自定义问候')))
})

test('scoped styles never put a selector after :global(...), which Vue would apply to :root itself', async () => {
  const folder = new URL('../src/components/', import.meta.url)
  for (const name of (await readdir(folder)).filter(file => file.endsWith('.vue'))) {
    const source = await readFile(new URL(name, folder), 'utf8')
    const style = source.slice(source.indexOf('<style'))
    assert.doesNotMatch(style, /:global\([^)]*\)\s*[.#:[a-z]/i, `${name}: write ":global(:root[x] .y)" or ":root[x] .y" instead`)
  }
})
