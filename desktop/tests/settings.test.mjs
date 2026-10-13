import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultPreferences, normalizePreferences, preferenceErrors, normalizeShortcut, shortcutFromEvent, shortcutFromWheelEvent, shortcutLabel, shortcutConflicts, matchShortcut, matchWheelShortcut, DEFAULT_SHORTCUTS, SHORTCUTS } from '../src/settings/model.ts'
import { defaultQuickPrompts, quickPromptLabelLength, limitQuickPromptLabel, QUICK_PROMPT_LABEL_LIMIT, QUICK_PROMPT_QUESTION_LIMIT } from '../src/settings/quick-prompts.ts'

function key(code, modifiers = {}) { return { code, key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers } }
function wheel(deltaY, modifiers = {}) { return { deltaY, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers } }

test('existing preferences gain three default quick prompts without changing prior reading and shortcut choices', () => {
  const prior = defaultPreferences()
  delete prior.assistant
  prior.pdf.zoomStep = 24; prior.appearance.theme = 'dark'; prior.shortcuts.capture = 'Alt+Shift+KeyG'
  const upgraded = normalizePreferences(prior)
  assert.deepEqual(upgraded.assistant.quickPrompts, defaultQuickPrompts())
  assert.deepEqual(upgraded.pdf, prior.pdf)
  assert.deepEqual(upgraded.appearance, prior.appearance)
  assert.deepEqual(upgraded.shortcuts, prior.shortcuts)
  assert.equal(preferenceErrors(upgraded).length, 0)
})

test('custom button descriptions and multiline questions survive persistence with independent draft copies', () => {
  const saved = defaultPreferences()
  saved.assistant.quickPrompts = [
    { label: '术语解释', question: '解释当前段落的术语。\n按术语、定义和例子列出。' },
    { label: '推导检查', question: '检查推导中每一步的适用条件。' },
    { label: '讨论 👨‍👩‍👧‍👦', question: '给出两个可讨论的问题。' },
  ]
  assert.equal(preferenceErrors(saved).length, 0)
  const restored = normalizePreferences(JSON.parse(JSON.stringify(saved)))
  assert.deepEqual(restored.assistant.quickPrompts, saved.assistant.quickPrompts)
  const draft = normalizePreferences(restored)
  draft.assistant.quickPrompts[0].label = '临时修改'
  draft.assistant.quickPrompts[1].question = '另一条临时修改'
  assert.deepEqual(restored.assistant.quickPrompts, saved.assistant.quickPrompts)
  const reset = defaultQuickPrompts(), other = defaultQuickPrompts()
  reset[0].label = '重置后修改'
  assert.equal(other[0].label, '梳理核心观点')
  assert.notEqual(reset[0], reset[1])
  assert.equal(defaultPreferences().assistant.quickPrompts[0].label, '梳理核心观点')
})

test('quick prompt title limits count complete Unicode graphemes instead of splitting emoji or combining accents', () => {
  const emoji = '👨‍👩‍👧‍👦', accent = 'e\u0301', flag = '🇨🇳'
  assert.equal(quickPromptLabelLength(`解释${emoji}${accent}${flag}`), 5)
  for (const unit of ['中', emoji, accent, flag]) {
    const over = unit.repeat(QUICK_PROMPT_LABEL_LIMIT + 1)
    assert.equal(limitQuickPromptLabel(over), unit.repeat(QUICK_PROMPT_LABEL_LIMIT))
    const preferences = defaultPreferences()
    preferences.assistant.quickPrompts[0].label = unit.repeat(QUICK_PROMPT_LABEL_LIMIT)
    assert.equal(preferenceErrors(preferences).length, 0)
    preferences.assistant.quickPrompts[0].label = over
    assert.ok(preferenceErrors(preferences).some(error => /按钮介绍须为 12 字以内/.test(error)))
  }
})

