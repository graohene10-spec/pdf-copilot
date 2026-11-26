import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceLearning, answerText, followUp, gradeChoice, learningContext, mergeMap,
  parseLearning, readLearning, repaired, settled, shuffledOrder, withoutAnswers
} from '../src/ai/learning.ts'

const block = (name, data) => '```learn-' + name + '\n' + JSON.stringify(data) + '\n```'
const plan = {
  nodes: [{ id: 'seq', title: '数列', page: 2 }, { id: 'limit', title: '极限', page: 5 }, { id: 'sum', title: '求和' }],
  edges: [['seq', 'limit'], ['limit', 'sum']]
}
const level = { goal: '理解级数', strands: [
  { topic: '数列', holds: '会求通项', breaks: '不会求极限', untested: false },
  { topic: '求和', holds: '', breaks: '', untested: true }
] }
const choice = { kind: 'probe', question: '哪些数是偶数？', options: ['二', '三', '四'], answer: [0, 2], why: '都能被二整除' }
const checkQuiz = (node, extra = {}) => ({ ...choice, kind: 'check', node, ...extra })
const openQuiz = { kind: 'check', node: 'sum', question: '为什么收敛？', answer: '部分和有极限。', why: '' }
const initial = () => ({ phase: 'setup', options: { scope: '第二章', pages: [2, 8], goal: '会判断收敛', quiz: 'choice' }, progress: {}, repairs: 0 })
const teaching = () => ({ ...initial(), phase: 'teach', plan })
const assistant = (state, content, messageId = 'm1', sources = []) => advanceLearning(state, { type: 'assistant', messageId, content, sources })
const answer = (state, quiz, data, messageId = 'm1') => advanceLearning(state, { type: 'answer', messageId, quiz: { index: 0, ...quiz }, answer: data })
const mark = (node, passed, statement) => block('mark', { node, passed, statement })
const entry = (passed, extra = {}) => ({ passed, messageIds: [], sources: [], ...extra })
const sources = Array.from({ length: 5 }, (_, i) => ({ page: i + 1, line: 2, rect: [1, 2, 3, 4], text: '书'.repeat(299) + '𠀀尾' }))

test('可从同一条回答取出四种学习块', () => {
  const content = [
    block('plan', plan), block('quiz', openQuiz), block('level', level), mark('seq', true, '会求通项')
  ].join('\n')
  const parsed = parseLearning(content)
  assert.deepEqual(parsed.quizzes, [{ ...openQuiz, index: 0 }])
  assert.deepEqual(parsed.plan, plan)
  assert.deepEqual(parsed.level, level)
  assert.deepEqual(parsed.marks, [{ node: 'seq', passed: true, statement: '会求通项' }])
  assert.deepEqual(parsed.errors, [])
})

test('同类块采用最后一份合法的路线图和摸底结论', () => {
  const content = [block('plan', { ...plan, edges: [] }), block('level', { ...level, goal: '旧目标' }),
    block('plan', plan), block('level', level), block('level', {}), block('plan', null)].join('\n')
  const parsed = parseLearning(content)
  assert.deepEqual(parsed.plan, plan)
  assert.deepEqual(parsed.level, level)
})

test('坏块按各自类别占用序号', () => {
  const content = [block('quiz', choice), '```learn-quiz\n{坏 JSON\n```', block('level', {}),
    block('quiz', openQuiz)].join('\n')
  const parsed = parseLearning(content)
  assert.deepEqual(parsed.quizzes.map(q => q.index), [0, 2])
  assert.deepEqual(parsed.errors.map(e => [e.block, e.index]), [['learn-quiz', 1], ['learn-level', 0]])
  assert.ok(parsed.errors.every(e => e.message.trim()))
  assert.match(parsed.errors[0].message, /JSON/)
})

