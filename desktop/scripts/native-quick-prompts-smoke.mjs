// Native settings smoke only: no document opening/import, real credential calls or AI.
// Preference backup stays in memory and is restored byte for byte. Absent values stay absent.
import { chromium } from 'playwright';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

const execute = promisify(execFile), folder = resolve('artifacts');
const debugPort = Number(process.env.PHYDOG_QUICK_PROMPTS_DEBUG_PORT || 9238);
const key = 'app.preferences.v1';
const checks = [], errors = [], externalRequests = [], forbiddenCalls = [], blockedBackgroundDiscovery = [];
const cleanup = {}, skipped = [];
const defaults = [
  { label: '梳理核心观点', question: '概括当前内容的核心观点，并说明它与整篇文档的关系。' },
  { label: '解释概念与公式', question: '解释当前页中的关键概念与公式。' },
  { label: '查找假设与局限', question: '找出文档中的主要假设、适用条件与局限。' },
];
const custom = ['一', '二', '三'].map((suffix, index) => ({
  label: `本机测试${suffix}`, question: `LOCAL_QUICK_PROMPT_${index + 1}\n仅验证设置保存，不发送请求。`,
}));
let browser, page, application, oldPreferences, backedUp = false, wrotePreferences = false, passed = false;
let failure;
const delay = ms => new Promise(done => setTimeout(done, ms));
async function until(condition, name, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (await condition()) return; await delay(70); }
  throw new Error(`${name} timed out.`);
}
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const dialog = () => page.getByRole('dialog', { name: '设置', exact: true });
const label = index => dialog().getByRole('textbox', { name: `快捷提问 ${index} 按钮介绍`, exact: true });
const question = index => dialog().getByRole('textbox', { name: `快捷提问 ${index} 提示词`, exact: true });
async function openPrompts() {
  await page.getByRole('button', { name: '打开设置', exact: true }).click(); await dialog().waitFor();
  await dialog().getByRole('button', { name: 'AI', exact: true }).click(); await label(1).waitFor();
}
async function cancel() { await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'detached' }); }
async function save() {
  assert.equal(typeof oldPreferences, 'string', 'Do not save when original preferences are absent');
  wrotePreferences = true;
  await dialog().getByRole('button', { name: '保存', exact: true }).click(); await dialog().waitFor({ state: 'detached' });
}
async function fieldsEqual(expected) {
  for (const [index, prompt] of expected.entries()) {
    assert.equal(await label(index + 1).inputValue(), prompt.label);
    assert.equal(await question(index + 1).inputValue(), prompt.question);
  }
}
async function storedPrompts() { return JSON.parse(await invoke('get_setting', { key })).assistant.quickPrompts; }