test('empty, malformed and oversized prompt edits are rejected before storage; damaged saved fields recover independently', () => {
  const preferences = defaultPreferences()
  preferences.assistant.quickPrompts[0] = { label: '  ', question: '\n\t' }
  assert.ok(preferenceErrors(preferences).some(error => /快捷提问 1：请填写按钮介绍/.test(error)))
  assert.ok(preferenceErrors(preferences).some(error => /快捷提问 1：请填写提示词/.test(error)))
  preferences.assistant.quickPrompts[0] = { label: '有效介绍', question: 'x'.repeat(QUICK_PROMPT_QUESTION_LIMIT + 1) }
  assert.ok(preferenceErrors(preferences).some(error => /提示词须在 16000/.test(error)))
  preferences.assistant.quickPrompts[0].question = 'x'.repeat(QUICK_PROMPT_QUESTION_LIMIT)
  assert.equal(preferenceErrors(preferences).length, 0)
  preferences.assistant.quickPrompts[0].label = '标题\n换行'
  assert.ok(preferenceErrors(preferences).some(error => /单行文字/.test(error)))
  const restored = normalizePreferences({ assistant: { quickPrompts: [
    { label: null, question: '保留有效提示词' },
    { label: '保留有效介绍', question: ' \n ' },
    { label: '😀'.repeat(13), question: 'x'.repeat(15999) + '😀' },
    { label: '多余第四项', question: '不会添加额外按钮。' },
  ] } })
  assert.equal(restored.assistant.quickPrompts.length, 3)
  assert.deepEqual(restored.assistant.quickPrompts[0], { label: defaultQuickPrompts()[0].label, question: '保留有效提示词' })
  assert.deepEqual(restored.assistant.quickPrompts[1], { label: '保留有效介绍', question: defaultQuickPrompts()[1].question })
  assert.equal(restored.assistant.quickPrompts[2].label, '😀'.repeat(12))
  assert.equal(restored.assistant.quickPrompts[2].question, 'x'.repeat(15999))
  assert.equal(preferenceErrors(restored).length, 0)
  preferences.assistant.quickPrompts = [defaultQuickPrompts()[0]]
  assert.ok(preferenceErrors(preferences).some(error => /须包含三个按钮/.test(error)))
  assert.deepEqual(normalizePreferences({ assistant: { quickPrompts: 'corrupt' } }).assistant.quickPrompts, defaultQuickPrompts())
})

