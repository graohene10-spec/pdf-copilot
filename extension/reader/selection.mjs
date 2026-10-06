import { selectionRect, canvasCrop, dataUrlBytes, MAX_IMAGE_BYTES, MAX_IMAGE_DATA_URL_LENGTH } from './geometry.mjs';

// The overlay receives pointer events only in capture mode, preserving the
// standard PDF.js text selection in normal reading mode.
export function rectangleSelector(surface, overlay, onSelect) {
  let start = null;
  let active = false;
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
    if (pointerId !== null && surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
    pointerId = null;
  };
  const down = event => {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    start = point(event);
    pointerId = event.pointerId;
    surface.setPointerCapture(event.pointerId);
    paint({ ...start, width: 0, height: 0 });
  };
  const move = event => {
    if (!start) return;
    const box = surface.getBoundingClientRect();
    paint(selectionRect(start, point(event), box.width, box.height));
  };
  const up = event => {
    if (!start) return;
    const box = surface.getBoundingClientRect();
    const rect = selectionRect(start, point(event), box.width, box.height);
    clear();
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
    clear,
    dispose() {
      active = false;
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