test('围栏独占一行，普通代码块里的示例保持原样，长围栏要用足够长的同种标记闭合', () => {
  const example = '行内 ```learn-quiz\n````md\n' + block('quiz', choice) + '\n````\n'
  const real = '  ~~~~learn-quiz  \r\n' + JSON.stringify(choice) + '\r\n  ~~~~~\t'
  assert.deepEqual(parseLearning(example + real).quizzes, [{ ...choice, index: 0 }])
  assert.equal(parseLearning(example + real).writing, false)
})

test('流式途中尚未闭合的学习块只标记为 writing', () => {
  for (const tail of ['```learn-level', '````learn-plan\n{}\n```', '~~~learn-mark\n```']) {
    const parsed = parseLearning(tail)
    assert.equal(parsed.writing, true)
    assert.deepEqual(parsed.errors, [])
  }
  assert.equal(parseLearning('```json\n{}').writing, false)
})

test('学习围栏的语言标记不区分大小写', () => {
  const parsed = parseLearning(block('quiz', choice).replace('learn-quiz', 'LeArN-QUIZ'))
  assert.deepEqual(parsed.quizzes, [{ ...choice, index: 0 }])
})

test('题目按题型校验题干、选项、参考答案与节点', () => {
  const invalid = [
    { ...choice, question: ' ' }, { ...choice, kind: 'exam' },
    { ...choice, options: ['一'] }, { ...choice, options: [2, 3] }, { ...choice, options: null },
    ...[[], [-1], [1.5], [3], ['1'], '0'].map(answer => ({ ...choice, answer })),
    { ...openQuiz, answer: ' ' }, { ...openQuiz, answer: [1] },
    checkQuiz('missing'), { ...openQuiz, node: '' }, { ...choice, kind: 'predict' }
  ]
  const parsed = parseLearning(invalid.map(q => block('quiz', q)).join('\n'), plan)
  assert.deepEqual(parsed.quizzes, [])
  assert.deepEqual(parsed.errors.map(e => e.index), invalid.map((_, i) => i))
})

test('题目省略解析时 why 为空串', () => {
  const standalone = parseLearning(block('quiz', { ...openQuiz, why: undefined }))
  assert.equal(standalone.quizzes[0].why, '')
})

test('摸底题忽略附带的节点', () => {
  const parsed = parseLearning(block('quiz', { ...choice, node: 'unknown' }), plan)
  assert.deepEqual(parsed.quizzes, [{ ...choice, index: 0 }])
  assert.deepEqual(parsed.errors, [])
})

test('路线图校验节点数量、id 和标题', () => {
  const nodes = n => Array.from({ length: n }, (_, i) => ({ id: 'x-' + i, title: '要点 ' + i }))
  const plans = [
    { nodes: nodes(2), edges: [] }, { nodes: nodes(16), edges: [] },
    ...['Limit', 'a--b', '-a', 'a-', 'a_b', 'a b', ''].map(id => ({ ...plan, nodes: [{ id, title: '标题' }, ...plan.nodes.slice(1)] })),
    { ...plan, nodes: [plan.nodes[0], plan.nodes[0], plan.nodes[1]] },
    { ...plan, nodes: [...plan.nodes, { id: 'new', title: ' ' }] }
  ]
  for (const invalid of plans) {
    const parsed = parseLearning(block('plan', invalid))
    assert.equal(parsed.plan, undefined)
    assert.equal(parsed.errors.length, 1)
  }
  assert.deepEqual(parseLearning(block('plan', { nodes: nodes(15), edges: [] })).plan.nodes, nodes(15))
})

test('路线图拒绝缺失或端点无效的边', () => {
  for (const edges of [undefined, [['seq']], [['seq', 'new']], [['seq', 'seq']]]) {
    assert.equal(parseLearning(block('plan', { ...plan, edges })).errors.length, 1)
  }
})

