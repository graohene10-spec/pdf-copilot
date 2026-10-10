import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultPreferences, normalizePreferences, preferenceErrors, normalizeShortcut, shortcutFromEvent, shortcutConflicts, matchShortcut, DEFAULT_SHORTCUTS, SHORTCUTS } from '../src/settings/model.ts'

function key(code, modifiers = {}) { return { code, key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers } }

test('preferences preserve legacy theme and explicit new setting wins', () => {
  assert.equal(normalizePreferences(undefined, 'dark').appearance.theme, 'dark')
  assert.equal(normalizePreferences({ appearance: { theme: 'system', libraryView: 'list' } }, 'dark').appearance.theme, 'system')
  assert.equal(normalizePreferences([], 'light').appearance.theme, 'light')
})
test('stored out-of-range values are bounded; new edits reject invalid numbers', () => {
  const fixed = normalizePreferences({ pdf: { initialZoom: 900, zoomStep: 1, fitOnPanelOverflow: false }, markdown: { fontSize: 99, contentWidth: 500 } })
  assert.deepEqual(fixed.pdf, { initialZoom: 400, zoomStep: 5, fitOnPanelOverflow: false, openAssistantOnCapture: true })
  assert.deepEqual(fixed.markdown, { fontSize: 28, contentWidth: 600 })
  fixed.pdf.zoomStep = Number.NaN
  fixed.markdown.fontSize = 13.2
  assert.equal(preferenceErrors(fixed).length, 2)
  assert.equal(preferenceErrors(defaultPreferences()).length, 0)
})
test('legacy glass presets migrate to continuous transparency without losing reading or shortcuts', () => {
  for (const [glass, expected] of [['clear', 85], ['balanced', 70], ['rich', 30], ['solid', 0]]) {
    const stored = defaultPreferences()
    delete stored.appearance.glassTransparency
    stored.appearance.glass = glass
    stored.pdf.zoomStep = 24
    stored.markdown.contentWidth = 1000
    stored.shortcuts.capture = 'Alt+Shift+KeyG'
    const migrated = normalizePreferences(stored)
    assert.equal(migrated.appearance.glassTransparency, expected)
    assert.equal(Object.hasOwn(migrated.appearance, 'glass'), false)
    assert.deepEqual(migrated.pdf, stored.pdf)
    assert.deepEqual(migrated.markdown, stored.markdown)
    assert.deepEqual(migrated.shortcuts, stored.shortcuts)
  }
  assert.equal(normalizePreferences({ appearance: { glass: 'rich', glassTransparency: 61 } }).appearance.glassTransparency, 61)
  assert.equal(normalizePreferences({ appearance: { glass: 'clear', glassTransparency: 0 } }).appearance.glassTransparency, 0)
  assert.equal(normalizePreferences({ appearance: { glass: '__proto__' } }).appearance.glassTransparency, 70)
})
test('transparency is bounded on load, strict on save, and unsafe backgrounds fall back to built-in', () => {
  for (const [input, expected] of [[-10, 0], [1000, 100], [64.7, 65], [Number.NaN, 70], ['80', 70]]) {
    assert.equal(normalizePreferences({ appearance: { glassTransparency: input } }).appearance.glassTransparency, expected)
  }
  const preferences = defaultPreferences()
  for (const value of [-1, 101, 50.5, Number.NaN, '80']) {
    preferences.appearance.glassTransparency = value
    assert.match(preferenceErrors(preferences)[0], /玻璃透明度/)
  }
  preferences.appearance.glassTransparency = 70
  preferences.appearance.background = { name: 'remote.png', dataUrl: 'https://example.com/remote.png' }
  assert.match(preferenceErrors(preferences)[0], /底板图片/)
  assert.equal(normalizePreferences(preferences).appearance.background, null)
  assert.equal(defaultPreferences().appearance.background, null)
})
test('shortcut normalization canonicalizes aliases and forbids browser or unmodified keys', () => {
  assert.equal(normalizeShortcut('shift+control+o'), 'Ctrl+Shift+KeyO')
  assert.equal(normalizeShortcut('Alt+ArrowDown'), 'Alt+ArrowDown')
  assert.equal(normalizeShortcut(''), '')
  for (const binding of ['KeyA', 'Shift+KeyA', 'Ctrl+KeyR', 'Alt+F4', 'Ctrl+Ctrl+KeyO', 'Ctrl+Escape']) assert.equal(normalizeShortcut(binding), null, binding)
  assert.equal(normalizeShortcut('Ctrl+Tab'), DEFAULT_SHORTCUTS.nextTab)
  assert.equal(normalizeShortcut('Ctrl+KeyW'), DEFAULT_SHORTCUTS.closeTab)
})
test('default shortcuts are unique, preserve original PDF selection bindings, and can be disabled', () => {
  assert.equal(DEFAULT_SHORTCUTS.ai, 'Ctrl+Shift+Digit7')
  assert.equal(DEFAULT_SHORTCUTS.capture, 'Alt+Shift+KeyS')
  const preferences = defaultPreferences()
  assert.equal(shortcutConflicts(preferences.shortcuts).length, 0)
  preferences.shortcuts.import = ''
  assert.equal(matchShortcut(key('KeyO', { ctrlKey: true }), preferences), null)
  assert.equal(preferenceErrors(preferences).length, 0)
})
test('duplicate shortcuts report actions and stored collisions fall back to defaults', () => {
  const preferences = defaultPreferences()
  preferences.shortcuts.search = 'Ctrl+KeyO'
  assert.deepEqual(shortcutConflicts(preferences.shortcuts)[0].actions, ['import', 'search'])
  assert.match(preferenceErrors(preferences)[0], /导入文档.*搜索文档/)
  assert.deepEqual(normalizePreferences(preferences).shortcuts, DEFAULT_SHORTCUTS)
})
test('matcher uses physical codes, exact modifiers, ignores IME, and separates AI actions', () => {
  const preferences = defaultPreferences()
  assert.equal(matchShortcut(key('KeyO', { key: '打开', ctrlKey: true }), preferences), 'import')
  assert.equal(matchShortcut(key('KeyO', { ctrlKey: true, shiftKey: true }), preferences), 'outline')
  assert.equal(matchShortcut(key('KeyO', { ctrlKey: true, isComposing: true }), preferences), null)
  assert.equal(matchShortcut(key('KeyO', { ctrlKey: true, keyCode: 229 }), preferences), null)
  assert.equal(shortcutFromEvent(key('KeyO', { ctrlKey: true, altKey: true, getModifierState: value => value === 'AltGraph' })), null)
  assert.equal(matchShortcut(key('Enter', { ctrlKey: true }), preferences), null)
  assert.equal(matchShortcut(key('Enter', { ctrlKey: true }), preferences, { scope: 'ai' }), 'aiSend')
  assert.equal(matchShortcut(key('Enter', { ctrlKey: true, shiftKey: true }), preferences, { scope: 'ai' }), 'aiStop')
  assert.equal(matchShortcut(key('KeyO', { ctrlKey: true }), preferences, { scope: 'ai' }), null)
  assert.equal(matchShortcut(key('KeyO', { ctrlKey: true, defaultPrevented: true }), preferences), null)
})
test('all supported default actions match their own canonical shortcut', () => {
  const preferences = defaultPreferences()
  for (const { action } of SHORTCUTS) {
    const parts = preferences.shortcuts[action].split('+'), code = parts.pop()
    const event = key(code, { ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'), metaKey: parts.includes('Meta') })
    assert.equal(matchShortcut(event, preferences, { scope: action.startsWith('ai') && action !== 'ai' ? 'ai' : 'global' }), action)
  }
})
