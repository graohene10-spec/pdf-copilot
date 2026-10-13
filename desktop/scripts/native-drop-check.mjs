// Exercise the packaged Windows WebView's real Tauri event bridge and SQLite
// import path. This is runtime event simulation, not an Explorer mouse drag.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, copyFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const executable = resolve(root, 'release/开智-portable/开智.exe');
const output = resolve(root, 'artifacts/native-drop-check.json');
const fixtureDirectory = resolve(root, 'artifacts', `native-drop-${randomUUID()}`);
const names = ['拖入检查 PDF.pdf', '拖入检查 Markdown.md', '忽略的文件.txt'];
const paths = names.map(name => resolve(fixtureDirectory, name));
const canonicalPath = value => value.replace(/^\\\\\?\\/, '').replaceAll('/', '\\').toLowerCase();
const ownPaths = new Set(paths.map(canonicalPath));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => `'${value.replaceAll("'", "''")}'`;
const run = promisify(execFile);
const powershell = source => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 });
const checks = [], errors = [], pageErrors = [];
let pid, browser, page, originalPreferences, preferencesRead = false, beforeIds = [], importedIds = [];

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const emit = (name, paths = []) => invoke('plugin:event|emit_to', {
  target: { kind: 'Any', label: 'main' }, event: `tauri://drag-${name}`,
  payload: { paths, position: { x: 400, y: 300 } },
});
const ownDocuments = async () => (await invoke('list_documents', { query: '' })).filter(document => ownPaths.has(canonicalPath(document.path)));

