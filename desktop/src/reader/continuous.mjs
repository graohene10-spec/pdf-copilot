import { ContinuousPdfViewer as PageWindow } from '../../../extension/reader/continuous.mjs';
import { clamp, renderPixelRatio, MAX_CANVAS_PIXELS } from '../../../extension/reader/geometry.mjs';
import { MAX_RENDERED_PAGES, PAGE_GAP, visiblePage } from '../../../extension/reader/scroll-layout.mjs';
import { installDarkFilter, imageUnits, classifyImages, photoLayer, releasePhotoLayer } from './dark-pages.mjs';

// Keep the former per-page resolution. A five-page desktop window and one
// detached redraw buffer have a bounded 24M-pixel allocation. Inactive tabs
// retain only their current committed page, with no background raster work.
export const DESKTOP_RENDERED_PAGES = 5;
export const DESKTOP_PAGE_PIXELS = MAX_CANVAS_PIXELS / (MAX_RENDERED_PAGES + 1);
export const DESKTOP_CANVAS_PIXELS = DESKTOP_PAGE_PIXELS * (DESKTOP_RENDERED_PAGES + 1);
// 双页时两页之间的缝；每页只有一半宽，窗口里多留几页（上一行、当前行、下一行）。
export const SPREAD_GAP = 14;
const SPREAD_RENDERED_PAGES = 7;

/** Rows of a two-page spread: pairs of pages; with `coverAlone`, page 1 sits alone (on the right, like a book's cover). */
export function spreadRows(count, coverAlone = false) {
  const rows = [];
  let number = 1;
  if (coverAlone && count) { rows.push([1]); number = 2; }
  for (; number <= count; number += 2) rows.push(number + 1 <= count ? [number, number + 1] : [number]);
  return rows;
}
const canceled = error => ['RenderingCancelledException', 'AbortException'].includes(error?.name);
const darkTheme = () => document.documentElement.dataset.theme === 'dark';
const idle = callback => (window.requestIdleCallback ? window.requestIdleCallback(callback, { timeout: 1200 }) : setTimeout(callback, 200));

export class ContinuousPdfViewer extends PageWindow {
  constructor(options) {
    // The shared viewer removes the document's existing #page-surface, which in
    // the extension is a stale single-page shell. On the desktop that element
    // may be the current page of another reader shown side by side, so it is
    // briefly renamed while the base viewer initializes and then restored.
    const others = [...document.querySelectorAll('#page-surface')];
    for (const element of others) element.removeAttribute('id');
    super({ ...options, maxRenderedPages: DESKTOP_RENDERED_PAGES });
    for (const element of others) if (!element.id) element.id = 'page-surface';
    installDarkFilter();
    this.paintJobs = [];
    this.suspended = false;
    this.spread = { enabled: false, coverAlone: false };
    this.rowFirst = [];
    this.activity = 0;
    // 每页哪些图片是照片（深色主题里保留原色）：判断一次后按页记住，缩放、翻回来都不再读像素。
    this.photoCache = new Map();
    // 读像素会让浏览器等显卡把活干完：正在滚动时一律推迟，停下来、空闲了再做。
    this.lastScroll = 0;
    options.container.addEventListener('scroll', () => { this.lastScroll = performance.now(); }, { passive: true });
  }

  setDocument(pdf) {
    this.photoCache = new Map();
    return super.setDocument(pdf);
  }

  /** Colour-preserving layers for the committed pages after switching to the dark theme. */
  refreshPhotos() {
    if (!darkTheme() || this.suspended) return;
    for (const view of [...this.views.values()]) {
      if (!view.disposed && view.paintedScale && !view.photosChecked) this.attachPhotos(view);
    }
  }