test('路线图拒绝依赖环', () => {
  for (const edges of [[...plan.edges, ['sum', 'seq']], [['sum', 'limit'], ['limit', 'sum']]]) {
    const parsed = parseLearning(block('plan', { ...plan, edges }))
    assert.equal(parsed.plan, undefined)
    assert.match(parsed.errors[0].message, /环/)
  }
})

test('无环路线图合并重复边', () => {
  const diamond = { ...plan, edges: [...plan.edges, ['seq', 'sum']] }
  assert.deepEqual(parseLearning(block('plan', { ...diamond, edges: [...diamond.edges, ...plan.edges] })).plan, diamond)
})

test('摸底需要目标和分项', () => {
  for (const invalid of [{ ...level, goal: '\t' }, { ...level, strands: [] }, { ...level, strands: [null] }]) {
    const parsed = parseLearning(block('level', invalid))
    assert.equal(parsed.level, undefined)
    assert.equal(parsed.errors.length, 1)
  }
})

test('摸底分项允许只给出主题', () => {
  const parsed = parseLearning(block('level', { ...level, strands: [{ topic: '数列' }] }))
  assert.deepEqual(parsed.level.strands, [{ topic: '数列', holds: '', breaks: '', untested: false }])
})

test('结论标记需要节点和布尔值', () => {
  for (const invalid of [mark('', true), mark('seq', 1), mark('unknown', true)]) {
    const parsed = parseLearning(invalid, plan)
    assert.deepEqual(parsed.marks, [])
    assert.equal(parsed.errors.length, 1)
  }
  assert.deepEqual(parseLearning(mark('unknown', false)).marks, [{ node: 'unknown', passed: false }])
})

test('选项排列由种子决定', () => {
  for (const n of [-1, 0, 1, 2, 9]) {
    const order = shuffledOrder('消息甲:0', n)
    assert.deepEqual(order, shuffledOrder('消息甲:0', n))
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i))
  }
  const orders = new Set(Array.from({ length: 8 }, (_, i) => shuffledOrder('消息:' + i, 8).join(',')))
  assert.ok(orders.size > 1)
})

test('判分比较原始下标的集合', () => {
  assert.equal(gradeChoice(choice, [2, 0, 2]), true)
  for (const picked of [[], [0], [0, 1], [0, 2, 5]]) assert.equal(gradeChoice(choice, picked), false)
  assert.equal(gradeChoice(openQuiz, []), false)
})

test('选择题作答文本只给出读者新增的信息', () => {
  for (const [sure, label] of ['蒙的', '不太确定', '比较确定', '确定'].entries()) {
    const text = answerText(choice, { picked: [2, 0], sure, thinking: '可以两两配对' })
    for (const part of ['四', '二', '答对', label, '可以两两配对']) assert.ok(text.includes(part))
    for (const part of [choice.question, choice.why, '三']) assert.ok(!text.includes(part))
  }
  const wrong = answerText(choice, { picked: [1] })
  assert.match(wrong, /三/)
  assert.match(wrong, /答错/)
  assert.doesNotMatch(wrong, /把握|确定|蒙的/)
})

test('自述题作答保留原话', () => {
  assert.equal(answerText(openQuiz, { text: '我先考察部分和。', sure: 3 }), '我先考察部分和。')
})

test('自述题留白时给出没有作答的提示', () => {
  assert.equal(answerText(openQuiz, { text: ' ' }), '（没有作答）')
})

test('不知道或跳过时省略选项与判分', () => {
  for (const [flag, word] of [['dontKnow', '不知道'], ['skipped', '跳过']]) {
    const text = answerText(choice, { [flag]: true, picked: [1], sure: 0 })
    assert.ok(text.includes(word))
    assert.doesNotMatch(text, /三|答错|把握|\n/)
  }
})

test('点不知道时也带上读者写的想法', () => {
  assert.equal(answerText(choice, { dontKnow: true, thinking: ' 可能要先分组 ' }), '我不知道。\n我的想法：可能要先分组')
})

