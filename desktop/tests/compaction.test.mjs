import test from 'node:test'
import assert from 'node:assert/strict'
import { limitFor, setCompactLimit, fullness, liveTokens, splitForCompaction, summaryBudget, handoff, compactionPrompt, estimateTokens } from '../src/ai/compaction.ts'
import { boundedHistory } from '../src/ai/document-chat.mjs'

const turns = (n, size = 100) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '字'.repeat(size) }))

test('按 token 计：中文一字一个，英文四个字符一个', () => {
  assert.equal(estimateTokens('群论'), 2); assert.equal(estimateTokens('abcdefgh'), 2)
  const list = turns(10)
  assert.equal(liveTokens(list), 1000); assert.equal(fullness(list, 2000), .5); assert.equal(fullness(list, 500), 1)
  list.slice(0, 8).forEach(item => { item.compressed = true })
  assert.equal(liveTokens(list), 200)
})
test('压缩留下最近几轮，从读者的一问开始', () => {
  const { old, tail } = splitForCompaction(turns(30), 40000)
  assert.equal(tail.length, 6); assert.equal(tail[0].role, 'user'); assert.equal(old.length, 24)
  const long = splitForCompaction(turns(30, 3500), 40000)
  assert.equal(long.tail.length, 2); assert.equal(long.tail[0].role, 'user')
  assert.equal(summaryBudget(1000), 800); assert.equal(summaryBudget(12000), 2000); assert.equal(summaryBudget(900000), 4000)
})
test('请求带的历史不超过设定的 token 数', () => {
  const kept = boundedHistory(1000, turns(40))
  assert.equal(kept.length, 11); assert.equal(kept.at(-1).content.length, 100)
})
test('交接摘要带上读者原话，上一份摘要并入', () => {
  const old = [{ role: 'assistant', content: '旧摘要', summary: true, compressed: false }, { role: 'user', content: '什么是\n子群' }, { role: 'assistant', content: '答' }]
  assert.match(handoff('新摘要', old), /新摘要[\s\S]*读者较早的原话[\s\S]*- 什么是 子群/)
  assert.match(compactionPrompt('群论', old), /【此前的交接摘要】：旧摘要/)
})
test('上限不超过模型窗口的六成', () => {
  setCompactLimit(200000)
  assert.equal(limitFor(128000), 76800); assert.equal(limitFor(200000), 120000); assert.equal(limitFor(400000), 200000)
  setCompactLimit(40000); assert.equal(limitFor(128000), 40000)
})
