export function normalizeText(text) { return String(text).normalize('NFKC').toLowerCase().replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2').replace(/\s+/g, ' ').trim(); }
export function tokens(text) {
  const result = [];
  for (const word of normalizeText(text).match(/[\p{L}\p{N}]+/gu) || []) {
    if (/\p{Script=Han}/u.test(word)) {
      const chars = [...word];
      for (let i = 0; i < chars.length - 1; i++) result.push(chars[i] + chars[i + 1]);
      if (chars.length === 1) result.push(word);
    } else result.push(word);
  }
  return result;
}
const union = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y, space: 'pdf-points' };
};
// Preserve raw text and PDF geometry; only the index uses normalized text.
export function textBlocks(content, pageNumber, pageWidth) {
  const items = content.items.filter(item => typeof item.str === 'string' && item.str.trim()).slice(0, 15000).map(item => {
    const height = Math.max(1, Math.abs(item.height || item.transform?.[3] || 10));
    return { text: item.str, x: item.transform[4], y: item.transform[5], height,
      rect: { x: item.transform[4], y: item.transform[5] - height * .2, width: Math.max(1, Math.abs(item.width || height)), height, space: 'pdf-points' } };
  });
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of items) {
    let line = lines.slice(-12).find(line => Math.abs(line.y - item.y) < Math.max(2, item.height * .35));
    if (!line) { line = { y: item.y, height: item.height, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  const runs = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let run;
    for (const item of line.items) {
      if (!run || item.x - (run.rect.x + run.rect.width) > Math.max(24, item.height * 3)) {
        run = { text: item.text, rect: item.rect, y: line.y, height: line.height }; runs.push(run);
      } else { run.text += ' ' + item.text; run.rect = union(run.rect, item.rect); }
    }
  }
  // A persistent central gutter is a conservative signal for two columns.
  const middle = pageWidth / 2;
  const left = runs.filter(run => run.rect.x < middle * .8 && run.rect.x + run.rect.width < middle + 12);
  const right = runs.filter(run => run.rect.x > middle - 12 && run.rect.width < pageWidth * .55);
  const columns = left.length >= 5 && right.length >= 5;
  const column = run => !columns ? 0 : run.rect.width > pageWidth * .65 ? -1 : run.rect.x >= middle - 12 ? 1 : 0;
  runs.sort((a, b) => column(a) - column(b) || b.y - a.y || a.rect.x - b.rect.x);
  const blocks = [];
  let prior;
  for (const run of runs) {
    const block = blocks.at(-1);
    if (block && prior && column(run) === column(prior) && prior.y - run.y >= 0 && prior.y - run.y < Math.max(run.height, prior.height) * 1.8 && Math.abs(run.rect.x - prior.rect.x) < 30 && block.text.length + run.text.length < 1200) {
      block.text += '\n' + run.text; block.rect = union(block.rect, run.rect);
    } else blocks.push({ blockId: `p${pageNumber}-b${blocks.length}`, text: run.text.slice(0, 1200), rect: run.rect });
    prior = run;
  }
  return blocks.slice(0, 300);
}
export class TextIndex {
  constructor() { this.pages = new Map(); this.characters = 0; }
  add(page, blocks) {
    if (this.pages.has(page)) this.characters -= this.pages.get(page).reduce((n, b) => n + b.text.length, 0);
    const indexed = blocks.map(block => {
      const words = tokens(block.text), terms = new Map();
      for (const word of words) terms.set(word, (terms.get(word) || 0) + 1);
      return { ...block, normalized: normalizeText(block.text), terms, length: words.length };
    });
    this.pages.delete(page); this.pages.set(page, indexed);
    this.characters += indexed.reduce((n, b) => n + b.text.length, 0);
    while (this.pages.size > 256 || this.characters > 2_000_000) {
      const oldest = this.pages.keys().next().value;
      this.characters -= this.pages.get(oldest).reduce((n, b) => n + b.text.length, 0); this.pages.delete(oldest);
    }
    return indexed;
  }
  get(page) { return this.pages.get(page); }
  search(query, start = 1, end = Infinity, limit = 6) {
    const docs = [...this.pages].filter(([page]) => page >= start && page <= end).flatMap(([page, blocks]) => blocks.map(block => ({ ...block, page })));
    const terms = [...new Set(tokens(query))].slice(0, 24), exact = normalizeText(query), average = docs.reduce((n, b) => n + b.length, 0) / (docs.length || 1);
    const idf = new Map(terms.map(term => [term, Math.log(1 + (docs.length - docs.filter(b => b.terms.has(term)).length + .5) / (docs.filter(b => b.terms.has(term)).length + .5))]));
    return docs.map(block => {
      let score = exact && block.normalized.includes(exact) ? 20 : 0;
      for (const term of terms) { const count = block.terms.get(term) || 0; score += (idf.get(term) || 0) * count * 2.2 / (count + 1.2 * (.25 + .75 * block.length / (average || 1))); }
      return { block, score };
    }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.block.page - b.block.page).slice(0, limit).map(hit => hit.block);
  }
  clear() { this.pages.clear(); this.characters = 0; }
}
