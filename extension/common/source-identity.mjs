export function documentUrl(value = '') {
  try { const url = new URL(value); url.hash = ''; return url.href; }
  catch { return value; }
}
export const sourceIdentity = source => source.documentKey || documentUrl(source.url);