test('抹答案保留围栏、其他字段与题块以外的原文', () => {
  const prefix = '````text\n' + block('quiz', choice) + '\n````\n讲解\r\n'
  const between = '\r\n' + block('level', level) + '\n'
  const tail = '\n```learn-quiz\n{坏 JSON\n```'
  const raw = { ...choice, detail: { answer: '扩展字段' }, question: '符号 $& 是什么？' }
  const fence = json => '  ~~~~LEARN-Quiz  \r\n  ' + JSON.stringify(json) + '\r\n  ~~~~~'
  const { answer: a, why: w, ...visible } = raw
  const { answer: b, why: x, ...openVisible } = openQuiz
  const redacted = withoutAnswers(prefix + fence(raw) + between + block('quiz', openQuiz) + tail)
  assert.equal(redacted, prefix + fence(visible) + between + block('quiz', openVisible) + tail)
  assert.equal(withoutAnswers(redacted), redacted)
})

test('题目 JSON 合法但校验失败时也抹掉答案和解析', () => {
  const invalid = { question: '', answer: '参考答案', why: '参考解析' }
  assert.equal(withoutAnswers(block('quiz', invalid)), block('quiz', { question: '' }))
})

test('末尾未闭合的题块从开围栏起整块移除', () => {
  const content = block('quiz', choice) + '\n正文\r\n'
  assert.equal(withoutAnswers(content + '  ~~~~Learn-Quiz\r\n{"answer":"答案"'), withoutAnswers(content))
})

test('开始事件只把设定阶段推进到摸底', () => {
  const start = initial()
  assert.equal(advanceLearning(start, { type: 'start' }).phase, 'probe')
  assert.equal(start.phase, 'setup')
  assert.deepEqual(advanceLearning(teaching(), { type: 'start' }), teaching())
})

test('摸底阶段获得合法结论才转入规划', () => {
  const before = { ...initial(), phase: 'probe' }
  assert.equal(assistant(before, block('plan', plan)).phase, 'probe')
  const after = assistant(before, block('level', level))
  assert.equal(after.phase, 'plan')
  assert.deepEqual(after.level, level)
  assert.equal(assistant(teaching(), block('level', level)).level, undefined)
})

test('接受现有路线后开始带读', () => {
  const before = { ...initial(), phase: 'plan' }
  assert.deepEqual(advanceLearning(before, { type: 'accept-plan' }), before)
  const ready = assistant(before, block('plan', plan))
  assert.equal(ready.phase, 'plan')
  assert.equal(advanceLearning(ready, { type: 'accept-plan' }).phase, 'teach')
})

test('accept-plan 时节点已全部通过则直接收尾', () => {
  const before = { ...initial(), phase: 'plan', plan }
  const ready = assistant(before, plan.nodes.map(n => mark(n.id, true)).join('\n'))
  assert.equal(ready.phase, 'plan')
  assert.equal(advanceLearning(ready, { type: 'accept-plan' }).phase, 'done')
})

const revised = { nodes: [...plan.nodes.slice(0, 2), { id: 'series', title: '级数' }], edges: [['limit', 'series']] }

test('同条回答先给新节点出题再改图，所有节点都以新图为准', () => {
  const state = assistant(teaching(), [mark('seq', true), mark('sum', false)].join('\n'))
  const content = [block('quiz', checkQuiz('series')), mark('sum', true), block('quiz', checkQuiz('sum')),
    mark('limit', true), block('plan', revised)].join('\n')
  const parsed = parseLearning(content, plan)
  assert.deepEqual(parsed.errors.map(e => [e.block, e.index]), [['learn-mark', 0], ['learn-quiz', 1]])
  assert.deepEqual(parsed.quizzes.map(q => q.node), ['series'])
  assert.deepEqual(parsed.marks.map(m => m.node), ['limit'])
  const next = assistant(state, content, '改图')
  assert.deepEqual(next.plan, revised)
  assert.deepEqual(next.progress.seq, state.progress.seq)
  assert.equal(next.progress.sum, undefined)
  assert.equal(next.current, 'series')
  assert.deepEqual(next.pending, { messageId: '改图', index: 0, node: 'series' })
})

