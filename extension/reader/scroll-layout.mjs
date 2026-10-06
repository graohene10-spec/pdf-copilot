export const PAGE_GAP = 24;
export const MAX_RENDERED_PAGES = 3;

export function pageOffsets(heights, gap = PAGE_GAP) {
  const offsets = [0];
  for (let index = 0; index < heights.length; index++) offsets.push(offsets[index] + heights[index] + (index < heights.length - 1 ? gap : 0));
  return offsets;
}

export function pageAtOffset(offsets, position) {
  let low = 0, high = offsets.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

export function visiblePage(offsets, heights, scrollTop, viewportHeight) {
  const bottom = scrollTop + viewportHeight;
  const anchor = scrollTop + viewportHeight / 2;
  let page = pageAtOffset(offsets, scrollTop), overlap = -1, distance = Infinity;
  for (let index = page - 1; index < heights.length && offsets[index] < bottom; index++) {
    const pixels = Math.max(0, Math.min(bottom, offsets[index] + heights[index]) - Math.max(scrollTop, offsets[index]));
    const fromAnchor = Math.abs(offsets[index] + heights[index] / 2 - anchor);
    if (pixels > overlap || (pixels === overlap && fromAnchor < distance)) {
      page = index + 1; overlap = pixels; distance = fromAnchor;
    }
  }
  return page;
}

export function renderWindow(page, count, limit = MAX_RENDERED_PAGES) {
  const length = Math.min(limit, count);
  const start = Math.max(1, Math.min(count - length + 1, page - Math.floor(length / 2)));
  return Array.from({ length }, (_, index) => start + index);
}
