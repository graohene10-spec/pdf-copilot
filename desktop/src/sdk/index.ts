import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { Doc, Library } from './types';
import { browserLibrary } from './browser';
export type { Doc, Library } from './types';
export const isDesktop = '__TAURI_INTERNALS__' in window;
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args); }
  catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
}
function bytes(value: ArrayBuffer | number[] | Uint8Array) { return value instanceof Uint8Array ? value : new Uint8Array(value); }
export function assetMime(path: string): string {
  const ext = path.split('.').at(-1)?.toLowerCase();
  return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',avif:'image/avif',bmp:'image/bmp'} as Record<string,string>)[ext || ''] || 'application/octet-stream';
}
const nativeLibrary: Library = {
  list: (query = '') => call('list_documents', { query }),
  async importDocuments() {
    const paths = await open({ multiple: true, title: '添加 PDF / Markdown 文档', filters: [{ name: '文档', extensions: ['pdf','md','markdown'] }] });
    if (!paths) return [];
    return call('import_documents', { paths: Array.isArray(paths) ? paths : [paths] });
  },
  async read(id) { return bytes(await call<ArrayBuffer>('read_document', { id })); },
  update: (id, patch) => call('update_document', { id, patch }),
  remove: id => call('remove_document', { id }),
  async readAsset(id, relativePath) { return { data: bytes(await call<ArrayBuffer>('read_asset', { id, relativePath })), mime: assetMime(relativePath) }; },
  index: (id, text) => call('index_document', { id, text }),
  getSetting: key => call('get_setting', { key }),
  setSetting: (key, value) => call('set_setting', { key, value }),
};
export const library = isDesktop ? nativeLibrary : browserLibrary;
const transientCredentials = new Map<string, string>();
export async function getCredential(provider: string): Promise<string> {
  return isDesktop ? (await call<string | null>('get_credential', { provider })) || '' : transientCredentials.get(provider) || '';
}
export async function setCredential(provider: string, key: string): Promise<void> {
  if (isDesktop) await call('set_credential', { provider, key });
  else transientCredentials.set(provider, key);
}
