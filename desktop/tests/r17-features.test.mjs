import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tidySource, resolveTarget, translationPrompt } from '../src/ai/translate.ts'
import { summarize, dayKey } from '../src/ai/usage.ts'
import { DEFAULT_SHORTCUTS, normalizeShortcut } from '../src/settings/model.ts'

test('translation: PDF line breaks are joined, paragraphs kept, hyphenated words rejoined', () => {
  assert.equal(tidySource('This is a sen-\ntence that wraps\nacross lines.\n\nNext para.'), 'This is a sentence that wraps across lines.\n\nNext para.')
  assert.equal(tidySource('中文句子在这里\n断开了一下'), '中文句子在这里断开了一下')
})

test('translation: auto target goes Chinese ⇄ English; explicit targets win', () => {
  assert.equal(resolveTarget('The measurement postulate says…', 'auto'), 'zh')
  assert.equal(resolveTarget('测量假设说的是什么', 'auto'), 'en')
  assert.equal(resolveTarget('测量假设', 'ja'), 'ja')
  assert.match(translationPrompt('x', 'en'), /English/)
})

test('usage summary: totals, per-model breakdown, shares and today vs peak', () => {
  const now = Date.now(), today = dayKey(now)
  const entries = [
    { kind: 'chat', provider: 'openai', model: 'gpt-5.5', input: 1000, output: 200, reasoning: 50, estimated: false, ms: 3000, at: now },
    { kind: 'translate', provider: 'openai', model: 'gpt-5.4-mini', input: 300, output: 100, reasoning: 0, estimated: true, ms: 800, at: now },
  ]
  const summary = summarize(entries, now, { [today]: { input: 1300, output: 300, requests: 2 }, '2000-01-01': { input: 3000, output: 200, requests: 9 } })
  assert.equal(summary.requests, 2)
  assert.equal(summary.input, 1300)
  assert.equal(summary.estimated, true)
  assert.equal(summary.byModel[0].model, 'gpt-5.5')
  assert.equal(Math.round(summary.byKind.find(item => item.kind === 'chat').share * 100), 75)
  assert.equal(summary.peak, 3200)
  assert.deepEqual(summary.today, { input: 1300, output: 300, requests: 2 })
})

test('Ctrl+T is the default translate shortcut and can be bound', () => {
  assert.equal(DEFAULT_SHORTCUTS.translate, 'Ctrl+KeyT')
  assert.equal(normalizeShortcut('Ctrl+KeyT'), 'Ctrl+KeyT')
})

test('machine translation: Google reply parsing, chunking and the Youdao v3 sign input', async () => {
  const { parseGoogle, chunks, youdaoInput } = await import('../src/ai/machine-translate.ts')
  assert.equal(parseGoogle([[['测量结果', 'The results', null], ['是本征值。', ' are eigenvalues.', null]], null, 'en']), '测量结果是本征值。')
  assert.throws(() => parseGoogle({ error: 1 }))
  const long = Array.from({ length: 5 }, (_, k) => `段落${k} ` + 'x'.repeat(3000)).join('\n\n')
  const parts = chunks(long, 4500)
  assert.ok(parts.length >= 4 && parts.every(part => part.length <= 4500))
  assert.equal(parts.join('\n\n').replace(/\s/g, '').length, long.replace(/\s/g, '').length)
  assert.equal(youdaoInput('hello'), 'hello')
  assert.equal(youdaoInput('abcdefghijklmnopqrstuvwxyz'), 'abcdefghij26qrstuvwxyz')
})