  /** Puts the photo layer on a committed page: from the cache right away, otherwise classified when the browser is idle. */
  attachPhotos(view) {
    if (!darkTheme() || !view.imageUnits) return;
    view.photosChecked = true;
    const known = this.photoCache.get(view.number);
    const show = images => {
      releasePhotoLayer(view.photos);
      view.photos = photoLayer(view.canvas, view.viewport, images);
      if (view.photos) view.canvas.after(view.photos);
    };
    if (known) { if (!view.photos) show(known); return; }
    if (!view.imageUnits.length) { this.photoCache.set(view.number, []); return; }
    const canvas = view.canvas, units = view.imageUnits;
    const run = async () => {
      if (view.disposed || view.canvas !== canvas || !darkTheme()) { view.photosChecked = false; return; }
      if (performance.now() - this.lastScroll < 400) { idle(run); return; }
      const flags = await classifyImages(canvas, view.viewport, units).catch(() => null);
      if (!flags || view.disposed || view.canvas !== canvas) { view.photosChecked = false; return; }
      const images = units.map((unit, index) => ({ unit, photo: flags[index] }));
      this.photoCache.set(view.number, images);
      show(images);
    };
    idle(run);
  }

  schedule() { if (!this.suspended) super.schedule(); }

  /** 切换单页 / 双页（以及封面是否单独一页），保持当前阅读的那一页仍在视口顶部。 */
  setSpread(enabled, coverAlone = false) {
    const next = { enabled: !!enabled, coverAlone: !!enabled && !!coverAlone };
    if (next.enabled === this.spread.enabled && next.coverAlone === this.spread.coverAlone) return false;
    this.spread = next;
    this.stack.classList.toggle('spread', next.enabled);
    this.stack.style.rowGap = next.enabled ? `${PAGE_GAP}px` : '';
    this.stack.style.columnGap = next.enabled ? `${SPREAD_GAP}px` : '';
    this.maxRenderedPages = next.enabled ? SPREAD_RENDERED_PAGES : DESKTOP_RENDERED_PAGES;
    if (!this.pdf || !this.slots?.length) return true;
    const number = this.currentPage;
    this.layout();
    this.container.scrollTop = this.stack.offsetTop + this.offsets[number - 1];
    this.explicitPosition = { page: this.rowFirst[number] || number, top: this.container.scrollTop };
    this.updateWindow(number);
    return true;
  }

  // 双页时跳到右页：滚到这一行，当前页记为左页，但仍返回目标页本身（引用高亮、书签要定位到它）。
  async goToPage(number, options = {}) {
    if (!this.spread.enabled || !this.pdf) return super.goToPage(number, options);
    const pdf = this.pdf, epoch = this.epoch;
    const navigation = this.navigation = (this.navigation || 0) + 1;
    number = clamp(Math.trunc(number) || 1, 1, this.pdf.numPages);
    const first = this.rowFirst[number] || number;
    if (options.scroll !== false) this.container.scrollTop = this.stack.offsetTop + this.offsets[number - 1];
    this.explicitPosition = { page: first, top: this.container.scrollTop };
    this.updateWindow(first);
    const view = this.views.get(number);
    await view?.promise;
    if (pdf !== this.pdf || epoch !== this.epoch || navigation !== this.navigation || this.currentPage !== first || this.views.get(number) !== view || view?.disposed) return;
    return view;
  }

  /** The slots shown side by side with `number` (just its own slot outside spread mode). */
  rowSlots(number = this.currentPage) {
    if (!this.spread.enabled || !this.slots) return this.slots?.[number - 1] ? [this.slots[number - 1]] : [];
    const first = this.rowFirst[number] || number;
    return [first, first + 1].filter(page => page <= this.slots.length && (this.rowFirst[page] || page) === first).map(page => this.slots[page - 1]);
  }

