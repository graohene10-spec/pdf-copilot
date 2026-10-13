// Browser and native integration checks use synthetic documents and no AI calls.
// Native mode operates only the process started here and restores app preferences.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const native = process.argv.includes('--native');
const artifacts = resolve('artifacts');
const port = Number(process.env.PHYDOG_FULLSCREEN_UI_PORT || 1468);
const debugPort = Number(process.env.PHYDOG_FULLSCREEN_DEBUG_PORT || 9237);
const checks = [], errors = [], externalRequests = [];
const nativeEvidence = {}, cleanup = {};
const names = [`全屏搜索验证-${randomUUID().slice(0, 8)}.pdf`, `全屏搜索验证-${randomUUID().slice(0, 8)}.md`];
const files = [samplePdf(3, false, true, { lines: {
  1: ['ALPHA evidence first page'],
  2: ['ALPHA evidence second page'],
  3: ['OMEGA final page', 'ALPHA final evidence'],
} }), Buffer.from('# Search integration\n\nALPHA opening evidence.\n\n' +
  Array.from({ length: 70 }, (_, i) => `Paragraph ${i + 1}: ordinary synthetic reading content.\n\n`).join('') +
  'OMEGA ending evidence.\n\nALPHA closing evidence.\n')];
let server, browser, context, page, application, fixtureDir;
let importedIds = [], oldPreferences, backedUp = false, passed = false;
const execute = promisify(execFile);
const delay = ms => new Promise(done => setTimeout(done, ms));
const invoke = (command, args) => page.evaluate(({ command, args }) =>
  window.__TAURI_INTERNALS__.invoke(command, args), { command, args });

