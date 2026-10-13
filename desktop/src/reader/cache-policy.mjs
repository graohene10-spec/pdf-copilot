export const READER_CACHE_BYTES = 96 * 1024 * 1024;
export const LARGE_DOCUMENT_BYTES = 32 * 1024 * 1024;

/** Keep entries in least-to-most-recent order, always retaining the active file.
 * @template {{ id: string, size: number }} T
 * @param {T[]} entries
 * @param {string} activeId
 * @returns {T[]}
 */
export function retainReaderEntries(entries, activeId) {
  const current = entries.find(entry => entry.id === activeId);
  if (!current) return [];
  const ordered = [...entries.filter(entry => entry !== current), current];
  const limit = current.size > READER_CACHE_BYTES ? 1
    : ordered.some(entry => entry.size > LARGE_DOCUMENT_BYTES) ? 2 : 3;
  let bytes = ordered.reduce((sum, entry) => sum + entry.size, 0);
  while (ordered.length > 1 && (ordered.length > limit || bytes > READER_CACHE_BYTES)) {
    bytes -= ordered.shift().size;
  }
  return ordered;
}
