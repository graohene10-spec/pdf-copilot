import { RequestQueue } from '../../../extension/common/request-queue.mjs';

// One app-wide queue. Only identifiers and scheduling metadata live here.
export class RequestScheduler {
  constructor(limits) {
    this.queue = new RequestQueue();
    this.queue.configure(limits);
    this.jobs = new Map();
    this.listeners = new Set();
    this.sequence = 0;
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.queue.summary()); return () => this.listeners.delete(listener); }
  configure(limits) { this.queue.configure(limits); this.publish(); }
  publish() {
    for (const [id, job] of this.jobs) {
      const state = this.queue.state(id, job.owner);
      const signature = `${state.status}:${state.position}`;
      if (job.lastState !== signature) { job.lastState = signature; job.onState?.(state); }
      if (state.status === 'running' && !job.started) { job.started = true; job.resolve(); }
    }
    for (const listener of this.listeners) listener(this.queue.summary());
  }
  acquire({ owner, provider, signal, onState }) {
    signal.throwIfAborted();
    if ([...this.jobs.values()].some(job => job.owner === owner)) throw new Error('这份文档已有提问正在运行或等待。');
    const id = crypto.randomUUID();
    let resolve, reject;
    const started = new Promise((done, fail) => { resolve = done; reject = fail; });
    started.catch(() => {});
    const job = { owner, resolve, reject, onState, started: false };
    const release = () => {
      if (!this.jobs.has(id)) return;
      signal.removeEventListener('abort', abort);
      this.jobs.delete(id);
      this.queue.remove(item => item.id === id);
      if (!job.started) reject(signal.reason || new DOMException('提问已停止。', 'AbortError'));
      this.publish();
    };
    // Running jobs keep their slot until network/document cleanup finishes.
    // Queued jobs own no such resources and can be removed immediately.
    const abort = () => { if (!job.started) release(); };
    this.queue.add({ id, owner, provider, tabId: ++this.sequence });
    this.jobs.set(id, job);
    signal.addEventListener('abort', abort, { once: true });
    this.publish();
    return { started, release };
  }
}
