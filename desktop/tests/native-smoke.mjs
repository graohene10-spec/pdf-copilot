// Explicit Windows runtime smoke test. Uses synthetic documents and never starts AI inference.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

if (process.platform !== 'win32') throw new Error('This explicit smoke test requires Windows.');
const root = resolve(import.meta.dirname, '..');
const { productName } = JSON.parse(await readFile(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const executable = process.env.PHYDOG_NATIVE_EXE ? resolve(process.env.PHYDOG_NATIVE_EXE) : resolve(root, 'src-tauri/target/debug/phydog.exe');
const production = !!process.env.PHYDOG_NATIVE_EXE;
if (production && ![resolve(root,'src-tauri/target/release/phydog.exe'),resolve(root,'release',`${productName}-portable`,`${productName}.exe`)].some(path => path.toLowerCase() === executable.toLowerCase())) {
  throw new Error('Production smoke test only accepts this project’s fixed release/portable executable.');
}
const prefix = production ? 'native-production' : 'native';
const artifactDir = resolve(root, 'artifacts');
const fixtureDir = resolve(artifactDir, `native-fixtures-${randomUUID()}`);
await mkdir(resolve(fixtureDir, 'images'), { recursive: true });
const pdfPath = resolve(fixtureDir, 'Native-PDF-smoke.pdf');
const mdPath = resolve(fixtureDir, 'Native-Markdown-smoke.md');
const mdText = '# 原生阅读验证\n\n量子物理与文档管理。\n\n![合成测试图片](images/pixel.png)\n\n## 公式\n\n$$E=mc^2$$\n\n' + Array(30).fill('这是一份合成的测试文档，用于验证本地阅读与阅读位置保存。').join('\n\n');
await writeFile(pdfPath, samplePdf(2, false, true, { lines: { 1: ['Native PDF runtime verification'], 2: ['Second synthetic page'] } }));
await writeFile(mdPath, mdText);
await writeFile(resolve(fixtureDir, 'images/pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

const errors = [], report = { production, fixtureDir, runtime: {}, checks: {}, consoleErrors: errors };
let server, application, browser, page, ids = [];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function eventually(operation, maximum = 30000) {
  const deadline = Date.now() + maximum;
  let failure;
  while (Date.now() < deadline) {
    try { return await operation(); } catch (error) { failure = error; await delay(300); }
  }
  throw failure || new Error('Timed out waiting for desktop runtime.');
}
async function invoke(command, args) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
}
async function nativeDiagnostic(type) {
  if (!production) return page.evaluate(async type => (await import('/src/ai/native.mjs')).nativeRequest(type),type);
  return page.evaluate(async type => {
    const ipc = window.__TAURI_INTERNALS__, requestId = crypto.randomUUID();
    let settle, reject, sessionId;
    const result = new Promise((resolve,failure) => { settle=resolve; reject=failure; });
    const callbackId=ipc.transformCallback(raw => {
      if ('end' in raw) { ipc.unregisterCallback(callbackId); return; }
      const message=raw.message;
      if (message.event==='disconnect') reject(new Error(message.error));
      else if(message.id===requestId) message.ok ? settle(message.result) : reject(new Error(message.error));
    });
    const timer=setTimeout(()=>reject(new Error('Native diagnostic request timed out')),30000);
    try {
      sessionId=await ipc.invoke('native_connect',{channel:`__CHANNEL__:${callbackId}`});
      await ipc.invoke('native_send',{sessionId,message:{id:requestId,type}});
      return await result;
    } finally { clearTimeout(timer); if(sessionId) await ipc.invoke('native_disconnect',{sessionId}); }
  },type);
}

try {
  if (!production) server = await createServer({
    root, configFile: resolve(root, 'vite.config.ts'), clearScreen: false,
    server: { host: '127.0.0.1', port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/public/vendor/**', '**/tests/artifacts/**', '**/artifacts/**', '**/test-results/**'] } },
  });
  if (server) await server.listen();
  application = spawn(executable, [], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9227 --remote-debugging-address=127.0.0.1' },
  });
  application.on('error', error => errors.push(`process: ${error.message}`));
  application.stderr.on('data', data => errors.push(`stderr: ${String(data).slice(0, 1000)}`));
  browser = await eventually(() => chromium.connectOverCDP('http://127.0.0.1:9227'));
  page = await eventually(async () => {
    const candidates = browser.contexts().flatMap(context => context.pages());
    const appPage = candidates.find(candidate => production ? /^(http:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(candidate.url()) : /localhost:1420/.test(candidate.url()));
    if (!appPage) throw new Error('Waiting for main WebView.');
    await appPage.waitForFunction(() => !!window.__TAURI_INTERNALS__ && !!document.querySelector('.library-heading'));
    return appPage;
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  report.runtime = await page.evaluate(() => ({ url: location.origin, native: !!window.__TAURI_INTERNALS__, userAgent: navigator.userAgent }));
  assert.equal(report.runtime.native, true);

  assert.equal(await page.title(), '开智');
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true });
  await settingsDialog.waitFor();
  const settingsTabs = settingsDialog.getByRole('navigation', { name: '设置分类' });
  for (const label of ['外观', '阅读', '快捷键', 'AI']) assert.ok(await settingsTabs.getByRole('button', { name: label, exact: true }).isVisible());
  for (const label of ['清澈', '标准', '浓郁', '实色']) assert.ok(await settingsDialog.getByRole('radio', { name: label, exact: true }).isVisible());
  report.checks.glassAppearance = { options: 4, selected: await page.locator('html').getAttribute('data-glass') };
  await page.screenshot({ path: resolve(artifactDir, `${prefix}-appearance.png`), animations: 'disabled' });
  await settingsTabs.getByRole('button', { name: '阅读', exact: true }).click();
  const fitEnabled = await settingsDialog.getByLabel('侧栏打开后页面超宽时适应宽度', { exact: true }).isChecked();
  assert.ok(await settingsDialog.getByLabel('PDF 缩放步长', { exact: true }).isVisible());
  assert.ok(await settingsDialog.getByLabel('Markdown 内容宽度', { exact: true }).isVisible());
  await page.screenshot({ path: resolve(artifactDir, `${prefix}-settings.png`), animations: 'disabled' });
  await settingsTabs.getByRole('button', { name: '快捷键', exact: true }).click();
  assert.ok(await settingsDialog.getByLabel('显示 / 隐藏 AI 助手快捷键', { exact: true }).isVisible());
  await settingsDialog.getByRole('button', { name: '取消', exact: true }).click();
  report.checks.brandAndUnifiedSettings = true;

  const imported = await invoke('import_documents', { paths: [pdfPath, mdPath] });
  assert.equal(imported.length, 2); ids = imported.map(document => document.id);
  const [pdf, md] = imported;
  report.checks.importAndContract = imported.map(({ kind, lastOpenedAt, page, pageCount }) => ({ kind, lastOpenedAt, page, pageCount }));
  assert.equal(typeof pdf.lastOpenedAt, 'number');
  assert.deepEqual((await invoke('import_documents', { paths: [pdfPath] })).map(doc => doc.id), [pdf.id]);
  const bytes = await page.evaluate(async ({ pdfId, mdId }) => {
    const pdf = await window.__TAURI_INTERNALS__.invoke('read_document', { id: pdfId });
    const md = await window.__TAURI_INTERNALS__.invoke('read_document', { id: mdId });
    return { pdfBinary: pdf instanceof ArrayBuffer, mdBinary: md instanceof ArrayBuffer, pdfHeader: new TextDecoder().decode(new Uint8Array(pdf).slice(0, 5)), markdown: new TextDecoder().decode(md) };
  }, { pdfId: pdf.id, mdId: md.id });
  assert.equal(bytes.pdfBinary, true); assert.equal(bytes.mdBinary, true); assert.equal(bytes.pdfHeader, '%PDF-'); assert.equal(bytes.markdown, mdText);
  report.checks.binaryIpc = { pdfBinary: bytes.pdfBinary, mdBinary: bytes.mdBinary, pdfHeader: bytes.pdfHeader };
  const updated = await invoke('update_document', { id: pdf.id, patch: { tags: ['原生验证'], pageCount: 2, page: 2, progress: 1, starred: true, lastOpenedAt: Date.now() } });
  assert.deepEqual(updated.tags, ['原生验证']); assert.equal(updated.page, 2); assert.equal(updated.progress, 1);
  assert.ok((await invoke('list_documents', { query: '原生验证' })).some(doc => doc.id === pdf.id));
  assert.ok((await invoke('list_documents', { query: '量子' })).some(doc => doc.id === md.id));
  assert.ok((await invoke('list_documents', { query: '量子物理' })).some(doc => doc.id === md.id));
  report.checks.persistedMetadataAndChineseSearch = true;
  const asset = await page.evaluate(async id => {
    const bytes = await window.__TAURI_INTERNALS__.invoke('read_asset', { id, relativePath: 'images/pixel.png' });
    return { binary: bytes instanceof ArrayBuffer, header: [...new Uint8Array(bytes).slice(0, 8)] };
  }, md.id);
  assert.equal(asset.binary, true); assert.deepEqual(asset.header, [137,80,78,71,13,10,26,10]);
  await assert.rejects(invoke('read_asset', { id: md.id, relativePath: '../outside.png' }), /文档目录/);
  await assert.rejects(invoke('native_send', { sessionId: 'missing', message: { type: 'shell', command: 'anything' } }), /不允许/);
  await assert.rejects(invoke('plugin:fs|read_file', { path: pdfPath }));
  await page.evaluate(async () => {
    const ipc = window.__TAURI_INTERNALS__, callback = ipc.transformCallback(() => {});
    try {
      await ipc.invoke('http_start', { id: crypto.randomUUID(), url: 'http://outside.invalid/v1/responses', method: 'POST', headers: [], body: '{}', channel: `__CHANNEL__:${callback}` });
      throw new Error('An unencrypted external AI endpoint was unexpectedly permitted.');
    } catch (error) {
      if (!String(error).includes('HTTPS')) throw error;
    } finally { ipc.unregisterCallback(callback); }
  });
  report.checks.assetScopeAndCommandRestrictions = true;

  // Native streaming, tool-loop and actual connection cancellation are verified
  // through the bundled AI interface in scripts/native-ai-smoke.mjs.

  await page.reload();
  await page.getByRole('button', { name: '打开 Native-Markdown-smoke.md', exact: true }).click();
  await page.locator('.markdown-paper h1').filter({ hasText: '原生阅读验证' }).waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('.markdown-paper img'); return image?.complete && image.naturalWidth > 0; });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(artifactDir, `${prefix}-markdown.png`), fullPage: true });
  await page.locator('.markdown-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction(() => document.querySelector('.reading-status')?.textContent?.includes('100%'));
  await eventually(async () => {
    const doc = (await invoke('list_documents', { query: 'Native-Markdown-smoke' })).find(doc => doc.id === md.id);
    assert.ok(doc.progress >= 0.9); report.checks.autoSavedScrollProgress = doc.progress; return doc;
  });
  report.checks.markdownRuntimeImageMathAndProgress = await page.locator('.markdown-paper').evaluate(element => ({ image: element.querySelector('img')?.naturalWidth > 0, math: !!element.querySelector('.katex'), sourceBlocks: element.querySelectorAll('[data-source-line]').length }));
  assert.equal(report.checks.markdownRuntimeImageMathAndProgress.math, true);

  await page.reload();
  await page.getByRole('button', { name: '打开 Native-PDF-smoke.pdf', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.pdf-scroll canvas')].some(canvas => canvas.width > 0 && canvas.height > 0));
  await page.locator('.reader-overlay').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('input[aria-label="页码"]')?.value === '2');
  await eventually(async () => {
    const saved = (await invoke('list_documents',{query:'Native-PDF-smoke'})).find(doc => doc.id === pdf.id);
    assert.equal(saved.page,2); assert.equal(saved.pageCount,2); assert.equal(saved.progress,1); return saved;
  });
  await page.reload();
  await page.getByRole('button', { name: '打开 Native-PDF-smoke.pdf', exact: true }).click();
  await page.locator('.reader-overlay').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('input[aria-label="页码"]')?.value === '2');
  report.checks.pdfProgressRestoredAfterReopen = true;

  // Exercise the new fit behavior in the bundled WebView without changing user preferences.
  const pageWidth = () => page.locator('.page-slot[data-page="2"]').evaluate(element => element.getBoundingClientRect().width);
  for (let count = 0; count < 5; count++) {
    const label = await page.getByTitle('适应宽度', { exact: true }).textContent();
    if (Number.parseFloat(label) >= 400) break;
    const before = await pageWidth();
    await page.getByTitle('放大', { exact: true }).click();
    await eventually(async () => { assert.ok(await pageWidth() > before); return true; });
  }
  const manualWidth = await pageWidth();
  await page.getByRole('button', { name: '阅读助手', exact: true }).click();
  await page.locator('.ai-pane').waitFor();
  if (fitEnabled) {
    await eventually(async () => {
      const available = await page.locator('.pdf-scroll').evaluate(element => { const style = getComputedStyle(element); return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight); });
      assert.ok(await pageWidth() <= available + 1);
      return true;
    });
  } else { await delay(500); assert.equal(await pageWidth(), manualWidth); }
  const panelWidth = await pageWidth();
  assert.ok(panelWidth <= manualWidth);
  assert.equal(await page.getByLabel('页码', { exact: true }).inputValue(), '2');
  await page.getByRole('button', { name: '关闭阅读助手', exact: true }).click();
  await delay(400);
  assert.equal(await pageWidth(), panelWidth, 'Closing the panel must preserve manual zoom');
  report.checks.sidebarFitPreservesPageAndManualScale = { enabled: fitEnabled, shrank: panelWidth < manualWidth };
  await page.screenshot({ path: resolve(artifactDir, `${prefix}-pdf.png`), fullPage: true });
  report.checks.pdfRuntimeRendering = await page.locator('.pdf-scroll').evaluate(element => ({ canvases: element.querySelectorAll('canvas').length, text: element.textContent.includes('Second synthetic page') }));
  assert.ok(report.checks.pdfRuntimeRendering.canvases > 0);

  const status = await nativeDiagnostic('status');
  report.checks.codexStatus = { version: status.version, compatible: status.compatible, loggedIn: status.loggedIn, diagnostic: status.diagnostic };
  const models = await nativeDiagnostic('models');
  report.checks.codexModels = { count: Array.isArray(models) ? models.length : models?.data?.length || models?.models?.length || 0 };
  assert.ok(report.checks.codexModels.count > 0);
  const exec = promisify(execFile);
  const verify = await exec(resolve(dirname(executable),'native-host/PdfCopilotHost.exe'), ['--verify-document-tools'], { cwd: root, windowsHide: true, timeout: 30000 });
  report.checks.codexIsolationAndDocumentTools = verify.stdout.trim();
  assert.deepEqual(errors, [], 'Desktop runtime reported console/process errors.');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (page && ids.length) {
    for (const id of ids) { try { await invoke('remove_document', { id }); } catch (error) { errors.push(`cleanup: ${String(error)}`); } }
  }
  await writeFile(resolve(artifactDir, `${prefix}-smoke-report.json`), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (application && !application.killed) application.kill();
  if (server) await server.close();
}
