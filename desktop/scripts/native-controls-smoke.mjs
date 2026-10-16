// Bundled Windows UI checks. Codex only reads login/model metadata; no chat is sent.
// Run after packaging, with no other native test instance active. Every temporary
// setting is backed up and restored, and only this script's UUID fixture is removed.
import { chromium } from 'playwright';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { samplePdf } from '../../tests/fixtures/pdf.mjs';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const artifacts = join(root, 'artifacts'), executable = join(root, 'release', `${config.productName}-portable`, `${config.productName}.exe`);
const debugPort = 9246, settingsKey = 'app.preferences.v1', aiSettingsKey = 'paperdesk.ai.settings.v1';
const fixtureDir = join(artifacts, `native-controls-${randomUUID()}`);
const fixtureName = `native-controls-${randomUUID()}.pdf`, fixturePath = join(fixtureDir, fixtureName);
const grayPath = join(fixtureDir, 'local-gray-wallpaper.png');
const checks = [], errors = [], remoteRequests = [], cleanupErrors = [], metrics = {};
let application, browser, page, importedId, originalPreferences, originalAiSettings, backedUp = false, passed = false;
const runPowerShell = promisify(execFile);
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
async function until(condition, message = 'Native control condition timed out.', timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await condition(); if (result) return result; await new Promise(done => setTimeout(done, 100)); }
  throw new Error(message);
}
const dialog = () => page.getByRole('dialog', { name: '设置', exact: true });
const settled = () => page.waitForFunction(() => !document.querySelector('.settings-pop-enter-active,.settings-pop-leave-active,.view-enter-active,.view-leave-active,.pane-enter-active,.pane-leave-active,.sidebar-enter-active,.sidebar-leave-active'));
const pdf = () => page.locator('.pdf-scroll:visible');
const zoom = () => page.locator('.reader-tools:visible .reader-zoom [data-tip="适应宽度"]').innerText();
async function readyPdf() {
  await page.locator('.pdf-scroll:visible .page-ready:not(.pdf-preview) .pdf-canvas').first().waitFor();
  await settled();
  await page.waitForFunction(() => {
    const scroll = [...document.querySelectorAll('.pdf-scroll')].find(element => element.getBoundingClientRect().width > 0);
    return scroll && !scroll.style.width && !document.querySelector('.reader-overlay') && scroll.querySelector('.page-ready:not(.pdf-preview)');
  });
}
async function openSettings(tab = '外观') {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await dialog().getByRole('button', { name: tab, exact: true }).click(); await settled();
}
async function menuContrast(theme) {
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  const values = await dialog().locator('select').evaluateAll(elements => {
    const luma = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { const x = n / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
    return elements.map(element => ({ label: element.getAttribute('aria-label'), scheme: getComputedStyle(element).colorScheme, options: [...element.options].map(option => {
      const style = getComputedStyle(option), a = luma(style.color), b = luma(style.backgroundColor);
      return { value: option.value, color: style.color, background: style.backgroundColor, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    }) }));
  });
  for (const value of values) { assert.equal(value.scheme, theme); for (const option of value.options) assert.ok(option.contrast >= 4.5); }
  metrics[`${theme}Menus`] = values;
}
async function physicalWheel(deltaY, control = false) {
  const box = await pdf().boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 160));
  if (control) await page.keyboard.down('Control');
  try { await page.mouse.wheel(0, deltaY); }
  finally { if (control) await page.keyboard.up('Control'); }
}
async function inkRoundTrip(theme) {
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator(`[data-tip="${theme === 'light' ? '切换浅色主题' : '切换深色主题'}"]`).click();
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  await until(() => page.locator('.app-sidebar .import-button,.app-sidebar .brand,.app-topbar .sidebar-toggle').evaluateAll((elements, theme) => elements.length === 3 && elements.every(element => element.dataset.glassInk === (theme === 'light' ? 'dark' : 'light')), theme), 'Gray wallpaper foreground did not restore after theme change.');
  await page.waitForTimeout(250);
  const foregrounds = await page.locator('.app-sidebar .import-button,.app-sidebar .brand,.app-topbar .sidebar-toggle').evaluateAll(elements => elements.map(element => ({ target: element.className, ink: element.dataset.glassInk, color: getComputedStyle(element).color })));
  metrics.themeRoundTrips ||= []; metrics.themeRoundTrips.push({ theme, foregrounds });
}
// Use the actual Windows client surface so a native select popup is visible in
// the artifact. Paths/PIDs are passed as environment values, never shell code.
async function captureNativeClient(path) {
  const bounds = await dialog().boundingBox(), dpr = await page.evaluate(() => devicePixelRatio);
  assert.ok(bounds);
  const clip = { x: Math.max(0, Math.floor(bounds.x * dpr) - 12), y: Math.max(0, Math.floor(bounds.y * dpr) - 12), width: Math.ceil(bounds.width * dpr) + 24, height: Math.ceil(bounds.height * dpr) + 24 };
  await runPowerShell('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ControlsSmokeWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
}
'@
[ControlsSmokeWindow]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$controlSmokeProcess = Get-Process -Id ([int]$env:PHYDOG_CONTROLS_PID)
$controlSmokeHandle = $controlSmokeProcess.MainWindowHandle
if ($controlSmokeHandle -eq [IntPtr]::Zero) { throw 'Native client window was unavailable.' }
$controlSmokeRect = New-Object ControlsSmokeWindow+Rect
$controlSmokePoint = New-Object ControlsSmokeWindow+Point
if (-not [ControlsSmokeWindow]::GetClientRect($controlSmokeHandle, [ref]$controlSmokeRect)) { throw 'Native client bounds were unavailable.' }
if (-not [ControlsSmokeWindow]::ClientToScreen($controlSmokeHandle, [ref]$controlSmokePoint)) { throw 'Native client position was unavailable.' }
$controlSmokeCropX = [int]$env:PHYDOG_CONTROLS_CROP_X
$controlSmokeCropY = [int]$env:PHYDOG_CONTROLS_CROP_Y
$controlSmokeCropWidth = [Math]::Min([int]$env:PHYDOG_CONTROLS_CROP_WIDTH, $controlSmokeRect.Right - $controlSmokeCropX)
$controlSmokeCropHeight = [Math]::Min([int]$env:PHYDOG_CONTROLS_CROP_HEIGHT, $controlSmokeRect.Bottom - $controlSmokeCropY)
if ($controlSmokeCropWidth -lt 1 -or $controlSmokeCropHeight -lt 1) { throw 'Native popup crop was outside the client.' }
$controlSmokeBitmap = [System.Drawing.Bitmap]::new($controlSmokeCropWidth, $controlSmokeCropHeight)
$controlSmokeGraphics = [System.Drawing.Graphics]::FromImage($controlSmokeBitmap)
try {
  $controlSmokeGraphics.CopyFromScreen(($controlSmokePoint.X + $controlSmokeCropX), ($controlSmokePoint.Y + $controlSmokeCropY), 0, 0, $controlSmokeBitmap.Size)
  $controlSmokeBitmap.Save($env:PHYDOG_CONTROLS_SCREENSHOT, [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $controlSmokeGraphics.Dispose(); $controlSmokeBitmap.Dispose() }`], { windowsHide: true, env: { ...process.env, PHYDOG_CONTROLS_PID: String(application.pid), PHYDOG_CONTROLS_SCREENSHOT: path, PHYDOG_CONTROLS_CROP_X: String(clip.x), PHYDOG_CONTROLS_CROP_Y: String(clip.y), PHYDOG_CONTROLS_CROP_WIDTH: String(clip.width), PHYDOG_CONTROLS_CROP_HEIGHT: String(clip.height) } });
}

try {
  await access(executable); await mkdir(fixtureDir, { recursive: true });
  await writeFile(fixturePath, samplePdf(8, false, true, { lines: { 1: ['Production controls smoke - synthetic PDF only'], 2: ['Ordinary scrolling and Ctrl wheel'], 8: ['Synthetic final page'] } }));
  const versionInfo = await runPowerShell('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:PHYDOG_CONTROLS_EXE).ProductVersion'], { windowsHide: true, env: { ...process.env, PHYDOG_CONTROLS_EXE: executable } });
  metrics.binaryVersion = versionInfo.stdout.trim(); assert.ok([config.version, `${config.version}.0`].includes(metrics.binaryVersion), 'The portable executable must match the newly built version.');
  application = spawn(executable, [], { cwd: dirname(executable), windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${debugPort}` } });
  let launchError; application.on('error', error => { launchError = error; });
  await until(async () => { if (launchError) throw launchError; try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); return true; } catch { return false; } }, 'Bundled native window did not start.', 30000);
  page = await until(() => browser.contexts().flatMap(context => context.pages()).find(candidate => /tauri\.localhost/.test(candidate.url())), 'Native WebView page was unavailable.');
  page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    if (/^https?:\/\/(tauri|ipc)\.localhost\//.test(route.request().url())) return route.continue();
    remoteRequests.push(route.request().url()); return route.abort();
  });
  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__) && Boolean(document.querySelector('.library-heading')));
  originalPreferences = await invoke('get_setting', { key: settingsKey });
  originalAiSettings = await page.evaluate(key => localStorage.getItem(key), aiSettingsKey); backedUp = true;
  const imported = await invoke('import_documents', { paths: [fixturePath] }); importedId = imported[0]?.id; assert.ok(importedId);
  await page.reload();
  await page.getByRole('button', { name: `打开 ${fixtureName}`, exact: true }).click(); await readyPdf();

  // Force known test values through the normal settings UI and restore the user's
  // exact saved values in finally. AI settings are never saved or credentials read.
  await openSettings(); await dialog().getByLabel('主题', { exact: true }).selectOption('dark');
  await dialog().getByRole('slider', { name: '玻璃透明度', exact: true }).evaluate(element => { element.value = '50'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  const gray = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1200; const paint = canvas.getContext('2d'); paint.fillStyle = '#5a5a5a'; paint.fillRect(0, 0, 1920, 1200); return canvas.toDataURL('image/png').split(',')[1]; });
  await writeFile(grayPath, Buffer.from(gray, 'base64'));
  await dialog().getByLabel('底板图片文件', { exact: true }).setInputFiles(grayPath);
  await dialog().getByAltText('底板图片预览', { exact: true }).waitFor();
  await until(() => dialog().getByRole('button', { name: '保存', exact: true }).isEnabled());
  await dialog().getByRole('button', { name: '阅读', exact: true }).click();
  await dialog().getByLabel('PDF 初始缩放模式', { exact: true }).selectOption('custom');
  await dialog().getByLabel('PDF 初始缩放比例', { exact: true }).fill('100'); await dialog().getByLabel('PDF 缩放步长', { exact: true }).fill('15');
  await dialog().getByRole('button', { name: '快捷键', exact: true }).click();
  await dialog().getByRole('button', { name: '恢复放大默认快捷键', exact: true }).click();
  await dialog().getByRole('button', { name: '恢复缩小默认快捷键', exact: true }).click();
  await dialog().getByRole('button', { name: '保存', exact: true }).click(); await dialog().waitFor({ state: 'detached' }); await readyPdf();
  await openSettings('AI'); await dialog().getByLabel('服务商', { exact: true }).selectOption('codex');
  const modelSelect = dialog().getByRole('combobox', { name: '模型', exact: true });
  await until(async () => (await modelSelect.isEnabled()) && /已登录.*\d+ 个模型/.test(await dialog().locator('.settings-status').textContent().catch(() => '')), 'Actual local Codex model metadata did not load.', 60000);
  const options = await modelSelect.locator('option').evaluateAll(elements => elements.map(option => ({ value: option.value, text: option.textContent.trim() })));
  const declared = Number((await dialog().locator('.settings-status').textContent()).match(/(\d+) 个模型/)[1]);
  const available = options.filter(option => option.value && !option.text.startsWith('当前设置：'));
  assert.ok(declared > 0); assert.equal(available.length, declared); assert.equal(new Set(available.map(option => option.value)).size, declared);
  metrics.models = available; metrics.modelCount = declared;
  if (available.length > 1) await modelSelect.selectOption(available.at(-1).value);
  assert.equal(await modelSelect.locator('option').count(), options.length, 'Choosing another model must not filter the complete list.');
  await menuContrast('dark');
  await modelSelect.focus(); await modelSelect.press('Alt+ArrowDown'); await page.waitForTimeout(250);
  await captureNativeClient(join(artifacts, '开智-0.2.1-原生模型下拉-深色.png'));
  await modelSelect.press('Escape');
  if (await dialog().count()) await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), aiSettingsKey), originalAiSettings);
  checks.push('The bundled native bridge reads the actual local model catalog; the complete select retains every returned model and dark native options have readable colors.');

  await readyPdf(); const initialZoom = await zoom(); const scrollTop = await pdf().evaluate(element => element.scrollTop);
  await physicalWheel(220); await until(() => pdf().evaluate(element => element.scrollTop).then(value => value > scrollTop)); assert.equal(await zoom(), initialZoom);
  await physicalWheel(-120, true); await until(() => zoom().then(value => value !== initialZoom)); await readyPdf(); const largerZoom = await zoom(); assert.ok(parseFloat(largerZoom) > parseFloat(initialZoom));
  await physicalWheel(120, true); await until(() => zoom().then(value => value !== largerZoom)); await readyPdf(); assert.equal(await zoom(), initialZoom);
  metrics.browserScale = await page.evaluate(() => visualViewport.scale); assert.equal(metrics.browserScale, 1);
  checks.push('Actual WebView2 mouse wheel scrolls normally; Ctrl + wheel changes only PDF scale and keeps browser scale at 1.');
  for (const theme of ['light', 'dark', 'light', 'dark', 'light']) await inkRoundTrip(theme);
  await openSettings('AI'); await dialog().getByLabel('服务商', { exact: true }).selectOption('codex'); await menuContrast('light');
  await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'detached' }); await readyPdf();
  await page.screenshot({ path: join(artifacts, '开智-0.2.1-原生字体往返-浅色.png'), animations: 'disabled' });
  checks.push('Gray-image glass restores local text colors after five real light/dark switches; light native menus keep their own readable surface colors.');
  // The native invocation API is immutable. Model count/status in the real UI
  // prove discovery; do not claim ineffective monkey-patched call counters.
  metrics.modelCheck = 'read-only settings metadata';
  metrics.inferenceActions = 0;
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []); passed = true;
} finally {
  if (page && !page.isClosed()) {
    if (await dialog().count()) await dialog().getByRole('button', { name: '取消', exact: true }).click().catch(() => {});
    const ownTab = page.getByRole('button', { name: `关闭 ${fixtureName} 标签`, exact: true });
    if (await ownTab.count()) await ownTab.click().catch(() => cleanupErrors.push('fixture tab close'));
    await page.waitForTimeout(500);
    if (importedId) await invoke('remove_document', { id: importedId }).catch(() => cleanupErrors.push('fixture document cleanup'));
    if (backedUp) {
      await invoke('set_setting', { key: settingsKey, value: originalPreferences || '' }).catch(() => cleanupErrors.push('preference restoration'));
      await page.evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }, { key: aiSettingsKey, value: originalAiSettings }).catch(() => cleanupErrors.push('AI metadata restoration'));
      const restored = await invoke('get_setting', { key: settingsKey }).catch(() => { cleanupErrors.push('restoration check'); return undefined; });
      if ((restored ?? '') !== (originalPreferences ?? '')) cleanupErrors.push('restored preferences differ');
    }
  } else if (backedUp || importedId) cleanupErrors.push('native window closed before restoration');
  await browser?.close().catch(() => cleanupErrors.push('CDP cleanup')); application?.kill();
  await unlink(fixturePath).catch(error => { if (error.code !== 'ENOENT') cleanupErrors.push('fixture file cleanup'); });
  await unlink(grayPath).catch(error => { if (error.code !== 'ENOENT') cleanupErrors.push('wallpaper fixture cleanup'); });
  await rmdir(fixtureDir).catch(error => { if (error.code !== 'ENOENT') cleanupErrors.push('fixture directory cleanup'); });
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, 'native-controls-smoke.json'), JSON.stringify({ passed: passed && !cleanupErrors.length, native: true, version: config.version, checks, metrics, errors, remoteRequests, cleanupErrors }, null, 2));
  if (cleanupErrors.length) throw new Error('Native control cleanup requires attention: ' + cleanupErrors.join(', '));
}
console.log(JSON.stringify({ passed, native: true, version: config.version, checks, modelCount: metrics.modelCount, browserScale: metrics.browserScale, errors, remoteRequests, cleanupErrors }, null, 2));
