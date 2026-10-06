import { DOCUMENT_LIMITS as limits, validateToolCall } from '../common/document-tools.mjs';
import { TextIndex, textBlocks } from './text-index.mjs';
import { destinationPage } from './geometry.mjs';

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
export class DocumentService {
  constructor(pdf, source, currentPage, viewPage, canCleanup = () => false) {
    this.pdf = pdf; this.source = source; this.currentPage = currentPage; this.viewPage = viewPage;
    this.index = new TextIndex(); this.loading = new Map(); this.sessions = new Map(); this.closed = false;
    this.canCleanup = canCleanup;
  }
  close() { this.closed = true; for (const session of this.sessions.values()) session.controller.abort(); this.sessions.clear(); this.index.clear(); this.loading.clear(); }
  assert(session) {
    session.controller.signal.throwIfAborted();
    if (this.closed) throw new Error('文档已关闭或切换。');
    if (Date.now() - session.created > 10 * 60000) { this.end(session.id); throw new Error('PDF 阅读请求已过期。'); }
  }
  end(id) { const session = this.sessions.get(id); session?.controller.abort(); this.sessions.delete(id); return { closed: true }; }
  async blocks(page, session) {
    this.assert(session);
    const cached = this.index.get(page); if (cached) return cached;
    if (!this.loading.has(page)) {
      const work = (async () => {
        const pdfPage = await this.pdf.getPage(page);
        const content = await pdfPage.getTextContent();
        if (this.closed) throw new Error('文档已切换。');
        const blocks = textBlocks(content, page, pdfPage.getViewport({ scale: 1 }).width);
        if (this.canCleanup(page)) pdfPage.cleanup?.();
        return this.index.add(page, blocks);
      })().finally(() => this.loading.delete(page));
      this.loading.set(page, work);
    }
    const value = await this.loading.get(page); this.assert(session); return value;
  }
  async metadata(session, offset = 0) {
    if (!this.metadataPromise) this.metadataPromise = (async () => {
      const [labels, outline] = await Promise.all([this.pdf.getPageLabels().catch(() => null), this.pdf.getOutline().catch(() => null)]);
      const entries = [];
      const flatten = (items, depth = 0) => {
        for (const item of items || []) { if (entries.length >= 400) break; entries.push({ title: String(item.title || '').slice(0, 180), dest: item.dest, depth }); }
        for (const item of items || []) { if (entries.length >= 400 || depth >= 12) break; flatten(item.items, depth + 1); }
      };
      flatten(outline); return { labels, entries };
    })();
    const data = await this.metadataPromise; this.assert(session);
    const resolve = async entry => {
      if (entry.page === undefined) entry.page = await destinationPage(this.pdf, entry.dest).catch(() => null);
      this.assert(session); return { title: entry.title, depth: entry.depth, page: entry.page, pageLabel: entry.page ? data.labels?.[entry.page - 1] || null : null };
    };
    const outline = [], roots = [];
    for (const entry of data.entries.filter(item => item.depth === 0).slice(0, 80)) roots.push(await resolve(entry));
    for (const entry of data.entries.slice(offset, offset + 30)) {
      outline.push(await resolve(entry));
    }
    const ordered = roots.filter(item => item.page).sort((a, b) => a.page - b.page);
    const at = ordered.findLastIndex(item => item.page <= session.anchor);
    const nearbyOutline = ordered.slice(Math.max(0, at - 1), Math.max(0, at - 1) + 4);
    return { name: this.source.name || 'PDF', pages: this.pdf.numPages, currentPage: session.anchor,
      pageLabel: data.labels?.[session.anchor - 1] || null, outline, nearbyOutline, nextOutlineOffset: offset + outline.length < data.entries.length ? offset + outline.length : null,
      outlineTruncated: data.entries.length >= 400, textNotice: '文字可能丢失公式排版；扫描页可能没有可检索文字。PDF 页码是从 1 开始的物理页序。' };
  }
  async begin(id, anchor, vision, rect) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('PDF 会话编号无效。');
    for (const [key, session] of this.sessions) if (Date.now() - session.created > 10 * 60000) this.end(key);
    if (this.sessions.has(id) || this.sessions.size >= 4) throw new Error('PDF 阅读连接过多，请停止其他对话后重试。');
    anchor = Number.isInteger(anchor) && anchor >= 1 && anchor <= this.pdf.numPages ? anchor : this.currentPage();
    const session = { id, anchor, vision: vision === true, created: Date.now(), controller: new AbortController(), pages: new Set(), chars: 0, calls: 0, images: 0, evidence: new Map(), prefix: 'S' + id.replaceAll('-', '').slice(0, 6), busy: false };
    this.sessions.set(id, session);
    try {
      const info = await this.metadata(session);
      const seed = await this.read(session, { start_page: anchor, anchor_rect: rect }, limits.seedCharacters);
      return { info, seed, limits };
    } catch (error) { this.end(id); throw error; }
  }
  evidence(session, block, page, maxChars) {
    if (session.chars >= limits.characters) return null;
    if (!session.pages.has(page) && session.pages.size >= limits.pages) return null;
    const length = Math.min(maxChars, limits.characters - session.chars);
    const text = block.text.slice(0, length); if (!text) return null;
    const key = page + ':' + block.blockId;
    if (!session.evidence.has(key)) session.evidence.set(key, session.prefix + '-' + (session.evidence.size + 1));
    session.pages.add(page); session.chars += text.length;
    return { sourceId: session.evidence.get(key), page, pageLabel: this.labels?.[page - 1] || null, blockId: block.blockId, text, rect: block.rect, truncated: text.length < block.text.length };
  }
  async read(session, args, maximum = 9000) {
    this.assert(session); const metadata = await this.metadataPromise; this.labels = metadata?.labels;
    const evidence = []; let count = 0, truncated = false, noText = [];
    for (let page = args.start_page; page <= (args.end_page ?? args.start_page); page++) {
      if (!session.pages.has(page) && session.pages.size >= limits.pages) { truncated = true; break; }
      const blocks = await this.blocks(page, session);
      if (!blocks.length) noText.push(page);
      let selected = blocks;
      if (args.anchor_rect?.space === 'pdf-points' && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(args.anchor_rect[key]))) {
        const rect = args.anchor_rect, center = rect.y + rect.height / 2;
        const nearest = blocks.map((block, at) => ({ at, distance: Math.abs(block.rect.y + block.rect.height / 2 - center) + Math.abs(block.rect.x - rect.x) * .2 })).sort((a, b) => a.distance - b.distance)[0]?.at;
        if (nearest !== undefined) selected = blocks.slice(Math.max(0, nearest - 2), nearest + 4);
      }
      if (args.block_id) {
        const at = blocks.findIndex(b => b.blockId === args.block_id);
        if (at < 0) throw new Error('该段落不属于请求页。');
        selected = blocks.slice(Math.max(0, at - 2), at + 3);
      }
      for (const block of selected) {
        const item = this.evidence(session, block, page, Math.min(1200, maximum - count));
        if (!item) { truncated = true; break; }
        evidence.push(item); count += item.text.length;
        if (count >= maximum) { truncated = true; break; }
      }
      if (truncated) break;
    }
    return { evidence, noTextPages: noText, truncated, remainingCharacters: limits.characters - session.chars, remainingPages: limits.pages - session.pages.size };
  }
  async search(session, args) {
    const start = args.start_page ?? 1, end = args.end_page ?? this.pdf.numPages;
    const first = args.next_page ?? start;
    if (first < start || first > end) throw new Error('搜索续页超出范围。');
    const deadline = Date.now() + limits.searchMilliseconds;
    let page = first, scanned = 0, nearbyScanned = 0;
    if (args.next_page == null && args.start_page == null && args.end_page == null) {
      for (let nearby = Math.max(1, session.anchor - 8); nearby <= Math.min(this.pdf.numPages, session.anchor + 3) && Date.now() < deadline; nearby++) {
        await this.blocks(nearby, session); await pause(); this.assert(session);
        nearbyScanned++;
      }
    }
    // Query existing pages immediately; scanning below progressively extends coverage.
    for (; page <= end && scanned + nearbyScanned < limits.searchPages && Date.now() < deadline; page++, scanned++) {
      await this.blocks(page, session); await pause(); this.assert(session);
    }
    const evidence = [];
    for (const block of this.index.search(args.query, start, end)) {
      const item = this.evidence(session, block, block.page, 450); if (item) evidence.push(item);
    }
    const covered = [...this.index.pages.keys()].filter(n => n >= start && n <= end).sort((a, b) => a - b);
    return { evidence, searchRange: [start, end], scannedRange: scanned ? [first, page - 1] : null,
      indexedPages: covered.length, complete: covered.length === end - start + 1, next_page: page <= end ? page : null,
      notice: covered.length === end - start + 1 ? '该范围文字搜索完成；没有文字层的内容不在检索范围内。' : '仅覆盖部分页面；无命中不能解释为全文不存在。可用 next_page 继续搜索。' };
  }
  async tool(id, name, args) {
    const session = this.sessions.get(id); if (!session) throw new Error('PDF 阅读会话已结束。');
    this.assert(session); validateToolCall(name, args, this.pdf.numPages);
    if (++session.calls > limits.calls) throw new Error('已达到本题 PDF 阅读次数上限。');
    if (session.busy) throw new Error('请等待当前 PDF 阅读完成。');
    session.busy = true;
    try {
      if (name === 'pdf_info') return await this.metadata(session, args.outline_offset ?? 0);
      if (name === 'pdf_read') return await this.read(session, args);
      if (name === 'pdf_search') return await this.search(session, args);
      if (!session.vision) throw new Error('当前模型不支持读取图片。');
      if (session.images >= limits.images || (!session.pages.has(args.page) && session.pages.size >= limits.pages)) throw new Error('已达到本题图片或页数上限。');
      let rect, original;
      if (args.block_id) { original = (await this.blocks(args.page, session)).find(b => b.blockId === args.block_id); rect = original?.rect; if (!rect) throw new Error('该段落不属于请求页。'); }
      const dataUrl = await this.viewPage(args.page, rect, session.controller.signal); this.assert(session);
      session.images++; session.pages.add(args.page);
      const block = { blockId: args.block_id || `p${args.page}-b999999`, text: original?.text || '附图：请以图片核对公式或图表。', rect };
      const evidence = this.evidence(session, block, args.page, 1200);
      return { evidence: evidence ? [evidence] : [], dataUrl, page: args.page, pageLabel: this.labels?.[args.page - 1] || null };
    } finally { session.busy = false; }
  }
}

