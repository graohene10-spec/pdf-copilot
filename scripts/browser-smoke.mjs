import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtime = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const playwright = require(process.env.PDF_COPILOT_PLAYWRIGHT_PATH || join(runtime, 'playwright'));
const fixture = join(root, '.cache', 'browser-extension');
await mkdir(fixture, { recursive: true });
await cp(join(root, 'dist', 'extension'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
// Local mock API access is granted ONLY in this test copy, never the release.
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
const requests = [];
const server = createServer(async (request, response) => {
  if (request.url === '/chat/completions') {
    let body = ''; for await (const part of request) body += part;
    requests.push(JSON.parse(body));
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
    response.end('data: {"choices":[{"delta":{"reasoning_content":"检查选文"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{"content":"这是本机模拟回答，用于验证插件。"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  } else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const profile = join(root, '.cache', 'edge-profile-' + Date.now());
let context;
try {
  context = await playwright.chromium.launchPersistentContext(profile, {
    executablePath: process.env.PDF_COPILOT_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: { width: 1200, height: 820 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + fixture, '--load-extension=' + fixture, '--no-first-run'],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = worker.url().split('/')[2];
  await worker.evaluate(async ({ baseUrl }) => {
    await chrome.storage.local.set({ settings: { provider: 'deepseek', model: 'deepseek-flash', effort: 'low', baseUrl, theme: 'light', rememberKey: false } });
    await chrome.storage.session.set({ 'apiKey:deepseek': 'smoke-test-only' });
  }, { baseUrl });
  const errors = [];
  const reader = await context.newPage();
  reader.on('pageerror', error => errors.push(error.message));
  await reader.goto('chrome-extension://' + id + '/reader/index.html');
  // Minimal two-page PDF, intentionally contains no personal data.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 650] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 650] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '', '', '<< /Type /Outlines /First 9 0 R /Last 9 0 R /Count 1 >>',
    '<< /Title (Second page) /Parent 8 0 R /Dest [4 0 R /Fit] >>',
  ];
  for (const [index, content] of [[5, 'BT /F1 22 Tf 45 560 Td (PDF Copilot sample) Tj ET\n1 0 0 rg 45 300 180 100 re f'], [6, 'BT /F1 22 Tf 45 560 Td (Second page sample) Tj ET']]) objects[index] = '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream';
  let pdf = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 ' + offsets.length + '\n0000000000 65535 f \n' + offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  await reader.locator('#file-input').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
  await reader.locator('#next').waitFor({ state: 'visible' });
  await reader.waitForFunction(() => !document.querySelector('#next').disabled);
  await reader.waitForFunction(() => document.querySelector('#text-layer').textContent.includes('PDF Copilot sample'));
  const tab = await reader.evaluate(async () => (await chrome.tabs.getCurrent()));
  const chat = await context.newPage();
  chat.on('pageerror', error => errors.push(error.message));
  await chat.goto('chrome-extension://' + id + '/chat/index.html?mode=quick&tab=' + tab.id + '&window=' + tab.windowId);
  await chat.locator('#prompt').fill('解释这份测试 PDF。');
  await chat.locator('#send').click();
  await chat.waitForFunction(() => document.querySelector('#status').textContent === '回答完成。');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].reasoning_effort, 'low');
  await chat.close();
  // Send selection through real runtime messaging; use quick target to avoid
  // a browser side-panel user gesture being synthesized by page.evaluate.
  await reader.bringToFront();
  await reader.locator('#target').selectOption('quick');
  await reader.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#text-layer'));
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const popupPromise = context.waitForEvent('page');
  await reader.locator('#send-text').click();
  const quickWindow = await popupPromise;
  quickWindow.on('pageerror', error => errors.push(error.message));
  await quickWindow.waitForLoadState();
  await quickWindow.locator('.attachment').waitFor();
  await quickWindow.locator('#prompt').fill('解释选文');
  await quickWindow.locator('#send').click();
  await quickWindow.waitForFunction(() => document.querySelector('#status').textContent === '回答完成。');
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /PDF Copilot sample/);
  assert.match(requests[1].messages.at(-1).content, /第 1 页/);
  await reader.locator('#next').click();
  await reader.waitForFunction(() => document.querySelector('#page-number').value === '2');
  await quickWindow.locator('.citation').first().click();
  await reader.waitForFunction(() => document.querySelector('#page-number').value === '1');
  await reader.bringToFront();
  await reader.locator('#capture-region').click();
  const surface = await reader.locator('#page-surface').boundingBox();
  await reader.mouse.move(surface.x + 60, surface.y + 80); await reader.mouse.down();
  await reader.mouse.move(surface.x + 260, surface.y + 220, { steps: 5 }); await reader.mouse.up();
  await reader.locator('#preview-dialog[open]').waitFor();
  await reader.locator('#preview-send').click();
  await quickWindow.locator('.attachment img').waitFor();
  await quickWindow.locator('#prompt').fill('解释截图');
  await quickWindow.locator('#send').click();
  await quickWindow.waitForFunction(() => document.querySelector('#status').textContent === '回答完成。');
  assert.equal(requests.length, 3);
  assert.match(requests[2].messages.at(-1).content[1].image_url.url, /^data:image\/png;base64,/);
  await reader.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async message => {
      const response = await send(message);
      if (message.type === 'sidebar:open') window.sidebarResult = response;
      return response;
    };
  });
  await reader.locator('#sidebar').click();
  await reader.waitForFunction(() => window.sidebarResult?.ok);
  const inbox = await worker.evaluate(async () => (await chrome.storage.session.get('inbox')).inbox);
  assert.equal(inbox.length, 0);
  const local = await worker.evaluate(async () => chrome.storage.local.get(null));
  assert.equal(local['apiKey:deepseek'], undefined);
  assert(!JSON.stringify(local).includes('data:image'));
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await reader.screenshot({ path: join(root, 'artifacts', 'reader.png') });
  await quickWindow.setViewportSize({ width: 510, height: 720 });
  await quickWindow.screenshot({ path: join(root, 'artifacts', 'chat.png') });
  await reader.locator('#file-input').setInputFiles({ name: 'another.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.replaceAll('sample', 'other!')) });
  await quickWindow.waitForFunction(() => document.querySelector('#source-name').textContent === 'another.pdf');
  assert.equal(await quickWindow.locator('.message').count(), 0);
  const settingsPage = await context.newPage();
  settingsPage.on('pageerror', error => errors.push(error.message));
  await settingsPage.goto('chrome-extension://' + id + '/settings/index.html');
  await settingsPage.locator('#provider').selectOption('openai');
  await settingsPage.locator('#model').fill('gpt-5.4-mini');
  await settingsPage.locator('#theme').selectOption('dark');
  assert.equal(await settingsPage.locator('html').getAttribute('data-theme'), 'dark');
  await settingsPage.screenshot({ path: join(root, 'artifacts', 'settings.png') });
  if (process.env.PDF_COPILOT_REAL_NATIVE_BROWSER_SMOKE) {
    // Explicit opt-in uses the existing host registration for metadata only.
    // Do not submit a prompt, start login, or read authentication files.
    await settingsPage.locator('#provider').selectOption('codex');
    await settingsPage.locator('#test-codex').click();
    await settingsPage.waitForFunction(() => !document.querySelector('#test-codex').disabled, undefined, { timeout: 45000 });
    assert.equal(await settingsPage.locator('#codex-diagnostics').isVisible(), true);
    assert.match(await settingsPage.locator('#codex-version').textContent(), /^codex-cli \d+\.\d+\.\d+/);
    assert.match(await settingsPage.locator('#codex-path').textContent(), /codex\.exe$/i);
    assert.equal(await settingsPage.locator('#codex-compatible').textContent(), '符合要求');
    const login = await settingsPage.locator('#codex-login').textContent();
    assert.match(login, /已登录|未检测到此 CLI 的登录/);
    console.log(`Real Edge native metadata diagnostics passed (${login}); no inference was started.`);
  }
  assert.deepEqual(errors, []);
  console.log('Real Edge extension smoke passed: rendering, text/image attachments, API streaming, temporary window, sidePanel user gesture, page citation, document isolation, memory queue and settings.');
} catch (error) {
  if (context) {
    for (const page of context.pages()) {
      console.error('Smoke page:', page.url(), await page.locator('#status').textContent().catch(() => ''), 'attachments:', await page.locator('.attachment').count().catch(() => 0));
    }
    const worker = context.serviceWorkers()[0];
    if (worker) console.error('Smoke inbox:', await worker.evaluate(async () => ((await chrome.storage.session.get('inbox')).inbox || []).map(item => ({ tabId: item.tabId, target: item.target, title: item.context.title }))).catch(() => []));
  }
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
