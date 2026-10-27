import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cropSize, MAX_CROP_EDGE } from '../src/reader/crop.ts'

test('region crops are never upscaled and keep the long edge within the cap', () => {
  assert.deepEqual(cropSize(300, 200), { width: 300, height: 200 })
  assert.deepEqual(cropSize(4096, 1024), { width: MAX_CROP_EDGE, height: 400 })
  assert.deepEqual(cropSize(1000, 5000), { width: 320, height: MAX_CROP_EDGE })
  assert.deepEqual(cropSize(.4, .4), { width: 1, height: 1 })
})

test('retired "quote the original" prompts migrate to the new wording', async () => {
  const { normalizeQuickPrompts, normalizeCaptureQuestions } = await import('../src/settings/quick-prompts.ts')
  assert.equal(normalizeQuickPrompts([{}, { label: '解释概念与公式', question: '解释当前页中的关键概念与公式，引用原文依据。' }])[1].question, '解释当前页中的关键概念与公式。')
  assert.ok(!normalizeCaptureQuestions([{ label: '为什么？', question: '针对框选的内容解释「为什么」：它为什么成立、为什么这样做，背后的原因、推导或依据是什么。请结合上下文并引用原文。' }])[0].question.includes('原文'))
  assert.equal(normalizeCaptureQuestions([{ label: '我的', question: '请引用原文回答' }])[0].question, '请引用原文回答', 'User-written prompts are untouched.')
})

test('the system prompt no longer insists on the original text', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/ai/providers.mjs', import.meta.url), 'utf8')
  assert.ok(!source.includes('清楚区分原文'))
  assert.ok(source.includes('说人话'))
})
