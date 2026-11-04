import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translationSettings, supportsFast } from '../src/ai/settings.mjs'
import { buildPayload } from '../src/ai/providers.mjs'
import { UI_FONTS, READING_FONTS, SKETCH_ANSWER_FONTS, normalizePreferences, defaultPreferences } from '../src/settings/model.ts'

const main = { provider: 'codex', baseUrl: '', model: 'gpt-5.5', effort: 'high', fast: false }

test('translation AI: shares the assistant provider but keeps its own model, effort and fast', () => {
  const shared = translationSettings({ ...main, translation: { share: true, model: 'gpt-5.4-mini', effort: 'low', fast: true } })
  assert.equal(shared.provider, 'codex')
  assert.deepEqual([shared.model, shared.effort, shared.fast], ['gpt-5.4-mini', 'low', true])
  // 未设置时默认共用，模型留空（自动用小模型）
  const fallback = translationSettings(main)
  assert.equal(fallback.provider, 'codex'); assert.equal(fallback.model, ''); assert.equal(fallback.fast, false)
})

test('translation AI: its own provider and endpoint; fast only where the provider supports it', () => {
  const own = translationSettings({ ...main, translation: { share: false, provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', effort: 'none', fast: true } })
  assert.deepEqual([own.provider, own.baseUrl, own.model, own.fast], ['deepseek', 'https://api.deepseek.com', 'deepseek-flash', false])
  assert.ok(supportsFast('codex') && supportsFast('openai') && !supportsFast('deepseek'))
})

test('fast: OpenAI requests use the priority tier; other providers send nothing extra', () => {
  const messages = [{ role: 'user', content: 'hi' }]
  assert.equal(buildPayload({ provider: 'openai', model: 'gpt-5.4-mini', effort: 'low', fast: true, messages }).service_tier, 'priority')
  assert.equal(buildPayload({ provider: 'openai', model: 'gpt-5.4-mini', effort: 'low', fast: false, messages }).service_tier, undefined)
  assert.equal(buildPayload({ provider: 'deepseek', model: 'deepseek-flash', effort: 'high', fast: true, messages }).service_tier, undefined)
})

test('fonts: common Latin fonts are offered everywhere and survive normalization', () => {
  for (const list of [UI_FONTS, READING_FONTS, SKETCH_ANSWER_FONTS]) {
    assert.ok(list.some(item => item.label === 'Arial'), 'Arial')
    assert.ok(list.some(item => item.label === 'Times New Roman'), 'Times New Roman')
  }
  const times = READING_FONTS.find(item => item.label === 'Times New Roman')
  assert.match(times.stack, /^'Times New Roman', .*SimSun/)
  const prefs = defaultPreferences()
  prefs.appearance.uiFont = UI_FONTS.find(item => item.label === 'Arial').id
  prefs.appearance.readingFont = times.id
  prefs.appearance.sketchAnswerFont = SKETCH_ANSWER_FONTS.find(item => item.label === 'Georgia').id
  const normalized = normalizePreferences(prefs)
  assert.equal(normalized.appearance.uiFont, prefs.appearance.uiFont)
  assert.equal(normalized.appearance.readingFont, times.id)
  assert.equal(normalized.appearance.sketchAnswerFont, prefs.appearance.sketchAnswerFont)
})
