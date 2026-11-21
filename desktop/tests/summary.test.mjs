import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summaryDraft, summaryChat, summaryContinues, summaryRequest, summaryInstructions, emptySummaryOptions } from '../src/ai/summary.ts'

const a = (content, finishedAt = 1) => ({ role: 'assistant', content, finishedAt })
test('summary: the draft is the latest whole document plus whatever was appended after it', () => {
  const first = a('我按全文来写。\n<summary-doc>\n# 标题\n\n第一部分\n</summary-doc>\n[[继续]]')
  assert.deepEqual(summaryDraft([first]), { text: '# 标题\n\n第一部分', writing: false, versions: 1, last: 'doc', missed: 0 })
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
  assert.deepEqual(summaryDraft([first, streaming]), { text: '# 重写到一', writing: true, versions: 2, last: 'doc', missed: 0 })
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

test('summary: preset options carry their meaning to the model', async () => {
  const { chosenNotes, SUMMARY_FIELDS } = await import('../src/ai/summary.ts')
  for (const field of SUMMARY_FIELDS) for (const option of field.options) assert.ok(field.notes[option], `${field.label} · ${option} 缺说明`)
  const options = { ...emptySummaryOptions(), focus: '知识体系、例题与方法', structure: '提纲', tone: '像讲故事' }
  const notes = chosenNotes(options)
  assert.equal(notes.length, 3)
  assert.match(notes.join('\n'), /侧重「知识体系」：概念之间是什么关系/)
  assert.match(summaryInstructions('群论', options, ''), /读者在表格里选的这几项，意思是：\n- 写法「提纲」/)
  assert.doesNotMatch(summaryInstructions('群论', emptySummaryOptions(), ''), /意思是：/)
})

test('summary: an edit replaces only the passage it names', () => {
  const base = a('<summary-doc>\n# 标题\n\n## 一\n\n第一段，讲位形。\n\n## 二\n\n第二段，讲广义坐标。\n</summary-doc>')
  const edit = a('改好了。\n<summary-edit>\n<old>\n第二段，讲广义坐标。\n</old>\n<new>\n第二段：广义坐标是一组独立参数。[Sab12-3]\n\n例如平面双摆用两个摆角。\n</new>\n</summary-edit>')
  const draft = summaryDraft([base, edit])
  assert.equal(draft.text, '# 标题\n\n## 一\n\n第一段，讲位形。\n\n## 二\n\n第二段：广义坐标是一组独立参数。\n\n例如平面双摆用两个摆角。')
  assert.equal(draft.last, 'edit'); assert.equal(draft.missed, 0)
  // 几处一起改；空的 <new> 是删除；空白抄得不一样也找得到。
  const many = a('<summary-edit><old>第一段，讲位形。</old><new>第一段：位形是系统的形状。</new></summary-edit>\n<summary-edit>\n<old>\n## 二\n第二段，讲广义坐标。\n</old>\n<new></new>\n</summary-edit>')
  assert.equal(summaryDraft([base, many]).text, '# 标题\n\n## 一\n\n第一段：位形是系统的形状。')
  assert.match(summaryChat(many.content), /^```draft-chip\n修改草稿 · 2 处\n```$/)
  // 原文对不上：草稿不动，记一处没改成。
  const wrong = a('<summary-edit><old>草稿里没有的话</old><new>新的</new></summary-edit>')
  const missed = summaryDraft([base, wrong])
  assert.equal(missed.text, summaryDraft([base]).text); assert.equal(missed.missed, 1)
  // 下一轮改成了，就不再算没改成。
  assert.equal(summaryDraft([base, wrong, edit]).missed, 0)
})
test('summary: an edit shows live while it streams and is dropped if cut off', () => {
  const base = a('<summary-doc>\n# 标题\n\n旧的一段。\n\n结尾。\n</summary-doc>')
  const typing = { role: 'assistant', content: '<summary-edit>\n<old>\n旧的一段。\n</old>\n<new>\n新的一' }
  assert.deepEqual(summaryDraft([base, typing]), { text: '# 标题\n\n新的一\n\n结尾。', writing: true, versions: 2, last: 'edit', missed: 0 })
  // 原文还没抄完：先不动。
  assert.equal(summaryDraft([base, { role: 'assistant', content: '<summary-edit>\n<old>\n旧的一' }]).text, '# 标题\n\n旧的一段。\n\n结尾。')
  // 写到一半被打断：不套半截的新内容。
  const cut = summaryDraft([base, { ...typing, finishedAt: 9 }])
  assert.equal(cut.text, '# 标题\n\n旧的一段。\n\n结尾。'); assert.equal(cut.missed, 1)
  assert.match(summaryChat(typing.content), /修改草稿 · 1 处 · 正在改/)
})
