// Round 11 (7.0): the question rail (contiguous slots, black/white ticks, no layout blowup, pin + dot),
// the solid history menu, the approved composer placeholders, the calm reader search field, and the settings
// dialog getting out of the way while glass sliders move or a new backdrop is previewed (采用 / 不采用).
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { PLACEHOLDERS } from '../src/ai/greeting.ts';

const artifacts = resolve('artifacts'), checks = [], errors = [];
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const LONG = Array.from({ length: 14 }, (_, index) => `第 ${index + 1} 段回答：用于撑开对话列表、让右侧的提问导航出现的填充文字。`).join('\n\n');
const model = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  let body = ''; for await (const chunk of request) body += chunk;
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  const text = body.includes('请预判这位读者') ? '预判的问题？' : LONG;
  response.end(event({ type: 'response.output_text.delta', delta: text }) + event({ type: 'response.completed', response: { status: 'completed', output: [] } }));
});
await new Promise(done => model.listen(0, '127.0.0.1', done));
const modelOrigin = `http://127.0.0.1:${model.address().port}`;
const port = 1481, origin = `http://127.0.0.1:${port}`;
let server, browser;
const grey = color => { const [r, g, b] = color.match(/[\d.]+/g).map(Number); return Math.max(r, g, b) - Math.min(r, g, b) < 24; };

