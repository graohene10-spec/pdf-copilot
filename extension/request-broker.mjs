import { RequestQueue } from './common/request-queue.mjs';

export function createRequestBroker(api, clock = Date.now) {
  let queue, serial = Promise.resolve(), lastSweep = -Infinity;
  const run = (operation, forceSweep = false) => {
    const task = serial.then(async () => {
      if (!queue) queue = new RequestQueue((await api.storage.session.get('requestQueue')).requestQueue);
      const previous = JSON.stringify(queue.entries);
      // One sweep for the whole queue, rather than every client polling all owners.
      if (forceSweep || clock() - lastSweep >= 2500) {
        const contexts = await api.runtime.getContexts({});
        const liveOwners = new Set(contexts.map(item => item.documentId));
        // Edge side-panel messages may omit MessageSender.documentId. Probe the
        // page's random in-memory identity instead; no tab ID or URL is an owner.
        await Promise.all([...new Set(queue.entries.map(item => item.owner).filter(owner => owner.startsWith('chat:')))].map(async owner => {
          try {
            const response = await api.runtime.sendMessage({ type: 'requests:owner-probe', owner });
            if (response?.live === true && response.owner === owner) liveOwners.add(owner);
          } catch {}
        }));
        // Context existence survives worker restarts and avoids expiring a slow, live job.
        queue.entries = queue.entries.filter(item => liveOwners.has(item.owner)); lastSweep = clock();
      }
      const { settings = {} } = await api.storage.local.get('settings');
      queue.configure(settings.requestLimits);
      let result;
      try { result = await operation(queue); }
      finally {
        if (JSON.stringify(queue.entries) !== previous) {
          try { await api.storage.session.set({ requestQueue: queue.entries }); }
          catch (error) { queue = new RequestQueue(JSON.parse(previous)); throw error; }
          api.runtime.sendMessage({ type: 'requests:changed', summary: queue.summary() }).catch(() => {});
        }
      }
      return { ok: true, ...result, summary: queue.summary() };
    });
    serial = task.catch(() => {});
    return task;
  };
  return {
    async handle(message, sender) {
      if (!sender.url?.startsWith(api.runtime.getURL('chat/index.html'))) throw new Error('仅对话窗口可调度提问。');
      const owner = sender.documentId || (typeof message.owner === 'string' && /^chat:[a-zA-Z0-9-]{8,80}$/.test(message.owner) ? message.owner : null);
      if (message.type !== 'requests:summary' && !owner) throw new Error('对话身份无效，请重新打开对话。');
      if (message.type !== 'requests:summary' && (typeof message.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(message.id))) throw new Error('提问编号无效。');
      return run(async queue => {
        if (message.type === 'requests:acquire') {
          if (!['codex', 'openai', 'deepseek'].includes(message.provider) || !Number.isInteger(message.tabId) || message.tabId <= 0) throw new Error('提问来源无效。');
          await api.tabs.get(message.tabId);
          return queue.add({ id: message.id, owner, tabId: message.tabId, provider: message.provider });
        }
        if (message.type === 'requests:release') queue.remove(item => item.id === message.id && item.owner === owner);
        return message.type === 'requests:summary' ? {} : queue.state(message.id, owner);
      }, message.type === 'requests:acquire');
    },
    invalidateTab(tabId) { return run(queue => { queue.remove(item => item.tabId === tabId); return {}; }); },
    refresh() { return run(() => ({}), true); },
  };
}
