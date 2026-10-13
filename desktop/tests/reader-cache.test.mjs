import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousPdfViewer, DESKTOP_RENDERED_PAGES, DESKTOP_PAGE_PIXELS, DESKTOP_CANVAS_PIXELS } from '../src/reader/continuous.mjs';
import { renderWindow, MAX_RENDERED_PAGES } from '../../extension/reader/scroll-layout.mjs';
import { renderPixelRatio, MAX_CANVAS_PIXELS } from '../../extension/reader/geometry.mjs';

function node() {
  return { width: 2000, height: 2000, style: {}, classList: { remove() {} }, removeAttribute(name) { this[name] = undefined; } };
}
function view(number) {
  return { number, paintedScale: 1, requestedScale: 2, ready: false, renderVersion: 1,
    slot: node(), canvas: node(), text: node(), links: node(), overlay: node(), selector: { setActive() {} } };
}

test('desktop five-page cache keeps the former per-page resolution and a bounded staging allocation', () => {
  assert.equal(MAX_RENDERED_PAGES, 3, 'browser-plugin defaults remain unchanged');
  assert.equal(renderWindow(7, 20).length, 3);
  assert.deepEqual(renderWindow(7, 20, DESKTOP_RENDERED_PAGES), [5, 6, 7, 8, 9]);
  assert.equal(DESKTOP_PAGE_PIXELS, MAX_CANVAS_PIXELS / 4);
  for (const [width, height, dpi] of [[1200, 1800, 2], [5000, 7000, 3], [720, 1024, 1.5]]) {
    const before = renderPixelRatio(width, height, dpi, MAX_CANVAS_PIXELS / 4);
    const after = renderPixelRatio(width, height, dpi, DESKTOP_PAGE_PIXELS);
    assert.equal(after, before, 'wider prefetch must not reduce active-page clarity');
    const pixels = Math.floor(width * after) * Math.floor(height * after);
    assert.ok(pixels * 6 <= DESKTOP_CANVAS_PIXELS);
  }
  assert.equal(DESKTOP_CANVAS_PIXELS, 24_000_000);
});

test('inactive reader retains its current bitmap, drops neighbors, cancels queued work and resumes without reloading', async () => {
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const reader = Object.create(ContinuousPdfViewer.prototype);
    const center = view(3), pending = { canvas: node(), task: { cancel() { pending.canceled = true; } } };
    center.pending = pending;
    let canceledJobs = 0, reboundIds = 0;
    Object.assign(reader, { currentPage: 3, activity: 0, selection: 0, frame: 4, suspended: false,
      pdf: { identity: 'same PDF proxy' }, views: new Map([1, 2, 3, 4, 5].map(number => [number, number === 3 ? center : view(number)])),
      paintJobs: [{ resolve() { canceledJobs++; } }, { resolve() { canceledJobs++; } }],
      release(view) { view.disposed = true; view.canvas.width = view.canvas.height = 0; },
      assignActiveIds() { reboundIds++; },
    });
    const pdf = reader.pdf, canvas = center.canvas;
    reader.suspend(); reader.suspend();
    assert.equal(reader.views.size, 1);
    assert.equal(reader.views.get(3).canvas, canvas, 'current bitmap is retained by identity');
    assert.equal(center.ready, true);
    assert.equal(center.requestedScale, center.paintedScale);
    assert.equal(pending.canceled, true);
    assert.equal(canceledJobs, 2);
    assert.equal(reader.frame, 0);
    assert.equal(reader.capturing, false);
    assert.equal(reader.activity, 1, 'repeated suspension is idempotent');
    assert.equal(await reader.ensure(2), undefined);
    // A canceled staging allocation is freed by its job's finally handler.
    center.pending = null;
    assert.ok(reader.getCacheStats().pixels <= DESKTOP_PAGE_PIXELS);
    reader.resume(); reader.resume();
    assert.equal(reader.pdf, pdf, 'activation reuses the loaded document');
    assert.equal(reader.views.get(3).canvas, canvas);
    assert.equal(reboundIds, 1);
    assert.equal(reader.suspended, false);
  } finally { globalThis.cancelAnimationFrame = originalCancel; }
});

test('current-page jobs overtake queued prefetch after navigation, with a single raster at a time', async () => {
  const reader = Object.create(ContinuousPdfViewer.prototype);
  const started = [], completed = [];
  let unblock, running = 0, maximum = 0;
  Object.assign(reader, { paintJobs: [], currentPage: 1, suspended: false, views: new Map(),
    async paintBuffered(number) {
      started.push(number); running++; maximum = Math.max(maximum, running);
      if (number === 1) await new Promise(resolve => { unblock = resolve; });
      running--; completed.push(number);
    },
  });
  const job = number => ({ view: { number }, args: [number], resolve() {}, reject(reason) { throw reason; } });
  reader.paintJobs.push(job(1));
  const drain = reader.drainPaintJobs();
  reader.paintJobs.push(job(2), job(3), job(5), job(4));
  reader.currentPage = 5;
  unblock(); await drain;
  assert.deepEqual(started, [1, 5, 4, 3, 2]);
  assert.deepEqual(completed, started);
  assert.equal(maximum, 1);
});

test('a raster job from the preceding activation cannot fetch, draw or commit after a quick tab round-trip', async () => {
  const reader = Object.create(ContinuousPdfViewer.prototype);
  let fetched = 0;
  Object.assign(reader, { suspended: false, activity: 3, epoch: 9, pdf: { getPage() { fetched++; throw new Error('obsolete job fetched a page'); } } });
  await reader.paintBuffered({ disposed: false, renderVersion: 2 }, 2, 1, 9, undefined, undefined, 1);
  assert.equal(fetched, 0);
  reader.suspended = true;
  await reader.paintBuffered({ disposed: false, renderVersion: 2 }, 2, 1, 9, undefined, undefined, 3);
  assert.equal(fetched, 0);
});