try {
  await mkdir(fixtureDirectory);
  await copyFile(resolve(root, 'release/开智-portable/samples/sample.pdf'), paths[0]);
  await writeFile(paths[1], '# 本机拖入验证\n\n这份临时 Markdown 仅用于验证文档拖入。\n', 'utf8');
  await writeFile(paths[2], 'This unsupported fixture must not be imported.', 'utf8');
  const port = await freePort();
  const launch = await powershell(`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}'; $application = Start-Process -FilePath ${quote(executable)} -WorkingDirectory ${quote(dirname(executable))} -WindowStyle Hidden -PassThru; $application.Id`);
  pid = Number(launch.stdout.trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'The test must own the newly launched process.');
  for (let attempt = 0; attempt < 100; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await delay(250); }
  }
  assert.ok(browser, 'The packaged application WebView must expose the test-only CDP endpoint.');
  for (let attempt = 0; attempt < 100; attempt++) {
    page = browser.contexts().flatMap(context => context.pages()).find(page => /tauri\.localhost/.test(page.url()));
    if (page) break;
    await delay(100);
  }
  assert.ok(page, 'The native main window must be available.');
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForFunction(() => window.__TAURI_INTERNALS__ && document.querySelector('.library-heading'));
  originalPreferences = await invoke('get_setting', { key: 'app.preferences.v1' });
  preferencesRead = true;
  beforeIds = (await invoke('list_documents', { query: '' })).map(document => document.id);
  await emit('enter', [paths[0], paths[1]]);
  await page.locator('.file-drop-overlay').waitFor();
  await emit('leave');
  await page.locator('.file-drop-overlay').waitFor({ state: 'detached' });
  await emit('enter', [paths[2]]);
  assert.equal(await page.locator('.file-drop-overlay').count(), 0, 'Unsupported files do not show the import target.');
  await emit('leave');
  checks.push('Actual Tauri enter/leave events show and dismiss the drop target; unsupported files leave it hidden.');

  await emit('enter', [paths[0], paths[1]]);
  await page.locator('.file-drop-overlay').waitFor();
  await emit('drop', [paths[0], paths[1], paths[0], paths[2]]);
  await page.locator('.file-drop-overlay').waitFor({ state: 'detached' });
  await page.getByRole('tab', { name: names[0], exact: true }).waitFor();
  await page.getByRole('tab', { name: names[1], exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#page-surface')?.classList.contains('page-ready'));
  const documents = await ownDocuments();
  importedIds = documents.map(document => document.id);
  assert.equal(documents.length, 2, 'Only the two supported files are imported.');
  assert.ok(importedIds.every(id => !beforeIds.includes(id)), 'Cleanup IDs must belong only to these unique temporary paths.');
  await page.locator('.toast-message').filter({ hasText: '已加入 2 份文档' }).waitFor();
  assert.deepEqual(documents.map(document => document.kind).sort(), ['markdown', 'pdf']);
  checks.push('Actual Tauri drop events invoke native import_documents and SQLite; mixed paths are filtered and deduplicated before IPC.');

  await emit('drop', [paths[1], paths[0]]);
  await page.getByRole('tab', { name: names[1], exact: true }).click();
  await page.locator('.markdown-paper').waitFor();
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  assert.equal(await page.getByRole('tab', { name: names[0], exact: true }).count(), 1);
  assert.equal(await page.getByRole('tab', { name: names[1], exact: true }).count(), 1);
  const repeated = await ownDocuments();
  assert.deepEqual(repeated.map(document => document.id).sort(), [...importedIds].sort(), 'Repeating a native drop preserves the same library IDs.');
  checks.push('Repeated drops preserve library IDs and one tab per file.');

  const activeRevision = '活动标签重新拖入后，应立即显示这一份新内容。';
  const activeContent = `# 活动文件修改检查\n\n${activeRevision}\n`;
  await writeFile(paths[1], activeContent, 'utf8');
  await emit('drop', [paths[1]]);
  await page.locator('.markdown-paper').getByText(activeRevision, { exact: true }).waitFor();
  const activeDocument = (await ownDocuments()).find(document => document.kind === 'markdown');
  assert.equal(activeDocument.id, documents.find(document => document.kind === 'markdown').id, 'An updated active file preserves the library ID.');
  assert.equal(activeDocument.size, Buffer.byteLength(activeContent), 'Native metadata reflects the updated active file.');
  assert.equal(await page.getByRole('tab', { name: names[1], exact: true }).count(), 1, 'Active-file reimport reuses its existing tab.');
  checks.push('Editing and re-dropping the active Markdown path refreshes its displayed content while preserving the same document ID and tab.');

  await page.getByRole('tab', { name: names[0], exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#page-surface')?.classList.contains('page-ready'));
  const inactiveRevision = '非活动缓存中的文件修改后再次拖入，也必须读取新内容，不能复用旧文档。';
  const inactiveContent = `# 非活动缓存修改检查\n\n${inactiveRevision}\n`;
  await writeFile(paths[1], inactiveContent, 'utf8');
  await emit('drop', [paths[1]]);
  await page.locator('.markdown-paper').getByText(inactiveRevision, { exact: true }).waitFor();
  const refreshed = await ownDocuments();
  assert.deepEqual(refreshed.map(document => document.id).sort(), [...importedIds].sort(), 'Invalidating stale cached content must preserve the two library IDs.');
  assert.equal(refreshed.find(document => document.kind === 'markdown').size, Buffer.byteLength(inactiveContent), 'Native metadata reflects the updated inactive file.');
  assert.equal(await page.getByRole('tab', { name: names[1], exact: true }).count(), 1);
  checks.push('Editing and re-dropping the inactive cached Markdown path invalidates its old reader and displays the new content without duplicate library records.');

  await emit('enter', [paths[0]]);
  await page.locator('.file-drop-overlay').waitFor();
  await emit('leave');
  await page.locator('.file-drop-overlay').waitFor({ state: 'detached' });
  checks.push('The drop hint clears after leaving while reading.');
  assert.equal(await invoke('get_setting', { key: 'app.preferences.v1' }), originalPreferences, 'The test must not change the user preferences.');
  assert.deepEqual(pageErrors, []);
} catch (error) {
  errors.push(String(error?.stack || error));
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(root, 'artifacts/native-drop-failure.png'), animations: 'disabled' }).catch(() => {});
} finally {
  if (page && !page.isClosed()) {
    for (const name of names.slice(0, 2)) {
      const close = page.getByRole('button', { name: `关闭 ${name} 标签`, exact: true });
      if (await close.count()) await close.click().catch(error => errors.push(`Close fixture tab: ${error}`));
    }
    await delay(700);
    // Discover successful partial imports on failure too, using only this run's
    // exact unique paths. Existing user document IDs are never removed.
    const remaining = await ownDocuments().catch(() => []);
    for (const document of remaining) {
      if (beforeIds.includes(document.id)) { errors.push('Refused to remove a pre-existing document ID.'); continue; }
      await invoke('remove_document', { id: document.id }).catch(error => errors.push(`Remove fixture: ${error}`));
    }
    if (preferencesRead && await invoke('get_setting', { key: 'app.preferences.v1' }).catch(() => originalPreferences) !== originalPreferences) {
      errors.push('Preferences changed during this read-only settings test; no external concurrent change was overwritten.');
    }
  }
  await browser?.close().catch(() => {});
  if (pid) await powershell(`$application = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($application -and $application.Path -eq ${quote(executable)}) { Stop-Process -Id ${pid} -Force }`).catch(error => errors.push(`Close owned application: ${error}`));
  for (const path of paths) await unlink(path).catch(() => {});
  await rmdir(fixtureDirectory).catch(error => errors.push(`Clean fixture folder: ${error}`));
  const result = { passed: errors.length === 0, native: true, physicalExplorerDrag: false, checks, pageErrors, errors, importedFiles: importedIds.length, preferencesUnchanged: preferencesRead && !errors.some(error => /preferences/i.test(error)) };
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
if (errors.length) process.exitCode = 1;
