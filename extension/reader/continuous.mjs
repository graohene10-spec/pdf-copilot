import { clamp, renderPixelRatio, MAX_CANVAS_PIXELS } from './geometry.mjs';
import { rectangleSelector } from './selection.mjs';
import { pageOffsets, visiblePage, renderWindow, PAGE_GAP, MAX_RENDERED_PAGES } from './scroll-layout.mjs';

// Lightweight page shells keep the browser's native scroll behavior. Only a
// three-page window owns canvases/text layers, including at low zoom levels.
export class ContinuousPdfViewer {
  constructor({ container, pdfjs, onPageChange, onPageReady, onSelect, onSelectionPending, onDestination, onError }) {
    Object.assign(this, { container, pdfjs, onPageChange, onPageReady, onSelect, onSelectionPending, onDestination, onError });
    this.stack = document.createElement('div');
    this.stack.className = 'page-stack';
    this.stack.hidden = true;
    document.getElementById('page-surface')?.remove();
    container.append(this.stack);
    this.views = new Map();
    this.epoch = 0;
    this.frame = 0;
    this.capturing = false;
    this.selection = 0;
    this.scale = null;
    container.addEventListener('scroll', () => this.schedule(), { passive: true });
  }

  get active() { return this.views.get(this.currentPage); }

