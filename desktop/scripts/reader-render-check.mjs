// Observe real painted frames, including deliberately slow PDF.js redraws.
// All files are synthetic; browser state is isolated and model calls are blocked.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseline = process.argv.includes('--baseline');
const layoutBaseline = process.argv.includes('--layout-baseline');
const native = !!process.env.PHYDOG_RENDER_NATIVE;
const timing = process.argv.includes('--timing');
const timingSample = timing && process.argv.includes('--sample');
const slow = !timing || process.argv.includes('--slow');
const artifacts = resolve('artifacts');
const checks = [], errors = [];
let server, browser, context, page, application, nativeId, nativePath;
let passed = false;
const prefix = timing ? `reader-timing-${timingSample ? 'sample' : 'synthetic'}-${slow ? 'slow' : 'real'}-${process.argv.includes('--before') ? 'before' : 'after'}` : native ? (layoutBaseline ? 'native-reader-layout-baseline' : 'native-reader-render') : layoutBaseline ? 'reader-layout-baseline' : baseline ? 'reader-render-baseline' : 'reader-render';
function fixture() {
  const widths = [500, 900, 500, 500, 500];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${widths.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${widths.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [index, width] of widths.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 700] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R${index === 0 ? ` /Annots [${widths.length * 2 + 4} 0 R]` : ''} >>`);
    const text = `0.8 0.88 0.94 rg 0 0 ${width} 700 re f\n0 0 0 rg BT /F1 22 Tf 40 620 Td (Document rendering test ${index + 1}) Tj ET\n1 0 0 rg 40 160 160 100 re f\n`;
    objects.push(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`);
  }
  objects.push('<< /Type /Annot /Subtype /Link /Rect [40 590 350 650] /Border [0 0 0] /Dest [6 0 R /Fit] >>');
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
async function waitReady() {
  await page.waitForFunction(() => {
    const slot = document.querySelector('#page-surface');
    return slot?.classList.contains('page-ready') && !slot.classList.contains('pdf-preview') && slot.querySelector('.pdf-canvas')?.width > 0 &&
      !document.querySelector('.sidebar-enter-active,.sidebar-leave-active,.pane-enter-active,.pane-leave-active,.view-enter-active') &&
      !document.querySelector('.pdf-scroll')?.style.width;
  });
  await page.waitForTimeout(250);
}
async function monitor(action, milliseconds = 1100) {
  await page.evaluate(() => {
    const tracked = [...document.querySelectorAll('.page-slot.page-ready')].map(slot => Number(slot.dataset.page));
    const result = { frames: 0, missing: 0, black: 0, white: 0, previews: 0, maxPixels: 0, tracked, sizes: [], geometry: [] };
    const started = performance.now();
    result.started = started;
    window.__renderFrames = result;
    const generation = window.__renderGeneration = (window.__renderGeneration || 0) + 1;
    const observe = () => {
      if (window.__renderGeneration !== generation) return;
      result.frames++;
      if (document.querySelector('.sidebar-enter-active,.sidebar-leave-active,.pane-enter-active,.pane-leave-active')) {
        result.firstMoving ??= Math.round(performance.now() - started);
        result.lastMoving = Math.round(performance.now() - started);
      }
      const active = document.querySelector('#page-surface');
      if (active) {
        const bounds = active.getBoundingClientRect(), width = bounds.width;
        const previous = result.geometry.at(-1);
        if (!previous || ['left', 'top', 'width', 'height'].some(key => Math.abs(previous[key] - bounds[key]) > .5)) result.geometry.push({
          left: bounds.left, top: bounds.top, width, height: bounds.height,
          page: Number(active.dataset.page), time: Math.round(performance.now() - started),
          moving: !!document.querySelector('.sidebar-enter-active,.sidebar-leave-active,.pane-enter-active,.pane-leave-active'),
          preview: active.classList.contains('pdf-preview'),
        });
        if (!result.sizes.length || Math.abs(result.sizes.at(-1).width - width) > .5) result.sizes.push({
          width, page: Number(active.dataset.page), scale: Number(active.style.getPropertyValue('--scale-factor')),
          time: Math.round(performance.now() - started), moving: !!document.querySelector('.sidebar-enter-active,.sidebar-leave-active,.pane-enter-active,.pane-leave-active'),
          preview: active.classList.contains('pdf-preview'),
          available: document.querySelector('.pdf-scroll').clientWidth,
        });
      }
      result.maxPixels = Math.max(result.maxPixels, window.__canvasPeakPixels || 0);
      for (const number of tracked) {
        const slot = document.querySelector(`.page-slot[data-page="${number}"]`);
        const canvas = slot?.querySelector('.pdf-canvas');
        if (!canvas || canvas.hidden || canvas.width < 1 || canvas.height < 1 || getComputedStyle(canvas).visibility === 'hidden') { result.missing++; continue; }
        const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width * .75), Math.floor(canvas.height * .3), 1, 1).data;
        if (pixel[0] < 10 && pixel[1] < 10 && pixel[2] < 10) result.black++;
        if (pixel[0] > 249 && pixel[1] > 249 && pixel[2] > 249) result.white++;
        if (slot.classList.contains('pdf-preview')) result.previews++;
      }
      requestAnimationFrame(observe);
    }; requestAnimationFrame(observe);
  });
  await action();
  await page.waitForTimeout(milliseconds);
  const result = await page.evaluate(() => {
    window.__renderGeneration++;
    const result = window.__renderFrames;
    result.rasters = (window.__renderRasters || []).filter(record => record.start >= result.started).map(record => ({
      page: record.page, scale: record.scale, start: Math.round(record.start - result.started),
      end: record.end === undefined ? null : Math.round(record.end - result.started),
      duration: record.end === undefined ? null : Math.round(record.end - record.start),
    }));
    result.buffers = (window.__renderBuffers || []).filter(record => record.start >= result.started).map(record => ({
      page: record.page, scale: record.scale, start: Math.round(record.start - result.started),
      ready: record.ready === undefined ? null : Math.round(record.ready - result.started),
      commit: record.commit === undefined ? null : Math.round(record.commit - result.started),
    }));
    delete result.started;
    return result;
  });
  assert.ok(result.frames > 10, 'Frame observation must cover actual display frames');
  return result;
}
function assertContinuous(result, label) {
  assert.equal(result.missing, 0, `${label}: a previously painted page disappeared`);
  assert.equal(result.black, 0, `${label}: an unpainted black canvas was displayed`);
  assert.equal(result.white, 0, `${label}: a page lost its synthetic colored background`);
  assert.ok(result.maxPixels <= 16_000_000, `${label}: backing buffers exceeded the 16M pixel budget`);
}
function assertAtomicFit(result, label) {
  assertContinuous(result, label);
  assert.equal(result.sizes.length, 2, `${label}: fit must have one visible size change`);
  assert.equal(result.sizes[1].moving, false, `${label}: fit committed during a panel transition`);
  assert.equal(result.sizes[1].preview, false, `${label}: size changed before the new bitmap was ready`);
  assert.equal(result.geometry.length, 2, `${label}: the old page moved before the single fitted-frame commit: ${JSON.stringify(result.geometry)}`);
  assert.equal(result.geometry[1].preview, false, `${label}: screen bounds changed before the new bitmap was ready`);
}
async function settingsZoom(value) {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '阅读', exact: true }).click();
  await dialog.getByLabel('PDF 初始缩放模式', { exact: true }).selectOption('custom');
  await dialog.getByLabel('PDF 初始缩放比例', { exact: true }).fill(String(value));
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await waitReady();
}
try {
  await mkdir(artifacts, { recursive: true });
  if (native) {
    const { spawn } = await import('node:child_process');
    const { readFile } = await import('node:fs/promises');
    const { productName } = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
    const executable = resolve('release', `${productName}-portable`, `${productName}.exe`);
    application = spawn(executable, [], { cwd: resolve(executable, '..'), windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-address=127.0.0.1 --remote-debugging-port=9230' } });
    for (let count = 0; count < 100; count++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9230'); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    assert.ok(browser);
    // CDP becomes available before WebView2 finishes creating the app page.
    for (let count = 0; count < 100; count++) {
      page = browser.contexts().flatMap(context => context.pages()).find(page => /^(http:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(page.url()));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(page);
    await page.waitForFunction(() => !!window.__TAURI_INTERNALS__ && !!document.querySelector('.library-heading'));
    nativePath = resolve(artifacts, 'render-synthetic-native.pdf');
    await writeFile(nativePath, fixture());
    nativeId = (await page.evaluate(path => window.__TAURI_INTERNALS__.invoke('import_documents', { paths: [path] }), nativePath))[0].id;
    await page.reload();
  } else {
    server = await createServer({ server: { host: '127.0.0.1', port: 1459, strictPort: true } }); await server.listen();
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    context = await browser.newContext({ viewport: { width: 1400, height: 980 }, deviceScaleFactor: 2 });
    page = await context.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, route => route.abort());
  }
  // Count detached staging buffers too, with no production instrumentation.
  await page.addInitScript(() => {
    const canvases = new Set(), create = document.createElement.bind(document);
    document.createElement = function(name, ...args) { const element = create(name, ...args); if (String(name).toLowerCase() === 'canvas') canvases.add(element); return element; };
    for (const key of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key);
      Object.defineProperty(HTMLCanvasElement.prototype, key, { ...descriptor, set(value) {
        descriptor.set.call(this, value);
        const pixels = [...canvases].filter(canvas => canvas.classList.contains('pdf-canvas')).reduce((sum, canvas) => sum + canvas.width * canvas.height, 0);
        window.__canvasPeakPixels = Math.max(window.__canvasPeakPixels || 0, pixels);
      } });
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  if (native) {
    await page.reload();
    await page.getByRole('button', { name: '打开 render-synthetic-native.pdf', exact: true }).click();
  } else {
    await page.goto('http://127.0.0.1:1459');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '加入文档', exact: true }).click();
    await (await chooser).setFiles({ name: timingSample ? 'sample.pdf' : '渲染连续性验证.pdf', mimeType: 'application/pdf', buffer: timingSample ? await readFile('public/samples/sample.pdf') : fixture() });
  }
  await waitReady();
  await page.getByTitle('适应宽度', { exact: true }).click(); await waitReady();
  // Delay real render continuations so a blank-frame gap cannot hide between snapshots.
  await page.evaluate(async slow => {
    // Use the existing reader reference in both development and production;
    // Vue's development-only DOM component marker is absent from packaged apps.
    window.__renderPdf = () => document.querySelector('#app')._vnode.component.refs.reader.getPdf();
    const pdf = window.__renderPdf();
    const prototype = Object.getPrototypeOf(await pdf.getPage(1)), original = prototype.render;
    window.__pdfRenderCount = 0; window.__renderRasters = []; window.__renderBuffers = [];
    prototype.render = function(options) {
      window.__pdfRenderCount++;
      const record = { page: this.pageNumber, scale: options.viewport.scale, start: performance.now() };
      window.__renderRasters.push(record);
      const task = original.call(this, options);
      task.promise.then(() => { record.end = performance.now(); }, () => {});
      if (slow) task.onContinue = continueRender => setTimeout(continueRender, 120);
      return task;
    };
    if (!window.__TAURI_INTERNALS__) {
      const { ContinuousPdfViewer } = await import('/src/reader/continuous.mjs');
      const original = ContinuousPdfViewer.prototype.paintBuffered;
      ContinuousPdfViewer.prototype.paintBuffered = function(...args) {
        const record = { page: args[0].number, scale: args[2], start: performance.now() };
        window.__renderBuffers.push(record);
        const beforeCommit = args[4], waitBeforeCommit = args[5];
        args[4] = () => { record.ready ??= performance.now(); const committed = beforeCommit ? beforeCommit() : true; if (committed) record.commit = performance.now(); return committed; };
        args[5] = signal => { record.ready = performance.now(); return waitBeforeCommit?.(signal); };
        return original.apply(this, args);
      };
    }
  }, slow);
  const open = await monitor(() => page.getByRole('button', { name: '切换侧栏', exact: true }).click(), 1400);
  checks.push({ test: slow ? 'fit-mode sidebar close with artificial 120ms render continuations' : 'fit-mode sidebar close with unmodified raster rendering', ...open });
  if (timing) {
    if (!timingSample) assertAtomicFit(open, 'sidebar close timing');
    else assert.equal(open.geometry.length, 2);
    await waitReady();
    const opening = await monitor(() => page.getByRole('button', { name: '切换侧栏', exact: true }).click(), 1400);
    if (!timingSample) assertAtomicFit(opening, 'sidebar open timing');
    else assert.equal(opening.geometry.length, 2);
    checks.push({ test: 'fit-mode sidebar open timing', ...opening });
    assert.deepEqual(errors, []);
  } else if (layoutBaseline) {
    await page.screenshot({ path: resolve(artifacts, `${prefix}.png`) });
  } else if (baseline) {
    assert.ok(open.missing + open.black + open.white > 0, 'Baseline should reproduce the reported flicker');
    await page.screenshot({ path: resolve(artifacts, `${prefix}.png`) });
  } else {
    assertAtomicFit(open, 'sidebar close'); await waitReady();
    const closed = await monitor(() => page.getByRole('button', { name: '切换侧栏', exact: true }).click(), 1400);
    assertAtomicFit(closed, 'sidebar open'); checks.push({ test: 'sidebar open', ...closed }); await waitReady();
    const ai = await monitor(() => page.getByRole('button', { name: '阅读助手', exact: true }).click(), 1700);
    assertAtomicFit(ai, 'AI first open'); checks.push({ test: 'AI first open', ...ai }); await waitReady();
    await page.getByRole('button', { name: '关闭阅读助手', exact: true }).click(); await waitReady();
    const outlineOpen = await monitor(() => page.getByTitle('文档目录', { exact: true }).click(), 1400);
    assertAtomicFit(outlineOpen, 'document outline open'); checks.push({ test: 'document outline open preserves screen bounds until fitted frame', ...outlineOpen }); await waitReady();
    const outlineClose = await monitor(() => page.getByTitle('文档目录', { exact: true }).click(), 1400);
    assertAtomicFit(outlineClose, 'document outline close'); checks.push({ test: 'document outline close preserves screen bounds until fitted frame', ...outlineClose }); await waitReady();
    const rapid = await monitor(async () => {
      for (let count = 0; count < 8; count++) { await page.getByRole('button', { name: '切换侧栏', exact: true }).click(); await page.waitForTimeout(165); }
    }, 1500);
    assertContinuous(rapid, 'rapid toggles'); checks.push({ test: 'rapid toggles / cancel superseded redraws', ...rapid }); await waitReady();
    const overlap = await monitor(async () => {
      const toggle = async () => page.evaluate(() => {
        document.querySelector('.sidebar-toggle').click();
        document.querySelector('.ai-toggle').click();
        document.querySelector('[title="文档详情与标签"]').click();
      });
      await toggle(); await page.waitForTimeout(90);
      await toggle(); await page.waitForTimeout(90);
      await page.evaluate(() => {
        document.querySelector('.ai-toggle').click();
        document.querySelector('[title="文档详情与标签"]').click();
      });
    }, 1800);
    assertContinuous(overlap, 'overlapping and interrupted panels');
    await waitReady();
    await page.waitForFunction(() => {
      const view = document.querySelector('.pdf-scroll'), slot = document.querySelector('#page-surface');
      const style = getComputedStyle(view);
      return !document.querySelector('.pane-enter-active,.pane-leave-active,.sidebar-enter-active,.sidebar-leave-active') && !slot.classList.contains('pdf-preview') &&
        Math.abs(slot.getBoundingClientRect().width - (view.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))) < 1;
    });
    checks.push({ test: 'overlapping panel animations and cancellation release resize hold and fit final width', ...overlap });
    await page.getByTitle('关闭文档详情', { exact: true }).click();
    await page.getByRole('button', { name: '关闭阅读助手', exact: true }).click();
    await waitReady();
    if (!native) {
      await settingsZoom(400);
      const high = await monitor(() => page.getByTitle('缩小', { exact: true }).click(), 1500);
      assertContinuous(high, 'high DPI budget'); checks.push({ test: '4x zoom at 2x DPI respects buffer budget', ...high }); await waitReady();
      await settingsZoom(100);
    }
    await page.getByTitle('缩小', { exact: true }).click(); await waitReady();
    const failed = await monitor(async () => {
      await page.evaluate(async () => {
        const pdf = window.__renderPdf();
        const prototype = Object.getPrototypeOf(await pdf.getPage(1)), original = prototype.render;
        prototype.render = function(options) { prototype.render = original; throw new Error('合成重绘失败验证'); };
      });
      await page.getByTitle('适应宽度', { exact: true }).click();
    }, 600);
    assertContinuous(failed, 'render failure');
    await page.locator('.toast-message').filter({ hasText: '合成重绘失败验证' }).waitFor();
    await page.getByTitle('适应宽度', { exact: true }).click(); await waitReady();
    await page.waitForFunction(() => !document.querySelector('.pdf-preview'));
    const count = await page.evaluate(() => window.__pdfRenderCount);
    await page.getByTitle('适应宽度', { exact: true }).click(); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__pdfRenderCount), count, 'An unchanged fit must not start a new raster render');
    checks.push({ test: 'failed redraw retains content, same-scale retry succeeds, unchanged fit skips raster work', ...failed });
    // Text and annotation geometry must be rebuilt at the new scale.
    const text = page.locator('#text-layer span').filter({ hasText: 'Document rendering test' }).first();
    await text.waitFor();
    await text.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await page.getByRole('button', { name: '用所选文字向 AI 提问', exact: true }).click();
    await page.getByTitle('清除选区', { exact: true }).click();
    const internal = page.locator('#link-layer button').first();
    await internal.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="页码"]').value === '2');
    await waitReady();
    await page.getByTitle('框选公式或图表作为 AI 上下文', { exact: true }).click();
    const bounds = await page.locator('#page-surface').boundingBox();
    await page.mouse.move(bounds.x + 25, bounds.y + 35); await page.mouse.down();
    await page.mouse.move(bounds.x + 160, bounds.y + 100); await page.mouse.up();
    await page.locator('.ai-selection-context img').waitFor();
    assert.ok((await page.locator('.ai-selection-context').textContent()).includes('第 2 页'));
    checks.push({ test: 'text selection, internal link and correctly anchored AI crop', passed: true });
    await page.getByTitle('清除选区', { exact: true }).click();
    await page.getByTitle('放大', { exact: true }).click(); await page.waitForTimeout(50);
    await page.getByRole('button', { name: '文档库', exact: true }).click();
    await page.getByRole('button', { name: native ? '打开 render-synthetic-native.pdf' : '打开 渲染连续性验证.pdf', exact: true }).click();
    await waitReady(); await page.waitForFunction(() => !document.querySelector('.pdf-preview'));
    assert.ok(await page.locator('.pdf-canvas').count() <= 3);
    checks.push({ test: 'closing during redraw disposes old buffers and reopening renders cleanly', passed: true });
    // A manual zoom issued while an automatic fit is still painting wins.
    const first = page.getByLabel('页码', { exact: true });
    await first.fill('1'); await first.press('Enter'); await waitReady();
    await page.getByTitle('适应宽度', { exact: true }).click(); await waitReady();
    await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#page-surface')?.classList.contains('pdf-preview'));
    await page.getByTitle('缩小', { exact: true }).click();
    const manualScale = await page.locator('#page-surface').evaluate(element => Number(element.style.getPropertyValue('--scale-factor')));
    await waitReady(); await page.waitForTimeout(600);
    assert.equal(await page.locator('#page-surface').evaluate(element => Number(element.style.getPropertyValue('--scale-factor'))), manualScale);
    checks.push({ test: 'manual zoom cancels a staged automatic fit without a late size change', passed: true });
    // Navigating outside the three-page window releases the staged page.
    // The final available width must still be applied to the new active page.
    await page.getByTitle('适应宽度', { exact: true }).click(); await waitReady();
    await page.getByRole('button', { name: '切换侧栏', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#page-surface')?.classList.contains('pdf-preview'));
    await first.fill('5'); await first.press('Enter');
    await page.waitForFunction(() => {
      const slot = document.querySelector('#page-surface'), view = document.querySelector('.pdf-scroll');
      const style = getComputedStyle(view);
      return slot?.dataset.page === '5' && slot.classList.contains('page-ready') && !slot.classList.contains('pdf-preview') &&
        Math.abs(slot.getBoundingClientRect().width - (view.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))) < 1;
    });
    assert.ok(await page.locator('.pdf-canvas').count() <= 3);
    assert.ok(await page.evaluate(() => window.__canvasPeakPixels <= 16_000_000));
    checks.push({ test: 'navigation during staged fit releases old page and fits new active page within the canvas budget', passed: true });
    await page.screenshot({ path: resolve(artifacts, `${prefix}.png`), animations: 'disabled' });
    assert.deepEqual(errors, []);
  }
  passed = true;
  console.log(JSON.stringify({ passed, baseline, native, timing, sample: timingSample, artificialContinuationDelayMs: slow ? 120 : 0, checks, errors }, null, 2));
} finally {
  if (nativeId && page && !page.isClosed()) {
    await page.getByRole('button', { name: '文档库', exact: true }).click().catch(() => {});
    await page.evaluate(id => window.__TAURI_INTERNALS__.invoke('remove_document', { id }), nativeId);
  }
  await writeFile(resolve(artifacts, `${prefix}.json`), JSON.stringify({ passed, baseline, native, timing, sample: timingSample, artificialContinuationDelayMs: slow ? 120 : 0, checks, errors }, null, 2));
  await context?.close(); await browser?.close(); application?.kill(); await server?.close();
  if (nativePath) { const { unlink } = await import('node:fs/promises'); await unlink(nativePath); }
}
