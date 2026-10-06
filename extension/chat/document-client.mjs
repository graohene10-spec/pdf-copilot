export function createDocumentClient(source, signal, onEvidence = () => {}, onProgress = () => {}) {
  const sessionId = crypto.randomUUID();
  let closed = false, remaining;
  const envelope = { type: 'document:request', tabId: source.id, documentKey: source.documentKey, sessionId };
  const close = () => {
    if (closed) return;
    closed = true; signal?.removeEventListener('abort', close);
    chrome.runtime.sendMessage({ ...envelope, operation: 'end' }).catch(() => {});
  };
  signal?.addEventListener('abort', close, { once: true });
  const query = async (operation, args, tool) => {
    signal?.throwIfAborted(); if (closed) throw new DOMException('已停止读取 PDF', 'AbortError');
    let timer, abort;
    try {
      const response = await Promise.race([
        chrome.runtime.sendMessage({ ...envelope, operation, args, tool }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF 读取超时，请缩小页码范围后重试。')), 45000); }),
        new Promise((_, reject) => { abort = () => reject(signal.reason || new DOMException('已停止', 'AbortError')); signal?.addEventListener('abort', abort, { once: true }); }),
      ]);
      signal?.throwIfAborted();
      if (!response?.ok) throw new Error(response?.error || '增强阅读器已关闭，无法继续读取。');
      const result = response.result;
      if (result.remaining) remaining = { ...result.remaining };
      const evidence = result.evidence || result.seed?.evidence || [];
      onEvidence(evidence.map(item => ({ ...item, source: { name: source.title, tabId: source.id, fingerprint: source.documentKey, page: item.page, pageLabel: item.pageLabel, rect: item.rect } })));
      return result;
    } catch (error) { if (operation === 'begin' || error.message.includes('超时')) close(); throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
  return {
    close,
    get remaining() { return remaining && { ...remaining }; },
    async begin(anchor, vision, rect, limits) { onProgress('正在读取问题附近的上下文…'); return query('begin', { anchor, vision, rect, limits }); },
    async tool(name, args) {
      onProgress(name === 'pdf_search' ? '正在查找相关定义与公式…' : name === 'pdf_info' ? '正在查看文档目录…' : name === 'pdf_view' ? `正在查看 PDF 第 ${args.page} 页图片…` : `正在读取 PDF 第 ${args.start_page}${args.end_page > args.start_page ? '–' + args.end_page : ''} 页…`);
      return query('tool', args, name);
    },
  };
}
