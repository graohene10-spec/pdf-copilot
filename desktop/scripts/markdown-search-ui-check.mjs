// Local synthetic Markdown documents only; no external asset or AI requests.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts');
const report = [], errors = [];
const names = ['搜索验证-A.md', '搜索验证-B.md'];
const source = '# 搜索验证\n\nneedle first\n\nAlpha **beta** 跨节点。\n\n[NEEDLE](https://example.invalid)\n\nＮＥＥＤＬＥ\n\n$\\text{mathunique}$\n\n`<script>window.searchInjected=true</script>`\n\n'
  + Array.from({ length: 180 }, (_, index) => `段落 ${index + 1}：用于验证全文定位与排版安全。\n\n`).join('') + 'needle last\n';
let server, browser, page;
async function count(current, total) {
  await page.waitForFunction(({ current, total }) => {
    const search = document.querySelector('.reader-search');
    return search?.getAttribute('aria-busy') === 'false' && search.querySelector('.reader-search-count')?.textContent?.trim() === `${current} / ${total}`;
  }, { current, total });
}
async function query(value, current, total) { await page.getByLabel('文档内搜索', { exact: true }).fill(value); await count(current, total); }
async function select(index) {
  await page.getByRole('tab', { name: names[index], exact: true }).click();
  await page.locator('.markdown-paper').waitFor();
  await page.waitForFunction(() => !document.querySelector('.reader-overlay'));
}
try {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({ cacheDir: resolve(artifacts, 'vite-markdown-search'), optimizeDeps: { entries: ['index.html'] }, server: { host: '127.0.0.1', port: 1476, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/artifacts/**'] } } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1420, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:1476');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([
    { name: names[0], mimeType: 'text/markdown', buffer: Buffer.from(source) },
    { name: names[1], mimeType: 'text/markdown', buffer: Buffer.from('# Other 文档\n\nOther text.') },
  ]);
  await page.locator('.markdown-paper .katex').waitFor();
  const original = await page.locator('.markdown-paper').innerHTML();
  await query('needle', 1, 4);
  const highlights = await page.evaluate(() => [...CSS.highlights.entries()].filter(([name]) => name.startsWith('kaizhi-md-search-')).map(([name, highlight]) => ({ name, size: highlight.size, texts: [...highlight].map(range => range.toString()) })));
  assert.equal(highlights.find(value => !value.name.endsWith('-current'))?.size, 4);
  assert.deepEqual(highlights.find(value => !value.name.endsWith('-current'))?.texts, ['needle', 'NEEDLE', 'ＮＥＥＤＬＥ', 'needle']);
  await page.getByLabel('文档内搜索', { exact: true }).press('Enter'); await count(2, 4);
  await page.getByLabel('文档内搜索', { exact: true }).press('Shift+Enter'); await count(1, 4);
  await page.getByRole('button', { name: '下一个搜索结果', exact: true }).click(); await count(2, 4);
  await page.getByRole('button', { name: '下一个搜索结果', exact: true }).click(); await count(3, 4);
  await page.getByRole('button', { name: '下一个搜索结果', exact: true }).click(); await count(4, 4);
  assert.ok(await page.locator('.markdown-scroll').evaluate(element => element.scrollTop) > 1000, 'Full-text result beyond the viewport must be revealed');
  await page.getByRole('button', { name: '下一个搜索结果', exact: true }).click(); await count(1, 4);
  assert.ok(await page.locator('.markdown-scroll').evaluate(element => element.scrollTop) < 100, 'Next wraps to the first occurrence');
  report.push('Case-insensitive full-document matching, Unicode compatibility forms, exact counts, Enter/Shift+Enter/buttons and viewport-independent wrap navigation');

  await query('alpha beta', 1, 1);
  assert.equal(await page.evaluate(() => [...CSS.highlights.entries()].find(([name]) => name.startsWith('kaizhi-md-search-') && name.endsWith('-current'))?.[1].values().next().value.toString()), 'Alpha beta');
  await query('mathunique', 1, 1);
  assert.equal(await page.locator('.markdown-paper').innerHTML(), original, 'Search must not rewrite KaTeX, links or the document DOM');
  await query('\\text', 0, 0);
  await query('<script>', 1, 1);
  assert.equal(await page.evaluate(() => window.searchInjected), undefined, 'User text stays literal and cannot inject HTML');
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  assert.equal(await page.getByLabel('文档内搜索', { exact: true }).inputValue(), '');
  assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('kaizhi-md-search-')).length), 0);
  report.push('Cross-inline-node phrases, visible formula matches without hidden MathML/TeX duplication, literal HTML safety and clean highlight removal');

  await query('needle', 1, 4);
  await page.getByRole('button', { name: '查看源码', exact: true }).click();
  await count(1, 4);
  assert.equal(await page.locator('.markdown-paper pre').textContent(), source);
  await query('\\text', 1, 1);
  await page.getByRole('button', { name: '阅读视图', exact: true }).click(); await count(0, 0);
  await query('needle', 1, 4);
  await page.getByTitle('放大字号', { exact: true }).click(); await count(1, 4);
  assert.equal(await page.locator('.markdown-paper .katex').count(), 1);
  report.push('Source mode searches the exact original source, mode changes rebuild ranges, font-size changes preserve safe ranges and formulas');

  await page.getByLabel('文档内搜索', { exact: true }).press('Enter'); await count(2, 4);
  await select(1); await query('other', 1, 2);
  assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('kaizhi-md-search-')).length), 2, 'Only the active reader owns registered highlights');
  await select(0); await count(2, 4);
  assert.equal(await page.getByLabel('文档内搜索', { exact: true }).inputValue(), 'needle');
  await select(1); await count(1, 2);
  await select(0); await count(2, 4);
  await page.getByRole('button', { name: '文档库', exact: true }).click();
  assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('kaizhi-md-search-')).length), 0);
  await page.getByRole('tab', { name: names[0], exact: true }).click(); await count(2, 4);
  assert.equal(await page.getByLabel('文档内搜索', { exact: true }).inputValue(), 'needle');
  await page.getByRole('button', { name: `关闭 ${names[0]} 标签`, exact: true }).click();
  await page.getByRole('button', { name: '文档库', exact: true }).click();
  await page.getByRole('button', { name: `打开 ${names[0]}`, exact: true }).click();
  await page.locator('.markdown-paper .katex').waitFor();
  assert.equal(await page.getByLabel('文档内搜索', { exact: true }).inputValue(), '', 'Closed-tab search state does not leak into a new reader');
  report.push('Per-tab query and current match survive warm switching and cold library round trips; inactive/unmounted/closed readers release highlights and closed-tab state');

  await query('needle', 1, 4);
  await page.getByLabel('文档内搜索', { exact: true }).press('Escape');
  assert.equal(await page.getByLabel('文档内搜索', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('文档内搜索', { exact: true }).evaluate(element => element === document.activeElement), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(artifacts, 'markdown-search-ui.png'), animations: 'disabled' });
  report.push('Esc clears query/highlights and returns focus to reading, with no runtime errors');
  await writeFile(resolve(artifacts, 'markdown-search-ui-report.json'), JSON.stringify({ passed: true, checks: report }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: report }, null, 2));
} catch (reason) {
  if (page) {
    await page.screenshot({ path: resolve(artifacts, 'markdown-search-ui-failure.png') }).catch(() => {});
    console.error(JSON.stringify({ error: reason.message, completed: report, query: await page.getByLabel('文档内搜索', { exact: true }).inputValue().catch(() => null), count: await page.locator('.reader-search-count').textContent().catch(() => null), errors }, null, 2));
  }
  throw reason;
} finally { await browser?.close(); await server?.close(); }
