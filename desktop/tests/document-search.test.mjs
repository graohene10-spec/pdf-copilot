import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextSearchIndex, matchText, matchPdfItems, scanPdfMatches } from '../src/reader/search.mjs';

test('plain document search preserves original offsets through case, whitespace and PDF ligatures', () => {
  const source = 'The ﬁle\n  ＰＤＦ and 😀pdf';
  assert.deepEqual(matchText(source, 'FILE'), [{ start: 4, end: 7 }]);
  const pdf = matchText(source, 'pdf');
  assert.deepEqual(pdf.map(match => source.slice(match.start, match.end)), ['ＰＤＦ', 'pdf']);
  assert.equal(source.slice(...Object.values(matchText(source, 'file pdf')[0])), 'ﬁle\n  ＰＤＦ');
  assert.deepEqual(matchText(source, '   '), []);
  assert.deepEqual(matchText('aaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  const index = createTextSearchIndex(source);
  assert.deepEqual(index.find('PDF', 1), [pdf[0]]);
  assert.deepEqual(index.find('not found'), []);
});

test('composed search terms match decomposed accents and Hangul without splitting original graphemes', () => {
  const source = 'cafe\u0301 and \u1100\u1161';
  assert.deepEqual(matchText(source, 'CAFÉ'), [{ start: 0, end: 5 }]);
  assert.deepEqual(matchText(source, '\uac00'), [{ start: 10, end: 12 }]);
  assert.deepEqual(matchText('ΟΣ ος οσ', 'ΟΣ'), [{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 8 }]);
});

test('PDF results map split glyph runs and inferred whitespace back into original text-layer spans', () => {
  const items = [
    { str: 'The ', transform: [12, 0, 0, 12, 10, 80], width: 24 },
    { str: 'ﬁ', transform: [12, 0, 0, 12, 34, 80], width: 10 },
    { str: 'le', transform: [12, 0, 0, 12, 44, 80], width: 12 },
    { str: 'PDF', transform: [12, 0, 0, 12, 60, 80], width: 22, hasEOL: true },
    { type: 'beginMarkedContent' },
    { str: 'next', transform: [12, 0, 0, 12, 10, 50], width: 30 },
  ];
  assert.deepEqual(matchPdfItems(items, 'file PDF'), [{ segments: [{ item: 1, start: 0, end: 1 }, { item: 2, start: 0, end: 2 }, { item: 3, start: 0, end: 3 }] }]);
  assert.deepEqual(matchPdfItems(items, 'pdf next'), [{ segments: [{ item: 3, start: 0, end: 3 }, { item: 4, start: 0, end: 4 }] }]);
});

test('PDF scanner reports incremental page results and releases every page without keeping text or proxies', async () => {
  const requested = [], released = [], pages = [];
  let simultaneous = 0, peak = 0;
  const pdf = { numPages: 4, async getPage(number) {
    requested.push(number); peak = Math.max(peak, ++simultaneous);
    return { async getTextContent() { return { items: [{ str: number % 2 ? 'alpha' : 'beta alpha' }] }; } };
  } };
  const result = await scanPdfMatches(pdf, 'alpha', { onPage: (number, matches) => pages.push([number, matches.length]), releasePage: number => { released.push(number); --simultaneous; } });
  assert.deepEqual(result, { total: 4, limited: false });
  assert.deepEqual(pages, [[1, 1], [2, 1], [3, 1], [4, 1]]);
  assert.deepEqual(requested, released);
  assert.equal(peak, 1);
});

test('new queries can cancel an unfinished text stream and release the page before scanning more pages', async () => {
  const controller = new AbortController();
  let canceled = false, released = false, pages = 0;
  const pdf = { numPages: 20, async getPage() {
    pages++;
    return { streamTextContent() { return new ReadableStream({ start(stream) { stream.enqueue({ items: [{ str: 'alpha' }] }); setTimeout(() => controller.abort(), 5); }, cancel() { canceled = true; } }); } };
  } };
  await assert.rejects(scanPdfMatches(pdf, 'alpha', { signal: controller.signal, releasePage() { released = true; } }), { name: 'AbortError' });
  assert.equal(canceled, true);
  assert.equal(released, true);
  assert.equal(pages, 1);
});

test('bounded search stops at the match budget and still cleans up the last page', async () => {
  const released = [], visited = [];
  const pdf = { numPages: 100, async getPage(number) { visited.push(number); return { async getTextContent() { return { items: [{ str: 'x x x x' }] }; } }; } };
  assert.deepEqual(await scanPdfMatches(pdf, 'x', { limit: 5, releasePage: number => released.push(number) }), { total: 5, limited: true });
  assert.deepEqual(visited, [1, 2]);
  assert.deepEqual(released, visited);
});

test('paused tab searches resume after the last fully scanned page', async () => {
  const visited = [];
  const pdf = { numPages: 4, async getPage(number) { visited.push(number); return { async getTextContent() { return { items: [{ str: 'alpha' }] }; } }; } };
  const result = await scanPdfMatches(pdf, 'alpha', { startPage: 3 });
  assert.deepEqual(visited, [3, 4]);
  assert.equal(result.total, 2);
});
