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

test('summary: source ids never reach the document; chapters become a scope sentence', async () => {
  const { summaryChapters, chapterScope } = await import('../src/ai/summary.ts')
  const draft = summaryDraft([a('<summary-doc>\n# 标题\n位形空间是流形。[Se8b917-4] [Se8b917-6]\n世界线可以相交。【Se8b917-52, Se8b917-53】\n</summary-doc>')])
  assert.equal(draft.text, '# 标题\n位形空间是流形。\n世界线可以相交。')
  const outline = [{ title: '第一章 质点', level: 1, page: 12 }, { title: '1.1 位置', level: 2, page: 13 }, { title: '1.1.1 细节', level: 3, page: 14 }, { title: '第二章 位形空间', level: 1, page: 38 }]
  const chapters = summaryChapters(outline)
  assert.deepEqual(chapters.map(item => [item.title, item.level]), [['第一章 质点', 0], ['1.1 位置', 1], ['第二章 位形空间', 0]])
  assert.equal(chapterScope([chapters[0], chapters[2]]), '「第一章 质点」（第 12 页起）、「第二章 位形空间」（第 38 页起）')
  assert.deepEqual(summaryChapters([]), [])
})

test('summary: the opening request reads back into a table', async () => {
  const { parseSummaryRequest } = await import('../src/ai/summary.ts')
  const text = summaryRequest('群论.pdf', { ...emptySummaryOptions(), scope: '「第二章 位形空间」（第 38 页起）', tone: '平实' }, '每节出两道题')
  assert.deepEqual(parseSummaryRequest(text), { title: '群论', rows: [['范围', '「第二章 位形空间」（第 38 页起）'], ['语风', '平实'], ['其他要求', '每节出两道题']] })
  assert.deepEqual(parseSummaryRequest('总结《群论》'), { title: '群论', rows: [] })
  assert.equal(parseSummaryRequest('总结一下这一页'), null)
  assert.equal(parseSummaryRequest('总结《群论》\n顺便讲讲历史'), null)
})