  updateWindow(number) {
    if (this.suspended) return;
    // 双页时以一行的左页作为「当前页」：页码、目录与进度都指向这一行。
    if (this.spread.enabled && this.offsets) {
      if (!number) {
        const top = this.container.scrollTop;
        if (this.explicitPosition && Math.abs(this.explicitPosition.top - top) > 1) this.explicitPosition = null;
        number = this.explicitPosition?.page || visiblePage(this.offsets, this.heights, top - this.stack.offsetTop, this.container.clientHeight);
      }
      number = this.rowFirst[number] || number;
    }
    const previous = this.currentPage;
    super.updateWindow(number);
    const painting = this.paintCurrentJob?.view;
    if (previous !== this.currentPage && painting && painting.number !== this.currentPage && !painting.disposed) {
      ++painting.renderVersion;
      this.cancelPending(painting);
      painting.requestedScale = painting.paintedScale || this.displayScale;
      painting.ready = !!painting.paintedScale;
    }
  }

  async drainPaintJobs() {
    if (this.paintRunning) return;
    this.paintRunning = true;
    try {
      while (this.paintJobs.length) {
        // Navigation/zoom always wins over neighboring-page prefetch. The
        // queue cannot trap the current page behind four expensive rasters.
        this.paintJobs.sort((a, b) => Math.abs(a.view.number - this.currentPage) - Math.abs(b.view.number - this.currentPage));
        const job = this.paintJobs.shift();
        this.paintCurrentJob = job;
        try { job.resolve(await this.paintBuffered(...job.args)); }
        catch (error) { job.reject(error); }
        finally { this.paintCurrentJob = null; }
      }
    } finally {
      this.paintRunning = false;
      // A canceled speculative job may still belong to the new five-page
      // window. Retry it only after the active-page priority queue is empty.
      if (!this.suspended && [...this.views.values()].some(view => !view.ready && !view.pending && !view.disposed && !view.failed)) this.schedule();
    }
  }

  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    ++this.activity; ++this.selection; this.navigation = (this.navigation || 0) + 1;
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.cancelDeferredZoom();
    this.capture(false);
    for (const [number, view] of this.views) {
      ++view.renderVersion;
      this.cancelPending(view);
      if (number !== this.currentPage || !view.paintedScale) { this.release(view); this.views.delete(number); continue; }
      view.requestedScale = view.paintedScale;
      view.ready = true;
      view.slot.classList.remove('pdf-preview');
      view.text.style.visibility = view.links.style.visibility = '';
      for (const node of [view.slot, view.canvas, view.text, view.links, view.overlay]) node.removeAttribute('id');
    }
    for (const job of this.paintJobs.splice(0)) job.resolve();
  }

  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    ++this.activity;
    this.assignActiveIds();
  }

  getCacheStats() {
    return { suspended: this.suspended, pages: this.views.size, pixels: [...this.views.values()].reduce((sum, view) => sum + view.canvas.width * view.canvas.height + (view.pending?.canvas?.width || 0) * (view.pending?.canvas?.height || 0), 0), maxPixels: DESKTOP_CANVAS_PIXELS };
  }

  getFitScale(availableWidth) {
    const style = getComputedStyle(this.container);
    const available = availableWidth ?? this.container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const size = this.sizes.get(this.currentPage) || this.defaultSize;
    if (this.spread.enabled) {
      // 适应宽度：当前这一行的两页（单独一页的行按两页宽算）连同中缝一起铺满。
      const row = this.rowSlots(this.currentPage).map(slot => (this.sizes.get(Number(slot.dataset.page)) || this.defaultSize).width);
      const units = row.length > 1 ? row[0] + row[1] : size.width * 2;
      return available > SPREAD_GAP ? clamp((available - SPREAD_GAP) / units, .001, 4) : this.displayScale || 1;
    }
    return available > 0 ? clamp(available / size.width, .001, 4) : this.displayScale || 1;
  }

  layout() {
    // Pin the committed scale. Measuring a newly visible page must not pick
    // up an intermediate panel width and bypass the reader's resize hold.
    if (this.scale === null && this.defaultSize) this.scale = this.getFitScale();
    super.layout();
    this.layoutSpread();
    for (const [index, slot] of this.slots.entries()) {
      const userUnit = this.views.get(index + 1)?.page?.userUnit || 1;
      for (const [name, value] of Object.entries({ '--scale-factor': this.displayScale, '--total-scale-factor': this.displayScale * userUnit, '--user-unit': userUnit, '--scale-round-x': '1px', '--scale-round-y': '1px' })) slot.style.setProperty(name, value);
    }
  }

  /** 双页排版：页面栈变成两列网格，同一行的两页共用一个纵向位置（offsets 按行算），其余滚动逻辑不变。 */
  layoutSpread() {
    const count = this.slots.length;
    this.rowFirst = new Array(count + 1);
    if (!this.spread.enabled) {
      for (const [index, slot] of this.slots.entries()) {
        slot.style.gridColumn = slot.style.justifySelf = '';
        slot.style.marginBottom = index < count - 1 ? `${PAGE_GAP}px` : '0';
      }
      return;
    }
    const offsets = new Array(count + 1).fill(0);
    const rows = spreadRows(count, this.spread.coverAlone);
    let top = 0;
    rows.forEach((row, index) => {
      const cover = row.length === 1 && row[0] === 1 && this.spread.coverAlone;
      row.forEach((page, column) => {
        const slot = this.slots[page - 1];
        offsets[page - 1] = top;
        this.rowFirst[page] = row[0];
        slot.style.marginBottom = '0';
        // 左页贴着中缝靠右、右页靠左；封面单独放在右栏，最后落单的一页放在左栏。
        slot.style.gridColumn = cover ? '2' : String(column + 1);
        slot.style.justifySelf = cover || column === 1 ? 'start' : 'end';
      });
      top += Math.max(...row.map(page => this.heights[page - 1])) + (index < rows.length - 1 ? PAGE_GAP : 0);
    });
    offsets[count] = top;
    this.offsets = offsets;
  }

  ensure(number) {
    if (this.suspended) return;
    const view = this.views.get(number);
    if (!view) return super.ensure(number);
    if (this.pendingZoom?.view === view) return view;
    if ((!view.ready && !view.failed && !view.pending && !this.paintJobs.some(job => job.view === view)) || Math.abs(view.requestedScale - this.displayScale) > .000001) {
      view.promise = this.paint(view).catch(error => {
        if (!view.disposed && !canceled(error)) this.onError?.(error);
      });
    }
    return view;
  }

  cancelPending(view) {
    const buffer = view.pending;
    if (!buffer) return;
    buffer.disposed = true;
    buffer.task?.cancel();
    buffer.layer?.cancel();
    buffer.commitAbort?.abort();
    buffer.finishWait?.();
    if (buffer.frame) { cancelAnimationFrame(buffer.frame); buffer.finishFrame?.(); }
  }

  paint(view, scale = this.displayScale, beforeCommit, waitBeforeCommit) {
    if (this.suspended) return Promise.resolve();
    this.cancelPending(view);
    const version = view.renderVersion = (view.renderVersion || 0) + 1;
    view.requestedScale = scale;
    const epoch = this.epoch;
    const keepContent = !!waitBeforeCommit && !!view.paintedScale;
    view.ready = keepContent; view.failed = false;
    // Held layout keeps the old bitmap, text and links aligned and usable.
    // Manual zoom changes its shell immediately, so hide stale hit targets.
    if (!view.paintedScale) {
      view.canvas.remove(); view.canvas.width = view.canvas.height = 0;
      view.text.remove(); view.links.remove();
      releasePhotoLayer(view.photos); view.photos = null;
    }
    view.text.style.visibility = view.links.style.visibility = keepContent ? '' : 'hidden';
    view.slot.classList.toggle('pdf-preview', !!view.paintedScale);
    const activity = this.activity;
    return new Promise((resolve, reject) => {
      this.paintJobs.push({ view, resolve, reject, args: [view, version, scale, epoch, beforeCommit, waitBeforeCommit, activity] });
      void this.drainPaintJobs();
    });
  }

  async paintBuffered(view, version, scale, epoch, beforeCommit, waitBeforeCommit, activity = this.activity) {
    const pdf = this.pdf;
    const valid = () => !this.suspended && activity === this.activity && !view.disposed && view.renderVersion === version && epoch === this.epoch && pdf === this.pdf;
    if (!valid()) return;
    let buffer;
    try {
      const page = view.page || await pdf.getPage(view.number);
      if (!valid()) { if (view.disposed && view.page !== page) page.cleanup(); return; }
      view.page = page;
      this.measure(view.number, page);
      const viewport = page.getViewport({ scale });
      buffer = { page, viewport, epoch, disposed: false, canvas: document.createElement('canvas'), text: document.createElement('div'), links: document.createElement('div') };
      view.pending = buffer;
      buffer.canvas.className = 'pdf-canvas'; buffer.text.className = 'textLayer'; buffer.links.className = 'link-layer';
      const ratio = renderPixelRatio(viewport.width, viewport.height, window.devicePixelRatio || 1, DESKTOP_PAGE_PIXELS);
      // Zero the default height before assigning the width; even extremely
      // wide pages cannot transiently allocate width * the default 150px.
      buffer.canvas.height = 0;
      buffer.canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
      buffer.canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      buffer.task = page.render({ canvasContext: buffer.canvas.getContext('2d', { alpha: false }), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0], background: 'white' });
      await buffer.task.promise;
      // 图片位置直接取自这次渲染的操作列表（只是遍历一遍，不再向 worker 重新要），切到深色主题时就不用重画。
      // 深色主题里这一页之前判断过就立刻贴上照片层，否则提交后在空闲时再判断；浅色主题不读任何像素。
      const operators = buffer.task._internalRenderTask?.operatorList;
      buffer.imageUnits = operators ? imageUnits(operators, viewport, this.pdfjs.OPS) : null;
      const known = darkTheme() && this.photoCache.get(view.number);
      if (known) buffer.photos = photoLayer(buffer.canvas, viewport, known);
      buffer.task = null;
      if (!valid()) return;
      buffer.layer = new this.pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: buffer.text, viewport });
      await buffer.layer.render();
      if (!valid()) return;
      await this.links(buffer);
      if (!valid()) return;
      // Prepare the one allowed staging buffer during the popup. Its commit
      // waits for final layout, and every cancellation also releases the queue.
      if (waitBeforeCommit) {
        buffer.commitAbort = new AbortController();
        await new Promise((resolve, reject) => {
          buffer.finishWait = resolve;
          Promise.resolve(waitBeforeCommit(buffer.commitAbort.signal)).then(resolve, reject);
        });
        buffer.finishWait = null;
        if (!valid()) return;
      }
      await new Promise(resolve => {
        buffer.finishFrame = resolve;
        buffer.frame = requestAnimationFrame(() => { buffer.frame = 0; resolve(); });
      });
      if (!valid()) return;

      // This synchronous frame commit exposes only fully drawn content.
      if (beforeCommit && !beforeCommit()) return;
      const oldCanvas = view.canvas, oldLayer = view.layer;
      for (const key of ['canvas', 'text', 'links']) {
        if (view[key].parentNode === view.slot) view[key].replaceWith(buffer[key]);
        else view.slot.insertBefore(buffer[key], view.overlay);
        view[key] = buffer[key];
      }
      releasePhotoLayer(view.photos);
      view.photos = buffer.photos || null;
      if (view.photos) view.canvas.after(view.photos);
      view.viewport = viewport; view.layer = buffer.layer; view.paintedScale = scale;
      view.imageUnits = buffer.imageUnits || null; view.photosChecked = false;
      this.attachPhotos(view);
      view.ready = true; view.slot.classList.add('page-ready'); view.slot.classList.remove('pdf-preview');
      buffer.committed = true;
      oldLayer?.cancel(); oldCanvas.width = oldCanvas.height = 0;
      this.assignActiveIds();
      this.onPageReady?.(view);
    } catch (error) {
      if (valid() && !canceled(error)) { view.failed = true; throw error; }
    } finally {
      buffer?.commitAbort?.abort();
      if (view.pending === buffer) view.pending = null;
      if (buffer && !buffer.committed) {
        buffer.layer?.cancel();
        releasePhotoLayer(buffer.photos);
        buffer.canvas.width = buffer.canvas.height = 0;
      }
    }
  }

  release(view) {
    releasePhotoLayer(view.photos); view.photos = null;
    super.release(view);
  }

  cancelDeferredZoom() {
    const pending = this.pendingZoom;
    if (!pending) return;
    this.pendingZoom = null;
    const view = pending.view;
    ++view.renderVersion;
    this.cancelPending(view);
    if (!view.disposed) {
      view.requestedScale = view.paintedScale || this.displayScale;
      view.ready = !!view.paintedScale;
      view.slot.classList.remove('pdf-preview');
      view.text.style.visibility = view.links.style.visibility = '';
      view.promise = Promise.resolve(view);
    }
  }

  commitScale(next) {
    const number = this.currentPage;
    const fraction = (this.container.scrollTop - this.stack.offsetTop - this.offsets[number - 1]) / this.heights[number - 1];
    ++this.selection;
    const selection = window.getSelection();
    if (this.container.contains(selection?.anchorNode)) selection.removeAllRanges();
    for (const view of this.views.values()) {
      view.selector.setActive(this.capturing);
      view.slot.querySelectorAll('.citation-highlight').forEach(marker => marker.remove());
    }
    this.scale = next;
    this.layout();
    this.container.scrollTop = this.stack.offsetTop + this.offsets[number - 1] + fraction * this.heights[number - 1];
    this.explicitPosition = { page: number, top: this.container.scrollTop };
    return number;
  }

  async zoom(scale, { deferLayout = false, beforeCommit, waitBeforeCommit } = {}) {
    if (this.suspended || !this.pdf) return;
    const next = scale === null ? this.getFitScale() : scale;
    if (!Number.isFinite(next) || next <= 0) return;
    if (this.pendingZoom?.scale === next && this.pendingZoom.view === this.active) return this.pendingZoom.view.promise;
    this.cancelDeferredZoom();
    // Repeated observer/mount notifications with the same target do no work.
    if (Math.abs(next - this.displayScale) < .000001) {
      beforeCommit?.();
      this.scale = next;
      if (this.active?.failed) {
        const view = this.active;
        view.promise = this.paint(view).catch(error => { if (!view.disposed && !canceled(error)) this.onError?.(error); });
      }
      await this.active?.promise;
      return this.active;
    }
    const view = this.active;
    if (deferLayout && view?.paintedScale) {
      const pending = this.pendingZoom = { view, scale: next };
      let committed = false;
      view.promise = this.paint(view, next, () => {
        if (this.pendingZoom !== pending) return false;
        if (beforeCommit?.() === false) return false;
        this.commitScale(next);
        this.pendingZoom = null;
        committed = true;
        return true;
      }, waitBeforeCommit).catch(error => {
        if (!view.disposed && !canceled(error)) this.onError?.(error);
      });
      try {
        await view.promise;
        if (committed && !view.disposed && this.pdf) this.updateWindow(this.currentPage);
      } finally {
        if (this.pendingZoom === pending) this.cancelDeferredZoom();
      }
      return this.active;
    }
    beforeCommit?.();
    const number = this.commitScale(next);
    return this.goToPage(number, { scroll: false });
  }

  reset() {
    this.cancelDeferredZoom();
    super.reset();
    for (const job of this.paintJobs?.splice(0) || []) job.resolve();
  }

  release(view) {
    ++view.renderVersion;
    this.cancelPending(view);
    view.slot.classList.remove('pdf-preview');
    // The base release now touches only committed buffers, never a canvas
    // still being painted. The serial job frees its detached buffer itself.
    super.release(view);
  }
}
