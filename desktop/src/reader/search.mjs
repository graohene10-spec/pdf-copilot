// Plain-text search with offsets back into the original text. Unicode
// compatibility forms (including PDF ligatures) keep their original ranges.
export function normalizeSearchText(value) {
  return foldCase(String(value ?? '').normalize('NFKC')).replace(/\s+/gu, ' ').trim();
}
// Unicode default lowercasing makes sigma contextual in a whole word. Folding
// its final form keeps query and per-grapheme source normalization consistent.
function foldCase(value) { return value.toLowerCase().replace(/\u03c2/gu, '\u03c3'); }

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
function normalizedOffsets(value) {
  let text = '', whitespace = false;
  const starts = [], ends = [];
  // Normalizing a code point at a time misses decomposed accents and Hangul
  // composition. Grapheme offsets preserve the whole original glyph cluster.
  const clusters = graphemes ? graphemes.segment(value) : [...value.matchAll(/\P{M}\p{M}*|\p{M}+/gu)].map(match => ({ segment: match[0], index: match.index }));
  for (const { segment, index: start } of clusters) {
    const offset = start + segment.length;
    for (const normalized of foldCase(segment.normalize('NFKC'))) {
      if (/\s/u.test(normalized)) {
        if (whitespace) { ends[ends.length - 1] = offset; continue; }
        whitespace = true;
        text += ' '; starts.push(start); ends.push(offset);
      } else {
        whitespace = false; text += normalized;
        for (let index = 0; index < normalized.length; index++) { starts.push(start); ends.push(offset); }
      }
    }
  }
  return { text, starts, ends };
}

export function createTextSearchIndex(value) {
  const source = normalizedOffsets(String(value ?? ''));
  return {
    find(query, limit = 10000) {
      const needle = normalizeSearchText(query);
      if (!needle || limit <= 0) return [];
      const matches = [];
      for (let from = 0; matches.length < limit;) {
        const index = source.text.indexOf(needle, from);
        if (index < 0) break;
        matches.push({ start: source.starts[index], end: source.ends[index + needle.length - 1] });
        from = index + needle.length;
      }
      return matches;
    },
  };
}
export function matchText(value, query, limit = 10000) { return createTextSearchIndex(value).find(query, limit); }

function itemGap(previous, item) {
  if (!previous || !previous.str || !item.str || /\s$/u.test(previous.str) || /^\s/u.test(item.str)) return '';
  if (previous.hasEOL) return '\n';
  const before = previous.transform, after = item.transform;
  if (!before || !after) return '';
  const vertical = previous.dir === 'ttb';
  const height = Math.max(1, Math.abs(previous.height || before[3] || before[0]));
  if (Math.abs((vertical ? after[4] - before[4] : after[5] - before[5])) > height * .5) return '\n';
  const gap = previous.dir === 'rtl' ? before[4] - after[4] - Math.abs(item.width || 0) : vertical ? before[5] - after[5] - Math.abs(previous.width || 0) : after[4] - before[4] - Math.abs(previous.width || 0);
  return gap > height * .12 ? ' ' : '';
}

export function matchPdfItems(items, query, limit = 10000) {
  let source = '', previous;
  const ranges = [];
  let index = 0;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    source += itemGap(previous, item);
    const start = source.length;
    source += item.str;
    ranges.push({ item: index++, start, end: source.length });
    previous = item;
  }
  let firstRange = 0;
  return matchText(source, query, limit).map(match => {
    while (firstRange < ranges.length && ranges[firstRange].end <= match.start) firstRange++;
    const segments = [];
    for (let index = firstRange; index < ranges.length && ranges[index].start < match.end; index++) {
      const range = ranges[index];
      const start = Math.max(match.start, range.start) - range.start, end = Math.min(match.end, range.end) - range.start;
      if (end > start) segments.push({ item: range.item, start, end });
    }
    return { segments };
  }).filter(match => match.segments.length);
}

function abortError() { const error = new Error('Search canceled'); error.name = 'AbortError'; return error; }
async function pageItems(page, signal) {
  if (signal?.aborted) throw abortError();
  if (!page.streamTextContent) {
    const content = await page.getTextContent();
    if (signal?.aborted) throw abortError();
    return content.items;
  }
  const reader = page.streamTextContent().getReader(), items = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const result = await reader.read();
      if (signal?.aborted) throw abortError();
      if (result.done) return items;
      items.push(...result.value.items);
    }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/**
 * @param {any} pdf
 * @param {string} query
 * @param {{signal?: AbortSignal, onPage?: Function, releasePage?: Function, limit?: number, startPage?: number}} [options]
 */
export async function scanPdfMatches(pdf, query, { signal, onPage, releasePage, limit = 10000, startPage = 1 } = {}) {
  let total = 0;
  for (let number = startPage; number <= pdf.numPages; number++) {
    if (signal?.aborted) throw abortError();
    const page = await pdf.getPage(number);
    try {
      if (signal?.aborted) throw abortError();
      const items = await pageItems(page, signal);
      const matches = matchPdfItems(items, query, limit - total);
      total += matches.length;
      if (signal?.aborted) throw abortError();
      onPage?.(number, matches, total);
      if (total >= limit) return { total, limited: true };
    } finally { releasePage?.(number, page); }
    // Give typing, scrolling and active-page raster jobs a turn between pages.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { total, limited: false };
}