export async function renderDocumentImage(pdf, number, rect, signal) {
  signal.throwIfAborted();
  const page = await pdf.getPage(number); signal.throwIfAborted();
  const raw = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2, 1536 / Math.max(raw.width, raw.height)) });
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
  const cancel = () => task.cancel(); signal.addEventListener('abort', cancel, { once: true });
  let crop;
  try {
    await task.promise; signal.throwIfAborted(); let output = canvas;
    if (rect) {
      const [a, b] = viewport.convertToViewportPoint(rect.x - 12, rect.y - 18);
      const [c, d] = viewport.convertToViewportPoint(rect.x + rect.width + 12, rect.y + rect.height + 18);
      const x = Math.max(0, Math.floor(Math.min(a, c))), y = Math.max(0, Math.floor(Math.min(b, d)));
      const width = Math.max(1, Math.min(canvas.width - x, Math.ceil(Math.abs(c - a)))), height = Math.max(1, Math.min(canvas.height - y, Math.ceil(Math.abs(d - b))));
      crop = document.createElement('canvas'); crop.width = width; crop.height = height;
      crop.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height); output = crop;
    }
    for (const quality of [.85, .65, .45, .25]) { const value = output.toDataURL('image/jpeg', quality); if (value.length <= 768000) return value; }
    throw new Error('该页图片过大，请手动框选较小区域。');
  } finally { signal.removeEventListener('abort', cancel); canvas.width = canvas.height = 0; if (crop) crop.width = crop.height = 0; }
}