  schedule() {
    if (!this.pdf || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.updateWindow(); });
  }

  async setDocument(pdf) {
    this.reset();
    if (!pdf) return;
    this.pdf = pdf;
    const epoch = this.epoch;
    const first = await pdf.getPage(1);
    if (epoch !== this.epoch) return;
    const viewport = first.getViewport({ scale: 1 });
    this.defaultSize = { width: viewport.width, height: viewport.height };
    this.sizes = new Map([[1, this.defaultSize]]);
    this.currentPage = 1;
    this.scale = null;
    this.slots = [];
    const fragment = document.createDocumentFragment();
    for (let number = 1; number <= pdf.numPages; number++) {
      const slot = document.createElement('div');
      slot.className = 'page page-slot';
      slot.dataset.page = number;
      slot.setAttribute('aria-label', `第 ${number} 页`);
      slot.style.marginBottom = number < pdf.numPages ? `${PAGE_GAP}px` : '0';
      const placeholder = document.createElement('span');
      placeholder.className = 'page-placeholder';
      placeholder.textContent = `第 ${number} 页 · 滚动到此页后载入`;
      slot.append(placeholder);
      this.slots.push(slot);
      fragment.append(slot);
    }
    this.stack.append(fragment);
    this.stack.hidden = false;
    this.layout();
    return this.goToPage(1);
  }

  reset() {
    ++this.epoch;
    cancelAnimationFrame(this.frame); this.frame = 0;
    for (const view of this.views.values()) this.release(view);
    this.views.clear();
    this.stack.replaceChildren();
    this.stack.hidden = true;
    this.pdf = null;
    this.explicitPosition = null;
    this.currentPage = 1;
  }

  layout() {
    const style = getComputedStyle(this.container);
    const width = this.container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    this.displayScale = this.scale ?? clamp(width / this.defaultSize.width, 0.25, 4);
    this.heights = this.slots.map((slot, index) => {
      const size = this.sizes.get(index + 1) || this.defaultSize;
      const height = size.height * this.displayScale;
      slot.style.width = `${size.width * this.displayScale}px`;
      slot.style.height = `${height}px`;
      return height;
    });
    this.offsets = pageOffsets(this.heights);
  }

  measure(number, page) {
    const unit = page.getViewport({ scale: 1 });
    const previous = this.sizes.get(number) || this.defaultSize;
    if (previous.width === unit.width && previous.height === unit.height) return;
    const before = this.offsets[this.currentPage - 1];
    this.sizes.set(number, { width: unit.width, height: unit.height });
    this.layout();
    // Explicit anchoring prevents a newly measured preceding page from moving
    // the text currently being read. CSS scroll anchoring is disabled below.
    const delta = this.offsets[this.currentPage - 1] - before;
    if (delta) {
      this.container.scrollTop += delta;
      if (this.explicitPosition) this.explicitPosition.top = this.container.scrollTop;
    }
  }

  updateWindow(forcedPage) {
    if (!this.pdf || !this.offsets) return;
    const top = this.container.scrollTop;
    if (this.explicitPosition && Math.abs(this.explicitPosition.top - top) > 1) this.explicitPosition = null;
    const number = forcedPage || this.explicitPosition?.page || visiblePage(this.offsets, this.heights, top - this.stack.offsetTop, this.container.clientHeight);
    const desired = renderWindow(number, this.pdf.numPages);
    // Release first, keeping the aggregate canvas allocation below its budget.
    for (const [page, view] of this.views) if (!desired.includes(page)) { this.release(view); this.views.delete(page); }
    this.currentPage = number;
    for (const page of [number, ...desired.filter(page => page !== number)]) this.ensure(page);
    this.assignActiveIds();
    this.onPageChange?.(number, this.displayScale);
  }

  assignActiveIds() {
    for (const view of this.views.values()) {
      for (const [element, id] of [[view.slot, 'page-surface'], [view.canvas, 'pdf-canvas'], [view.text, 'text-layer'], [view.links, 'link-layer'], [view.overlay, 'selection-box']]) {
        if (view.number === this.currentPage) element.id = id;
        else element.removeAttribute('id');
      }
    }
  }

  ensure(number) {
    if (this.views.has(number)) return this.views.get(number);
    const slot = this.slots[number - 1];
    const view = { number, slot, epoch: this.epoch, ready: false, disposed: false };
    view.canvas = document.createElement('canvas'); view.canvas.className = 'pdf-canvas';
    view.text = document.createElement('div'); view.text.className = 'textLayer';
    view.links = document.createElement('div'); view.links.className = 'link-layer';
    view.overlay = document.createElement('div'); view.overlay.className = 'selection-box'; view.overlay.hidden = true;
    slot.append(view.canvas, view.text, view.links, view.overlay);
    view.selector = rectangleSelector(slot, view.overlay, rect => this.select(view, rect).catch(error => this.onError?.(error)));
    view.selector.setActive(this.capturing);
    this.views.set(number, view);
    view.promise = this.paint(view).catch(error => {
      if (!view.disposed && view.epoch === this.epoch && !['RenderingCancelledException', 'AbortException'].includes(error.name)) this.onError?.(error);
    });
    return view;
  }

  async select(view, rect) {
    const epoch = this.epoch, pdf = this.pdf;
    const selection = this.selection = (this.selection || 0) + 1;
    if (!view.ready) {
      this.onSelectionPending?.(view);
      await view.promise;
    }
    // A drag may finish before PDF.js finishes the page. Keep that selection,
    // but never use its geometry after a zoom, document change or cancellation.
    if (view.disposed || epoch !== this.epoch || pdf !== this.pdf || !this.capturing || selection !== this.selection) return;
    if (view.ready) this.onSelect?.(view, rect);
  }

  async paint(view) {
    const pdf = this.pdf;
    const page = await pdf.getPage(view.number);
    if (view.disposed || view.epoch !== this.epoch) { page.cleanup(); return; }
    view.page = page;
    this.measure(view.number, page);
    const viewport = page.getViewport({ scale: this.displayScale });
    view.viewport = viewport;
    const ratio = renderPixelRatio(viewport.width, viewport.height, window.devicePixelRatio || 1, MAX_CANVAS_PIXELS / MAX_RENDERED_PAGES);
    view.canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
    view.canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
    for (const [name, value] of Object.entries({ '--scale-factor': this.displayScale, '--total-scale-factor': this.displayScale * (page.userUnit || 1), '--user-unit': page.userUnit || 1, '--scale-round-x': '1px', '--scale-round-y': '1px' })) view.slot.style.setProperty(name, value);
    const task = page.render({ canvasContext: view.canvas.getContext('2d', { alpha: false }), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0], background: 'white' });
    view.task = task;
    try { await task.promise; }
    finally { if (view.task === task) view.task = null; }
    if (view.disposed || view.epoch !== this.epoch) return;
    view.layer = new this.pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: view.text, viewport });
    await view.layer.render();
    if (view.disposed || view.epoch !== this.epoch) return;
    await this.links(view);
    if (view.disposed || view.epoch !== this.epoch) return;
    view.ready = true;
    view.slot.classList.add('page-ready');
    this.onPageReady?.(view);
  }

  async links(view) {
    const annotations = await view.page.getAnnotations({ intent: 'display' });
    if (view.disposed || view.epoch !== this.epoch) return;
    for (const annotation of annotations) {
      if (annotation.subtype !== 'Link' || !annotation.rect || (!annotation.dest && !annotation.url)) continue;
      let link;
      if (annotation.dest) {
        link = document.createElement('button'); link.type = 'button'; link.setAttribute('aria-label', '跳转文档内部链接');
        link.addEventListener('click', () => this.onDestination?.(annotation.dest));
      } else {
        try { if (!['http:', 'https:', 'mailto:'].includes(new URL(annotation.url).protocol)) continue; }
        catch { continue; }
        link = document.createElement('a'); link.href = annotation.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', '打开文档中的外部链接');
      }
      link.className = 'pdf-link';
      const [x1, y1] = view.viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
      const [x2, y2] = view.viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
      Object.assign(link.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` });
      view.links.append(link);
    }
  }

  release(view) {
    view.disposed = true;
    view.task?.cancel(); view.layer?.cancel(); view.selector.dispose();
    view.canvas.width = view.canvas.height = 0;
    for (const element of [view.canvas, view.text, view.links, view.overlay]) element.remove();
    view.slot.removeAttribute('id');
    view.slot.classList.remove('page-ready', 'capture-mode');
    view.promise?.finally(() => view.page?.cleanup());
  }

  async goToPage(number, { scroll = true } = {}) {
    if (!this.pdf) return;
    const pdf = this.pdf, epoch = this.epoch;
    const navigation = this.navigation = (this.navigation || 0) + 1;
    number = clamp(Math.trunc(number) || 1, 1, this.pdf.numPages);
    if (scroll) this.container.scrollTop = this.stack.offsetTop + this.offsets[number - 1];
    this.explicitPosition = { page: number, top: this.container.scrollTop };
    this.updateWindow(number);
    const view = this.views.get(number);
    await view?.promise;
    if (pdf !== this.pdf || epoch !== this.epoch || navigation !== this.navigation || this.currentPage !== number || this.views.get(number) !== view || view?.disposed) return;
    return view;
  }

  async zoom(scale) {
    if (!this.pdf) return;
    const number = this.currentPage;
    const fraction = (this.container.scrollTop - this.stack.offsetTop - this.offsets[number - 1]) / this.heights[number - 1];
    ++this.epoch;
    for (const view of this.views.values()) this.release(view);
    this.views.clear();
    this.scale = scale;
    this.layout();
    this.container.scrollTop = this.stack.offsetTop + this.offsets[number - 1] + fraction * this.heights[number - 1];
    return this.goToPage(number, { scroll: false });
  }

  capture(value) {
    ++this.selection;
    this.capturing = value;
    for (const view of this.views.values()) view.selector.setActive(value);
  }

  clearOverlays() { ++this.selection; for (const view of this.views.values()) view.selector.clear(); }
}
