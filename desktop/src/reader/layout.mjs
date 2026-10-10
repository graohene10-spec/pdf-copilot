const MIN_SCALE = .25;
const MAX_SCALE = 4;
const MIN_AUTO_SCALE = .001;

/** @param {number} clientWidth @param {number|string} paddingLeft @param {number|string} paddingRight */
export function availableReadingWidth(clientWidth, paddingLeft = 0, paddingRight = 0) {
  return Math.max(0, Number(clientWidth) - (parseFloat(paddingLeft) || 0) - (parseFloat(paddingRight) || 0));
}

// Measure the current page in CSS pixels. Its size may differ from the first
// page, and the backing canvas may use a higher device-pixel ratio.
export function shrinkToFitScale(renderedWidth, availableWidth, currentScale) {
  if (![renderedWidth, availableWidth, currentScale].every(Number.isFinite)
      || availableWidth <= 0 || currentScale <= 0 || renderedWidth <= availableWidth + 1) return null;
  // Multiple sidebars can leave less than 25% of a page. The manual zoom
  // limits must not prevent auto-fit, or raise an already smaller scale.
  const next = Math.max(Math.min(MIN_AUTO_SCALE, currentScale), currentScale * availableWidth / renderedWidth);
  return next < currentScale * (1 - .000001) ? next : null;
}

export function clampPdfScale(value) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number.isFinite(value) ? value : 1));
}

export function clampMarkdownFontSize(value) {
  return Math.max(13, Math.min(28, Number.isFinite(value) ? value : 17));
}

export function clampMarkdownContentWidth(value) {
  return Math.max(600, Math.min(1400, Number.isFinite(value) ? value : 820));
}

export function readingScrollTarget(top, viewportHeight, contentHeight, direction) {
  const max = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(max, top + direction * viewportHeight * .85));
}