try {
  await mkdir(folder, { recursive: true });
  const processes = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "ConvertTo-Json -Compress -InputObject @(Get-Process -Name '开智' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })"], { windowsHide: true });
  assert.deepEqual(JSON.parse(processes.stdout.trim() || '[]'), [], 'Close existing app before shared preference checks');
  let occupied = false;
  try { occupied = (await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(600) })).ok; } catch { }
  assert.equal(occupied, false, 'Refuse to attach to an existing process');
  const executable = resolve('release', '开智-portable', '开智.exe');
  application = spawn(executable, [], { cwd: dirname(executable), windowsHide: true, stdio: 'ignore', env: {
    ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${debugPort}`,
  } });
  await until(async () => {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); return true; }
    catch { if (application.exitCode !== null) throw new Error('Owned application exited early'); return false; }
  }, 'Native debugging endpoint', 25000);
  await until(() => { page = browser.contexts().flatMap(context => context.pages()).find(candidate => /tauri\.localhost/.test(candidate.url())); return !!page; }, 'Native page');
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && !!document.querySelector('.library-heading'));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost|tauri\.localhost|ipc\.localhost)(:|\/)/.test(url)) {
      externalRequests.push(url); return route.abort();
    }
    return route.continue();
  });
  await page.evaluate(() => {
    window.__quickPromptForbiddenCalls = [];
    window.__quickPromptBlockedDiscovery = [];
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = function(command, ...args) {
      // The AI category mounts its service form. Stub secret loading and stop
      // automatic discovery while leaving real settings storage under test.
      if (command === 'get_credential') return Promise.resolve('');
      if (/^native_/.test(command)) {
        window.__quickPromptBlockedDiscovery.push(command);
        return Promise.reject(new Error('Native discovery disabled in quick-prompts settings smoke'));
      }
      if (/^(set_credential|http_|read_document|import_documents)/.test(command)) {
        window.__quickPromptForbiddenCalls.push(command);
        return Promise.reject(new Error('Native settings smoke prohibits document, credential or AI operations'));
      }
      return original.call(this, command, ...args);
    };
  });
  oldPreferences = await invoke('get_setting', { key }); backedUp = true;
  const aiMetadataBefore = await page.evaluate(() => localStorage.getItem('paperdesk.ai.settings.v1'));
  assert.ok(oldPreferences === null || typeof oldPreferences === 'string', 'Preference value is nullable string');
  await openPrompts();
  assert.equal(await dialog().locator('.quick-prompt-editor:not(.capture-question-editor)').count(), 3);
  assert.equal(await dialog().getByLabel('PDF 框选后显示快捷提问', { exact: true }).count(), 1);
  for (let index = 1; index <= 3; index++) {
    assert.equal(await label(index).count(), 1); assert.equal(await question(index).count(), 1);
    assert.ok((await label(index).inputValue()).trim()); assert.ok((await question(index).inputValue()).trim());
  }
  assert.equal(await page.getByRole('textbox', { name: '向 AI 提问', exact: true }).count(), 0);
  assert.equal(await dialog().locator('.settings-tabs').getByRole('button', { name: '快捷提问', exact: true }).count(), 0);
  checks.push('Native AI settings contain three quick-prompt editors and no separate quick-prompts category');

  if (oldPreferences === null) {
    await cancel();
    assert.equal(await invoke('get_setting', { key }), null);
    skipped.push('Save/cancel/limit/restore edit cases skipped because an absent preference cannot be deleted through the current native API');
  } else {
    await dialog().getByLabel('PDF 框选后显示快捷提问', { exact: true }).check();
    for (const [index, prompt] of custom.entries()) { await label(index + 1).fill(prompt.label); await question(index + 1).fill(prompt.question); }
    await save(); assert.deepEqual(await storedPrompts(), custom);
    await openPrompts(); await fieldsEqual(custom);
    assert.equal(await dialog().getByLabel('PDF 框选后显示快捷提问', { exact: true }).isChecked(), true);
    assert.equal(JSON.parse(await invoke('get_setting', { key })).pdf.quickAskOnCapture, true);
    checks.push('The optional capture mode and three prompt labels/questions save through native storage and persist when settings reopen');

    const saved = await invoke('get_setting', { key });
    await dialog().getByLabel('PDF 框选后显示快捷提问', { exact: true }).uncheck();
    await label(1).fill('取消修改'); await question(2).fill('THIS_EDIT_MUST_NOT_PERSIST'); await cancel();
    assert.equal(await invoke('get_setting', { key }), saved);
    await openPrompts(); await fieldsEqual(custom);
    checks.push('Cancel leaves the exact stored preference unchanged and reopening retains saved prompts');

    const chinese = '甲乙丙丁戊己庚辛壬癸子丑寅', family = '👩‍👩‍👧‍👦';
    await label(1).fill(chinese); assert.equal(await label(1).inputValue(), chinese.slice(0, 12));
    await label(2).fill(family.repeat(13)); assert.equal(await label(2).inputValue(), family.repeat(12));
    const limited = [ { ...custom[0], label: chinese.slice(0, 12) }, { ...custom[1], label: family.repeat(12) }, custom[2] ];
    await save(); assert.deepEqual(await storedPrompts(), limited);
    await openPrompts(); await fieldsEqual(limited);
    assert.equal(await dialog().locator('#quick-prompt-count-0').innerText(), '12 / 12');
    assert.equal(await dialog().locator('#quick-prompt-count-1').innerText(), '12 / 12');
    checks.push('Pasted Chinese and joined-family emoji labels stop at 12 graphemes and persist without splitting emoji');

    await dialog().getByRole('button', { name: '恢复快捷提问 1 默认', exact: true }).click();
    assert.equal(await label(1).inputValue(), defaults[0].label); assert.equal(await question(1).inputValue(), defaults[0].question);
    assert.equal(await label(2).inputValue(), limited[1].label);
    await dialog().getByRole('button', { name: '恢复全部快捷提问默认', exact: true }).click();
    await fieldsEqual(defaults); await save(); assert.deepEqual(await storedPrompts(), defaults);
    await openPrompts(); await fieldsEqual(defaults); await cancel();
    checks.push('Individual restore affects only its own button; category restore saves all three original defaults');
  }
  forbiddenCalls.push(...await page.evaluate(() => window.__quickPromptForbiddenCalls));
  blockedBackgroundDiscovery.push(...await page.evaluate(() => window.__quickPromptBlockedDiscovery));
  assert.equal(await page.evaluate(() => localStorage.getItem('paperdesk.ai.settings.v1')), aiMetadataBefore, 'Quick prompt edits must not rewrite AI service configuration');
  cleanup.aiServiceConfigurationUnchanged = true;
  assert.deepEqual(forbiddenCalls, []); assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []);
  passed = true;
} catch (error) { failure = error; errors.push(error.message); }
finally {
  if (backedUp && page && !page.isClosed()) {
    try {
      if (await dialog().count()) await cancel();
      if (wrotePreferences) await invoke('set_setting', { key, value: oldPreferences });
      cleanup.preferencesRestoredExact = (await invoke('get_setting', { key })) === oldPreferences;
      cleanup.absencePreserved = oldPreferences !== null || cleanup.preferencesRestoredExact;
      assert.equal(cleanup.preferencesRestoredExact, true, 'Restore the original preference string or absence exactly');
    } catch (error) { errors.push(`Preference cleanup failed: ${error.message}`); }
  }
  await browser?.close(); application?.kill();
  if (application) {
    try {
      await until(() => application.exitCode !== null || application.signalCode !== null, 'Owned process exit');
      const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `if (Get-Process -Id ${application.pid} -ErrorAction SilentlyContinue) { 'running' } else { 'closed' }`], { windowsHide: true });
      cleanup.ownedProcessClosed = result.stdout.trim() === 'closed';
      assert.equal(cleanup.ownedProcessClosed, true);
    } catch (error) { errors.push(`Process cleanup failed: ${error.message}`); }
  }
  const report = { passed: passed && errors.length === 0, checks, skipped, errors, externalRequests, forbiddenCalls, blockedBackgroundDiscovery, cleanup };
  await mkdir(folder, { recursive: true }); await writeFile(resolve(folder, 'native-quick-prompts-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
