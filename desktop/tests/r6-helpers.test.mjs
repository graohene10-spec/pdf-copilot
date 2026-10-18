import { test } from 'node:test'
import assert from 'node:assert/strict'
import { greetingFor } from '../src/ai/greeting.ts'
import { describeFontFile } from '../src/ui/font-names.ts'
import { defaultPreferences, normalizePreferences, preferenceErrors, fontChoices, UI_FONTS, READING_FONTS, validAvatarImage, MAX_CUSTOM_FONTS } from '../src/settings/model.ts'

const at = hour => new Date(2026, 9, 18, hour, 30)

test('greetings follow the local time of day and stay stable for a given random value', () => {
  assert.match(greetingFor(at(7), 0), /早/)
  assert.match(greetingFor(at(15), 0), /下午/)
  assert.match(greetingFor(at(21), 0), /晚上/)
  assert.match(greetingFor(at(2), 0), /夜/)
  assert.equal(greetingFor(at(10), .4), greetingFor(at(11), .4))
  assert.ok(greetingFor(at(13), .999999).length > 0)
})

test('font file names become a family, weight and style', () => {
  assert.deepEqual(describeFontFile('AnthropicSerif-SemiboldItalic.woff2'), { family: 'Anthropic Serif', file: 'AnthropicSerif-SemiboldItalic.woff2', weight: '600', style: 'italic' })
  assert.equal(describeFontFile('AnthropicSerif-Roman-Variable.ttf').family, 'Anthropic Serif')
  assert.equal(describeFontFile('AnthropicSerif-Roman-Variable.ttf').weight, '100 900')
  assert.equal(describeFontFile('Inter[wght].woff2').weight, '100 900')
  assert.equal(describeFontFile('LXGWWenKai-Bold.ttf').weight, '700')
  assert.equal(describeFontFile('Regular.otf').family, 'Imported Font')
  assert.doesNotMatch(describeFontFile('a";}b.ttf').family, /["};]/)
})

test('imported fonts join the font choices and survive normalisation', () => {
  const font = { id: 'a1b2c3', family: 'Anthropic Serif', file: 'AnthropicSerif.ttf', weight: '400', style: 'normal' }
  const reading = fontChoices(READING_FONTS, [font])
  assert.ok(reading.some(choice => choice.id === 'custom:Anthropic Serif'))
  assert.equal(fontChoices(UI_FONTS, []).length, UI_FONTS.length)
  const stored = defaultPreferences()
  stored.appearance.customFonts = [font]
  stored.appearance.readingFont = 'custom:Anthropic Serif'
  const normalized = normalizePreferences(stored)
  assert.deepEqual(normalized.appearance.customFonts, [font])
  assert.equal(normalized.appearance.readingFont, 'custom:Anthropic Serif')
  // Picking a removed font falls back to the default.
  assert.equal(normalizePreferences({ appearance: { readingFont: 'custom:Gone' } }).appearance.readingFont, defaultPreferences().appearance.readingFont)
  stored.appearance.customFonts = Array.from({ length: MAX_CUSTOM_FONTS + 1 }, (_, index) => ({ ...font, id: `f${index}` }))
  assert.ok(preferenceErrors(stored).length > 0)
})

test('assistant avatars default to the crab and accept only image data URLs', () => {
  assert.deepEqual(defaultPreferences().assistant.avatar, { kind: 'crab', image: null })
  assert.ok(validAvatarImage('data:image/gif;base64,R0lGODlhAQABAAAAACw='))
  assert.ok(!validAvatarImage('https://example.com/a.gif'))
  assert.ok(!validAvatarImage('data:text/html;base64,PGI+'))
  assert.equal(normalizePreferences({ assistant: { avatar: { kind: 'custom', image: 'javascript:alert(1)' } } }).assistant.avatar.kind, 'crab')
  assert.deepEqual(normalizePreferences({ assistant: { avatar: { kind: 'deepseek' } } }).assistant.avatar, { kind: 'deepseek', image: null })
})
