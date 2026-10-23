// Round 10 (6.0): bookmarks with a glass rail, the glass sort menu, collapsing the chrome in a window,
// the faded reading edges, the segmented effort control, and the assistant's Enter-to-send / sent context.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts'), checks = [], errors = [];
const port = 1480, origin = `http://127.0.0.1:${port}`;
let server, browser;
const MARKDOWN = ['# 书签', '', ...Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 段：用于滚动与书签跳转的填充文字，足够长以便折行，让页面可以上下滚动。\n`)].join('\n');

try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-r10-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);

  // ---- Library: the sort control opens the app's glass menu, not a native select ----------------------------
  await page.getByRole('button', { name: '排序方式', exact: true }).click();
  const menu = page.locator('.context-menu');
  await menu.waitFor();
  assert.ok((await menu.getByRole('menuitem').allTextContents()).some(text => text.includes('文件大小')));
  assert.equal(await page.locator('select[aria-label="排序方式"]').count(), 0);
  await menu.getByRole('menuitem', { name: /文件名称/ }).click();
  await page.waitForFunction(() => document.querySelector('.library-sort')?.textContent.includes('文件名称'));
  checks.push('The library sort control opens the liquid-glass menu and switches to name order.');

  // ---- Markdown: edge fade, bookmarks with Alt+B, rename, Ctrl+Up/Down -----------------------------------------
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name: '书签.md', mimeType: 'text/markdown', buffer: Buffer.from(MARKDOWN) }]);
  await page.locator('.markdown-paper p').first().waitFor();
  assert.match(await page.locator('.markdown-scroll').evaluate(element => getComputedStyle(element).maskImage), /linear-gradient/, 'The reading edges fade out.');
  const scrollTo = ratio => page.locator('.markdown-scroll').evaluate((element, ratio) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * ratio; }, ratio);
  await page.locator('.markdown-paper').click({ position: { x: 40, y: 40 } });
  await scrollTo(.2); await page.keyboard.press('Alt+KeyB');
  await scrollTo(.7); await page.keyboard.press('Alt+KeyB');
  await page.waitForFunction(() => document.querySelectorAll('.bookmark-rail .bookmark').length === 2);
  const tops = await page.locator('.bookmark-rail .bookmark').evaluateAll(marks => marks.map(mark => parseFloat(mark.style.top)));
  assert.ok(Math.abs(tops[0] - 20) < 2 && Math.abs(tops[1] - 70) < 2, `Rail marks sit at their place in the book (${tops}).`);
  await scrollTo(.45); await page.waitForTimeout(150);
  const at = () => page.locator('.markdown-scroll').evaluate(element => element.scrollTop / (element.scrollHeight - element.clientHeight));
  await page.keyboard.press('Control+ArrowDown');
  await page.waitForFunction(() => { const element = document.querySelector('.markdown-scroll'); return Math.abs(element.scrollTop / (element.scrollHeight - element.clientHeight) - .7) < .02; });
  await page.keyboard.press('Control+ArrowUp');
  await page.waitForFunction(() => { const element = document.querySelector('.markdown-scroll'); return Math.abs(element.scrollTop / (element.scrollHeight - element.clientHeight) - .2) < .02; });
  checks.push(`Alt+B drops bookmarks on the right rail; Ctrl+↓ / Ctrl+↑ move to the next / previous one (now at ${(await at()).toFixed(2)}).`);
  await page.locator('.bookmark-rail .bookmark-hit').nth(1).click({ button: 'right' });
  await page.locator('.context-menu').getByRole('menuitem', { name: /命名/ }).click();
  await page.getByRole('textbox', { name: '书签名称' }).fill('第二章');
  await page.keyboard.press('Enter');
  await page.locator('.bookmark-label', { hasText: '第二章' }).waitFor();
  assert.equal(await page.locator('.bookmark-label').count(), 1, 'Only the named bookmark shows text.');
  await scrollTo(0); await page.waitForTimeout(150);
  await page.locator('.bookmark-label', { hasText: '第二章' }).click();
  await page.waitForFunction(() => { const element = document.querySelector('.markdown-scroll'); return Math.abs(element.scrollTop / (element.scrollHeight - element.clientHeight) - .7) < .02; });
  await page.screenshot({ path: resolve(artifacts, 'r10-bookmarks.png') });
  await page.locator('.bookmark-rail .bookmark-hit').first().click({ button: 'right' });
  await page.locator('.context-menu').getByRole('menuitem', { name: /删除书签/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.bookmark-rail .bookmark').length === 1);
  checks.push('Right-click names a bookmark (shown as text beside its mark) or deletes it; clicking a mark jumps there.');

  // ---- Chrome collapses in a normal window too, into a tag as tall as the reader toolbar ---------------------
  await page.getByRole('button', { name: '收起顶栏与侧栏', exact: true }).click();
  const tag = page.locator('.chrome-tag'); await tag.waitFor();
  await page.waitForFunction(() => !document.querySelector('.app-topbar:not([style*="display: none"])') && document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const [tagBox, toolsBox] = [await tag.boundingBox(), await page.locator('.reader-tools').first().boundingBox()];
  assert.ok(Math.abs(tagBox.height - toolsBox.height) < 2 && Math.abs(tagBox.y - toolsBox.y) < 2, `The tag lines up with the toolbar (${tagBox.y}/${tagBox.height} vs ${toolsBox.y}/${toolsBox.height}).`);
  await tag.click(); await page.locator('.app-topbar').waitFor();
  checks.push('The top bar and sidebar collapse outside fullscreen into a tag the same height as the reader toolbar.');

  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'r10-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); }
