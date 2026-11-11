import { selectionRect, canvasCrop, dataUrlBytes, MAX_IMAGE_BYTES, MAX_IMAGE_DATA_URL_LENGTH } from './geometry.mjs';

// The overlay receives pointer events only in capture mode, preserving the
// standard PDF.js text selection in normal reading mode.
// Right-button drags (opt-in per selector) share one document-level guard: the
// context menu belongs to a plain right click, never to the end of a drag.
// Windows raises `contextmenu` on release, Linux and macOS on press, so a menu
// raised while the button is still down is held back and replayed on a plain click.
let rightDrag = null;
let swallowMenuUntil = 0;
let menuGuard = false;
function guardContextMenu() {
  if (menuGuard || typeof document === 'undefined') return;
  menuGuard = true;
  document.addEventListener('contextmenu', event => {
    if (event.replayed) return;
    if (rightDrag) rightDrag.menu = { target: event.target, x: event.clientX, y: event.clientY };
    else if (performance.now() >= swallowMenuUntil) return;
    swallowMenuUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
const DRAG_START = 6;

export function rectangleSelector(surface, overlay, onSelect) {
  let start = null;
  let active = false;
  let secondary = false;
  let drag = null;
  let pointerId = null;
  const point = event => {
    const box = surface.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const paint = rect => {
    overlay.style.left = `${rect.x}px`;
    overlay.style.top = `${rect.y}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.hidden = false;
  };
  const clear = () => {
    start = null; overlay.hidden = true;
    if (drag && rightDrag === drag) rightDrag = null;
    drag = null;
    if (pointerId !== null && surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
    pointerId = null;
  };
  const down = event => {
    if (secondary && event.button === 2) {
      // Nothing is drawn until the pointer really moves: a plain right click keeps its menu.
      clear();
      start = point(event);
      pointerId = event.pointerId;
      drag = rightDrag = { moved: false, menu: null };
      surface.setPointerCapture(event.pointerId);
      return;
    }
    if (!active || event.button !== 0) return;
    event.preventDefault();
    start = point(event);
    pointerId = event.pointerId;
    surface.setPointerCapture(event.pointerId);
    paint({ ...start, width: 0, height: 0 });
  };
  const move = event => {
    if (!start) return;
    if (drag && !drag.moved) {
      const now = point(event);
      if (Math.hypot(now.x - start.x, now.y - start.y) < DRAG_START) return;
      drag.moved = true;
      surface.classList.add('capture-drag');
    }
    const box = surface.getBoundingClientRect();
    paint(selectionRect(start, point(event), box.width, box.height));
  };
  const up = event => {
    if (!start) return;
    const box = surface.getBoundingClientRect();
    const rect = selectionRect(start, point(event), box.width, box.height);
    const right = drag;
    clear();
    if (right) {
      surface.classList.remove('capture-drag');
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
      if (right.moved) {
        // The menu Windows raises on release belongs to this drag, not to a click.
        swallowMenuUntil = performance.now() + 400;
        if (rect.width >= 8 && rect.height >= 8) onSelect(rect);
      } else if (right.menu) {
        const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: right.menu.x, clientY: right.menu.y });
        menu.replayed = true;
        (right.menu.target.isConnected ? right.menu.target : surface).dispatchEvent(menu);
      }
      return;
    }
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (rect.width >= 4 && rect.height >= 4) onSelect(rect);
  };
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointercancel', clear);
  return {
    setActive(value) {
      active = value;
      clear();
      surface.classList.toggle('capture-mode', value);
    },
    /** Right-button drags frame a region even outside capture mode (for scanned pages without a text layer). */
    setSecondary(value) {
      secondary = Boolean(value);
      if (secondary) guardContextMenu();
      else if (drag) { clear(); surface.classList.remove('capture-drag'); }
    },
    clear,
    dispose() {
      active = false;
      secondary = false;
      surface.classList.remove('capture-drag');
      clear();
      surface.classList.remove('capture-mode');
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointercancel', clear);
    },
  };
}

export function cropImage(source, rect, displayWidth, displayHeight) {
  const crop = canvasCrop(rect, displayWidth, displayHeight, source.naturalWidth || source.width, source.naturalHeight || source.height);
  if (crop.width < 1 || crop.height < 1) throw new Error('请框选更大的区域。');
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, Math.sqrt(8_000_000 / (crop.width * crop.height)));
  canvas.width = Math.max(1, Math.round(crop.width * ratio));
  canvas.height = Math.max(1, Math.round(crop.height * ratio));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  let dataUrl = canvas.toDataURL('image/png');
  // PNG has no lossy quality setting. Downsample unusually complex regions
  // instead, keeping the bytes in memory and never exporting a temporary file.
  while ((dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES || dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) && canvas.width > 64 && canvas.height > 64) {
    const reduced = document.createElement('canvas');
    reduced.width = Math.max(1, Math.floor(canvas.width * 0.75));
    reduced.height = Math.max(1, Math.floor(canvas.height * 0.75));
    reduced.getContext('2d').drawImage(canvas, 0, 0, reduced.width, reduced.height);
    canvas.width = reduced.width;
    canvas.height = reduced.height;
    canvas.getContext('2d').drawImage(reduced, 0, 0);
    reduced.width = reduced.height = 0;
    dataUrl = canvas.toDataURL('image/png');
  }
  canvas.width = canvas.height = 0;
  if (dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES || dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error('选区图片太大，请缩小范围后再试。');
  return dataUrl;
}
