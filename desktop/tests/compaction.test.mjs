import test from 'node:test'
import assert from 'node:assert/strict'
import { fullness, splitForCompaction, summaryBudget, handoff, compactionPrompt, WINDOW } from '../src/ai/compaction.ts'

const turns = (n, size = 100) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:` + 'x'.repeat(size) }))

test('压缩留下最近几轮，从读者的一问开始', () => {
  const { old, tail } = splitForCompaction(turns(30))
  assert.equal(tail.length, 6); assert.equal(tail[0].role, 'user'); assert.equal(old.length, 24)
  const long = splitForCompaction(turns(30, 7000))
  assert.equal(long.tail.length, 2); assert.equal(long.tail[0].role, 'user')
})
test('已压缩的不再计入，圆环与摘要篇幅跟着原文走', () => {
  const list = turns(WINDOW.messages)
  assert.equal(fullness(list), 1)
  list.slice(0, 18).forEach(item => { item.compressed = true })
  assert.equal(fullness(list), 6 / WINDOW.messages)
  assert.equal(summaryBudget(1000), 800); assert.equal(summaryBudget(12000), 2000); assert.equal(summaryBudget(900000), 4000)
})
test('交接摘要带上读者原话，上一份摘要并入', () => {
  const old = [{ role: 'assistant', content: '旧摘要', summary: true, compressed: false }, { role: 'user', content: '什么是\n子群' }, { role: 'assistant', content: '答' }]
  assert.match(handoff('新摘要', old), /新摘要[\s\S]*读者较早的原话[\s\S]*- 什么是 子群/)
  assert.match(compactionPrompt('群论', old), /【此前的交接摘要】：旧摘要/)
})
