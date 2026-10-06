// Regression testing uses an isolated Edge profile, synthetic PDFs and localhost.
// It never connects to the user's Edge profile or a paid model service.
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { samplePdf } from '../tests/fixtures/pdf.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deviceScaleFactor = Number(process.env.PDF_COPILOT_TEST_DPR) || 1;
const require = createRequire(import.meta.url);
const runtime = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const playwright = require(process.env.PDF_COPILOT_PLAYWRIGHT_PATH || join(runtime, 'playwright'));
const fixture = join(root, '.cache', 'acceptance-extension');
await mkdir(fixture, { recursive: true });
await cp(join(root, 'dist', 'extension'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
// Calling a captured command listener does not grant activeTab, unlike a real
// browser shortcut. This isolated test copy grants capture access explicitly.
manifest.host_permissions.push('<all_urls>');
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
const background = join(fixture, 'background.js');
await writeFile(background, `const originalCommands = chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);
chrome.commands.onCommand.addListener = listener => { globalThis.testCommand = listener; originalCommands(listener); };
const originalMenu = chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);
chrome.contextMenus.onClicked.addListener = listener => { globalThis.testMenu = listener; originalMenu(listener); };
` + await readFile(background, 'utf8'));
const continuous = join(fixture, 'reader', 'continuous.mjs');
await writeFile(continuous, (await readFile(continuous, 'utf8')).replace('await view.layer.render();', 'await view.layer.render(); if (window.acceptanceRenderGate) await window.acceptanceRenderGate;'));
const requests = [], checks = [], errors = [];
const server = createServer(async (request, response) => {
  if (request.url === '/native.pdf') {
    response.writeHead(200, { 'Content-Type': 'application/pdf' }); response.end(samplePdf(40, true)); return;
  }
  if (request.url === '/chat/completions') {
    let body = ''; for await (const part of request) body += part;
    requests.push(JSON.parse(body));
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
    response.end('data: {"choices":[{"delta":{"content":"Synthetic answer $x^2=4$."},"finish_reason":null}]}\n\ndata: [DONE]\n\n'); return;
  }
  response.writeHead(404); response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
let context, reader, worker;
const check = async (name, run) => {
  try { await run(); checks.push({ name, result: 'pass' }); console.log('PASS ' + name); }
  catch (error) {
    const pages = await Promise.all((context?.pages() || []).map(async page => ({ url: page.url(), status: await page.locator('#status').textContent({ timeout: 500 }).catch(() => '') })));
    checks.push({ name, result: 'fail', error: error.message, pages }); console.log('FAIL ' + name + ': ' + error.message);
  }
};
const pageReady = async number => {
  await reader.waitForFunction(number => document.querySelector('#page-surface')?.dataset.page === String(number) && document.querySelector('#page-surface')?.classList.contains('page-ready'), number);
};
const goto = async number => {
  await reader.locator('#page-number').fill(String(number)); await reader.locator('#page-number').press('Enter'); await pageReady(number);
};
const drag = async (page, selector, reverse = false, preview = true) => {
  const surface = await page.locator(selector).boundingBox();
  const area = await page.locator(selector === '#capture-surface' ? '#capture-surface' : '#reading-area').boundingBox();
  const left = Math.max(surface.x, area.x) + 30, top = Math.max(surface.y, area.y) + 35;
  const right = Math.min(left + 150, surface.x + surface.width - 8, area.x + area.width - 8);
  const bottom = Math.min(top + 100, surface.y + surface.height - 8, area.y + area.height - 8);
  assert(right - left > 4 && bottom - top > 4, 'test rectangle must fit visible work surface');
  await page.mouse.move(reverse ? right : left, reverse ? bottom : top); await page.mouse.down();
  await page.mouse.move(reverse ? left : right, reverse ? top : bottom, { steps: 8 }); await page.mouse.up();
  if (!preview) return;
  await page.locator('#preview-dialog[open]').waitFor({ timeout: 4000 });
  await page.locator('#preview-image').evaluate(image => image.decode());
  const size = await page.locator('#preview-image').evaluate(image => [image.naturalWidth, image.naturalHeight]);
  assert(size.every(value => value > 4), 'preview has real image pixels');
};
try {
  context = await playwright.chromium.launchPersistentContext(join(root, '.cache', 'edge-acceptance-' + Date.now()), {
    executablePath: process.env.PDF_COPILOT_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, deviceScaleFactor, viewport: { width: 1200, height: 820 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + fixture, '--load-extension=' + fixture, '--no-first-run'],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2], extensionUrl = `chrome-extension://${id}`;
  await worker.evaluate(async ({ baseUrl }) => {
    await chrome.storage.local.set({ settings: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high', baseUrl, rememberKey: false, theme: 'light' } });
    await chrome.storage.session.set({ 'apiKey:deepseek': 'synthetic-key' });
  }, { baseUrl });

  const native = await context.newPage(); await native.goto(baseUrl + '/native.pdf'); await native.bringToFront();
  const nativeTab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]);
  await check('native PDF: enhanced-reader command preserves source URL', async () => {
    const opening = context.waitForEvent('page');
    await worker.evaluate(tab => globalThis.testCommand('open-reader', tab), nativeTab);
    reader = await opening; await reader.waitForLoadState();
    assert.equal(new URL(reader.url()).searchParams.get('url'), baseUrl + '/native.pdf');
    await reader.locator('#open-url').click(); await pageReady(1);
  });
  if (!reader) throw new Error('Enhanced reader must open before remaining checks');
  await check('native PDF: quick window opens, is reused and has correct source', async () => {
    const opening = context.waitForEvent('page'); await worker.evaluate(tab => globalThis.testCommand('quick-chat', tab), nativeTab);
    const quick = await opening; await quick.waitForLoadState();
    assert.equal(Number(new URL(quick.url()).searchParams.get('tab')), nativeTab.id);
    const windows = await worker.evaluate(() => chrome.windows.getAll());
    await worker.evaluate(tab => globalThis.testCommand('quick-chat', tab), nativeTab);
    assert.equal((await worker.evaluate(() => chrome.windows.getAll())).length, windows.length);
    await quick.close();
  });
  await check('native PDF: visible-tab crop, reverse drag, cancel/retry, memory-only attachment', async () => {
    await native.bringToFront();
    const opening = context.waitForEvent('page'); await worker.evaluate(tab => globalThis.testCommand('capture-region', tab), nativeTab);
    const capture = await opening; await capture.waitForLoadState();
    await capture.locator('#capture-surface').waitFor(); await drag(capture, '#capture-surface');
    await capture.locator('#preview-cancel').click(); await drag(capture, '#capture-surface', true);
    // Select the target after closing the modal, then create a fresh crop.
    await capture.locator('#preview-cancel').click(); await capture.locator('#target').selectOption('quick'); await drag(capture, '#capture-surface');
    const quickOpening = context.waitForEvent('page'); await capture.locator('#preview-send').click();
    const quick = await quickOpening; await quick.waitForLoadState(); await quick.locator('.attachment img').waitFor();
    await capture.waitForFunction(() => !document.querySelector('#snapshot').getAttribute('src'));
    assert(!(await worker.evaluate(() => chrome.storage.local.get(null)))['inbox']);
    assert.equal(requests.length, 0, 'adding an attachment does not send it to the server');
    await quick.locator('.attachment button').click(); assert.equal(await quick.locator('.attachment').count(), 0);
    await quick.close(); await capture.close();
  });

  await reader.bringToFront();
  await check('reader: continuous wheel scrolling and page controls', async () => {
    const area = await reader.locator('#reading-area').boundingBox();
    await reader.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await reader.mouse.wheel(0, 2200);
    await reader.waitForFunction(() => Number(document.querySelector('#page-number').value) > 1);
    await goto(10); await reader.locator('#next').click(); await pageReady(11);
    await reader.locator('#previous').click(); await pageReady(10);
    await reader.locator('#reading-area').click({ position: { x: 10, y: 10 } });
    await reader.keyboard.press('PageDown'); await pageReady(11); await reader.keyboard.press('PageUp'); await pageReady(10);
  });
  await check('reader: night-mode crop keeps the actual PDF color', async () => {
    await goto(2);
    const area = await reader.locator('#reading-area').boundingBox();
    await reader.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await reader.mouse.wheel(0, 400);
    await reader.waitForTimeout(150);
    if (!await reader.locator('body').evaluate(body => body.classList.contains('night'))) await reader.locator('#night').click();
    await reader.locator('#capture-region').click();
    const box = await reader.locator('.page-slot[data-page="2"]').boundingBox(), ratio = box.width / 500;
    await reader.mouse.move(box.x + 70 * ratio, box.y + 380 * ratio); await reader.mouse.down();
    await reader.mouse.move(box.x + 110 * ratio, box.y + 410 * ratio, { steps: 5 }); await reader.mouse.up();
    await reader.locator('#preview-dialog[open]').waitFor();
    const rgb = await reader.locator('#preview-image').evaluate(async image => {
      await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    });
    assert.deepEqual(rgb, [255, 0, 0]);
    await reader.locator('#preview-cancel').click(); await reader.keyboard.press('Escape'); await reader.locator('#night').click();
  });
  for (const [width, height] of [[1200, 820], [869, 772], [510, 720]]) {
    await reader.setViewportSize({ width, height }); await reader.waitForTimeout(250);
    if (width < 620 && await reader.locator('#navigation').isVisible()) await reader.locator('#nav-toggle').click();
    await goto(20);
    for (const mode of ['fit', 'zoom', 'night']) {
      if (mode === 'fit') await reader.locator('#zoom-label').click();
      if (mode === 'zoom') await reader.locator('#zoom-in').click();
      if (mode === 'night') await reader.locator('#night').click();
      await pageReady(20);
      await check(`reader: crop forward/reverse at ${width}px, ${mode}, page 20`, async () => {
        if (await reader.locator('#capture-region').getAttribute('aria-pressed') !== 'true') await reader.locator('#capture-region').click();
        await drag(reader, '#page-surface'); await reader.locator('#preview-cancel').click();
        await drag(reader, '#page-surface', true); await reader.locator('#preview-cancel').click();
        assert.equal(await reader.locator('#preview-image').getAttribute('src'), null);
      });
      if (await reader.locator('#preview-dialog').isVisible()) await reader.locator('#preview-cancel').click();
    }
    await reader.keyboard.press('Escape');
  }
  await reader.setViewportSize({ width: 1200, height: 820 }); await reader.locator('#zoom-label').click(); await goto(1);
  await check('reader: a crop made while rendering opens after the page finishes', async () => {
    await reader.evaluate(() => { window.acceptanceRenderGate = new Promise(resolve => { window.releaseAcceptanceRender = resolve; }); });
    await reader.locator('#zoom-label').click();
    await reader.waitForFunction(() => document.querySelector('#text-layer')?.textContent.includes('Synthetic page 1') && !document.querySelector('#page-surface').classList.contains('page-ready'));
    await reader.locator('#capture-region').click(); await drag(reader, '#page-surface', false, false);
    await reader.evaluate(() => { window.releaseAcceptanceRender(); window.acceptanceRenderGate = null; }); await pageReady(1);
    await reader.locator('#preview-dialog[open]').waitFor({ timeout: 2000 }); await reader.locator('#preview-cancel').click();
  });
  await reader.keyboard.press('Escape');
  await check('reader: real mouse text selection enables send action', async () => {
    const text = await reader.locator('#text-layer span').first().boundingBox();
    await reader.mouse.move(text.x + 2, text.y + text.height / 2); await reader.mouse.down();
    await reader.mouse.move(text.x + text.width - 2, text.y + text.height / 2, { steps: 8 }); await reader.mouse.up();
    await reader.waitForFunction(() => !document.querySelector('#send-text').disabled);
    assert.match(await reader.evaluate(() => getSelection().toString()), /Synthetic/);
  });
  await check('reader: cancelled text selection clears send action', async () => {
    await reader.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('#text-layer'));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await reader.waitForFunction(() => !document.querySelector('#send-text').disabled);
    await reader.evaluate(() => getSelection().removeAllRanges());
    await reader.waitForFunction(() => document.querySelector('#send-text').disabled, undefined, { timeout: 2000 });
  });
  await check('reader: scrolling in capture mode preserves capture instruction and preview', async () => {
    await reader.locator('#capture-region').click(); await goto(25);
    assert.match(await reader.locator('#status').textContent(), /拖动|框选模式/);
    await drag(reader, '#page-surface'); await reader.locator('#preview-cancel').click(); await reader.keyboard.press('Escape');
  });
  await check('reader: bookmarks survive reload and remain document-specific', async () => {
    if (!await reader.locator('#navigation').isVisible()) await reader.locator('#nav-toggle').click();
    await goto(25); await reader.locator('#bookmark').click();
    await goto(26); await reader.locator('#bookmarks button').filter({ hasText: '第 25 页' }).click(); await pageReady(25);
    await reader.reload(); await reader.locator('#open-url').click(); await pageReady(1);
    await reader.locator('#bookmarks button').filter({ hasText: '第 25 页' }).click(); await pageReady(25);
    await reader.locator('.remove-bookmark').click(); assert.equal(await reader.locator('.bookmark-row').count(), 0);
  });
  await check('reader: rejected files report errors; valid file selection recovers', async () => {
    await reader.locator('#file-input').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid') });
    await reader.waitForFunction(() => document.querySelector('#status').textContent.includes('无法打开 PDF'));
    await reader.locator('#file-input').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: samplePdf(40, true) }); await pageReady(1);
  });
  await check('reader: file drop, outline and internal link navigation', async () => {
    await reader.locator('#bookmark').click();
    const bytes = Array.from(samplePdf(3, false, true));
    await reader.evaluate(bytes => {
      const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'navigation.pdf', { type: 'application/pdf' }));
      document.querySelector('#reading-area').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, bytes);
    await reader.waitForFunction(() => document.querySelector('#document-title').textContent === 'navigation.pdf'); await pageReady(1);
    await reader.locator('#outline button').filter({ hasText: 'Second page' }).click(); await pageReady(2);
    await goto(1); await reader.getByRole('button', { name: '跳转文档内部链接', exact: true }).click(); await pageReady(2);
    assert.equal(await reader.locator('.bookmark-row').count(), 0, 'another document has independent bookmarks');
    await goto(1); await reader.locator('#capture-region').click(); await drag(reader, '#page-surface');
    await reader.locator('#preview-cancel').click(); await reader.keyboard.press('Escape');
  });
  await reader.locator('#file-input').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: samplePdf(40, true) }); await pageReady(1);
  assert.equal(await reader.locator('.bookmark-row').count(), 1, 'original document retains its bookmark');
  await reader.locator('#bookmark').click();
  await check('reader: aggregate canvas budget after many jumps', async () => {
    for (const number of [35, 2, 39, 10, 40, 1]) await goto(number);
    const pixels = await reader.locator('#reading-area canvas').evaluateAll(canvases => canvases.map(canvas => canvas.width * canvas.height));
    assert(pixels.length <= 3); assert(pixels.reduce((sum, value) => sum + value, 0) <= 16_000_000);
  });
  if (process.env.PDF_COPILOT_ENCRYPTED_FIXTURE) {
    await check('reader: encrypted PDF wrong password, retry and cancellation', async () => {
      let prompt = reader.waitForEvent('dialog');
      await reader.locator('#file-input').setInputFiles(process.env.PDF_COPILOT_ENCRYPTED_FIXTURE);
      let dialog = await prompt; assert.equal(dialog.type(), 'prompt');
      prompt = reader.waitForEvent('dialog'); await dialog.accept('wrong-password');
      dialog = await prompt; assert.match(dialog.message(), /不正确/); await dialog.accept('pdf-copilot-test'); await pageReady(1);
      prompt = reader.waitForEvent('dialog');
      await reader.locator('#file-input').setInputFiles(process.env.PDF_COPILOT_ENCRYPTED_FIXTURE);
      dialog = await prompt; await dialog.dismiss();
      await reader.waitForFunction(() => document.querySelector('#status').textContent.includes('已取消打开加密 PDF'));
      await reader.waitForTimeout(200);
      assert.match(await reader.locator('#status').textContent(), /已取消打开加密 PDF/);
      await reader.locator('#file-input').setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: samplePdf(40, true) });
      await reader.waitForFunction(() => document.querySelector('#document-title').textContent === 'synthetic.pdf'); await pageReady(1);
    });
  }
  const settings = await context.newPage(); await settings.goto(extensionUrl + '/settings/index.html');
  await check('settings: session key, remember key, forget key and provider isolation', async () => {
    await settings.locator('#base-url').fill(baseUrl); await settings.locator('#key').fill('synthetic-session');
    await settings.locator('#remember').uncheck(); await settings.locator('button[type=submit]').click();
    await settings.waitForFunction(() => document.querySelector('#status').textContent.startsWith('已保存'));
    let storage = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    assert.equal(storage.local['apiKey:deepseek'], undefined); assert.equal(storage.session['apiKey:deepseek'], 'synthetic-session');
    await settings.locator('#remember').check(); await settings.locator('button[type=submit]').click();
    await settings.waitForTimeout(100);
    storage = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
    assert.equal(storage.local['apiKey:deepseek'], 'synthetic-session'); assert.equal(storage.session['apiKey:deepseek'], undefined);
    await settings.locator('#forget').click(); await settings.waitForFunction(() => document.querySelector('#status').textContent.includes('已清除'));
    assert.equal(await settings.locator('#key').inputValue(), '');
    await settings.locator('#provider').selectOption('openai');
    assert.equal(await settings.locator('#key').inputValue(), ''); assert.match(await settings.locator('#base-url').inputValue(), /openai/);
    await settings.locator('#provider').selectOption('codex'); await settings.locator('#api-fields').waitFor({ state: 'hidden' });
    assert.equal(await settings.locator('#codex-fields').isVisible(), true);
  });
  await check('no uncaught errors or persistent screenshot data', async () => {
    assert.deepEqual(errors, []);
    assert(!JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null))).includes('data:image'));
  });
  if (process.env.PDF_COPILOT_LOCAL_PDF_PATH) {
    // Explicit opt-in reads only the user-specified file. Preview stays in RAM:
    // do not send its contents to the mock server or save screenshot artifacts.
    await check('user-specified PDF: local render, page jumps and crops without upload', async () => {
      await reader.bringToFront();
      if (!await reader.locator('#zoom-label').isDisabled()) await reader.locator('#zoom-label').click();
      await reader.locator('#file-input').setInputFiles(process.env.PDF_COPILOT_LOCAL_PDF_PATH);
      await reader.waitForFunction(name => document.querySelector('#document-title').textContent === name, basename(process.env.PDF_COPILOT_LOCAL_PDF_PATH));
      await pageReady(1);
      const count = Number((await reader.locator('#page-count').textContent()).replace(/\D/g, ''));
      assert(count > 1);
      for (const number of [1, Math.min(10, count), Math.min(25, count), count]) {
        await goto(number);
        if (await reader.locator('#capture-region').getAttribute('aria-pressed') !== 'true') await reader.locator('#capture-region').click();
        await drag(reader, '#page-surface'); await reader.locator('#preview-cancel').click();
      }
      await reader.keyboard.press('Escape');
      assert.equal(requests.length, 0, 'user document is never sent to a model');
      const pixels = await reader.locator('#reading-area canvas').evaluateAll(canvases => canvases.map(canvas => canvas.width * canvas.height));
      assert(pixels.length <= 3); assert(pixels.reduce((sum, value) => sum + value, 0) <= 16_000_000);
    });
  }
} finally {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', 'acceptance-results.json'), JSON.stringify({ version: manifest.version, deviceScaleFactor, checks, errors, networkRequests: requests.length, limitations: ['Isolated headless Edge; native browser accelerator keys and personal profile are not tested.', 'No paid model inference or personal document uploads.'] }, null, 2));
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
if (checks.some(check => check.result === 'fail')) process.exitCode = 1;
