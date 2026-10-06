export const DEFAULTS = Object.freeze({
  provider: 'deepseek', model: 'deepseek-flash', effort: 'high',
  theme: 'system', baseUrl: 'https://api.deepseek.com', rememberKey: false,
});

export async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...settings };
}

export async function saveSettings(settings, key) {
  const clean = { ...settings };
  delete clean.apiKey;
  await chrome.storage.local.set({ settings: clean });
  const keyName = 'apiKey:' + clean.provider;
  if (clean.rememberKey && key) {
    await chrome.storage.local.set({ [keyName]: key });
    await chrome.storage.session.remove(keyName);
  } else {
    await chrome.storage.local.remove(keyName);
    if (key) await chrome.storage.session.set({ [keyName]: key });
    else await chrome.storage.session.remove(keyName);
  }
}

export async function loadKey(provider) {
  const keyName = 'apiKey:' + provider;
  const session = await chrome.storage.session.get(keyName);
  if (session[keyName]) return session[keyName];
  return (await chrome.storage.local.get(keyName))[keyName] || '';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
}

export function apiOrigin(baseUrl) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含密码、查询参数或锚点。');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('API 地址需要 HTTPS；本机服务可以使用 HTTP。');
  return url.origin + '/*';
}
