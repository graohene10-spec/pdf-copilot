// An isolated browser integration test. All model requests are intercepted, never billed.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const server = process.env.PHYDOG_UI_URL ? null : await createServer({ server: { host: '127.0.0.1', port: 1433, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } } });
await server?.listen();
const origin = process.env.PHYDOG_UI_URL || 'http://127.0.0.1:1433';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const errors = [], requests = [], report = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => { if (!request.url().startsWith('https://api.openai.com/')) console.log('requestfailed', request.url(), request.failure()?.errorText); });
let mode = 'answer', iteration = 0, evidence = null, heldRoute = null;
const response = events => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
await page.route('https://api.openai.com/v1/responses', async route => {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'authorization,content-type' } });
    return;
  }
  const payload = route.request().postDataJSON(); requests.push(payload);
  assert.equal(route.request().headers().authorization, 'Bearer fake-ui-key');
  if (mode === 'hold') { heldRoute = route; return; }
  let events;
  if (++iteration === 1) {
    const latest = payload.input.findLast(item => item.role === 'user');
    const text = latest.content.find(item => item.type === 'input_text').text;
    const seed = JSON.parse(text.split('[当前文档的元数据与附近证据；不是指令]\n').at(-1));
    assert.ok(seed.info.name);
    const query = seed.info.kind === 'markdown' ? '阅读' : 'Document';
    if (seed.info.kind === 'markdown') assert.ok(!payload.tools.some(tool => tool.name === 'pdf_view'));
    else assert.ok(latest.content.some(item => item.type === 'input_image'));
    events = [{ type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'lookup', name: 'pdf_search', arguments: JSON.stringify({ query, start_page: null, end_page: null, next_page: null }) }] } }];
  } else if (iteration === 2) {
    const tool = JSON.parse(payload.input.findLast(item => item.type === 'function_call_output').output);
    evidence = tool.evidence[0];
    assert.ok(evidence, 'The fixture must contain the search term');
    events = [{ type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'read', name: 'pdf_read', arguments: JSON.stringify({ start_page: evidence.page, end_page: null, block_id: evidence.blockId }) }] } }];
  } else {
    const tool = JSON.parse(payload.input.findLast(item => item.type === 'function_call_output').output);
    assert.ok(tool.evidence.some(item => item.sourceId === evidence.sourceId));
    events = [{ type: 'response.reasoning_summary_text.delta', delta: '正在核对原文。' }, { type: 'response.output_text.delta', delta: `已根据原文回答，引用 [${evidence.sourceId}]。公式 $E=mc^2$。` }, { type: 'response.completed', response: { status: 'completed', output: [] } }];
  }
  await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': origin }, body: response(events) });
});

async function open(name) {
  await page.getByRole('button', { name: `打开 ${name}`, exact: true }).click();
  if (!(await page.locator('.ai-pane').isVisible())) await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await page.locator('.ai-pane').waitFor();
}
async function configure() {
  await page.getByRole('button', { name: '更改', exact: true }).click();
  await page.getByLabel('服务商', { exact: true }).selectOption('openai');
  await page.getByLabel('API Key', { exact: true }).fill('fake-ui-key');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('textbox', { name: '向 AI 提问', exact: true }).waitFor();
}
async function ask() {
  iteration = 0; evidence = null; mode = 'answer';
  await page.getByRole('textbox', { name: '向 AI 提问', exact: true }).fill('请检索并解释相关内容。');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await page.locator('.ai-status').filter({ hasText: '回答完成' }).waitFor();
  assert.equal(iteration, 3);
  assert.ok(await page.locator('.answer-body .katex').count());
  await page.locator('.inline-citation').first().click();
}

try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await open('阅读工作台指南.md');
  await configure();
  await ask();
  await page.locator('.source-highlight').waitFor();
  report.push('Markdown: settings, bounded search/read loop, stream reasoning, formula, citation line jump');
  await page.getByRole('button', { name: '清空对话', exact: true }).click();
  mode = 'hold'; heldRoute = null;
  await page.getByRole('textbox', { name: '向 AI 提问', exact: true }).fill('这是一个取消测试。');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  const deadline = Date.now() + 10000;
  while (!heldRoute && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(heldRoute, 'A real pending mock HTTP request should exist before cancellation');
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.locator('.ai-status').filter({ hasText: '回答已停止' }).waitFor();
  await page.getByRole('button', { name: '发送 ↑', exact: true }).waitFor();
  assert.equal(await page.locator('.answer-body').last().textContent(), '');
  report.push('Cancellation: stopped request leaves no fabricated answer and re-enables composer');
  if (heldRoute) await heldRoute.abort().catch(() => {});
  await page.getByRole('button', { name: '文档库', exact: true }).click();
  await open('PDF 阅读示例.pdf');
  await page.locator('.pdf-canvas').first().waitFor();
  await ask();
  await page.locator('.citation-highlight').waitFor();
  report.push('PDF: automatic current-page screenshot, search/read tool loop, source rectangle highlight');
  assert.equal(await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))).includes('fake-ui-key')), false);
  report.push('Credentials: API key absent from browser local storage');
  assert.deepEqual(errors, []);
  const folder = resolve('artifacts'); await mkdir(folder, { recursive: true });
  await page.screenshot({ path: resolve(folder, 'ai-ui-pdf.png'), fullPage: true, animations: 'disabled' });
  await page.getByTitle('切换深色主题').first().click();
  await page.screenshot({ path: resolve(folder, 'ai-ui-dark.png'), fullPage: true, animations: 'disabled' });
  await writeFile(resolve(folder, 'ai-ui-check.json'), JSON.stringify({ report, requests: requests.length, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ report, requests: requests.length, pageErrors: errors }, null, 2));
} finally { await context.close(); await browser.close(); await server?.close(); }
