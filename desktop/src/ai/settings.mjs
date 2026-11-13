import { DEFAULTS } from '../../../extension/common/settings.js';
import { normalizeDocumentLimits } from '../../../extension/common/document-limits.mjs';
import { normalizeRequestLimits } from '../../../extension/common/request-queue.mjs';
const keys = new Map();
const storageKey = 'paperdesk.ai.settings.v1';
export function loadAiSettings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch {}
  delete stored.apiKey;
  return { ...DEFAULTS, ...stored, documentLimits: normalizeDocumentLimits(stored.documentLimits), requestLimits: normalizeRequestLimits(stored.requestLimits) };
}
export async function loadApiKey(provider) {
  if (keys.has(provider)) return keys.get(provider);
  if (globalThis.__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    const key = await invoke('get_credential', { provider });
    if (key) keys.set(provider, key);
    return key || '';
  }
  return '';
}
export async function saveAiSettings(settings, apiKey) {
  const clean = { ...settings, documentLimits: normalizeDocumentLimits(settings.documentLimits), requestLimits: normalizeRequestLimits(settings.requestLimits) };
  delete clean.apiKey;
  keys.set(clean.provider, apiKey || '');
  if (globalThis.__TAURI_INTERNALS__ && clean.provider !== 'codex') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_credential', { provider: clean.provider, key: clean.rememberKey ? apiKey || '' : '' });
  }
  localStorage.setItem(storageKey, JSON.stringify(clean));
}
// The composer's quick picker changes only the model and effort. Credentials
// and every other field keep their stored values.
export function saveModelChoice(model, effort, fast) {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch {}
  delete stored.apiKey;
  localStorage.setItem(storageKey, JSON.stringify({ ...stored, model, effort, ...(fast === undefined ? {} : { fast: Boolean(fast) }) }));
}
/** 支持 Fast（优先通道）的服务商：Codex 本机登录与 OpenAI API。 */
export const supportsFast = provider => provider === 'codex' || provider === 'openai';
/**
 * 翻译用的 AI：默认与阅读助手共用服务商（连接、密钥都一样），模型、思考强度、Fast 各自选；
 * 也可以换成另一家服务商。model 留空时用该服务商的小模型。
 */
export const TRANSLATION_DEFAULTS = Object.freeze({ share: true, provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: '', effort: '', fast: false });
export function translationSettings(main = loadAiSettings()) {
  const own = { ...TRANSLATION_DEFAULTS, ...(main.translation || {}) };
  const connection = own.share ? { provider: main.provider, baseUrl: main.baseUrl, protocol: main.protocol } : { provider: own.provider, baseUrl: own.baseUrl, protocol: own.protocol };
  return { ...main, ...connection, model: own.model, effort: own.effort, fast: Boolean(own.fast) && supportsFast(connection.provider), translation: own };
}
/**
 * 快速解释用的 AI：服务商可以跟阅读助手一样（assistant）、跟翻译一样（translation），或者自己单独一家（own）；
 * 模型、思考强度、Fast 始终自己选。
 */
export const EXPLAIN_DEFAULTS = Object.freeze({ share: 'assistant', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', protocol: 'chat', model: '', effort: '', fast: false });
export function explainSettings(main = loadAiSettings()) {
  const own = { ...EXPLAIN_DEFAULTS, ...(main.explain || {}) };
  const from = own.share === 'own' ? own : own.share === 'translation' ? translationSettings(main) : main;
  const connection = { provider: from.provider, baseUrl: from.baseUrl, protocol: from.protocol };
  return { ...main, ...connection, model: own.model, effort: own.effort, fast: Boolean(own.fast) && supportsFast(connection.provider), explain: own };
}
/** 翻译窗口里改模型 / 强度 / Fast：只动 translation 这一块。 */
export function saveTranslationChoice(patch) {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch {}
  delete stored.apiKey;
  localStorage.setItem(storageKey, JSON.stringify({ ...stored, translation: { ...TRANSLATION_DEFAULTS, ...(stored.translation || {}), ...patch } }));
}
// 其他服务的凭据（例如有道翻译的应用 ID 与密钥）：桌面版加密保存在本机，浏览器预览只留在内存里。
export async function saveCredential(provider, key) {
  keys.set(provider, key || '');
  if (globalThis.__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_credential', { provider, key: key || '' });
  }
}
