import { test } from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { installCjkEmphasis, fixCjkEmphasis } from '../src/components/markdown-cjk.ts'
import { toClaudeMessages } from '../src/ai/anthropic.mjs'
import { buildPayload, protocolOf, PROVIDERS } from '../src/ai/providers.mjs'

test('bold next to Chinese punctuation renders', () => {
  const markdown = new MarkdownIt(); installCjkEmphasis(markdown)
  const html = markdown.render('这里有个关键前提：**插入新牌之前，手里的牌已经排好了。**下文明确说。\n\n然后**“不用再整理”指不用重排。**如果原来乱')
  assert.equal((html.match(/<strong>/g) || []).length, 2, html)
  assert.doesNotMatch(html, /\*\*/)
  assert.equal(fixCjkEmphasis('`a**。**b`'), '`a**。**b`', 'inline code is untouched')
  assert.equal(fixCjkEmphasis('plain **bold** text'), 'plain **bold** text')
})

test('providers: Claude, Kimi, GLM, Qwen and a custom endpoint with its own protocol', () => {
  for (const id of ['anthropic', 'kimi', 'glm', 'qwen', 'custom']) assert.ok(PROVIDERS.some(item => item.id === id), id)
  assert.equal(protocolOf('anthropic'), 'anthropic')
  assert.equal(protocolOf('kimi'), 'chat')
  assert.equal(protocolOf('custom', 'responses'), 'responses')
  assert.equal(protocolOf('custom', 'bogus'), 'chat')
  const messages = [{ role: 'user', content: 'hi' }]
  assert.deepEqual(buildPayload({ provider: 'glm', model: 'glm-4.6', effort: 'none', messages }).thinking, { type: 'disabled' })
  assert.equal(buildPayload({ provider: 'glm', model: 'glm-4.6', effort: 'high', messages }).reasoning_effort, undefined)
  assert.equal(buildPayload({ provider: 'kimi', model: 'kimi-k2-turbo-preview', effort: '', messages }).thinking, undefined)
  assert.equal(buildPayload({ provider: 'custom', protocol: 'responses', model: 'x', messages }).input.length, 1)
})

test('chat history converts to Claude messages with tool results in one user turn', () => {
  const { system, messages } = toClaudeMessages([
    { role: 'system', content: 'S' },
    { role: 'user', content: [{ type: 'text', text: 'Q' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'pdf_read', arguments: '{"start_page":1}' } }, { id: 't2', function: { name: 'pdf_search', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't1', content: '{"a":1}' },
    { role: 'tool', tool_call_id: 't2', content: '{"b":2}' },
    { role: 'user', content: [{ type: 'text', text: 'img' }] },
  ])
  assert.equal(system, 'S')
  assert.deepEqual(messages.map(item => item.role), ['user', 'assistant', 'user'])
  assert.deepEqual(messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } })
  assert.deepEqual(messages[1].content.map(block => block.type), ['tool_use', 'tool_use'])
  assert.deepEqual(messages[1].content[0].input, { start_page: 1 })
  assert.deepEqual(messages[2].content.map(block => block.type), ['tool_result', 'tool_result', 'text'])
})

test('bookmark navigation finds the nearest mark before or after the current spot', async () => {
  const { neighbour } = await import('../src/library/bookmark-nav.ts')
  const list = [{ id: 'a', ratio: .1 }, { id: 'c', ratio: .7 }, { id: 'b', ratio: .4 }]
  assert.equal(neighbour(list, .4, 1).id, 'c')
  assert.equal(neighbour(list, .4, -1).id, 'a')
  assert.equal(neighbour(list, .05, -1), undefined)
  assert.equal(neighbour(list, .9, 1), undefined)
})