test('各阶段的助手回答都按现有路线图校验节点', () => {
  for (const phase of ['setup', 'probe', 'plan', 'teach', 'done']) {
    const next = assistant({ ...teaching(), phase }, block('quiz', checkQuiz('unknown')))
    assert.equal(next.pending, undefined, phase)
  }
})

test('没有路线图时带节点的题目和标记不产生节点进度', () => {
  for (const content of [block('quiz', checkQuiz('seq')), mark('seq', false), mark('seq', true)]) {
    const next = assistant(initial(), content)
    assert.deepEqual(next.progress, {})
    assert.equal(next.current, undefined)
  }
})

test('quiz 与 mark 按正文顺序决定正在学的节点', () => {
  const quiz = block('quiz', checkQuiz('seq'))
  const retry = mark('limit', false)
  for (const [content, current] of [[quiz + '\n' + retry, 'limit'], [retry + '\n' + quiz, 'seq']]) {
    const next = assistant(teaching(), content)
    assert.equal(next.current, current)
    assert.equal(next.progress.seq.passed, false)
    assert.equal(next.progress.limit.passed, false)
  }
})

test('已通过的节点再出题时保留通过判定和小结', () => {
  const before = assistant(teaching(), mark('seq', true, '能写出通项'))
  const next = assistant(before, block('quiz', checkQuiz('seq')), 'm2')
  assert.deepEqual(next.progress.seq, entry(true, { statement: '能写出通项', messageIds: ['m1', 'm2'] }))
  assert.deepEqual(before.progress.seq.messageIds, ['m1'])
})

test('内容相同的出处只留最近一份，忽略 rect 的对象与坐标', () => {
  const original = { page: 2, line: 3, rect: [1], text: '数列' }
  const copy = structuredClone(original)
  const latest = { ...original, rect: [7] }
  const first = assistant(teaching(), mark('seq', false), 'm1', [original])
  const next = assistant(first, mark('seq', false), 'm2', [copy, latest])
  assert.deepEqual(next.progress.seq.sources, [latest])
  assert.deepEqual(first.progress.seq.sources, [original])
})

test('每节点保留最近四个不同出处，重引会更新先后次序', () => {
  const content = mark('seq', false)
  const first = assistant(teaching(), content, 'm1', sources.slice(0, 4))
  const next = assistant(first, content, 'm2', [sources[0], sources[4]])
  assert.deepEqual(next.progress.seq.sources.map(s => s.page), [3, 4, 1, 5])
})

test('出处摘句保留前 300 个字符', () => {
  const state = assistant(teaching(), mark('seq', false), 'm1', sources.slice(0, 1))
  assert.equal(state.progress.seq.sources[0].text, '书'.repeat(299) + '𠀀')
  assert.ok(sources[0].text.endsWith('尾'))
})

test('同一条消息补入出处时只记一次消息 id', () => {
  const content = block('quiz', checkQuiz('seq')) + '\n' + mark('seq', true)
  const first = assistant(teaching(), content, 'm1', sources.slice(0, 1))
  const next = assistant(first, content, 'm1', sources.slice(0, 2))
  assert.deepEqual(next.progress.seq.messageIds, ['m1'])
  assert.deepEqual(next.progress.seq.sources.map(s => s.page), [1, 2])
})

test('pending 指向回答里最后一道合法题', () => {
  const content = [block('quiz', {}), block('quiz', checkQuiz('seq')), block('quiz', choice), block('quiz', {})].join('\n')
  assert.deepEqual(assistant(teaching(), content).pending, { messageId: 'm1', index: 2 })
})

