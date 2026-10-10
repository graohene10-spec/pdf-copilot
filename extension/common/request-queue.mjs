// Scheduling metadata only: prompts, credentials and pixels never enter this queue.
export const REQUEST_LIMIT_FIELDS = Object.freeze([
  { key: 'concurrent', label: '同时运行的提问 / 全部窗口', min: 1, max: 4, default: 2 },
  { key: 'codex', label: '其中 Codex 同时运行数', min: 1, max: 2, default: 1 },
  { key: 'queued', label: '最多等待的提问 / 全部窗口', min: 0, max: 16, default: 8 },
]);
export function normalizeRequestLimits(value) {
  return Object.fromEntries(REQUEST_LIMIT_FIELDS.map(field => [field.key,
    typeof value?.[field.key] === 'number' && Number.isFinite(value[field.key])
      ? Math.max(field.min, Math.min(field.max, Math.trunc(value[field.key]))) : field.default]));
}
export class RequestQueue {
  constructor(entries = []) {
    this.entries = Array.isArray(entries) ? entries.filter(item => item && typeof item.id === 'string' && typeof item.owner === 'string'
      && Number.isInteger(item.tabId) && ['codex', 'openai', 'deepseek'].includes(item.provider)
      && ['running', 'queued'].includes(item.status)).slice(0, 20).map(({ id, owner, tabId, provider, status }) => ({ id, owner, tabId, provider, status })) : [];
    this.limits = normalizeRequestLimits();
  }
  configure(limits) { this.limits = normalizeRequestLimits(limits); this.drain(); }
  available(provider) {
    const running = this.entries.filter(item => item.status === 'running');
    return running.length < this.limits.concurrent && (provider !== 'codex' || running.filter(item => item.provider === 'codex').length < this.limits.codex);
  }
  drain() {
    // Oldest eligible job first; a saturated Codex slot must not block free API slots.
    for (const item of this.entries) if (item.status === 'queued' && this.available(item.provider)) item.status = 'running';
  }
  add(item) {
    const existing = this.entries.find(entry => entry.id === item.id);
    if (existing) {
      if (existing.owner !== item.owner) throw new Error('提问编号已被占用。');
      return this.state(item.id, item.owner);
    }
    this.drain();
    const status = this.available(item.provider) ? 'running' : 'queued';
    if (status === 'queued' && this.entries.filter(entry => entry.status === 'queued').length >= this.limits.queued) throw new Error('等待队列已满，请稍后再试，或停止其他提问。');
    this.entries.push({ ...item, status });
    return this.state(item.id, item.owner);
  }
  remove(predicate) { this.entries = this.entries.filter(item => !predicate(item)); this.drain(); }
  state(id, owner) {
    const item = this.entries.find(entry => entry.id === id && entry.owner === owner);
    if (!item) return { status: 'missing' };
    return { status: item.status, position: item.status === 'queued' ? this.entries.filter(entry => entry.status === 'queued').findIndex(entry => entry.id === id) + 1 : 0 };
  }
  summary() {
    return { running: this.entries.filter(item => item.status === 'running').length,
      queued: this.entries.filter(item => item.status === 'queued').length, limits: this.limits };
  }
}
