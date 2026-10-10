import { createNativeHttpFetch } from './native-http.mjs';
let nativeFetch;
// Desktop AI streams use an explicitly cancellable Rust reader; preview uses browser fetch.
export async function transportFetch(url, options) {
  if (globalThis.__TAURI_INTERNALS__) {
    if (!nativeFetch) {
      const { invoke, Channel } = await import('@tauri-apps/api/core');
      nativeFetch = createNativeHttpFetch(invoke, Channel);
    }
    return nativeFetch(url, options);
  }
  return globalThis.fetch(url, options);
}