test('没有合法 quiz 的回答保留待答题', () => {
  const before = assistant(teaching(), block('quiz', checkQuiz('seq')))
  for (const content of ['继续讲解', mark('seq', true), block('quiz', {})]) {
    assert.deepEqual(assistant(before, content, '插话后').pending, before.pending)
  }
})

test('改图时只清除所属节点已移除的待答题', () => {
  for (const node of ['sum', 'seq']) {
    const before = assistant(teaching(), block('quiz', checkQuiz(node)) + '\n' + mark('limit', false))
    const next = assistant(before, block('plan', revised))
    assert.deepEqual(next.pending, node === 'sum' ? undefined : before.pending)
    assert.equal(next.current, 'limit')
  }
})

test('只有答题消息和题号同时匹配才清除 pending', () => {
  const before = assistant(teaching(), [block('quiz', choice), block('quiz', checkQuiz('seq'))].join('\n'))
  for (const [id, index] of [['其他消息', 1], ['m1', 0], ['m1', 1]]) {
    const next = answer(before, { ...checkQuiz('seq'), index }, { picked: [0] }, id)
    assert.deepEqual(next.pending, id === 'm1' && index === 1 ? undefined : before.pending)
  }
})

test('答对旧消息的检查选择题仍可通过并收尾', () => {
  const before = assistant(teaching(), [mark('seq', true), mark('limit', true), block('quiz', choice)].join('\n'))
  const next = answer(before, checkQuiz('sum'), { picked: [2, 0] }, '旧消息')
  assert.equal(next.progress.sum.passed, true)
  assert.equal(next.phase, 'done')
  assert.deepEqual(next.pending, before.pending)
})

test('本地只对答对的检查选择题放行', () => {
  const state = assistant(teaching(), block('quiz', checkQuiz('sum')))
  for (const [quiz, data] of [
    [checkQuiz('sum', { kind: 'predict' }), { picked: [0, 2] }], [choice, { picked: [0, 2] }],
    [openQuiz, { text: openQuiz.answer }], [checkQuiz('sum'), { picked: [0] }],
    [checkQuiz('sum'), { picked: [0, 2], dontKnow: true }], [checkQuiz('sum'), { picked: [0, 2], skipped: true }]
  ]) assert.equal(answer(state, quiz, data).progress.sum.passed, false)
})

const completed = () => assistant(teaching(), plan.nodes.map(n => mark(n.id, true)).join('\n'))

test('done 后被 mark 退回的节点恢复带读', () => {
  const before = completed()
  assert.equal(before.phase, 'done')
  const next = assistant(before, mark('seq', false))
  assert.equal(next.phase, 'teach')
  assert.equal(next.progress.seq.passed, false)
  assert.equal(next.current, 'seq')
})

test('done 后改图增加未通过节点时恢复带读', () => {
  const expanded = { ...plan, nodes: [...plan.nodes, revised.nodes[2]] }
  assert.equal(assistant(completed(), block('plan', expanded)).phase, 'teach')
})

test('回答结束时 followUp 请求补全未写完的最后一个块', () => {
  const before = teaching()
  const content = '```learn-mark\n{"passed":'
  assert.match(followUp(before, assistant(before, content), content), /最后一个块没有写完/)
})

test('摸底结论和坏块同时出现时，一句补发同时要求修正和规划', () => {
  const before = { ...initial(), phase: 'probe' }
  const content = [block('level', level), block('quiz', {}), mark('', true)].join('\n')
  const text = followUp(before, assistant(before, content), content)
  assert.ok(text.includes('重写') && text.includes('请规划路线并用 learn-plan 块给出'))
  for (const e of parseLearning(content).errors) assert.ok(text.includes(e.block) && text.includes(e.message))
  assert.equal(text.split('。').filter(Boolean).length, 1)
})

test('修好坏块后仍缺图时，即使本条回答没有 level 也请求规划', () => {
  const before = { ...initial(), phase: 'plan', level, repairs: 1 }
  const content = block('quiz', choice)
  assert.match(followUp(before, assistant(before, content), content), /规划.*learn-plan/)
})

