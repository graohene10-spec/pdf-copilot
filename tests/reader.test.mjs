import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionRect, canvasCrop, renderPixelRatio, dataUrlBytes, destinationPage, safeDocumentUrl, documentName, pdfRectangle, MAX_CANVAS_PIXELS } from '../extension/reader/geometry.mjs';
import { pageOffsets, pageAtOffset, visiblePage, renderWindow, MAX_RENDERED_PAGES } from '../extension/reader/scroll-layout.mjs';
import { rectangleSelector } from '../extension/reader/selection.mjs';
import { ContinuousPdfViewer } from '../extension/reader/continuous.mjs';

test('reverse drag and out-of-page drag stay inside the visible page', () => {
  assert.deepEqual(selectionRect({ x: 80, y: 60 }, { x: -10, y: 500 }, 100, 200), { x: 0, y: 60, width: 80, height: 140 });
});

test('fractional CSS selection maps to high DPI pixels without clipping', () => {
  assert.deepEqual(canvasCrop({ x: 10.25, y: 20.5, width: 20.5, height: 40.25 }, 100, 100, 200, 200), { x: 20, y: 41, width: 42, height: 81 });
  assert.deepEqual(canvasCrop({ x: -20, y: 10, width: 150, height: 200 }, 100, 100, 200, 200), { x: 0, y: 20, width: 200, height: 180 });
  assert.throws(() => canvasCrop({}, 0, 100, 200, 200), /尺寸/);
});

test('render memory stays bounded for oversized pages and high DPI screens', () => {
  assert.equal(renderPixelRatio(600, 800, 2), 2);
  const ratio = renderPixelRatio(20_000, 10_000, 3);
  assert.ok(20_000 * 10_000 * ratio * ratio <= MAX_CANVAS_PIXELS + 0.01);
  assert.ok(ratio < 1);
});

test('base64 attachment size handles padding correctly', () => {
  assert.equal(dataUrlBytes('data:image/png;base64,YQ=='), 1);
  assert.equal(dataUrlBytes('data:image/png;base64,YWI='), 2);
  assert.equal(dataUrlBytes('data:image/png;base64,YWJj'), 3);
});

test('outline jumps resolve named, numeric and reference destinations', async () => {
  const pdf = { numPages: 10, getDestination: async name => name === 'chapter' ? [{ num: 2, gen: 0 }, { name: 'XYZ' }] : null, getPageIndex: async ref => ref.num + 2 };
  assert.equal(await destinationPage(pdf, 'chapter'), 5);
  assert.equal(await destinationPage(pdf, [0, { name: 'Fit' }]), 1);
  assert.equal(await destinationPage(pdf, [9, { name: 'Fit' }]), 10);
  assert.equal(await destinationPage(pdf, [10]), null);
  assert.equal(await destinationPage(pdf, [-1]), null);
  assert.equal(await destinationPage(pdf, 'missing'), null);
});

test('document URLs reject executable and credential-bearing links', () => {
  assert.equal(safeDocumentUrl('https://example.com/a.pdf').protocol, 'https:');
  assert.equal(safeDocumentUrl('file:///C:/papers/a.pdf').protocol, 'file:');
  assert.throws(() => safeDocumentUrl('javascript:alert(1)'), /只支持/);
  assert.throws(() => safeDocumentUrl('https://secret:password@example.com/a.pdf'), /用户名/);
  assert.equal(documentName('https://example.com/%E8%AE%BA%E6%96%87.pdf'), '论文.pdf');
});

test('screen rectangle metadata is converted to PDF coordinates including Y inversion', () => {
  const viewport = { convertToPdfPoint: (x, y) => [x / 2, (1000 - y) / 2] };
  assert.deepEqual(pdfRectangle(viewport, { x: 100, y: 200, width: 400, height: 100 }), { x: 50, y: 350, width: 200, height: 50, space: 'pdf-points' });
});

test('continuous page offsets account for mixed dimensions and page gaps', () => {
  const offsets = pageOffsets([1000, 600, 1400]);
  assert.deepEqual(offsets, [0, 1024, 1648, 3048]);
  assert.equal(pageAtOffset(offsets, 1010), 1);
  assert.equal(pageAtOffset(offsets, 1024), 2);
  assert.equal(pageAtOffset(offsets, 50_000), 3);
  assert.equal(pageAtOffset(offsets, -10), 1);
});

test('natural scrolling changes current page only when the next page becomes more visible', () => {
  const heights = [1200, 1200, 1200], offsets = pageOffsets(heights);
  assert.equal(visiblePage(offsets, heights, 0, 700), 1);
  assert.equal(visiblePage(offsets, heights, 300, 700), 1);
  assert.equal(visiblePage(offsets, heights, 700, 700), 1);
  assert.equal(visiblePage(offsets, heights, 1000, 700), 2);
  assert.equal(visiblePage(offsets, heights, 600, 700), 1);
});

test('low zoom prioritizes a visible page near the viewport center', () => {
  const heights = [200, 200, 200, 200, 200], offsets = pageOffsets(heights);
  assert.equal(visiblePage(offsets, heights, 0, 800), 2);
  assert.equal(visiblePage(offsets, heights, 300, 800), 4);
});