async function until(condition, description = 'UI condition', timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await condition()) return; await delay(80); }
  throw new Error(`${description} did not settle within ${timeout} ms.`);
}
async function readyPdf(expected) {
  await page.waitForFunction(expected => {
    const surface = document.querySelector('#page-surface');
    return surface?.classList.contains('page-ready') && !surface.classList.contains('pdf-preview') &&
      surface.querySelector('.pdf-canvas')?.width > 0 &&
      (expected === undefined || document.querySelector('[aria-label="页码"]')?.value === String(expected));
  }, expected);
  await page.waitForTimeout(150);
}
const find = () => page.getByRole('textbox', { name: '文档内搜索', exact: true });
async function setQuery(value) { await find().fill(value); await page.waitForTimeout(380); }
async function shortcutSettings() {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  await dialog.getByRole('button', { name: '快捷键', exact: true }).click();
  return dialog;
}
async function saveSettings(dialog) {
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}
async function countMatches(expected) {
  await until(async () => {
    const text = await page.locator('.reader-search-count').innerText();
    return new RegExp(`/\\s*${expected}$`).test(text.trim()) && !text.includes('…');
  }, `search total ${expected}`);
}
async function fullscreenState() {
  return native ? invoke('plugin:window|is_fullscreen', { label: 'main' }) : page.evaluate(() => !!document.fullscreenElement);
}
async function fullscreenExpected(value) {
  await until(async () => await fullscreenState() === value, `fullscreen ${value}`);
  const button = page.getByRole('button', { name: value ? '退出全屏' : '进入全屏', exact: true });
  await button.waitFor(); await until(() => button.isEnabled(), 'fullscreen request completion');
}
async function nativeMetrics() {
  const [fullscreen, maximized, size, position, monitor, innerSize, scaleFactor, viewport] = await Promise.all([
    invoke('plugin:window|is_fullscreen', { label: 'main' }),
    invoke('plugin:window|is_maximized', { label: 'main' }),
    invoke('plugin:window|outer_size', { label: 'main' }),
    invoke('plugin:window|outer_position', { label: 'main' }),
    invoke('plugin:window|current_monitor', { label: 'main' }),
    invoke('plugin:window|inner_size', { label: 'main' }),
    invoke('plugin:window|scale_factor', { label: 'main' }),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })),
  ]);
  return { fullscreen, maximized, size, position, monitor, innerSize, scaleFactor, viewport };
}
function restoredWindow(before, after, label) {
  assert.equal(after.fullscreen, false, `${label}: exit fullscreen`);
  assert.equal(after.maximized, before.maximized, `${label}: maximize state restored`);
  for (const key of ['width', 'height']) assert.ok(Math.abs(before.size[key] - after.size[key]) <= 2, `${label}: restore ${key}`);
  for (const key of ['x', 'y']) assert.ok(Math.abs(before.position[key] - after.position[key]) <= 2, `${label}: restore ${key}`);
}
async function makeOwnWindowNormal() {
  assert.ok(application?.pid > 0, 'Only the test process may be resized');
  const factor = await invoke('plugin:window|scale_factor', { label: 'main' });
  const width = Math.round(1100 * factor), height = Math.round(780 * factor);
  // No app capability is added solely for tests. Win32 acts on the owned PID.
  const taskScript = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FullscreenTestWindow {
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hwnd, int x, int y, int width, int height, bool repaint);
}
'@
$taskOldDpi = [FullscreenTestWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($taskOldDpi -eq [IntPtr]::Zero) { throw 'DPI awareness context could not be set.' }
$taskProcess = Get-Process -Id ${application.pid} -ErrorAction Stop
$taskHandle = $taskProcess.MainWindowHandle
if ($taskHandle -eq [IntPtr]::Zero) { throw 'Owned test window is missing.' }
[FullscreenTestWindow]::ShowWindow($taskHandle, 9) | Out-Null
Start-Sleep -Milliseconds 150
[FullscreenTestWindow]::MoveWindow($taskHandle, 80, 60, ${width}, ${height}, $true) | Out-Null
[FullscreenTestWindow]::SetThreadDpiAwarenessContext($taskOldDpi) | Out-Null
`;
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', taskScript], { windowsHide: true });
  await until(async () => !(await nativeMetrics()).maximized, 'owned normal window');
  await page.waitForTimeout(400);
  const metrics = await nativeMetrics();
  assert.ok(metrics.viewport.width >= 1000 && metrics.viewport.width <= 1120, `Owned compact logical viewport: ${JSON.stringify(metrics.viewport)}`);
  assert.ok(Math.abs(metrics.innerSize.width / metrics.scaleFactor - metrics.viewport.width) <= 2, 'Native pixels and logical viewport agree');
}

try {
  await mkdir(artifacts, { recursive: true });
  if (native) {
    const processes = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "ConvertTo-Json -Compress -InputObject @(Get-Process -Name '开智' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })"], { windowsHide: true });
    assert.deepEqual(JSON.parse(processes.stdout.trim() || '[]'), [], 'Close existing user app before a native test can temporarily alter shared preferences');
    let existingEndpoint = false;
    try { existingEndpoint = (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(700) })).ok; }
    catch { /* An unused debugging port has no endpoint. */ }
    assert.equal(existingEndpoint, false, 'Refuse to attach to a native process not started by this test');
    const { productName } = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
    const executable = resolve('release', `${productName}-portable`, `${productName}.exe`);
    application = spawn(executable, [], {
      cwd: dirname(executable), windowsHide: true, stdio: 'ignore',
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${debugPort}` },
    });
    await until(async () => {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); return true; }
      catch { if (application.exitCode !== null) throw new Error('Owned native app exited before attaching.'); return false; }
    }, 'native debugging endpoint', 25000);
    await until(() => { page = browser.contexts().flatMap(value => value.pages()).find(value => /tauri\.localhost/.test(value.url())); return !!page; });
    await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && !!document.querySelector('.library-heading'));
    oldPreferences = await invoke('get_setting', { key: 'app.preferences.v1' }); backedUp = true;
    const isolated = JSON.parse(oldPreferences || '{}');
    isolated.shortcuts = {}; // Normalize to the defaults under test, then restore exact stored bytes.
    await invoke('set_setting', { key: 'app.preferences.v1', value: JSON.stringify(isolated) });
    fixtureDir = resolve(artifacts, `fullscreen-fixtures-${randomUUID()}`); await mkdir(fixtureDir);
    const paths = names.map(name => resolve(fixtureDir, name));
    await Promise.all(paths.map((path, index) => writeFile(path, files[index])));
    const documents = await invoke('import_documents', { paths }); importedIds = documents.map(document => document.id);
    await page.reload();
    await page.getByRole('button', { name: `打开 ${names[0]}`, exact: true }).click(); await readyPdf(1);
    await page.getByRole('button', { name: '文档库', exact: true }).click();
    await page.getByRole('button', { name: `打开 ${names[1]}`, exact: true }).click();
    await page.locator('.markdown-paper').waitFor();
    await page.getByRole('tab', { name: names[0], exact: true }).click(); await readyPdf(1);
  } else {
    server = await createServer({ cacheDir: resolve(artifacts, 'vite-fullscreen-search-ui'), optimizeDeps: {
      entries: ['index.html'], include: ['vue', 'pdfjs-dist', 'markdown-it', 'katex', '@tauri-apps/api/window', '@tauri-apps/api/webview', '@tauri-apps/api/core', '@tauri-apps/plugin-dialog'],
    }, server: {
      host: '127.0.0.1', port, strictPort: true, hmr: false, watch: { ignored: ['**/artifacts/**', '**/src-tauri/**'] },
    } }); await server.listen();
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    context = await browser.newContext({ viewport: { width: 1400, height: 900 } }); page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '加入文档', exact: true }).click();
    await (await chooser).setFiles(names.map((name, index) => ({ name, mimeType: index ? 'text/markdown' : 'application/pdf', buffer: files[index] })));
    await readyPdf(1);
  }
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => {
    window.__fullscreenSearchKeys = [];
    window.addEventListener('keydown', event => {
      if (event.key === 'F11' || (event.ctrlKey && event.code === 'KeyF'))
        window.__fullscreenSearchKeys.push({ code: event.code, repeat: event.repeat, prevented: event.defaultPrevented });
    });
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost|tauri\.localhost|ipc\.localhost)(:|\/)/.test(url)) {
      externalRequests.push(url); return route.abort();
    }
    return route.continue();
  });

  assert.equal(await fullscreenState(), false);
  const initialWindow = native ? await nativeMetrics() : null;
  if (native) nativeEvidence.initialWindow = initialWindow;
  await page.getByRole('button', { name: '进入全屏', exact: true }).click(); await fullscreenExpected(true);
  if (native) {
    const state = await nativeMetrics();
    nativeEvidence.fullscreenWindow = state;
    assert.ok(state.monitor, 'Fullscreen monitor available');
    assert.ok(Math.abs(state.size.width - state.monitor.size.width) <= 2, 'Full monitor width including former window border');
    assert.ok(Math.abs(state.size.height - state.monitor.size.height) <= 2, 'Full monitor height including former taskbar and titlebar');
  }
  await page.getByRole('button', { name: '退出全屏', exact: true }).click(); await fullscreenExpected(false);
  if (native) { await page.waitForTimeout(200); nativeEvidence.restoredInitial = await nativeMetrics(); restoredWindow(initialWindow, nativeEvidence.restoredInitial, 'initial window'); }
  checks.push('Fullscreen button changes actual native or browser fullscreen state; exit restores the previous window');

  await page.keyboard.press('F11'); await fullscreenExpected(true);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F11', code: 'F11', repeat: true, bubbles: true, cancelable: true })));
  await page.waitForTimeout(150); assert.equal(await fullscreenState(), true, 'F11 auto-repeat leaves state unchanged');
  assert.equal(await page.evaluate(() => window.__fullscreenSearchKeys.findLast(event => event.code === 'F11' && event.repeat)?.prevented), true, 'Ignored F11 repeat must not invoke browser fullscreen');
  await page.getByRole('button', { name: '打开设置', exact: true }).click(); await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await fullscreenState(), true, 'Escape closes a dialog before fullscreen');
  await page.locator('.pdf-scroll').focus(); await page.keyboard.press('Escape'); await fullscreenExpected(false);
  checks.push('F11 toggles fullscreen; held-key repeat is ignored; Escape closes an open dialog before exiting fullscreen');

  if (native) {
    await makeOwnWindowNormal(); const normalWindow = await nativeMetrics();
    nativeEvidence.normalWindow = normalWindow;
    await page.getByRole('button', { name: '进入全屏', exact: true }).click(); await fullscreenExpected(true);
    await page.getByRole('button', { name: '退出全屏', exact: true }).click(); await fullscreenExpected(false);
    await page.waitForTimeout(200); nativeEvidence.restoredNormal = await nativeMetrics(); restoredWindow(normalWindow, nativeEvidence.restoredNormal, 'normal owned window');
    checks.push('Native fullscreen also restores a nonmaximized window at its prior size and position');
  }

  await page.locator('.pdf-scroll').focus(); await page.keyboard.press('Control+f');
  await until(() => find().evaluate(input => document.activeElement === input), 'Ctrl+F document search focus');
  assert.equal(await page.evaluate(() => window.__fullscreenSearchKeys.findLast(event => event.code === 'KeyF')?.prevented), true, 'Document search prevents the browser find overlay');
  await setQuery('OMEGA'); await countMatches(1); await readyPdf(3);
  await page.locator('#page-surface .document-search-current').first().waitFor();
  assert.equal(await find().inputValue(), 'OMEGA');
  checks.push('Ctrl+F focuses the matching glass search field; PDF text search reaches another page and paints a current-result highlight');

  await setQuery('ALPHA'); await countMatches(3);
  const beforeMatch = (await page.locator('.reader-search-count').innerText()).trim();
  await find().press('Enter');
  await until(async () => (await page.locator('.reader-search-count').innerText()).trim() !== beforeMatch, 'Enter advances match');
  await find().press('Shift+Enter');
  await until(async () => (await page.locator('.reader-search-count').innerText()).trim() === beforeMatch, 'Shift+Enter returns match');
  await setQuery('NO_SUCH_SEARCH_TOKEN'); await countMatches(0);
  assert.equal(await page.locator('.document-search-hit').count(), 0);
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  assert.equal(await find().inputValue(), '');
  assert.equal(await page.locator('.document-search-hit').count(), 0);
  checks.push('PDF result navigation supports Enter and Shift+Enter, no-result search and clearing do not leave stale highlights');

  await setQuery('OMEGA'); await countMatches(1);
  await page.getByRole('button', { name: '进入全屏', exact: true }).click(); await fullscreenExpected(true);
  await find().focus(); await find().press('Escape');
  assert.equal(await find().inputValue(), '');
  assert.equal(await fullscreenState(), true, 'Escape in search clears the query without simultaneously leaving fullscreen');
  await page.getByTitle('框选公式或图表作为 AI 上下文', { exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await fullscreenState(), true, 'Escape ends screenshot capture before fullscreen');
  assert.equal(await page.getByTitle('框选公式或图表作为 AI 上下文', { exact: true }).evaluate(button => button.classList.contains('active')), false);
  await page.locator('.pdf-scroll').focus(); await page.keyboard.press('Escape'); await fullscreenExpected(false);
  checks.push('Escape clears a focused search or cancels screenshot capture before the next Escape exits fullscreen');

  await page.getByRole('tab', { name: names[1], exact: true }).click(); await page.locator('.markdown-paper').waitFor();
  await page.locator('.markdown-paper').click({ position: { x: 25, y: 25 } }); await page.keyboard.press('Control+f');
  await until(() => find().evaluate(input => document.activeElement === input), 'Markdown Ctrl+F focus');
  await setQuery('ALPHA'); await countMatches(2);
  await page.waitForFunction(() => CSS.highlights && [...CSS.highlights.entries()].some(([name, ranges]) => name.startsWith('kaizhi-md-search-') && name.endsWith('-current') && ranges.size > 0));
  const firstMarkdownMatch = (await page.locator('.reader-search-count').innerText()).trim();
  await page.getByRole('button', { name: '下一个搜索结果', exact: true }).click();
  await until(async () => (await page.locator('.reader-search-count').innerText()).trim() !== firstMarkdownMatch, 'Markdown next result');
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('kaizhi-md-search-')).length), 0);
  checks.push('Markdown uses the same search controls and supports whole-document matches, navigation and clear');

  const assistant = page.getByRole('button', { name: '阅读助手', exact: true });
  if (await assistant.getAttribute('aria-expanded') !== 'true') await assistant.click();
  const draft = page.getByRole('textbox', { name: '向 AI 提问', exact: true });
  await draft.fill('Only an unsent draft.');
  await draft.press('Control+a');
  assert.equal(await draft.inputValue(), 'Only an unsent draft.');
  assert.equal(await draft.evaluate(input => input.selectionEnd - input.selectionStart), 'Only an unsent draft.'.length);
  assert.equal(await find().inputValue(), '');
  checks.push('Ordinary editor shortcuts keep working in the AI composer without moving focus or issuing a request');

  await page.getByRole('tab', { name: names[0], exact: true }).click(); await readyPdf();
  let dialog = await shortcutSettings();
  await dialog.getByRole('textbox', { name: '文档内搜索快捷键', exact: true }).click();
  await dialog.getByRole('textbox', { name: '文档内搜索快捷键', exact: true }).press('Control+Alt+f');
  await dialog.getByRole('textbox', { name: '进入 / 退出全屏快捷键', exact: true }).click();
  await dialog.getByRole('textbox', { name: '进入 / 退出全屏快捷键', exact: true }).press('Control+Alt+Enter');
  await saveSettings(dialog);
  await page.locator('.pdf-scroll').focus(); await page.keyboard.press('Control+f');
  assert.equal(await find().evaluate(input => document.activeElement === input), false, 'Changed Ctrl+F no longer focuses document search');
  assert.equal(await page.evaluate(() => window.__fullscreenSearchKeys.findLast(event => event.code === 'KeyF')?.prevented), true, 'Changed Ctrl+F still prevents the browser find popup');
  await page.keyboard.press('F11'); await page.waitForTimeout(120); assert.equal(await fullscreenState(), false);
  assert.equal(await page.evaluate(() => window.__fullscreenSearchKeys.findLast(event => event.code === 'F11')?.prevented), true, 'Changed F11 prevents the default browser fullscreen');
  await page.keyboard.press('Control+Alt+f');
  await until(() => find().evaluate(input => document.activeElement === input), 'custom document-find shortcut');
  await find().press('Escape');
  await page.locator('.pdf-scroll').focus(); await page.keyboard.press('Control+Alt+Enter'); await fullscreenExpected(true);
  await page.keyboard.press('Control+Alt+Enter'); await fullscreenExpected(false);
  dialog = await shortcutSettings();
  await dialog.getByRole('button', { name: '禁用文档内搜索快捷键', exact: true }).click();
  await dialog.getByRole('button', { name: '禁用进入 / 退出全屏快捷键', exact: true }).click();
  await saveSettings(dialog);
  await page.locator('.pdf-scroll').focus(); await page.keyboard.press('Control+f'); await page.keyboard.press('F11');
  assert.equal(await find().evaluate(input => document.activeElement === input), false);
  assert.equal(await fullscreenState(), false);
  assert.equal(await page.evaluate(() => window.__fullscreenSearchKeys.findLast(event => event.code === 'KeyF')?.prevented), true);
  assert.equal(await page.evaluate(() => window.__fullscreenSearchKeys.findLast(event => event.code === 'F11')?.prevented), true);
  await page.getByRole('button', { name: '进入全屏', exact: true }).click(); await fullscreenExpected(true);
  await page.getByRole('button', { name: '退出全屏', exact: true }).click(); await fullscreenExpected(false);
  dialog = await shortcutSettings();
  await dialog.getByRole('button', { name: '恢复文档内搜索默认快捷键', exact: true }).click();
  await dialog.getByRole('button', { name: '恢复进入 / 退出全屏默认快捷键', exact: true }).click();
  await saveSettings(dialog);
  checks.push('Custom and disabled search/fullscreen shortcuts work; prior Ctrl+F and F11 bindings do not leak to browser defaults; toolbar buttons stay available');

  if (!native) await page.setViewportSize({ width: 1000, height: 740 });
  await page.getByRole('tab', { name: names[0], exact: true }).click(); await readyPdf();
  if (await page.getByRole('button', { name: '切换侧栏', exact: true }).getAttribute('aria-expanded') !== 'true')
    await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
  await setQuery('ALPHA'); await countMatches(3); await page.waitForTimeout(450);
  const layout = await page.locator('.reader-tools').evaluate(toolbar => {
    const box = toolbar.getBoundingClientRect();
    const search = toolbar.querySelector('.reader-search')?.getBoundingClientRect();
    return { scrollWidth: toolbar.scrollWidth, width: toolbar.clientWidth, height: box.height, left: box.left, right: box.right,
      search: search && { left: search.left, right: search.right, width: search.width, top: search.top, bottom: search.bottom } };
  });
  assert.ok(layout.scrollWidth <= layout.width + 2, `Toolbar does not horizontally overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.search?.width > 70, 'Search retains an editable width in the compact reading view');
  assert.ok(layout.search.left >= layout.left - 2 && layout.search.right <= layout.right + 2, 'Search stays inside the toolbar');
  if (native) nativeEvidence.compactLayout = { ...layout, viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })) };
  checks.push('The search control remains inside a compact PDF toolbar with library sidebar and AI sidebar open');

  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await page.screenshot({ path: resolve(artifacts, `${native ? 'native-' : ''}fullscreen-search-ui.png`), animations: 'disabled' });
  passed = true;
} finally {
  if (!passed && page && !page.isClosed())
    await page.screenshot({ path: resolve(artifacts, `${native ? 'native-' : ''}fullscreen-search-ui-failed.png`), animations: 'disabled' }).catch(() => {});
  if (native && page && !page.isClosed() && backedUp) {
    for (const name of names) {
      const close = page.getByRole('button', { name: `关闭 ${name} 标签`, exact: true });
      if (await close.count()) await close.click().catch(() => {});
    }
    await delay(450);
    await invoke('set_setting', { key: 'app.preferences.v1', value: oldPreferences || '' }).catch(error => errors.push(`Restore preferences: ${error.message}`));
    for (const id of importedIds) await invoke('remove_document', { id }).catch(error => errors.push(`Remove own fixture: ${error.message}`));
    try {
      cleanup.preferencesRestored = (await invoke('get_setting', { key: 'app.preferences.v1' })) === (oldPreferences || '');
      assert.equal(cleanup.preferencesRestored, true, 'Exact preference string restored');
      const remaining = await invoke('list_documents', { query: '' });
      cleanup.syntheticDocumentsRemoved = !remaining.some(document => importedIds.includes(document.id));
      assert.equal(cleanup.syntheticDocumentsRemoved, true, 'All owned synthetic documents removed');
    } catch (error) { errors.push(`Verify native cleanup: ${error.message}`); }
  }
  await context?.close(); await browser?.close(); application?.kill(); await server?.close();
  if (native && application) {
    await until(() => application.exitCode !== null || application.signalCode !== null, 'owned process exit');
    const processCheck = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `if (Get-Process -Id ${application.pid} -ErrorAction SilentlyContinue) { 'running' } else { 'closed' }`], { windowsHide: true });
    cleanup.ownedProcessClosed = processCheck.stdout.trim() === 'closed';
    assert.equal(cleanup.ownedProcessClosed, true, 'Owned native process closed');
  }
  if (fixtureDir) {
    for (const name of names) await unlink(resolve(fixtureDir, name)); await rmdir(fixtureDir);
    cleanup.syntheticFilesRemoved = true;
  }
  const report = { passed: passed && errors.length === 0, native, checks, errors, externalRequests, ...(native ? { nativeEvidence, cleanup } : {}) };
  await mkdir(artifacts, { recursive: true });
  await writeFile(resolve(artifacts, `${native ? 'native-' : ''}fullscreen-search-ui.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
