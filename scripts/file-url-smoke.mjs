// Local URL regression: real Edge, exact extension permissions, no AI requests.
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { samplePdf } from '../tests/fixtures/pdf.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtime = join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(process.env.PDF_COPILOT_PLAYWRIGHT_PATH || join(runtime, 'playwright'));
const lite = process.env.PDF_COPILOT_MATH_PROFILE === 'plain';
const fixture = join(root, '.cache', 'file-url-extension' + (lite ? '-lite' : ''));
await mkdir(fixture, { recursive: true }); await cp(join(root, 'dist', lite ? 'extension-lite' : 'extension'), fixture, { recursive: true });
const sample = join(root, '.cache', 'local sample # 中文.pdf');
await writeFile(sample, samplePdf(6, true));
const checks = [], errors = [], details = {};
let context;
try {
  context = await chromium.launchPersistentContext(join(root, '.cache', 'edge-file-url-' + Date.now()), {
    executablePath: process.env.PDF_COPILOT_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
    viewport: { width: 1100, height: 800 }, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + fixture, '--load-extension=' + fixture, '--no-first-run'],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2], base = 'chrome-extension://' + id;
  const reader = await context.newPage();
  await reader.goto(base + '/reader/index.html?url=' + encodeURIComponent(pathToFileURL(sample).href));
  details.before = await reader.evaluate(async () => ({ allowed: await chrome.extension.isAllowedFileSchemeAccess(), fileHost: await chrome.permissions.contains({ origins: ['file:///*'] }) }));
  console.log('Local URL permissions before open:', JSON.stringify(details.before));
  await reader.locator('#open-url').click();
  await reader.waitForFunction(() => /无法打开|文件网址|权限|第 1 \/|本地 PDF/.test(document.querySelector('#status').textContent), undefined, { timeout: 30000 });
  details.status = await reader.locator('#status').textContent();
  details.after = await reader.evaluate(async () => ({ allowed: await chrome.extension.isAllowedFileSchemeAccess(), fileHost: await chrome.permissions.contains({ origins: ['file:///*'] }) }));
  console.log('Local URL status:', details.status); console.log('Permissions after open:', JSON.stringify(details.after));
  if (process.argv.includes('--diagnose')) returnDiagnostic();
  else {
    const ready = async page => page.waitForFunction(() => document.querySelector('#page-count').textContent !== '/ 0' && document.querySelector('#page-surface')?.classList.contains('page-ready'), undefined, { timeout: 30000 });
    const openUrl = async href => {
      const page = await context.newPage(); await page.goto(base + '/reader/index.html?url=' + encodeURIComponent(href));
      await page.locator('#open-url').click(); return page;
    };
    await ready(reader);
    checks.push('file URL with spaces, encoded hash and Chinese opens without broad host permissions');
    assert.equal(details.after.fileHost, true);
    const reopened = await openUrl(pathToFileURL(sample).href + '#page=2'); await ready(reopened);
    checks.push('existing file grant and native-PDF page fragment open on a new reader');
    const missing = await openUrl(pathToFileURL(join(root, '.cache', 'missing-local-pdf.pdf')).href);
    await missing.waitForFunction(() => document.querySelector('#status').textContent.includes('无法读取本地 PDF'));
    const failedStatus = await missing.locator('#status').textContent(); assert(!failedStatus.includes('远程')); assert(failedStatus.includes('文件仍存在'));
    checks.push('missing local URL gets a local-file error and recovery guidance');
    await worker.evaluate(() => chrome.permissions.remove({ origins: ['file:///*'] }));
    const picker = await context.newPage(); await picker.goto(base + '/reader/index.html');
    await picker.locator('#file-input').setInputFiles(sample); await ready(picker);
    assert.equal(await picker.evaluate(() => chrome.permissions.contains({ origins: ['file:///*'] })), false);
    checks.push('file picker remains usable without local URL host access');
    if (process.env.PDF_COPILOT_LOCAL_PDF_PATH) {
      const real = await openUrl(pathToFileURL(process.env.PDF_COPILOT_LOCAL_PDF_PATH).href); await ready(real);
      details.realPages = await real.locator('#page-count').textContent();
      await real.locator('#page-number').fill('10'); await real.locator('#page-number').press('Enter');
      await real.waitForFunction(() => document.querySelector('#page-surface')?.dataset.page === '10' && document.querySelector('#page-surface')?.classList.contains('page-ready'));
      checks.push('user-specified local PDF URL renders first page and page 10 without AI or image export');
    }
    assert.deepEqual(errors, []); for (const check of checks) console.log('PASS ' + check);
  }
  function returnDiagnostic() { checks.push('baseline diagnosed'); }
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', 'file-url-results' + (lite ? '-lite' : '') + '.json'), JSON.stringify({ checks, errors, details }, null, 2));
  await context?.close();
}