test('连着补发两次仍不写路线图就停下，不会一直替读者催', () => {
  let state = { ...initial(), phase: 'plan', level, repairs: 0 }
  const content = '你想先学哪一部分？'
  let sent = 0
  for (let round = 0; round < 10; round++) {
    const after = assistant(state, content, 'm' + round)
    const next = followUp(state, after, content)
    if (!next) break
    sent++; state = repaired(after)
  }
  assert.equal(sent, 2)
})

test('同条回答已经给出合法路线时无需再请求规划', () => {
  const before = { ...initial(), phase: 'probe' }
  const content = block('level', level) + '\n' + block('plan', plan)
  assert.equal(followUp(before, assistant(before, content), content), null)
})

test('是否补发修正请求取决于回答前的次数', () => {
  const before = teaching()
  const first = repaired(before), second = repaired(first)
  const bad = block('quiz', {})
  assert.match(followUp(first, second, bad), /重写/)
  assert.equal(followUp(second, first, bad), null)
})

test('补发次数随修正请求递增，在本轮结束时归零', () => {
  const before = teaching()
  const first = repaired(before), second = repaired(first)
  assert.equal(before.repairs, 0)
  assert.equal(first.repairs, 1)
  assert.equal(second.repairs, 2)
  assert.deepEqual(settled(second), before)
})

test('learningContext 区分路线节点的四种状态', () => {
  const state = { ...teaching(), plan: { ...plan, nodes: [...plan.nodes, revised.nodes[2]] }, current: 'limit',
    progress: { seq: entry(true), limit: entry(false), sum: entry(false) } }
  const lines = learningContext(state).split('\n')
  for (const line of ['seq 数列（第 2 页）：已通过', 'limit 极限（第 5 页）：正在学', 'sum 求和：讲过未通过', 'series 级数：没到']) {
    assert.ok(lines.includes(line), line)
  }
})

test('中文上下文包含设定、摸底分项和依赖方向', () => {
  const text = learningContext({ ...teaching(), level })
  for (const part of ['第二章', '2–8', '会判断收敛', '带读', '理解级数', '会求通项', '不会求极限', '求和：未测', 'seq → limit', 'limit → sum']) {
    assert.ok(text.includes(part), part)
  }
})

test('读盘能恢复带出处和待答题的学习状态', () => {
  const state = assistant({ ...teaching(), level }, block('quiz', checkQuiz('seq')), 'm', sources)
  assert.deepEqual(readLearning(JSON.parse(JSON.stringify(state))), state)
})

test('读盘只因设定或阶段无效而放弃整份状态', () => {
  const s = initial()
  for (const raw of [
    null, undefined, [], '坏数据', 1, Symbol(), {}, { ...s, options: null }, { ...s, options: { ...s.options, quiz: 'invalid' } },
    { ...s, phase: 'constructor' }, { ...s, options: { ...s.options, pages: [2, 1] } },
    { get options() { throw new Error('不能读取') } }
  ]) assert.equal(readLearning(raw), undefined)
})

test('读盘总是重置本轮修正次数', () => {
  for (const repairs of [2, -1, '坏数据', undefined]) assert.deepEqual(readLearning({ ...initial(), repairs }), initial())
})

test('读盘分别丢弃损坏的路线和摸底结论', () => {
  const state = { ...initial(), level, plan }
  assert.deepEqual(readLearning({ ...state, level: { ...level, strands: [{}] } }), { ...initial(), plan })
  assert.deepEqual(readLearning({ ...state, plan: { ...plan, edges: [['sum', 'sum']] } }), { ...initial(), level })
})

