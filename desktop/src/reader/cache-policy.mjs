export const READER_CACHE_BYTES = 96 * 1024 * 1024;
export const LARGE_DOCUMENT_BYTES = 32 * 1024 * 1024;

/** Keep entries in least-to-most-recent order, always retaining the active file
 * and every file still shown in a side-by-side pane.
 * @template {{ id: string, size: number }} T
 * @param {T[]} entries
 * @param {string} activeId
 * @param {string[]} [visibleIds] files on screen beside the active one
 * @returns {T[]}
 */
export function retainReaderEntries(entries, activeId, visibleIds = []) {
  const current = entries.find(entry => entry.id === activeId);
  if (!current) return [];
  const pinned = new Set([activeId, ...visibleIds]);
  const ordered = [...entries.filter(entry => entry !== current), current];
  const visible = ordered.filter(entry => pinned.has(entry.id)).length;
  const limit = Math.max(visible, current.size > READER_CACHE_BYTES ? 1
    : ordered.some(entry => entry.size > LARGE_DOCUMENT_BYTES) ? 2 : 3);
  let bytes = ordered.reduce((sum, entry) => sum + entry.size, 0);
  // Evict the least recent file that is off screen; visible panes stay mounted.
  while (ordered.length > visible && (ordered.length > limit || bytes > READER_CACHE_BYTES)) {
    const index = ordered.findIndex(entry => !pinned.has(entry.id));
    if (index < 0) break;
    bytes -= ordered.splice(index, 1)[0].size;
  }
  return ordered;
}
