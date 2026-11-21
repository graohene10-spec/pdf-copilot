import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summaryDraft, summaryChat, summaryContinues, summaryRequest, summaryInstructions, emptySummaryOptions } from '../src/ai/summary.ts'

const a = (content, finishedAt = 1) => ({ role: 'assistant', content, finishedAt })
test('summary: the draft is the latest whole document plus whatever was appended after it', () => {
  const first = a('我按全文来写。\n<summary-doc>\n# 标题\n\n第一部分\n</summary-doc>\n[[继续]]')
  assert.deepEqual(summaryDraft([first]), { text: '# 标题\n\n第一部分', writing: false, versions: 1 })
  const more = a('<summary-add>\n## 第二部分\n内容\n</summary-add>\n\n[[完成]]')
  assert.equal(summaryDraft([first, { role: 'user', content: '继续' }, more]).text, '# 标题\n\n第一部分\n\n## 第二部分\n内容')
  const rewrite = a('改短了。\n<summary-doc>\n# 新标题\n短\n</summary-doc>')
  assert.equal(summaryDraft([first, more, rewrite]).text, '# 新标题\n短')
  // 只是回答问题、没有文档块：草稿不变。
  assert.equal(summaryDraft([first, a('这一章讲的是群。')]).text, '# 标题\n\n第一部分')
})
test('summary: a block still being written shows live; an interrupted rewrite does not replace the finished draft', () => {
  const first = a('<summary-doc>\n# 完整的\n</summary-doc>')
  const streaming = { role: 'assistant', content: '好的。\n<summary-doc>\n# 重写到一' }
  assert.deepEqual(summaryDraft([first, streaming]), { text: '# 重写到一', writing: true, versions: 2 })
  assert.equal(summaryDraft([first, { ...streaming, finishedAt: 5, failed: true }]).text, '# 完整的')
  // 第一稿就被打断：有多少留多少。
  assert.equal(summaryDraft([{ ...streaming, finishedAt: 5 }]).text, '# 重写到一')
})
test('summary: the chat column shows a chip in place of the document and hides the continue marker', () => {
  const shown = summaryChat('范围是第 3 章。\n<summary-doc>\n# 标题\n正文一二三\n</summary-doc>\n[[继续]]')
  assert.match(shown, /^范围是第 3 章。\n\n```draft-chip\n写入草稿 · 8 字\n```$/)
  assert.doesNotMatch(shown, /正文一二三|\[\[继续\]\]|summary-doc/)
  assert.match(summaryChat('<summary-add>\n新的'), /续写草稿 · 2 字 · 正在写/)
  assert.equal(summaryContinues('…\n[[继续]]\n'), true)
  assert.equal(summaryContinues('…\n[[完成]]'), false)
})
test('summary: the request lists only what was filled in; the instructions follow the switches', () => {
  const options = { ...emptySummaryOptions(), scope: '第三章', tone: '像给同学讲题' }
  assert.equal(summaryRequest('群论', options, '每节末尾出两道自测题'), '总结《群论》\n- 范围：第三章\n- 语风：像给同学讲题\n- 其他要求：每节末尾出两道自测题')
  assert.equal(summaryRequest('群论', emptySummaryOptions()), '总结《群论》')
  assert.match(summaryInstructions('群论', options, ''), /不要写 ui 代码块/)
  assert.match(summaryInstructions('群论', { ...options, ui: true, multi: true }, 'UI 写法'), /UI 写法[\s\S]*$/)
  assert.match(summaryInstructions('群论', { ...options, multi: true }, ''), /\[\[继续\]\]/)
})
