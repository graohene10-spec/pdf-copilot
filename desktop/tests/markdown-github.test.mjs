import { test } from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { installGithubFlavor } from '../src/components/markdown-github.ts'

const render = source => { const markdown = new MarkdownIt({ html: false, linkify: true }); installGithubFlavor(markdown); return markdown.render(source) }

test('task lists render read-only checkboxes', () => {
  const html = render('- [x] done\n- [ ] todo\n- plain')
  assert.match(html, /<li class="task-list-item"><input class="task-list-checkbox" type="checkbox" tabindex="-1" aria-readonly="true" checked> done<\/li>/)
  assert.match(html, /<input class="task-list-checkbox" type="checkbox" tabindex="-1" aria-readonly="true"> todo/)
  assert.match(html, /<li>plain<\/li>/)
})

test('simple inline tags pass through without attributes', () => {
  assert.match(render('按 <kbd class="x" onclick="alert(1)">Ctrl</kbd> 与 H<sub>2</sub>O<br/>'), /按 <kbd>Ctrl<\/kbd> 与 H<sub>2<\/sub>O<br>/)
})

test('README style html becomes plain images and links; scripts and handlers are dropped', () => {
  const html = render('<p align="center"><img src="https://example.com/logo.png" alt="Logo" width="120" onerror="alert(1)"></p>\n\n<script>alert(1)</script>\n\n<a href="https://example.com" onclick="x()">site</a> <div style="color:red">text</div>')
  assert.match(html, /<p class="align-center"><img src="https:\/\/example.com\/logo.png" alt="Logo" width="120"><\/p>/)
  assert.match(html, /<a href="https:\/\/example.com">site<\/a>/)
  assert.doesNotMatch(html, /alert|onerror|onclick|<script|<div|style=/)
  assert.match(html, /text/)
})

test('answers: <details>/<summary> on their own lines become folds, other HTML stays text', async () => {
  const { installFold } = await import('../src/components/markdown-fold.ts')
  const markdown = new MarkdownIt({ html: false, breaks: true }); installFold(markdown)
  const html = markdown.render('前言\n<details>\n<summary><strong>1　置换</strong>　｜　先算谁？</summary>\n\n- 一条\n- 两条\n\n<details>\n<summary>例题</summary>\n\n正文 <b>x</b>\n</details>\n</details>\n\n<details open><summary>写在一行</summary>\n里面\n</details>\n\n<script>alert(1)</script>')
  assert.equal(html.match(/<details/g).length, 3)
  assert.equal(html.match(/<\/details>/g).length, 3)
  assert.match(html, /<details class="answer-fold">\s*<summary><strong>1　置换<\/strong>　｜　先算谁？<\/summary>/)
  assert.match(html, /<details class="answer-fold" open="">\s*<summary>写在一行<\/summary>/)
  assert.match(html, /<p>正文 &lt;b&gt;x&lt;\/b&gt;<\/p>\s*<\/details>/)
  assert.doesNotMatch(html, /&lt;\/?(details|summary)/)
  assert.match(html, /&lt;script&gt;/)
})