test('long documents retain only three pages and a fixed aggregate canvas budget', () => {
  assert.deepEqual(renderWindow(1, 40), [1, 2, 3]);
  assert.deepEqual(renderWindow(20, 40), [19, 20, 21]);
  assert.deepEqual(renderWindow(40, 40), [38, 39, 40]);
  assert.deepEqual(renderWindow(1, 1), [1]);
  assert.deepEqual(renderWindow(2, 2), [1, 2]);
  for (const page of renderWindow(20, 40)) {
    assert.ok(page >= 1 && page <= 40);
    const ratio = renderPixelRatio(10_000, 20_000, 3, MAX_CANVAS_PIXELS / MAX_RENDERED_PAGES);
    assert.ok(10_000 * 20_000 * ratio * ratio * MAX_RENDERED_PAGES <= MAX_CANVAS_PIXELS + 0.01);
  }
});

test('recycling a page releases capture handlers and unfinished pointer capture', () => {
  const surface = new EventTarget();
  const captures = new Set();
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 300 });
  surface.classList = { toggle() {}, remove() {} };
  surface.setPointerCapture = id => captures.add(id);
  surface.hasPointerCapture = id => captures.has(id);
  surface.releasePointerCapture = id => captures.delete(id);
  const overlay = { style: {}, hidden: true };
  const pointer = (type, x, y) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0 });
    surface.dispatchEvent(event);
  };
  let selected = 0;
  for (let repeat = 0; repeat < 30; repeat++) {
    const selector = rectangleSelector(surface, overlay, () => { selected++; });
    selector.setActive(true);
    pointer('pointerdown', 10, 10); pointer('pointerup', 40, 40);
    assert.equal(selected, repeat + 1, 'one selection callback per gesture');
    pointer('pointerdown', 10, 10);
    selector.dispose();
    assert.equal(captures.size, 0, 'release capture when a view is evicted');
    pointer('pointerup', 40, 40);
    assert.equal(selected, repeat + 1, 'disposed view cannot capture another region');
  }
});

test('an awaited jump cannot return a same-numbered view from another document or zoom', async () => {
  for (const changeDocument of [true, false]) {
    let finish;
    const view = { promise: new Promise(resolve => { finish = resolve; }), disposed: false };
    const viewer = Object.assign(Object.create(ContinuousPdfViewer.prototype), {
      pdf: { numPages: 2 }, epoch: 0, container: { scrollTop: 0 }, stack: { offsetTop: 0 },
      offsets: [0, 824, 1648], views: new Map([[1, view]]), updateWindow(number) { this.currentPage = number; },
    });
    const navigation = viewer.goToPage(1);
    viewer.epoch++;
    if (changeDocument) viewer.pdf = { numPages: 2 };
    viewer.views.set(1, { promise: Promise.resolve(), disposed: false });
    finish();
    assert.equal(await navigation, undefined, 'old geometry cannot be returned for a new view');
  }
});

test('a newer page jump supersedes an older pending citation jump', async () => {
  let finish;
  const view = { promise: new Promise(resolve => { finish = resolve; }), disposed: false };
  const viewer = Object.assign(Object.create(ContinuousPdfViewer.prototype), {
    pdf: { numPages: 2 }, epoch: 0, container: { scrollTop: 0 }, stack: { offsetTop: 0 },
    offsets: [0, 824, 1648], views: new Map([[1, view]]), updateWindow(number) { this.currentPage = number; },
  });
  const first = viewer.goToPage(1), latest = viewer.goToPage(1);
  finish();
  assert.equal(await first, undefined);
  assert.equal(await latest, view);
});

test('a drag before rendering finishes opens its preview when the same page is ready', async () => {
  let finish;
  const view = { ready: false, disposed: false, promise: new Promise(resolve => { finish = resolve; }) };
  const previews = [], pending = [];
  const viewer = Object.assign(Object.create(ContinuousPdfViewer.prototype), {
    pdf: {}, epoch: 1, selection: 0, capturing: true,
    onSelect: (view, rect) => previews.push(rect), onSelectionPending: view => pending.push(view),
  });
  const rect = { x: 10, y: 20, width: 30, height: 40 };
  const selected = viewer.select(view, rect);
  assert.equal(pending.length, 1); assert.equal(previews.length, 0);
  view.ready = true; finish(); await selected;
  assert.deepEqual(previews, [rect]);
});

test('pending crops are discarded after cancellation, eviction, zoom or another crop', async () => {
  for (const change of ['cancel', 'clear', 'evict', 'zoom', 'document', 'new-crop']) {
    let finish, previews = 0;
    const view = { ready: false, disposed: false, promise: new Promise(resolve => { finish = resolve; }) };
    const viewer = Object.assign(Object.create(ContinuousPdfViewer.prototype), {
      pdf: {}, epoch: 1, selection: 0, capturing: true, views: new Map(), onSelect: () => { previews++; },
    });
    const selected = viewer.select(view, {});
    if (change === 'cancel') viewer.capture(false);
    if (change === 'clear') viewer.clearOverlays();
    if (change === 'evict') view.disposed = true;
    if (change === 'zoom') viewer.epoch++;
    if (change === 'document') viewer.pdf = {};
    if (change === 'new-crop') { await viewer.select({ ready: true }, {}); previews = 0; }
    view.ready = true; finish(); await selected;
    assert.equal(previews, 0, change + ' cannot open a stale preview');
  }
});