test('读盘保留有效进度，跳过损坏或已移除的节点', () => {
  const state = { ...teaching(), progress: { seq: entry(true) } }
  for (const bad of [null, entry('错'), entry(false, { statement: 42 }), entry(false, { messageIds: [false] }), entry(false, { sources: null })]) {
    assert.deepEqual(readLearning({ ...state, progress: { ...state.progress, limit: bad, old: entry(true) } }), state)
  }
  assert.deepEqual(readLearning({ ...teaching(), progress: null }), teaching())
})

test('损坏的出处只丢该条，保留同节点的其他出处', () => {
  const valid = { page: 1, line: 2, text: '数列' }
  const state = { ...teaching(), progress: { seq: entry(true, { sources: [valid, null, { page: 0, text: '坏页码' }] }) } }
  assert.deepEqual(readLearning(state).progress.seq, entry(true, { sources: [valid] }))
})

test('读盘丢掉不在图里的 current', () => {
  assert.deepEqual(readLearning({ ...teaching(), current: 'removed' }), teaching())
})

test('读盘跳过坏的待答题', () => {
  for (const pending of [null, { messageId: '', index: 0 }, { messageId: 'm', index: 1.5 }, { messageId: 'm', index: 0, node: 'removed' }]) {
    assert.deepEqual(readLearning({ ...teaching(), pending }), teaching())
  }
})

const oldNode = id => ({ id, title: id, statement: '旧表述', conversationId: 'old', at: 1, sources: [] })

test('知识地图按 id 覆盖通过节点，沿用已记录的出处', () => {
  const previous = { ...oldNode('prereq'), sources }
  const existing = { nodes: [oldNode('seq'), previous], edges: [] }
  const state = assistant(teaching(), mark('seq', true, '会求通项'), 'm', sources)
  const snapshot = structuredClone({ existing, state })
  const map = mergeMap(existing, state, 'new', 42)
  assert.deepEqual({ existing, state }, snapshot)
  assert.deepEqual(map.nodes, [
    { ...plan.nodes[0], statement: '会求通项', sources: state.progress.seq.sources, conversationId: 'new', at: 42 }, previous
  ])
  assert.equal(map.nodes[0].sources, state.progress.seq.sources)
})

test('知识地图保留旧边并连接先前会话的节点', () => {
  const existing = { nodes: ['prereq', 'seq', 'limit'].map(oldNode), edges: [['prereq', 'seq'], ['seq', 'limit']] }
  const state = { ...teaching(), progress: { sum: entry(true) } }
  const map = mergeMap(existing, state, 'new', 42)
  assert.deepEqual(map.edges, [['prereq', 'seq'], ['seq', 'limit'], ['limit', 'sum']])
  assert.deepEqual(mergeMap(map, state, 'new', 42), map)
})

test('知识地图只收已通过的节点及端点齐全的边', () => {
  const state = { ...teaching(), progress: { seq: entry(true), limit: entry(false) } }
  const map = mergeMap({ nodes: [], edges: [] }, state, 'new', 42)
  assert.deepEqual(map.nodes.map(n => n.id), ['seq'])
  assert.deepEqual(map.edges, [])
})

test('并入知识地图时缺少小结的节点沿用标题', () => {
  const state = { ...teaching(), progress: { sum: entry(true) } }
  const map = mergeMap({ nodes: [], edges: [] }, state, 'new', 42)
  assert.equal(map.nodes[0].statement, '求和')
})

test('mergeMap 丢掉与旧边形成间接环的新边，继续并入后续合法边', () => {
  const existing = { nodes: ['seq', 'limit', 'sum'].map(oldNode), edges: [['sum', 'seq']] }
  const state = { ...teaching(), plan: { ...revised, nodes: [...plan.nodes, revised.nodes[2]], edges: [...plan.edges, ['limit', 'series']] },
    progress: { series: entry(true) } }
  const map = mergeMap(existing, state, 'new', 42)
  assert.deepEqual(map.edges, [['sum', 'seq'], ['seq', 'limit'], ['limit', 'series']])
})
