import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// intelligent-ui.ts 里的相对导入不带扩展名（交给 Vite 解析）：这里补上 .ts 再找一次。
const hook = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\\.\\.?\\//.test(specifier)) throw error
    return next(specifier + '.ts', context)
  }
}`
register('data:text/javascript,' + encodeURIComponent(hook))
// 渲染代码在模块顶层建了一个 ResizeObserver；Node 里没有，给个空的。
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
const { UI_INSTRUCTIONS } = await import('../src/ai/intelligent-ui.ts')
const { DIAGRAM_SKILLS } = await import('../src/ai/diagrams.ts')

const DIAGRAMS = DIAGRAM_SKILLS.map(item => item.type)
const has = (guide, type) => new RegExp(`(^|[^a-z])${type}([^a-z]|$)`).test(guide)

test('ui instructions: all three guides exist', () => {
  for (const name of ['assistant', 'document', 'explain']) {
    assert.equal(typeof UI_INSTRUCTIONS[name], 'string', name)
    assert.ok(UI_INSTRUCTIONS[name].length > 500, name)
  }
})

test('ui instructions: the assistant guide makes text the default', () => {
  const guide = UI_INSTRUCTIONS.assistant
  for (const banned of ['偏向画', '主要手段', '不是点缀', '不画的情况只有这些']) assert.ok(!guide.includes(banned), banned)
  assert.match(guide, /默认是文字/)
  assert.match(guide, /去掉这张图，读者是否明显更难懂/)
  assert.match(guide, /必须画/)
  assert.match(guide, /不要画/)
  assert.match(guide, /拿不准就不画/)
  assert.match(guide, /最多 2 处/)
  // 选型：表格优先于图，图解优先于可交互；sim 和正文是同一个模型；示例数据要标明。
  assert.match(guide, /表格能说清就不用图/)
  assert.match(guide, /图解能说清就不上可交互/)
  assert.match(guide, /sim 的表达式必须和正文公式是同一个模型/)
  assert.match(guide, /示例/)
  assert.ok(guide.length <= 5200, `assistant guide is ${guide.length} characters`)
})

test('ui instructions: every component type is still documented', () => {
  for (const type of [...DIAGRAMS, 'cards', 'chart', 'table', 'sim', 'form', 'badges', 'text']) assert.ok(has(UI_INSTRUCTIONS.assistant, type), `assistant: ${type}`)
  for (const type of [...DIAGRAMS, 'cards', 'chart', 'table', 'sim', 'badges']) assert.ok(has(UI_INSTRUCTIONS.document, type), `document: ${type}`)
  for (const type of [...DIAGRAMS, 'chart', 'table', 'sim']) assert.ok(has(UI_INSTRUCTIONS.explain, type), `explain: ${type}`)
  // 每种图解的 JSON 写法都还在（目录没被误删）。
  for (const guide of Object.values(UI_INSTRUCTIONS)) for (const type of DIAGRAMS) assert.ok(guide.includes(`{"type":"${type}"`), type)
})

test('ui instructions: the document and explain guides are restrained too', () => {
  assert.match(UI_INSTRUCTIONS.document, /不是每节一张/)
  assert.match(UI_INSTRUCTIONS.document, /不画/)
  assert.ok(!UI_INSTRUCTIONS.document.includes('{"type":"form"'))
  // 读者主动要了可视化：仍然画，但挑对那一种；没有可画的结构时可以只给文字。
  assert.match(UI_INSTRUCTIONS.explain, /挑对那一种/)
  assert.match(UI_INSTRUCTIONS.explain, /不硬画/)
  assert.ok(!UI_INSTRUCTIONS.explain.includes('{"type":"form"'))
})
