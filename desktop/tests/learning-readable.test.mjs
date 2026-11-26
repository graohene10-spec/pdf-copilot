import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readableLearning, readLearning, withoutAnswers } from '../src/ai/learning.ts'
import { searchTalks } from '../src/ai/conversation-search.ts'

const block = (name, data) => '```learn-' + name + '\n' + JSON.stringify(data) + '\n```'
const quiz = { kind: 'check', node: 'limit', question: '数列 $a_n=1/n$ 收敛到几？', options: ['零', '一', '不收敛'], answer: [0], why: '分母趋于无穷，所以是零' }
const plan = { nodes: [{ id: 'seq', title: '数列' }, { id: 'limit', title: '极限' }, { id: 'sum', title: '求和' }], edges: [['seq', 'limit']] }

test('复制出去的回答：题目只留题干和选项，没有答案、解析和 JSON', () => {
  const content = '先看定义。\n\n' + block('mark', { node: 'seq', passed: true, statement: '会求通项' }) + '\n\n' + block('quiz', quiz)
  const text = readableLearning(content)
  assert.match(text, /先看定义/)
  assert.match(text, /数列 \$a_n=1\/n\$ 收敛到几？/)
  assert.match(text, /- 零\n- 一\n- 不收敛/)
  for (const leak of ['分母趋于无穷', '"answer"', '"why"', '{', 'learn-', '```', '会求通项']) assert.ok(!text.includes(leak), leak)
})

test('路线图、摸底结论整块去掉；没写完的块和坏块也不露出 JSON', () => {
  const level = { goal: '理解', strands: [{ topic: '数列', holds: '会', breaks: '', untested: false }] }
  assert.equal(readableLearning('思路如下。\n\n' + block('plan', plan) + '\n\n然后停下。'), '思路如下。\n\n然后停下。')
  assert.equal(readableLearning(block('level', level)), '')
  assert.equal(readableLearning('讲完了。\n```learn-quiz\n{"kind":"check","answer":[1'), '讲完了。')
  assert.equal(readableLearning('坏的：\n```learn-quiz\n{"question": 不是 JSON}\n```\n后面'), '坏的：\n后面')
})

test('普通围栏里的示例和不含学习块的回答原样保留', () => {
  const plain = '一段话\n\n```js\nconst a = 1\n```'
  assert.equal(readableLearning(plain), plain)
  const nested = '````md\n```learn-quiz\n{}\n```\n````'
  assert.equal(readableLearning(nested), nested)
})

test('自述题只留题干', () => {
  const open = { kind: 'check', node: 'sum', question: '为什么收敛？', answer: '部分和有极限。', why: '' }
  assert.equal(readableLearning(block('quiz', open)), '为什么收敛？')
})

test('对话搜索的命中片段不露出答案和 JSON', () => {
  const talk = { title: '学习', updatedAt: 1, messages: [{ id: 'a', content: block('quiz', quiz) }] }
  assert.equal(searchTalks([talk], '分母趋于无穷').length, 0)
  const [hit] = searchTalks([talk], '收敛到几')
  assert.equal(hit.messageId, 'a')
  const snippet = hit.snippet.before + hit.snippet.hit + hit.snippet.after
  assert.ok(!/answer|why|\{|learn-/.test(snippet), snippet)
})

test('读者把大纲删到只剩两个节点，重开应用后大纲还在', () => {
  const state = { options: { scope: '', goal: '', quiz: 'choice' }, phase: 'teach', plan: { nodes: plan.nodes.slice(0, 2), edges: [['seq', 'limit']] }, progress: {}, repairs: 0 }
  assert.deepEqual(readLearning(JSON.parse(JSON.stringify(state))), state)
})

test('withoutAnswers 不受影响：仍保留题目的 JSON（附属对话要发给模型）', () => {
  const text = withoutAnswers(block('quiz', quiz))
  assert.match(text, /"question"/)
  assert.ok(!text.includes('分母趋于无穷'))
})
