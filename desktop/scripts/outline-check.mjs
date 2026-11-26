// 大纲栏的本地操作：拖动换次序、右键安排、减号删除。塞一份假的学习状态，不调任何模型。
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts');
let server, browser;
try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ server: { host: '127.0.0.1', port: 1499, strictPort: true, watch: null }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:1499');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name: '大纲检查.md', mimeType: 'text/markdown', buffer: Buffer.from('# 大纲检查\n\n一段正文。') }]);
  await page.locator('.markdown-paper').filter({ hasText: '大纲检查' }).waitFor();
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await page.locator('.ai-pane:visible').first().waitFor();
  await page.evaluate(async () => {
    const { chatState } = await import('/src/ai/workspace.ts'), { library } = await import('/src/sdk/index.ts');
    const state = chatState((await library.list())[0].id);
    state.messages.push({ id: 'u1', role: 'user', content: '学习', sources: [] }, { id: 'a1', role: 'assistant', content: '好。', sources: [], startedAt: 1, finishedAt: 2 });
    state.learning = { options: { scope: '', goal: '深度理解', quiz: 'choice' }, phase: 'teach', current: 'b', repairs: 0, progress: { a: { passed: true, messageIds: [], sources: [] } },
      plan: { nodes: ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id, title: `节点 ${id.toUpperCase()}`, page: index + 1 })), edges: [['a', 'b'], ['b', 'c']] } };
  });
  const outline = page.locator('.outline'), rows = outline.locator('.outline-nodes li');
  await outline.waitFor();
  const plan = () => page.evaluate(async () => { const { chatState } = await import('/src/ai/workspace.ts'), { library } = await import('/src/sdk/index.ts'); const plan = chatState((await library.list())[0].id).learning.plan; return { order: plan.nodes.map(node => node.id + (node.pace ? ':' + node.pace : '')).join(' '), edges: plan.edges.map(edge => edge.join('>')).join(' ') }; });

  await rows.nth(3).click({ button: 'right' });
  await page.getByText('讲细一点', { exact: true }).click();
  assert.equal((await plan()).order, 'a b c d:slow e', '右键给节点标上细讲');

  await outline.getByRole('button', { name: '调整', exact: true }).click(); await page.waitForTimeout(200);
  const from = await rows.nth(4).boundingBox(), to = await rows.nth(1).boundingBox();
  const x = from.x + from.width / 2, startY = from.y + from.height / 2, endY = to.y + 3;
  await page.mouse.move(x, startY); await page.mouse.down();
  for (let step = 1; step <= 16; step++) { await page.mouse.move(x, startY + (endY - startY) * step / 16); await page.waitForTimeout(20); }
  await page.screenshot({ path: resolve(artifacts, 'outline-dragging.png') });
  await page.mouse.up(); await page.waitForTimeout(300);
  assert.equal((await plan()).order, 'a e b c d:slow', '把最后一个拖到第二位');
  assert.equal((await plan()).edges, 'a>b b>c', '没有被新次序颠倒的依赖留着');

  await outline.locator('.outline-remove').nth(2).click({ force: true }); await page.waitForTimeout(200);
  assert.equal((await plan()).order, 'a e c d:slow', '减号删掉一个节点');
  assert.equal((await plan()).edges, '', '删掉的节点连着的依赖一起去掉');
  await outline.getByRole('button', { name: '完成', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('outline-check: ok');
} finally { await browser?.close(); await server?.close(); }
