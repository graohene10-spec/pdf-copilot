// Round 14: two interface styles beside liquid glass — 暖色极简 and 铅笔草稿. Each switches off the glass runtime,
// brings its own fonts, keeps every interface label on one line, and the sketch answer font is selectable.
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const artifacts = resolve('artifacts'), checks = [], errors = [];
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const model = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization,content-type');
  response.setHeader('access-control-allow-methods', 'POST,OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  for await (const _ of request);
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  response.end(event({ type: 'response.output_text.delta', delta: '高斯面换成别的形状也行，只是不好算。' }) + event({ type: 'response.completed', response: { status: 'completed', output: [] } }));
});
await new Promise(done => model.listen(0, '127.0.0.1', done));
const modelOrigin = `http://127.0.0.1:${model.address().port}`;
const port = 1483, origin = `http://127.0.0.1:${port}`;
let server, browser;

// Short interface text nodes that run onto a second line.
const wrapped = page => page.evaluate(() => {
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const text = node.textContent.trim();
    const host = node.parentElement;
    if (!text || text.length > 24 || !host || host.closest('.answer-body,.markdown-paper,.pdf-scroll,.ai-welcome,.settings-help,p,textarea,option,.document-card-title,.user-question,.tag-empty')) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const tops = new Set([...range.getClientRects()].filter(rect => rect.width > 1 && rect.height > 1).map(rect => Math.round(rect.top / 6)));
    if (tops.size > 1) found.push(text);
  }
  return found;
});

try {
  await mkdir(artifacts, { recursive: true });
  server = await createViteServer({ cacheDir: resolve(artifacts, 'vite-r14-ui'), server: { host: '127.0.0.1', port, strictPort: true, watch: null } }); await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => { const url = route.request().url(); return url.startsWith(origin) || url.startsWith(modelOrigin) ? route.continue() : route.abort(); });
  await page.goto(origin);

  const settings = async () => { await page.getByRole('button', { name: '打开设置', exact: true }).click(); return page.getByRole('dialog', { name: '设置', exact: true }); };
  let dialog = await settings();
  await dialog.getByRole('button', { name: 'AI', exact: true }).click();
  await dialog.getByLabel('服务商', { exact: true }).selectOption('openai');
  await dialog.getByLabel('API 地址', { exact: true }).fill(modelOrigin + '/v1');
  await dialog.getByLabel('API Key', { exact: true }).fill('r14-local-key');
  await dialog.getByLabel('模型', { exact: true }).fill('r14-local-model');
  await dialog.getByRole('button', { name: '外观', exact: true }).click();

  // ---- The style picker sits beside liquid glass; glass-only settings leave with it ------------------------------
  const group = dialog.getByRole('radiogroup', { name: '界面风格', exact: true });
  assert.equal(await group.getByRole('radio').count(), 3);
  assert.equal(await group.getByRole('radio', { name: '液态玻璃风格' }).getAttribute('aria-checked'), 'true');
  assert.equal(await dialog.getByLabel('玻璃透明度', { exact: true }).count(), 1);
  await group.getByRole('radio', { name: '铅笔草稿风格' }).click();
  assert.equal(await dialog.getByLabel('玻璃透明度', { exact: true }).count(), 0);
  assert.equal(await dialog.getByRole('radiogroup', { name: '底板', exact: true }).count(), 0);
  const answerFont = dialog.getByLabel('回答字体', { exact: true });
  assert.equal(await answerFont.inputValue(), 'mashanzheng');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.style), 'sketch', 'The style previews while choosing.');
  checks.push('界面风格 offers 液态玻璃 / 暖色极简 / 铅笔草稿; glass sliders and backdrops only show for liquid glass; the sketch answer font defaults to 马善政楷书.');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });

  // ---- Sketch: glass runtime off, handwriting loaded, labels on one line ------------------------------------------
  const root = await page.evaluate(() => ({ ...document.documentElement.dataset }));
  assert.equal(root.glass, 'solid'); assert.equal(root.refraction, 'off');
  await page.getByRole('button', { name: '打开 PDF 阅读示例.pdf', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.page-slot.page-ready'));
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  const pane = page.locator('.ai-pane:visible');
  const prompt = pane.getByRole('textbox', { name: '向 AI 提问', exact: true });
  await prompt.fill('高斯面一定要是球面吗？'); await prompt.press('Enter');
  const answer = pane.locator('.answer-body').first(); await answer.waitFor();
  await page.waitForTimeout(900);
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({
    ui: getComputedStyle(document.querySelector('.workspace-nav button')).fontFamily,
    answer: getComputedStyle(document.querySelector('.answer-body')).fontFamily,
    longCang: document.fonts.check("20px 'Long Cang'", '文档库'),
    maShanZheng: document.fonts.check("20px 'Ma Shan Zheng'", '高斯'),
    liveGlass: document.querySelectorAll('[data-glass-live]').length,
  }));
  assert.match(fonts.ui, /Long Cang/); assert.match(fonts.answer, /Ma Shan Zheng/);
  assert.ok(fonts.longCang && fonts.maShanZheng, JSON.stringify(fonts));
  assert.equal(fonts.liveGlass, 0);
  assert.deepEqual(await wrapped(page), []);
  await page.screenshot({ path: resolve(artifacts, 'r14-sketch-reader.png') });
  checks.push('铅笔草稿: glass runtime stays off, the interface is handwritten (龙藏体), answers use 马善政楷书, and no interface label wraps.');

  // ---- Changing the answer font in settings ------------------------------------------------------------------------
  dialog = await settings();
  await dialog.getByLabel('回答字体', { exact: true }).selectOption('xiaowei');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  assert.match(await answer.evaluate(element => getComputedStyle(element).fontFamily), /ZCOOL XiaoWei/);
  checks.push('The sketch answer font can be changed in settings (站酷小薇体 applied to the answer).');

  // ---- Warm minimal, light and dark ---------------------------------------------------------------------------------
  dialog = await settings();
  await dialog.getByRole('radiogroup', { name: '界面风格', exact: true }).getByRole('radio', { name: '暖色极简风格' }).click();
  await dialog.getByLabel('主题', { exact: true }).selectOption('dark');
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await page.waitForTimeout(500);
  const warm = await page.evaluate(() => ({ style: document.documentElement.dataset.style, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), display: getComputedStyle(document.documentElement).getPropertyValue('--font-display'), answer: getComputedStyle(document.querySelector('.answer-body')).fontFamily }));
  assert.equal(warm.style, 'warm'); assert.equal(warm.accent, '#d97757');
  assert.match(warm.display, /Anthropic Serif/); assert.doesNotMatch(warm.answer, /XiaoWei/);
  assert.deepEqual(await wrapped(page), []);
  await page.screenshot({ path: resolve(artifacts, 'r14-warm-dark-reader.png') });
  checks.push('暖色极简 (dark): clay accent, Anthropic Serif headings, answers back on the reading font, and no interface label wraps.');

  assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'r14-ui-check.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); await server?.close(); await new Promise(done => model.close(done)); }
