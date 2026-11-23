import { test } from 'node:test'
import assert from 'node:assert/strict'
import { locate, searchTalks } from '../src/ai/conversation-search.ts'

const talk = (title, updatedAt, ...contents) => ({ title, updatedAt, messages: contents.map((content, index) => ({ id: `m${index}`, content })) })
test('conversation search: exact, in-order with gaps, and one wrong character', () => {
  assert.deepEqual(locate('特征值与特征向量', '特征向量'), { start: 4, end: 8, loose: false })
  assert.equal(locate('特征值的几何意义', '特征意义')?.loose, true)
  assert.equal(locate('拉格朗日乘子法', '拉格朗月乘子')?.loose, true)
  assert.equal(locate('特别无关的一句话，隔了很远才说到征兆，再往后才是意义', '特征意义'), null)
  assert.equal(locate('封闭、结合律、有单位元', '结合率单位')?.loose, true)
  assert.equal(locate('ab', 'ba'), null)
})
test('conversation search: titles first, every word required, snippet around the hit', () => {
  const list = [
    talk('矩阵对角化', 1, '什么时候可以对角化？', '有 n 个线性无关的特征向量时可以。'),
    talk('特征向量怎么求', 2, '先解特征方程。'),
    talk('群的定义', 3, '封闭、结合、单位元、逆元。'),
  ]
  const hits = searchTalks(list, '特征向量')
  assert.deepEqual(hits.map(hit => hit.item.title), ['特征向量怎么求', '矩阵对角化'])
  assert.equal(hits[0].title.hit, '特征向量')
  assert.equal(hits[1].snippet.hit, '特征向量')
  assert.equal(hits[1].messageId, 'm1')
  assert.ok(hits[1].snippet.before.endsWith('线性无关的'))
  assert.deepEqual(searchTalks(list, '对角化 特征').map(hit => hit.item.title), ['矩阵对角化'])
  assert.deepEqual(searchTalks(list, '单位元逆').map(hit => hit.item.title), ['群的定义'])
  assert.deepEqual(searchTalks(list, '  '), [])
})