try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-r11-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => { const url = route.request().url(); return url.startsWith(origin) || url.startsWith(modelOrigin) ? route.continue() : route.abort(); });
  await page.goto(origin);

  // ---- Tooltips take the same ink as the control they describe (white on dark glass) -------------------------
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') { await page.locator('[data-tip="切换深色主题"]').first().click(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); await page.mouse.move(640, 600); }
    const control = page.getByRole('button', { name: '加入文档', exact: true });
    await control.hover();
    await page.locator('.glass-tooltip.visible').waitFor();
    const [tipInk, controlInk] = await page.evaluate(() => [getComputedStyle(document.querySelector('.glass-tooltip')).color, getComputedStyle(document.querySelector('.app-sidebar')).getPropertyValue('--control-ink').trim()]);
    const probe = await page.evaluate(color => { const element = document.createElement('i'); element.style.color = color; document.body.append(element); const value = getComputedStyle(element).color; element.remove(); return value; }, controlInk);
    assert.equal(tipInk, probe, `${theme}: the tooltip uses the control's ink (${tipInk} vs ${probe}).`);
    await page.mouse.move(640, 600); await page.locator('.glass-tooltip.visible').waitFor({ state: 'detached' }).catch(() => {});
  }
  await page.locator('[data-tip="切换浅色主题"]').first().click(); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  checks.push('Tooltips are glass again and their text follows the ink of the control they describe, in light and dark.');

  // ---- Settings: sliders clear the blur; a new backdrop is previewed with 采用 / 不采用 ----------------------
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByLabel('玻璃透明度', { exact: true }).waitFor();
  const backdrop = page.locator('.settings-backdrop');
  assert.notEqual(await backdrop.evaluate(element => getComputedStyle(element).backdropFilter), 'none', 'The settings veil blurs the app normally.');
  const slider = await dialog.getByLabel('玻璃透明度', { exact: true }).boundingBox();
  await page.mouse.move(slider.x + slider.width / 2, slider.y + slider.height / 2); await page.mouse.down();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.settings-backdrop')).backdropFilter === 'none', null, { timeout: 2000 });
  await page.mouse.up();
  checks.push('Dragging the transparency / blur sliders removes the settings veil and its blur, so the glass change is visible.');

  const swatches = dialog.getByRole('radiogroup', { name: '底板', exact: true }).getByRole('radio');
  const before = await swatches.evaluateAll(items => items.findIndex(item => item.getAttribute('aria-checked') === 'true'));
  const other = before === 0 ? 1 : 0;
  await swatches.nth(other).click();
  const bar = page.getByRole('dialog', { name: '预览新底板', exact: true });
  await bar.waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.settings-dialog')).opacity === '0', null, { timeout: 3000 }).catch(async () => { throw new Error(`The settings window steps aside during the preview: ${await page.evaluate(() => JSON.stringify({ cls: document.querySelector('.settings-backdrop').className, op: getComputedStyle(document.querySelector('.settings-dialog')).opacity, style: document.querySelector('.settings-dialog').getAttribute('style') }))}`); });
  await page.screenshot({ path: resolve(artifacts, 'r11-backdrop-preview.png') });
  await bar.getByRole('button', { name: '不采用', exact: true }).click();
  await bar.waitFor({ state: 'detached' });
  assert.equal(await swatches.nth(before).getAttribute('aria-checked'), 'true', '不采用 restores the previous backdrop.');
  await swatches.nth(other).click(); await bar.waitFor();
  await bar.getByRole('button', { name: '采用', exact: true }).click(); await bar.waitFor({ state: 'detached' });
  assert.equal(await swatches.nth(other).getAttribute('aria-checked'), 'true', '采用 keeps the new backdrop.');
  checks.push('Choosing a backdrop shows the new scene with 采用 / 不采用; 不采用 reverts, 采用 keeps it.');

  // AI provider pointing at the local model.
  await dialog.getByRole('button', { name: 'AI', exact: true }).click();
  await dialog.getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog.getByLabel('API 地址', { exact: true }).fill(modelOrigin + '/v1');
  await dialog.getByLabel('API Key', { exact: true }).fill('r11-local-key');
  await dialog.getByLabel('模型', { exact: true }).fill('r11-local-model');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });

  // ---- Reader: calm search field ------------------------------------------------------------------------------
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '加入文档', exact: true }).click();
  await (await chooser).setFiles([{ name: '导航.md', mimeType: 'text/markdown', buffer: Buffer.from('# 导航\n\n用于检查提问导航。') }]);
  await page.locator('.markdown-paper p').first().waitFor();
  assert.equal(await page.locator('.reader-search').first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'The search field has no fill of its own at rest.');
  checks.push('The reader search field blends into the toolbar (no fill or coloured ring at rest).');

  // ---- Assistant: blank placeholder, rail, pin, history menu -------------------------------------------------
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  const pane = page.locator('.ai-pane:visible');
  const prompt = pane.getByRole('textbox', { name: '向 AI 提问', exact: true }); await prompt.waitFor();
  await pane.getByRole('switch', { name: '当前页上下文与文档检索', exact: true }).uncheck();
  assert.ok(PLACEHOLDERS.includes(await prompt.getAttribute('placeholder')), 'The composer placeholder is one of the approved lines.');
  for (const job of ['问题一', '问题二', '问题三', '问题四']) {
    await prompt.fill(job); await prompt.press('Enter');
    await page.waitForFunction(count => document.querySelectorAll('.ai-pane .ai-message.assistant').length === count && !document.querySelector('.ai-pane [aria-label="停止"]'), ['问题一', '问题二', '问题三', '问题四'].indexOf(job) + 1);
  }
  const ticks = pane.locator('.rail-mark');
  await page.waitForFunction(() => document.querySelectorAll('.ai-pane .rail-mark').length === 4);
  const boxes = await ticks.evaluateAll(items => items.map(item => { const box = item.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, width: box.width } }));
  for (let index = 1; index < boxes.length; index++) assert.ok(Math.abs(boxes[index].top - boxes[index - 1].bottom) < .6, `Tick slots touch (${JSON.stringify(boxes)}).`);
  assert.ok(boxes.every(box => box.width >= 40), 'Each tick is a wide hit area.');
  const lines = await ticks.evaluateAll(items => items.map(item => getComputedStyle(item, '::after').backgroundColor));
  assert.ok(lines.every(grey), `Ticks are black / white only (${lines}).`);
  checks.push('Question ticks are contiguous 44px-wide slots with black/white lines only.');

  const paneBox = await pane.boundingBox();
  await ticks.last().click(); await page.waitForTimeout(700);
  const after = await pane.boundingBox();
  assert.ok(Math.abs(after.x - paneBox.x) < 1 && Math.abs(after.y - paneBox.y) < 1 && Math.abs(after.height - paneBox.height) < 1, 'Jumping to the last question leaves the pane where it was.');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.app-shell, .workspace, .reading-main, .ai-pane, body, html')].reduce((sum, element) => sum + element.scrollTop, 0)), 0, 'No outer container scrolled.');
  await ticks.first().click(); await page.waitForTimeout(700);
  checks.push('Clicking the last tick scrolls only the message list; the pane layout stays intact.');

  await ticks.nth(1).hover();
  const preview = pane.locator('.rail-preview'); await preview.waitFor();
  await preview.getByRole('button', { name: '钉住这一问', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ai-pane .rail-mark.pinned').length === 1);
  await preview.getByRole('button', { name: '取消钉住', exact: true }).waitFor();
  await page.screenshot({ path: resolve(artifacts, 'r11-rail-pin.png') });
  checks.push('The hover card stays reachable; its top-right pin button marks the question with a dot on the rail.');
  await page.mouse.move(200, 400); await preview.waitFor({ state: 'detached' });

  await pane.getByRole('button', { name: '对话记录', exact: true }).click();
  const menu = pane.locator('.history-menu'); await menu.waitFor(); await page.waitForTimeout(350);
  const look = await menu.evaluate(element => { const style = getComputedStyle(element); return { background: style.backgroundColor, filter: style.backdropFilter }; });
  const alpha = Number(look.background.match(/rgba?\(([^)]+)\)/)[1].split(',')[3] ?? 1);
  assert.ok(alpha > .95 && look.filter === 'none', `The history menu is solid (${JSON.stringify(look)}).`);
  checks.push('The conversation history menu has a solid background.');

  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'r11-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); await new Promise(done => model.close(done)); }
