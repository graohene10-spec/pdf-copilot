// AI streams need cancellation of the in-flight native read, not just a closed JS reader.
// Keep the transport independent of Tauri imports so its lifecycle can be tested directly.
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024;
export function createNativeHttpFetch(invoke, Channel) {
  return function nativeHttpFetch(input, init = {}) {
    const signal = init.signal;
    if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('已取消', 'AbortError'));
    const method = String(init.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) return Promise.reject(new Error('AI HTTP 只支持 GET / POST。'));
    if (init.body != null && typeof init.body !== 'string') return Promise.reject(new Error('AI HTTP 请求正文必须是文本。'));
    if (method === 'GET' && init.body != null) return Promise.reject(new Error('GET 请求不能包含正文。'));
    if (init.body && new TextEncoder().encode(init.body).length > MAX_BODY_BYTES) return Promise.reject(new Error('AI HTTP 请求正文超过 16 MiB。'));
    const id = crypto.randomUUID();
    const channel = new Channel();
    let controller, resolveResponse, rejectResponse, responseSettled = false;
    let finished = false, canceled = false, cancelSent = false, started, responseBytes = 0;
    const responsePromise = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    const errorOf = value => value instanceof Error || value instanceof DOMException ? value : new Error(String(value));
    const removeListener = () => signal?.removeEventListener('abort', abort);
    const sendCancel = () => {
      if (cancelSent) return;
      cancelSent = true;
      // Registration must finish first: cancellation cannot overtake a request's start command.
      return Promise.resolve(started).then(() => invoke('http_cancel', { id })).catch(() => {});
    };
    const fail = reason => {
      if (finished || canceled) return;
      finished = true; removeListener();
      const error = errorOf(reason);
      if (!responseSettled) { responseSettled = true; rejectResponse(error); }
      controller.error(error);
    };
    const abort = () => {
      if (finished || canceled) return;
      canceled = true; removeListener();
      const error = signal?.reason || new DOMException('已取消', 'AbortError');
      if (!responseSettled) { responseSettled = true; rejectResponse(error); }
      controller.error(error);
      void sendCancel();
    };
    const body = new ReadableStream({
      start(value) { controller = value; },
      cancel() {
        if (finished || canceled) return;
        canceled = true; removeListener();
        return sendCancel();
      },
    });
    channel.onmessage = event => {
      if (finished || canceled) return;
      try {
        if (event.type === 'headers') {
          if (responseSettled) throw new Error('HTTP 重复返回响应头。');
          const response = new Response([204, 205, 304].includes(event.status) ? null : body, {
            status: event.status, statusText: event.statusText || '', headers: event.headers || [],
          });
          responseSettled = true; resolveResponse(response);
        } else if (event.type === 'chunk') {
          if (!responseSettled) throw new Error('HTTP 在响应头之前返回了正文。');
          if (!Array.isArray(event.data) || event.data.length > MAX_CHUNK_BYTES || event.data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('HTTP 返回了无效或过大的数据片段。');
          responseBytes += event.data.length;
          if (responseBytes > MAX_RESPONSE_BYTES) throw new Error('HTTP 响应超过 32 MiB。');
          controller.enqueue(new Uint8Array(event.data));
        } else if (event.type === 'end') {
          if (!responseSettled) throw new Error('HTTP 连接未返回响应头。');
          finished = true; removeListener(); controller.close();
        } else if (event.type === 'error') fail(event.message || 'HTTP 请求失败。');
        else throw new Error('HTTP 返回了未知的流式事件。');
      } catch (error) { fail(error); void sendCancel(); }
    };
    try {
      started = Promise.resolve(invoke('http_start', {
        id, url: String(input), method, headers: [...new Headers(init.headers || {}).entries()], body: init.body ?? null, channel,
      }));
      started.catch(fail);
    } catch (error) { started = Promise.reject(error); started.catch(fail); }
    signal?.addEventListener('abort', abort, { once: true });
    // Covers an abort triggered while the command arguments were being prepared.
    if (signal?.aborted) abort();
    return responsePromise;
  };
}
