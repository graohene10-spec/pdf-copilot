import { ContinuousPdfViewer as PageWindow } from '../../../extension/reader/continuous.mjs';
import { clamp, renderPixelRatio, MAX_CANVAS_PIXELS } from '../../../extension/reader/geometry.mjs';
import { MAX_RENDERED_PAGES } from '../../../extension/reader/scroll-layout.mjs';

// Keep the former per-page resolution. A five-page desktop window and one
// detached redraw buffer have a bounded 24M-pixel allocation. Inactive tabs
// retain only their current committed page, with no background raster work.
export const DESKTOP_RENDERED_PAGES = 5;
export const DESKTOP_PAGE_PIXELS = MAX_CANVAS_PIXELS / (MAX_RENDERED_PAGES + 1);
export const DESKTOP_CANVAS_PIXELS = DESKTOP_PAGE_PIXELS * (DESKTOP_RENDERED_PAGES + 1);
const canceled = error => ['RenderingCancelledException', 'AbortException'].includes(error?.name);

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
    this.paintJobs = [];
    this.suspended = false;
    this.activity = 0;
  }

  schedule() { if (!this.suspended) super.schedule(); }

  updateWindow(number) {
    if (this.suspended) return;
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
    return available > 0 ? clamp(available / size.width, .001, 4) : this.displayScale || 1;
  }

  layout() {
    // Pin the committed scale. Measuring a newly visible page must not pick
    // up an intermediate panel width and bypass the reader's resize hold.
    if (this.scale === null && this.defaultSize) this.scale = this.getFitScale();
    super.layout();
    for (const [index, slot] of this.slots.entries()) {
      const userUnit = this.views.get(index + 1)?.page?.userUnit || 1;
      for (const [name, value] of Object.entries({ '--scale-factor': this.displayScale, '--total-scale-factor': this.displayScale * userUnit, '--user-unit': userUnit, '--scale-round-x': '1px', '--scale-round-y': '1px' })) slot.style.setProperty(name, value);
    }
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
      view.viewport = viewport; view.layer = buffer.layer; view.paintedScale = scale;
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
        buffer.canvas.width = buffer.canvas.height = 0;
      }
    }
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
