export function nativeRequest(type, signal) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative('com.pdfcopilot.codex');
    const id = crypto.randomUUID();
    const timer = setTimeout(() => finish(new Error('Codex 小助手响应超时，请检查安装和 Codex 路径。')), 30000);
    let settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      port.disconnect();
      if (error) reject(error); else resolve(value);
    }
    const abort = () => finish(signal.reason || new DOMException('已取消', 'AbortError'));
    port.onDisconnect.addListener(() => finish(new Error(chrome.runtime.lastError?.message || 'Windows 小助手连接已断开。')));
    port.onMessage.addListener(msg => { if (msg.id === id) finish(msg.ok ? null : new Error(msg.error), msg.result); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    port.postMessage({ id, type });
  });
}
export const getNativeModels = signal => nativeRequest('models', signal);
export const getNativeStatus = signal => nativeRequest('status', signal);

export function streamNative({ model, effort, messages, signal, onDelta, onReasoning, pdfTools = false, pdfVision = false, pdfLimits, onTool }) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative('com.pdfcopilot.codex');
    const id = crypto.randomUUID();
    let settled = false;
    let toolQueue = Promise.resolve();
    const toolReplies = new Set();
    let received = false;
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      port.disconnect();
      if (error) reject(error); else resolve();
    }
    const abort = () => {
      try { port.postMessage({ id: crypto.randomUUID(), type: 'cancel', targetId: id }); } catch {}
      finish(signal.reason || new DOMException('已取消', 'AbortError'));
    };
    const timer = setTimeout(() => { try { port.postMessage({ id: crypto.randomUUID(), type: 'cancel', targetId: id }); } catch {} finish(new Error('对话超过 10 分钟，已停止。')); }, 10 * 60000);
    port.onDisconnect.addListener(() => finish(new Error(chrome.runtime.lastError?.message || 'Codex 小助手断开了连接。')));
    port.onMessage.addListener(msg => {
      if (toolReplies.has(msg.id) && msg.ok === false) { finish(new Error(msg.error || '小助手拒绝了 PDF 阅读结果，请降低资源限制后重试。')); return; }
      if (msg.id !== id) return;
      if (msg.event === 'delta') { received = true; onDelta?.(msg.text); }
      if (msg.event === 'reasoning') onReasoning?.(msg.text);
      if (msg.event === 'tool') {
        if (!pdfTools || !onTool || typeof msg.callId !== 'string') { finish(new Error('小助手返回了未启用的工具请求。')); return; }
        toolQueue = toolQueue.then(async () => {
          if (settled) return;
          let result;
          try { result = await onTool(msg.tool, msg.arguments); }
          catch (error) { signal?.throwIfAborted(); result = { error: error.message }; }
          if (settled || signal?.aborted) return;
          const { dataUrl, ...text } = result;
          const replyId = crypto.randomUUID(); toolReplies.add(replyId);
          port.postMessage({ id: replyId, type: 'tool-result', targetId: id, callId: msg.callId, text: JSON.stringify(text), images: dataUrl ? [dataUrl] : [] });
        }).catch(error => { if (!settled) finish(error); });
      }
      if (msg.event === 'done') finish();
      if (msg.event === 'error' || msg.ok === false) {
        const error = new Error(msg.error || 'Codex 请求失败。');
        if (pdfTools && !received && /Unsupported request field/.test(error.message)) {
          error.code = 'PDF_LIMITS_UNAVAILABLE'; error.message = '当前 Windows 小助手不支持自定义资源限制，请运行新版 windows-helper/install.cmd 更新助手后重试。';
        } else if (pdfTools && !received && /PDF_TOOLS_UNAVAILABLE/.test(error.message)) error.code = 'PDF_TOOLS_UNAVAILABLE';
        finish(error);
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    const latest = messages.at(-1);
    port.postMessage({ id, type: 'chat', model, effort, text: latest.content,
      history: messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
      images: messages.flatMap(item => item.images || []), ...(pdfTools ? { pdfTools: true, pdfVision, ...(pdfLimits ? { pdfLimits } : {}) } : {}) });
  });
}
export const streamNativeDocument = options => streamNative({ ...options, pdfTools: true, pdfVision: options.tools.some(tool => tool.name === 'pdf_view') });