test('preferences preserve legacy theme and explicit new setting wins', () => {
  assert.equal(normalizePreferences(undefined, 'dark').appearance.theme, 'dark')
  assert.equal(normalizePreferences({ appearance: { theme: 'system', libraryView: 'list' } }, 'dark').appearance.theme, 'system')
  assert.equal(normalizePreferences([], 'light').appearance.theme, 'light')
})
test('capture quick ask stays opt-in for legacy and damaged preferences without changing existing capture behavior', () => {
  assert.equal(defaultPreferences().pdf.quickAskOnCapture, false)
  for (const version of [undefined, 1, 2]) {
    for (const quickAskOnCapture of [undefined, null, 'true', 'false', 0, 1, {}, []]) {
      const restored = normalizePreferences({ version, pdf: { quickAskOnCapture, openAssistantOnCapture: false, zoomStep: 24 } })
      assert.equal(restored.pdf.quickAskOnCapture, false)
      assert.equal(restored.pdf.openAssistantOnCapture, false)
      assert.equal(restored.pdf.zoomStep, 24)
      assert.equal(restored.version, 2)
      assert.equal(preferenceErrors(restored).length, 0)
    }
  }
})
test('capture quick ask survives saving and reloading independently from automatic assistant opening', () => {
  for (const quickAskOnCapture of [false, true]) {
    for (const openAssistantOnCapture of [false, true]) {
      const saved = defaultPreferences()
      saved.pdf.quickAskOnCapture = quickAskOnCapture
      saved.pdf.openAssistantOnCapture = openAssistantOnCapture
      saved.assistant.quickPrompts[0] = { label: '推导检查', question: '检查框选内容的推导条件。' }
      assert.equal(preferenceErrors(saved).length, 0)
      const restored = normalizePreferences(JSON.parse(JSON.stringify(saved)))
      assert.deepEqual(restored.pdf, saved.pdf)
      assert.deepEqual(restored.assistant.quickPrompts, saved.assistant.quickPrompts)
    }
  }
  const malformed = defaultPreferences()
  malformed.pdf.quickAskOnCapture = 'true'
  assert.ok(preferenceErrors(malformed).some(error => /框选快捷提问选项无效/.test(error)))
})
test('stored out-of-range values are bounded; new edits reject invalid numbers', () => {
  const fixed = normalizePreferences({ pdf: { initialZoom: 900, zoomStep: 1, fitOnPanelOverflow: false }, markdown: { fontSize: 99, contentWidth: 500 } })
  assert.deepEqual(fixed.pdf, { initialZoom: 400, zoomStep: 5, fitOnPanelOverflow: false, openAssistantOnCapture: true, quickAskOnCapture: false })
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
test('shortcut normalization supports document find and F11 while guarding other browser and unmodified keys', () => {
  assert.equal(normalizeShortcut('shift+control+o'), 'Ctrl+Shift+KeyO')
  assert.equal(normalizeShortcut('Alt+ArrowDown'), 'Alt+ArrowDown')
  assert.equal(normalizeShortcut(''), '')
  for (const binding of ['KeyA', 'F5', 'F12', 'Shift+KeyA', 'Ctrl+KeyR', 'Alt+F4', 'Ctrl+Ctrl+KeyO', 'Ctrl+Escape']) assert.equal(normalizeShortcut(binding), null, binding)
  assert.equal(normalizeShortcut('F11'), 'F11')
  assert.equal(normalizeShortcut('Ctrl+KeyF'), DEFAULT_SHORTCUTS.find)
  assert.equal(normalizeShortcut('Ctrl+Tab'), DEFAULT_SHORTCUTS.nextTab)
  assert.equal(normalizeShortcut('Ctrl+KeyW'), DEFAULT_SHORTCUTS.closeTab)
})

test('existing preferences gain find and fullscreen without losing customized bindings', () => {
  const stored = defaultPreferences()
  delete stored.shortcuts.find; delete stored.shortcuts.fullscreen
  stored.shortcuts.capture = 'Alt+Shift+KeyG'; stored.pdf.zoomStep = 24
  const upgraded = normalizePreferences(stored)
  assert.equal(upgraded.shortcuts.find, 'Ctrl+KeyF')
  assert.equal(upgraded.shortcuts.fullscreen, 'F11')
  assert.equal(upgraded.shortcuts.capture, 'Alt+Shift+KeyG')
  assert.equal(upgraded.pdf.zoomStep, 24)
  upgraded.shortcuts.fullscreen = ''; upgraded.shortcuts.find = 'Alt+KeyF'
  const restored = normalizePreferences(upgraded)
  assert.equal(restored.shortcuts.fullscreen, '')
  assert.equal(restored.shortcuts.find, 'Alt+KeyF')
  assert.equal(preferenceErrors(restored).length, 0)
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
    const modifiers = { ctrlKey: parts.includes('Ctrl'), altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'), metaKey: parts.includes('Meta') }
    if (code === 'WheelUp' || code === 'WheelDown') assert.equal(matchWheelShortcut(wheel(code === 'WheelUp' ? -120 : 120, modifiers), preferences), action)
    else assert.equal(matchShortcut(key(code, modifiers), preferences, { scope: action.startsWith('ai') && action !== 'ai' ? 'ai' : 'global' }), action)
  }
})

test('real wheel directions match zoom with exact modifiers and reject ordinary, zero or invalid wheel events', () => {
  const preferences = defaultPreferences()
  assert.equal(DEFAULT_SHORTCUTS.zoomIn, 'Ctrl+WheelUp')
  assert.equal(DEFAULT_SHORTCUTS.zoomOut, 'Ctrl+WheelDown')
  assert.equal(normalizeShortcut('control+滚轮向上'), 'Ctrl+WheelUp')
  assert.equal(shortcutLabel('Ctrl+WheelDown'), 'Ctrl + 滚轮向下')
  for (const delta of [-.25, -1, -120]) {
    assert.equal(shortcutFromWheelEvent(wheel(delta, { ctrlKey: true })), 'Ctrl+WheelUp')
    assert.equal(matchWheelShortcut(wheel(delta, { ctrlKey: true }), preferences), 'zoomIn')
  }
  for (const delta of [.25, 1, 120]) assert.equal(matchWheelShortcut(wheel(delta, { ctrlKey: true }), preferences), 'zoomOut')
  for (const delta of [0, Number.NaN, Infinity, -Infinity]) assert.equal(shortcutFromWheelEvent(wheel(delta, { ctrlKey: true })), null)
  for (const modifiers of [{}, { ctrlKey: true, altKey: true }, { ctrlKey: true, shiftKey: true }, { metaKey: true }, { ctrlKey: true, defaultPrevented: true }]) {
    assert.equal(matchWheelShortcut(wheel(-120, modifiers), preferences), null)
  }
  assert.equal(matchShortcut(key('Equal', { ctrlKey: true }), preferences), null)
  assert.equal(matchShortcut(key('Minus', { ctrlKey: true }), preferences), null)
})

test('custom wheel modifiers, direction reversal and disabled zoom bindings are honored', () => {
  const preferences = defaultPreferences()
  preferences.shortcuts.zoomIn = 'Alt+WheelDown'
  preferences.shortcuts.zoomOut = 'Alt+WheelUp'
  assert.equal(preferenceErrors(preferences).length, 0)
  assert.equal(matchWheelShortcut(wheel(120, { altKey: true }), preferences), 'zoomIn')
  assert.equal(matchWheelShortcut(wheel(-120, { altKey: true }), preferences), 'zoomOut')
  assert.equal(matchWheelShortcut(wheel(-120, { ctrlKey: true }), preferences), null)
  assert.equal(matchWheelShortcut(wheel(-120, { altKey: true, shiftKey: true }), preferences), null)
  preferences.shortcuts.zoomOut = ''
  assert.equal(matchWheelShortcut(wheel(-120, { altKey: true }), preferences), null)
})

test('the old unchanged keyboard zoom pair migrates while customized and disabled bindings survive', () => {
  const stored = defaultPreferences()
  stored.version = 1
  stored.shortcuts.zoomIn = 'Ctrl+Equal'; stored.shortcuts.zoomOut = 'Ctrl+Minus'
  stored.shortcuts.capture = 'Alt+Shift+KeyG'; stored.pdf.zoomStep = 24; stored.appearance.theme = 'dark'
  const migrated = normalizePreferences(stored)
  assert.equal(migrated.shortcuts.zoomIn, 'Ctrl+WheelUp'); assert.equal(migrated.shortcuts.zoomOut, 'Ctrl+WheelDown')
  assert.equal(migrated.shortcuts.capture, 'Alt+Shift+KeyG'); assert.equal(migrated.pdf.zoomStep, 24); assert.equal(migrated.appearance.theme, 'dark')
  for (const [zoomIn, zoomOut] of [['Ctrl+Equal', 'Alt+Minus'], ['Alt+Equal', 'Ctrl+Minus'], ['', 'Ctrl+Minus'], ['Ctrl+WheelUp', 'Alt+WheelDown']]) {
    const original = { shortcuts: { zoomIn, zoomOut } }, current = normalizePreferences(original)
    assert.equal(current.shortcuts.zoomIn, zoomIn); assert.equal(current.shortcuts.zoomOut, zoomOut)
  }
  assert.equal(normalizePreferences({}).shortcuts.zoomIn, 'Ctrl+WheelUp')
})

test('version two deliberate keyboard zoom choices survive saving and reloading', () => {
  const preferences = defaultPreferences()
  assert.equal(preferences.version, 2)
  preferences.shortcuts.zoomIn = 'Ctrl+Equal'; preferences.shortcuts.zoomOut = 'Ctrl+Minus'
  assert.equal(preferenceErrors(preferences).length, 0)
  const saved = normalizePreferences(preferences), restored = normalizePreferences(JSON.parse(JSON.stringify(saved)))
  assert.equal(restored.shortcuts.zoomIn, 'Ctrl+Equal'); assert.equal(restored.shortcuts.zoomOut, 'Ctrl+Minus')
  assert.equal(matchShortcut(key('Equal', { ctrlKey: true }), restored), 'zoomIn')
  assert.equal(matchShortcut(key('Minus', { ctrlKey: true }), restored), 'zoomOut')
  assert.equal(matchWheelShortcut(wheel(-120, { ctrlKey: true }), restored), null)
  assert.equal(matchWheelShortcut(wheel(120, { ctrlKey: true }), restored), null)
  for (const version of [undefined, 1]) {
    const old = normalizePreferences({ version, shortcuts: { zoomIn: 'Ctrl+Equal', zoomOut: 'Ctrl+Minus' } })
    assert.equal(old.version, 2); assert.equal(old.shortcuts.zoomIn, 'Ctrl+WheelUp'); assert.equal(old.shortcuts.zoomOut, 'Ctrl+WheelDown')
  }
})

test('wheel bindings are limited to zoom and conflicting zoom directions are rejected', () => {
  const preferences = defaultPreferences()
  preferences.shortcuts.search = 'Alt+WheelUp'
  assert.ok(preferenceErrors(preferences).some(error => /滚轮组合只用于放大和缩小/.test(error)))
  assert.equal(normalizePreferences(preferences).shortcuts.search, DEFAULT_SHORTCUTS.search)
  preferences.shortcuts.search = DEFAULT_SHORTCUTS.search
  preferences.shortcuts.zoomOut = preferences.shortcuts.zoomIn
  assert.deepEqual(shortcutConflicts(preferences.shortcuts)[0].actions, ['zoomOut', 'zoomIn'])
  assert.ok(preferenceErrors(preferences).some(error => /缩小.*放大/.test(error)))
  assert.deepEqual(normalizePreferences(preferences).shortcuts, DEFAULT_SHORTCUTS)
})
