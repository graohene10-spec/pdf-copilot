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
