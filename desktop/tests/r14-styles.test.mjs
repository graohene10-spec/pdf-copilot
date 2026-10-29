import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultPreferences, normalizePreferences, preferenceErrors, UI_STYLES, SKETCH_ANSWER_FONTS } from '../src/settings/model.ts'

test('interface style defaults to liquid glass and keeps the sketch answer font choice', () => {
  const defaults = defaultPreferences()
  assert.equal(defaults.appearance.style, 'glass')
  assert.equal(defaults.appearance.sketchAnswerFont, 'mashanzheng')
  assert.deepEqual(UI_STYLES.map(item => item.id), ['glass', 'warm', 'sketch'])
  const sketch = normalizePreferences({ appearance: { style: 'sketch', sketchAnswerFont: 'xiaowei' } })
  assert.equal(sketch.appearance.style, 'sketch')
  assert.equal(sketch.appearance.sketchAnswerFont, 'xiaowei')
  const invalid = normalizePreferences({ appearance: { style: 'neon', sketchAnswerFont: 'comic' } })
  assert.equal(invalid.appearance.style, 'glass')
  assert.equal(invalid.appearance.sketchAnswerFont, 'mashanzheng')
  assert.deepEqual(preferenceErrors(sketch), [])
  assert.ok(preferenceErrors({ ...sketch, appearance: { ...sketch.appearance, style: 'neon' } }).includes('请选择有效界面风格。'))
})

test('the default sketch answer font is a readable regular script, with bundled faces for every handwritten choice', () => {
  const stack = SKETCH_ANSWER_FONTS.find(item => item.id === 'mashanzheng').stack
  assert.match(stack, /'Ma Shan Zheng'/)
  const faces = readFileSync(new URL('../src/styles/fonts.css', import.meta.url), 'utf8')
  for (const family of ['Long Cang', 'Caveat', 'Patrick Hand', 'Ma Shan Zheng', 'ZCOOL XiaoWei', 'ZCOOL KuaiLe']) assert.match(faces, new RegExp(`font-family: '${family}'`))
})
