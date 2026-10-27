// Round 12: the region quick-ask card appears before the screenshot finishes encoding, Escape keeps the
// screenshot for asking by hand, and the composer takes images (button, paste) that go out with the question.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts'), checks = [], errors = [], requests = [];
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const model = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  let body = ''; for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  if (!body.includes('请预判这位读者')) requests.push(payload);
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  response.end(event({ type: 'response.output_text.delta', delta: '好的。' }) + event({ type: 'response.completed', response: { status: 'completed', output: [] } }));
});
await new Promise(done => model.listen(0, '127.0.0.1', done));
const modelOrigin = `http://127.0.0.1:${model.address().port}`;
const port = 1482, origin = `http://127.0.0.1:${port}`;
let PNG;
let server, browser;

try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-r12-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => { const url = route.request().url(); return url.startsWith(origin) || url.startsWith(modelOrigin) ? route.continue() : route.abort(); });
  await page.goto(origin);
  PNG = Buffer.from((await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 30; const context = canvas.getContext('2d'); context.fillStyle = '#c33'; context.fillRect(0, 0, 40, 30); return canvas.toDataURL('image/png'); })).split(',')[1], 'base64');

  // Local model.
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: 'AI', exact: true }).click();
  await dialog.getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog.getByLabel('API 地址', { exact: true }).fill(modelOrigin + '/v1');
  await dialog.getByLabel('API Key', { exact: true }).fill('r12-local-key');
  await dialog.getByLabel('模型', { exact: true }).fill('r12-local-model');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });

  // ---- The card shows up at once; the screenshot is filled in when its encoding finishes ---------------------
  await page.getByRole('button', { name: '打开 PDF 阅读示例.pdf', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.page-slot.page-ready'));
  await page.waitForTimeout(500);
  await page.locator('[data-tip="框选公式或图表作为 AI 上下文"]').click();
  const box = await page.locator('.page-slot').first().boundingBox();
  await page.mouse.move(box.x + 80, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 520, box.y + 520, { steps: 8 });
  const quick = page.getByRole('dialog', { name: '框选快捷提问', exact: true });
  const shown = page.evaluate(() => new Promise(done => { const start = performance.now(); const tick = () => document.querySelector('.capture-quick-actions') ? done(performance.now() - start) : requestAnimationFrame(tick); tick(); }));
  await page.mouse.up();
  const delay = await shown;
  await quick.waitFor();
  assert.ok(delay < 400, `The card appears right after release (${Math.round(delay)}ms).`);
  checks.push(`The quick-ask card appears ${Math.round(delay)}ms after release, without waiting for the screenshot encoding.`);

  // ---- Escape closes the card but keeps the screenshot for asking by hand -----------------------------------
  await page.keyboard.press('Escape'); await quick.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  const pane = page.locator('.ai-pane:visible');
  const preview = pane.getByAltText('选取的截图预览', { exact: true });
  await preview.waitFor();
  assert.match(await preview.getAttribute('src'), /^data:image\/png;base64,/);
  checks.push('Escape closes the quick-ask card but keeps the screenshot above the composer.');

  // ---- Composer images: the button and Ctrl+V paste -----------------------------------------------------------
  await pane.locator('.attach-file').setInputFiles({ name: '图一.png', mimeType: 'image/png', buffer: PNG });
  await pane.getByAltText('附上的图片').first().waitFor({ timeout: 5000 }).catch(async error => { throw new Error(`No attachment: ${await pane.locator('.ai-error').allTextContents()} ${await pane.locator('.attach-file').count()}`); });
  await pane.getByRole('textbox', { name: '向 AI 提问', exact: true }).evaluate((textarea, bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'paste.png', { type: 'image/png' }));
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, [...PNG]);
  await page.waitForFunction(() => document.querySelectorAll('.ai-pane .attachment img').length === 2);
  await page.screenshot({ path: resolve(artifacts, 'r12-composer-images.png') });
  await pane.getByRole('switch', { name: '当前页上下文与文档检索', exact: true }).uncheck();
  const prompt = pane.getByRole('textbox', { name: '向 AI 提问', exact: true });
  await prompt.fill('这三张图分别是什么？'); await prompt.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.ai-pane .attachment'));
  await pane.locator('.ai-message.assistant').first().waitFor();
  const last = requests.at(-1);
  const images = JSON.stringify(last).match(/"input_image"/g)?.length || 0;
  assert.equal(images, 3, `The question carries the screenshot and both composer images (${images}).`);
  assert.equal(await pane.locator('.sent-context img').count(), 3);
  checks.push('Composer images (button and Ctrl+V) go out with the question next to the screenshot, then the composer clears.');

  // ---- The system prompt is short and conversational -----------------------------------------------------------
  const system = String(last.instructions || '');
  assert.ok(system.includes('说人话') && !system.includes('清楚区分原文'), system);
  checks.push('The system prompt asks for plain, human answers and no longer insists on the original text.');

  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'r12-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); await new Promise(done => model.close(done)); }
